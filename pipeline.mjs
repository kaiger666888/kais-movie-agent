#!/usr/bin/env node
/**
 * Movie Pipeline V3 — AI 短片全流程编排器
 *
 * Usage:
 *   node pipeline.mjs run <topic>                    # 完整管线
 *   node pipeline.mjs run <topic> --resume           # 从checkpoint恢复
 *   node pipeline.mjs run <topic> --from <step>      # 从指定步骤开始
 *   node pipeline.mjs status <projectId>             # 查看状态
 *   node pipeline.mjs list                           # 列出所有项目
 *
 * Steps: topic → outline → art-direction → characters → scenes → scenario → storyboard → shooting-script → production → post
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync, exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { JimengClient } from "./lib/jimeng-client.js";
import { EvolutionPipeline } from "./lib/evolution-pipeline.js";

const execAsync = promisify(execCb);

// ─── Constants ────────────────────────────────────────────

const VERSION = "3.0.0";
const STEPS = [
  { id: "topic", name: "选题分析", skill: "kais-topic-selector", output: "concept.json", approval: { type: "select", label: "请选择选题方向" } },
  { id: "outline", name: "故事大纲", skill: "kais-story-outline", output: "story.json", approval: { type: "confirm", label: "请确认故事大纲" } },
  { id: "art-direction", name: "美术方向", skill: "kais-art-direction", output: "art-direction.json", approval: { type: "select", label: "请选择并锁定全局风格" } },
  { id: "characters", name: "角色设计", skill: "kais-character-designer", output: "characters.json", approval: { type: "select", label: "请选择角色设计方案" } },
  { id: "scenes", name: "场景设计", skill: "kais-scene-designer", output: "scenes.json", approval: { type: "confirm", label: "请确认场景设计" } },
  { id: "scenario", name: "剧本写作", skill: "kais-scenario-writer", output: "scenario.json", approval: { type: "select", label: "请选择剧本版本(A或B)" } },
  { id: "storyboard", name: "分镜设计", skill: "kais-storyboard-designer", output: "storyboard.json", approval: { type: "confirm", label: "请确认分镜设计" } },
  { id: "shooting-script", name: "拍摄脚本", skill: "kais-shooting-script", output: "shooting-script.json", approval: null },
  { id: "production", name: "素材生产", skill: null, output: "production.json", approval: null },
  { id: "post", name: "后期合成", skill: null, output: "final.json", approval: null },
];

// ─── Utilities ────────────────────────────────────────────

function log(msg, emoji = "▶") {
  const t = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  console.log(`[${t}] ${emoji} ${msg}`);
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function saveJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function genProjectId(topic) {
  const ts = Date.now().toString(36);
  const slug = topic.slice(0, 20).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_");
  return `movie_${ts}_${slug}`;
}

function parseArgs() {
  const args = { _: [] };
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i];
    const next = process.argv[i + 1];
    if (key === "--resume") args.resume = true;
    if (key === "--from" && next) { args.from = next; i++; }
    if (key === "--dry-run") args.dryRun = true;
    if (key === "--workdir" && next) { args.workdir = next; i++; }
    if (key === "--shots" && next) { args.shots = parseInt(next); i++; }
    if (key === "--duration" && next) { args.duration = parseInt(next); i++; }
    if (key === "--ratio" && next) { args.ratio = next; i++; }
    if (key === "--style" && next) { args.style = next; i++; }
    if (key === "--interactive") args.interactive = true;
    if (key === "--evolution") args.evolution = true;
    if (key === "--choice" && next) { args.choice = next; i++; }
    if (!key.startsWith("--")) args._.push(key);
  }
  return args;
}

// ─── MoviePipeline Class ──────────────────────────────────

class MoviePipeline {
  constructor(config = {}) {
    this.workdir = config.workdir || "/tmp/crew-v3-build";
    this.skillsDir = config.skillsDir || resolve(this.workdir, "skills");
    this.existingSkillsDir = config.existingSkillsDir || resolve(process.env.HOME, ".openclaw/workspace/skills");
    this.projectDir = null;
    this.projectId = null;
    this.state = null;
    this.config = {
      shots: config.shots || 8,
      duration: config.duration || 50,
      ratio: config.ratio || "9:16",
      style: config.style || null,
      popSize: 1, // MVP: no evolution
      evolution: config.evolution || false,
    };
    this.evolutionPipeline = null;
  }

  /** Initialize evolution pipeline if --evolution mode */
  #initEvolution() {
    if (this.evolutionPipeline) return;
    this.evolutionPipeline = new EvolutionPipeline({
      stateDir: join(this.projectDir, "evolution"),
      maxGenerations: 3,
      populationSizes: { text: 5, visual: 3, execution: 1 },
    });
  }

  /** Get skill path (existing or new) */
  getSkillPath(skillName) {
    const newPath = join(this.skillsDir, skillName);
    if (existsSync(newPath)) return newPath;
    const existingPath = join(this.existingSkillsDir, skillName);
    if (existsSync(existingPath)) return existingPath;
    return null;
  }

  /** Initialize or load project */
  async initProject(topic, resume = false, fromStep = null) {
    if (resume || fromStep) {
      // Find latest project or use topic hint
      const projects = this.listProjects();
      if (projects.length === 0) throw new Error("No existing projects to resume");
      // If fromStep, try to find project containing topic
      const target = fromStep ? projects.find(p => {
        try {
          const s = loadJson(join(this.workdir, p, ".checkpoint.json"));
          return s.topic && s.topic.includes(topic);
        } catch { return false; }
      }) : projects[projects.length - 1];
      this.projectId = target.replace("/", "");
      this.projectDir = join(this.workdir, this.projectId);
      this.state = this.loadCheckpoint();
      if (fromStep) {
        const stepIdx = STEPS.findIndex(s => s.id === fromStep);
        if (stepIdx < 0) throw new Error(`Unknown step: ${fromStep}`);
        this.state.currentStep = fromStep;
      }
      log(`Resumed project: ${this.projectId} (from step: ${this.state.currentStep})`, "🔄");
      return;
    }

    this.projectId = genProjectId(topic);
    this.projectDir = join(this.workdir, this.projectId);
    ensureDir(this.projectDir);
    ensureDir(join(this.projectDir, "assets"));
    ensureDir(join(this.projectDir, "clips"));
    ensureDir(join(this.projectDir, "output"));

    this.state = {
      type: "ProjectManifest",
      version: VERSION,
      project_id: this.projectId,
      topic,
      currentStep: "topic",
      completedSteps: [],
      config: { ...this.config },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.saveCheckpoint();
    log(`New project: ${this.projectId} — "${topic}"`, "🎬");
  }

  loadCheckpoint() {
    const path = join(this.projectDir, ".checkpoint.json");
    return existsSync(path) ? loadJson(path) : null;
  }

  saveCheckpoint() {
    if (!this.state || !this.projectDir) return;
    this.state.updatedAt = new Date().toISOString();
    saveJson(join(this.projectDir, ".checkpoint.json"), this.state);
  }

  /** Run a single skill step — delegates to AI agent via SKILL.md */
  async runSkill(stepId) {
    const stepDef = STEPS.find(s => s.id === stepId);
    if (!stepDef) throw new Error(`Unknown step: ${stepId}`);

    const outputPath = join(this.projectDir, stepDef.output);
    if (existsSync(outputPath)) {
      log(`${stepDef.name}: output exists, skipping`, "⏭️");
      return loadJson(outputPath);
    }

    log(`${stepDef.name} (${stepDef.id})...`, "🔧");
    this.state.currentStep = stepId;
    this.saveCheckpoint();

    if (stepDef.skill) {
      const skillPath = this.getSkillPath(stepDef.skill);
      if (!skillPath) {
        log(`Skill not found: ${stepDef.skill}, marking as SKILL_REQUIRED`, "⚠️");
        this.state.currentStep = stepId;
        this.state.skillRequired = stepDef.skill;
        this.state.skillPath = skillPath;
        this.saveCheckpoint();
        return null; // Signal to agent: need to run this skill
      }
      log(`  Skill: ${skillPath}`, "📄");
    }

    // For skills that need AI execution, we mark as pending and return
    // The agent (OpenClaw) will read the SKILL.md and execute

    // ── Evolution mode: if enabled and step is evolvable ──
    if (this.config.evolution && this.evolutionPipeline?.isEvolvable(stepId)) {
      const evoConfig = this.evolutionPipeline.getStepConfig(stepId);
      if (evoConfig && evoConfig.populationSize > 1) {
        log(`  Evolution mode: pop=${evoConfig.populationSize}, strategy=${evoConfig.selection}`, "🧬");
        this.state.evolutionRequired = {
          stepId,
          skill: stepDef.skill,
          config: evoConfig,
        };
        this.state.inputHints = this.buildInputHints(stepId);
        this.state.outputPath = outputPath;
        this.saveCheckpoint();
        log(`  → EVOLUTION_PENDING: 需要进化式执行 ${stepDef.skill}`, "🧬");
        return null;
      }
    }

    this.state.skillRequired = stepDef.skill;
    this.state.inputHints = this.buildInputHints(stepId);
    this.state.outputPath = outputPath;
    this.saveCheckpoint();

    log(`  → SKILL_PENDING: 需要执行 ${stepDef.skill}`, "⏸️");
    log(`  → 读取 SKILL.md: ${this.getSkillPath(stepDef.skill)}/SKILL.md`);
    log(`  → 输出写入: ${outputPath}`);
    return null;
  }

  /** Complete a skill step and trigger approval if needed */
  completeSkillStep(stepId, outputPath = null) {
    const stepDef = STEPS.find(s => s.id === stepId);

    // If interactive mode with approval, check if we need approval gate
    if (this.interactive && stepDef?.approval) {
      // Try to load output for preview
      let outputData = null;
      const outPath = outputPath || join(this.projectDir, stepDef.output);
      if (existsSync(outPath)) {
        try { outputData = loadJson(outPath); } catch {}
      }

      this.setApprovalPending(stepId, outputData);
      this.state.approvalRequired = stepId;
      this.state.currentStep = stepId;
      this.saveCheckpoint();

      this.printApprovalGate(stepId);
      return; // Pause pipeline for approval
    }

    // No approval needed — just complete and advance
    this.completeStep(stepId, outputPath);
  }

  /** Build input file hints for current step */
  buildInputHints(stepId) {
    const stepIdx = STEPS.findIndex(s => s.id === stepId);
    const hints = {};
    for (let i = 0; i < stepIdx; i++) {
      const s = STEPS[i];
      const p = join(this.projectDir, s.output);
      if (existsSync(p)) hints[s.id] = p;
    }
    return hints;
  }

  /** Generate preview summary for approval */
  generatePreview(stepId, outputData) {
    if (!outputData) return "(无产出数据)";
    const stepDef = STEPS.find(s => s.id === stepId);
    if (!stepDef?.approval) return "";

    if (stepDef.approval.type === "select") {
      // Extract options from output
      const options = outputData.options || outputData.candidates || outputData.variants || outputData.versions || [];
      if (Array.isArray(options) && options.length > 0) {
        return options.map((opt, i) => {
          const label = opt.title || opt.name || opt.label || opt.variant || `选项${i + 1}`;
          const desc = opt.description || opt.summary || opt.style || "";
          return `  ${i + 1}. ${label}${desc ? ` — ${desc.slice(0, 60)}` : ""}`;
        }).join("\n");
      }
      // Fallback: try to extract keys as options
      const keys = Object.keys(outputData).filter(k => !k.startsWith("_") && typeof outputData[k] === "object");
      if (keys.length > 0) {
        return keys.map((k, i) => `  ${i + 1}. ${k}`).join("\n");
      }
      return `  产出包含 ${Object.keys(outputData).length} 个字段，请查看 ${stepDef.output}`;
    }

    if (stepDef.approval.type === "confirm") {
      const lines = [];
      if (outputData.logline) lines.push(`  Logline: ${outputData.logline.slice(0, 100)}`);
      if (outputData.synopsis) lines.push(`  Synopsis: ${outputData.synopsis.slice(0, 100)}...`);
      if (outputData.style_name) lines.push(`  风格: ${outputData.style_name}`);
      if (outputData.title) lines.push(`  标题: ${outputData.title}`);
      if (outputData.scenes) lines.push(`  场景数: ${Array.isArray(outputData.scenes) ? outputData.scenes.length : "N/A"}`);
      if (outputData.shots) lines.push(`  分镜数: ${Array.isArray(outputData.shots) ? outputData.shots.length : "N/A"}`);
      if (outputData.beats) lines.push(`  故事节拍: ${Array.isArray(outputData.beats) ? outputData.beats.length : "N/A"}`);
      return lines.length > 0 ? lines.join("\n") : `  产出包含 ${Object.keys(outputData).length} 个字段`;
    }

    return "";
  }

  /** Check if approval is required for a step, returns approval status or null */
  checkApproval(stepId) {
    const stepDef = STEPS.find(s => s.id === stepId);
    if (!stepDef?.approval) return null; // No approval needed
    if (!this.interactive) return null; // Not in interactive mode

    const approvals = this.state.approvals || {};
    const approval = approvals[stepId];

    if (approval?.status === "approved" || approval?.status === "skipped") {
      return { status: approval.status, choice: approval.choice };
    }

    return { status: "pending" };
  }

  /** Mark approval as pending after skill execution */
  setApprovalPending(stepId, outputData) {
    if (!this.state.approvals) this.state.approvals = {};
    this.state.approvals[stepId] = { status: "pending", timestamp: new Date().toISOString() };
    this.state.approvalPreview = this.generatePreview(stepId, outputData);
    this.saveCheckpoint();
  }

  /** Record director's approval choice */
  recordApproval(stepId, choice) {
    if (!this.state.approvals) this.state.approvals = {};
    this.state.approvals[stepId] = {
      status: choice === "skip" ? "skipped" : "approved",
      choice,
      timestamp: new Date().toISOString(),
    };
    delete this.state.approvalPreview;
    delete this.state.approvalRequired;
    this.saveCheckpoint();
  }

  /** Print approval gate block */
  printApprovalGate(stepId) {
    const stepDef = STEPS.find(s => s.id === stepId);
    if (!stepDef?.approval) return;

    console.log(`\n════════════════════════════════════`);
    console.log(`📋 APPROVAL_REQUIRED`);
    console.log(`   步骤: ${stepDef.name} (${stepId})`);
    console.log(`   审批类型: ${stepDef.approval.type}（${stepDef.approval.label}）`);
    console.log(`   产出文件: ${stepDef.output}`);
    if (this.state.approvalPreview) {
      console.log(`   预览:\n${this.state.approvalPreview}`);
    }
    console.log(``);
    console.log(`   请导演确认：`);
    console.log(`   - 回复选项编号（如 "1" 或 "A"）`);
    console.log(`   - 回复 "ok" 确认`);
    console.log(`   - 回复 "rerun" 重新生成`);
    console.log(`   - 回复 "skip" 跳过审批`);
    console.log(``);
    console.log(`   确认后执行: node pipeline.mjs approve "${this.projectId}" --choice <选项>`);
    console.log(`════════════════════════════════════\n`);
  }
  completeStep(stepId, outputPath = null) {
    const stepDef = STEPS.find(s => s.id === stepId);
    if (outputPath) {
      this.state[stepId.replace(/-/g, "_")] = outputPath;
    }
    if (!this.state.completedSteps.includes(stepId)) {
      this.state.completedSteps.push(stepId);
    }
    this.state.skillRequired = null;

    // Advance to next step
    const idx = STEPS.findIndex(s => s.id === stepId);
    if (idx < STEPS.length - 1) {
      this.state.currentStep = STEPS[idx + 1].id;
    } else {
      this.state.currentStep = "done";
    }
    this.saveCheckpoint();
    log(`✅ ${stepDef?.name || stepId} complete → next: ${this.state.currentStep}`, "🎉");
  }

  /** Execute production phase — generate images/videos via kais-jimeng API */
  async executeProduction() {
    const shootingScriptPath = join(this.projectDir, "shooting-script.json");
    if (!existsSync(shootingScriptPath)) {
      throw new Error("shooting-script.json not found. Run shooting-script step first.");
    }

    const script = loadJson(shootingScriptPath);
    const jimeng = new JimengClient();

    // 健康检查
    if (!(await jimeng.ping())) {
      throw new Error("即梦 API 服务未运行 (http://localhost:8000)。请先启动服务。");
    }

    log(`Production: ${script.shots?.length || 0} shots to generate`, "🏭");

    const results = [];
    for (const shot of (script.shots || [])) {
      const shotId = shot.shot_id || `shot_${results.length}`;
      const isVideo = shot.mode === "video" && !shot.fallback_needed;
      const ext = isVideo ? ".mp4" : ".png";
      const outputPath = join(this.projectDir, "assets", `${shotId}${ext}`);

      if (existsSync(outputPath)) {
        log(`  ${shotId}: exists, skipping`, "⏭️");
        results.push({ shot_id: shotId, path: outputPath, status: "existing", mode: isVideo ? "video" : "image" });
        continue;
      }

      const apiParams = shot.api_params || {};
      const ratio = apiParams.ratio || shot.aspect_ratio || this.config.ratio || "16:9";

      try {
        if (isVideo && apiParams.file_paths?.length) {
          // ── Seedance 异步视频流程 ──
          log(`  ${shotId}: Seedance async video...`, "🎬");
          const taskId = await jimeng.submitSeedanceTask(apiParams.prompt, apiParams.file_paths, {
            model: apiParams.model,
            ratio,
            duration: apiParams.duration || 4,
          });
          log(`  ${shotId}: task submitted (${taskId})`, "⏳");
          const videoUrl = await jimeng.pollTask(taskId);
          await jimeng.download(videoUrl, outputPath);
          results.push({ shot_id: shotId, path: outputPath, status: "generated", mode: "video" });
          log(`  ${shotId}: ✅ video`, "🎬");
        } else if (isVideo) {
          // ── 普通视频模型（纯文本） ──
          log(`  ${shotId}: sync video (${apiParams.model})...`, "🎬");
          const videoUrl = await jimeng.generateVideo(apiParams.prompt, {
            model: apiParams.model,
            ratio,
            duration: apiParams.duration || 5,
          });
          if (videoUrl) {
            await jimeng.download(videoUrl, outputPath);
            results.push({ shot_id: shotId, path: outputPath, status: "generated", mode: "video" });
            log(`  ${shotId}: ✅ video`, "🎬");
          } else {
            throw new Error("视频生成返回空结果");
          }
        } else {
          // ── 文生图（image 模式或降级） ──
          log(`  ${shotId}: generating image...`, "🖼️");
          const imgPrompt = apiParams.prompt || shot.prompt || "";
          const data = await jimeng.generateImage(imgPrompt, {
            model: apiParams.model || "jimeng-5.0",
            ratio,
          });
          if (data?.[0]?.url) {
            await jimeng.download(data[0].url, outputPath);
            results.push({ shot_id: shotId, path: outputPath, status: "generated", mode: "image" });
            log(`  ${shotId}: ✅`, "🖼️");
          } else {
            throw new Error("图片生成返回空结果");
          }
        }
      } catch (e) {
        log(`  ${shotId}: ❌ ${e.message}`, "⚠️");
        results.push({ shot_id: shotId, path: outputPath, status: "failed", error: e.message, mode: isVideo ? "video" : "image" });

        // 降级：视频失败 → 尝试文生图
        if (isVideo) {
          try {
            log(`  ${shotId}: degrading to image...`, "🔄");
            const imgPrompt = (shot.fallback?.prompt || apiParams.prompt || "").replace(/^@1\s*/, "");
            const data = await jimeng.generateImage(imgPrompt, {
              model: "jimeng-5.0",
              ratio,
            });
            if (data?.[0]?.url) {
              const imgPath = join(this.projectDir, "assets", `${shotId}.png`);
              await jimeng.download(data[0].url, imgPath);
              results[results.length - 1] = { shot_id: shotId, path: imgPath, status: "degraded", mode: "image" };
              log(`  ${shotId}: ✅ degraded to image`, "🖼️");
            }
          } catch (e2) {
            log(`  ${shotId}: degradation also failed: ${e2.message}`, "⚠️");
          }
        }
      }
    }

    saveJson(join(this.projectDir, "production.json"), { shots: results, timestamp: new Date().toISOString() });
    return results;
  }

  /** Post-process: concatenate clips */
  async postProcess() {
    const prodPath = join(this.projectDir, "production.json");
    if (!existsSync(prodPath)) {
      throw new Error("production.json not found. Run production step first.");
    }

    const prod = loadJson(prodPath);
    const clips = prod.shots?.filter(s => s.status === "generated" || s.status === "existing") || [];
    if (clips.length === 0) throw new Error("No generated clips found");

    log(`Post-process: ${clips.length} clips`, "✂️");

    const concatFile = join(this.projectDir, "concat.txt");
    const concatContent = clips.map(s => `file '${s.path}'`).join("\n");
    writeFileSync(concatFile, concatContent);

    const outputPath = join(this.projectDir, "output", "final.mp4");
    try {
      await execAsync(`ffmpeg -f concat -safe 0 -i "${concatFile}" -c copy "${outputPath}"`, { timeout: 60000 });
      log(`Final video: ${outputPath}`, "🎬");
    } catch (e) {
      log(`FFmpeg failed: ${e.message}`, "⚠️");
      // Try with re-encoding
      try {
        await execAsync(`ffmpeg -f concat -safe 0 -i "${concatFile}" -c:v libx264 -preset fast "${outputPath}"`, { timeout: 120000 });
        log(`Final video (re-encoded): ${outputPath}`, "🎬");
      } catch (e2) {
        throw new Error(`FFmpeg concat failed: ${e2.message}`);
      }
    }

    saveJson(join(this.projectDir, "final.json"), {
      outputPath,
      clipCount: clips.length,
      timestamp: new Date().toISOString(),
    });
    return outputPath;
  }

  /** Main run loop */
  async run(topic, options = {}) {
    const { resume = false, fromStep = null, dryRun = false, interactive = false } = options;
    this.interactive = interactive;

    if (this.config.evolution) {
      this.#initEvolution();
      log("Evolution mode enabled — population-based skill execution", "🧬");
    }

    await this.initProject(topic, resume, fromStep);

    const startIdx = fromStep
      ? STEPS.findIndex(s => s.id === fromStep)
      : STEPS.findIndex(s => s.id === this.state.currentStep);

    if (startIdx < 0) {
      log(`Project already complete!`, "✅");
      return this.state;
    }

    log(`Pipeline starting from step ${STEPS[startIdx].id} (step ${startIdx + 1}/${STEPS.length})`, "🚀");
    log(`Project dir: ${this.projectDir}`, "📁");

    for (let i = startIdx; i < STEPS.length; i++) {
      const step = STEPS[i];

      if (this.state.completedSteps.includes(step.id)) {
        log(`${step.name}: already done, skipping`, "⏭️");
        continue;
      }

      if (step.id === "production") {
        if (!dryRun) {
          await this.executeProduction();
          this.completeStep("production");
        } else {
          log("Production: dry-run, skipping", "🎯");
          this.completeStep("production");
        }
        continue;
      }

      if (step.id === "post") {
        if (!dryRun) {
          await this.postProcess();
          this.completeStep("post");
        } else {
          log("Post: dry-run, skipping", "🎯");
          this.completeStep("post");
        }
        continue;
      }

      // Check if this step has a pending approval
      const approvalStatus = this.checkApproval(step.id);
      if (approvalStatus?.status === "pending") {
        // Load output and show approval gate
        let outputData = null;
        const outPath = join(this.projectDir, step.output);
        if (existsSync(outPath)) {
          try { outputData = loadJson(outPath); } catch {}
        }
        this.state.approvalPreview = this.generatePreview(step.id, outputData);
        this.state.approvalRequired = step.id;
        this.state.currentStep = step.id;
        this.saveCheckpoint();

        this.printApprovalGate(step.id);
        log(`Pipeline paused: 等待导演审批`, "⏸️");
        return this.state;
      }

      // Skill steps — run and check if agent needs to intervene
      const result = await this.runSkill(step.id);
      if (result === null) {
        // Agent intervention needed — save state and return
        log(`\n═══════════════════════════════════`, "");
        log(`⏸️  Pipeline paused at: ${step.name} (${step.skill})`, "📋");
        log(`   需要执行 Skill: ${this.state.skillRequired}`, "📋");
        log(`   输入文件: ${Object.entries(this.state.inputHints || {}).map(([k, v]) => `${k} → ${v}`).join(", ")}`, "📋");
        log(`   输出目标: ${this.state.outputPath}`, "📋");
        log(`   完成后执行: node pipeline.mjs complete "${this.projectId}"`, "📋");
        log(`═══════════════════════════════════`, "");
        return this.state;
      }
      this.completeStep(step.id);
    }

    log(`\n═══════════════════════════════════`, "");
    log(`✅ Pipeline complete: ${this.projectId}`, "🎉");
    log(`📁 Dir: ${this.projectDir}`, "📁");
    log(`🎬 Output: ${join(this.projectDir, "output", "final.mp4")}`, "🎬");
    log(`═══════════════════════════════════`, "");

    return this.state;
  }

  /** Complete a step manually (after agent executed the skill) */
  completeCurrentStep() {
    const step = this.state.currentStep;
    if (!step || step === "done") {
      log("Nothing to complete", "⚠️");
      return;
    }
    const outputPath = join(this.projectDir, STEPS.find(s => s.id === step)?.output || "unknown.json");
    this.completeStep(step, existsSync(outputPath) ? outputPath : null);
  }

  /** Resume from checkpoint */
  async resume(projectId) {
    this.projectId = projectId;
    this.projectDir = join(this.workdir, projectId);
    this.state = this.loadCheckpoint();
    if (!this.state) throw new Error(`Project not found: ${projectId}`);
    log(`Resuming: ${projectId} from step ${this.state.currentStep}`, "🔄");

    if (this.state.currentStep === "done") {
      log("Project already complete!", "✅");
      return this.state;
    }

    // Continue from current step
    const currentIdx = STEPS.findIndex(s => s.id === this.state.currentStep);
    for (let i = currentIdx; i < STEPS.length; i++) {
      const step = STEPS[i];
      if (this.state.completedSteps.includes(step.id)) continue;

      if (step.id === "production") {
        await this.executeProduction();
        this.completeStep("production");
        continue;
      }
      if (step.id === "post") {
        await this.postProcess();
        this.completeStep("post");
        continue;
      }

      const result = await this.runSkill(step.id);
      if (result === null) return this.state; // Pause for agent
      this.completeStep(step.id);
    }

    return this.state;
  }

  getStatus() {
    if (!this.state) return { status: "no-project" };
    return {
      project_id: this.projectId,
      topic: this.state.topic,
      current_step: this.state.currentStep,
      completed: this.state.completedSteps,
      total_steps: STEPS.length,
      progress: `${this.state.completedSteps.length}/${STEPS.length}`,
      percent: Math.round((this.state.completedSteps.length / STEPS.length) * 100),
    };
  }

  listProjects() {
    if (!existsSync(this.workdir)) return [];
    return readdirSync(this.workdir, { withFileTypes: true })
      .filter(d => d.isDirectory() && existsSync(join(this.workdir, d.name, ".checkpoint.json")))
      .map(d => d.name);
  }
}

// ─── CLI ──────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const cmd = args._[0];
  const pipeline = new MoviePipeline({
    workdir: args.workdir,
    shots: args.shots,
    duration: args.duration,
    ratio: args.ratio,
    style: args.style,
    evolution: args.evolution,
  });

  switch (cmd) {
    case "run": {
      const topic = args._[1];
      if (!topic && !args.resume) {
        console.error("Usage: node pipeline.mjs run <topic> [--resume] [--from <step>] [--dry-run]");
        process.exit(1);
      }
      const result = args.resume
        ? await pipeline.resume(args._[1])
        : await pipeline.run(topic, { resume: false, fromStep: args.from, dryRun: args.dryRun, interactive: args.interactive });
      console.log(`\n__STATE__${JSON.stringify(result)}__STATE__`);
      break;
    }
    case "approve": {
      const projectId = args._[1];
      const choice = args.choice || args._[2];
      if (!projectId || !choice) {
        console.error("Usage: node pipeline.mjs approve <projectId> --choice <选项>");
        process.exit(1);
      }
      pipeline.projectId = projectId;
      pipeline.projectDir = join(pipeline.workdir, projectId);
      pipeline.state = pipeline.loadCheckpoint();
      if (!pipeline.state) { console.error("Project not found"); process.exit(1); }

      const approvalStep = pipeline.state.approvalRequired || pipeline.state.currentStep;
      if (!approvalStep) { console.error("No pending approval"); process.exit(1); }

      log(`Approving step ${approvalStep} with choice: ${choice}`, "✅");
      pipeline.recordApproval(approvalStep, choice);
      pipeline.completeStep(approvalStep);

      // Auto-continue to next steps
      log(`Approval recorded, continuing pipeline...`, "🚀");
      const result = await pipeline.run(pipeline.state.topic, {
        resume: true,
        interactive: pipeline.state.approvals ? true : false,
      });
      console.log(`\n__STATE__${JSON.stringify(result)}__STATE__`);
      break;
    }
    case "complete": {
      const projectId = args._[1];
      if (!projectId) {
        console.error("Usage: node pipeline.mjs complete <projectId>");
        process.exit(1);
      }
      pipeline.projectId = projectId;
      pipeline.projectDir = join(pipeline.workdir, projectId);
      pipeline.state = pipeline.loadCheckpoint();
      pipeline.completeCurrentStep();
      console.log(`\n__STATE__${JSON.stringify(pipeline.state)}__STATE__`);
      break;
    }
    case "resume": {
      const projectId = args._[1];
      if (!projectId) {
        // Auto-resume latest
        const projects = pipeline.listProjects();
        if (projects.length === 0) { console.error("No projects found"); process.exit(1); }
        const result = await pipeline.resume(projects[projects.length - 1]);
        console.log(`\n__STATE__${JSON.stringify(result)}__STATE__`);
      } else {
        const result = await pipeline.resume(projectId);
        console.log(`\n__STATE__${JSON.stringify(result)}__STATE__`);
      }
      break;
    }
    case "status": {
      const projectId = args._[1];
      if (projectId) {
        pipeline.projectId = projectId;
        pipeline.projectDir = join(pipeline.workdir, projectId);
        pipeline.state = pipeline.loadCheckpoint();
      }
      console.log(JSON.stringify(pipeline.getStatus(), null, 2));
      break;
    }
    case "list": {
      const projects = pipeline.listProjects();
      if (projects.length === 0) { console.log("No projects found."); break; }
      console.log(`Projects (${projects.length}):`);
      for (const p of projects) {
        const state = JSON.parse(readFileSync(join(pipeline.workdir, p, ".checkpoint.json"), "utf-8"));
        const pct = Math.round((state.completedSteps?.length || 0) / STEPS.length * 100);
        console.log(`  ${p} — "${state.topic}" — ${pct}% (${state.currentStep})`);
      }
      break;
    }
    default:
      console.log(`Movie Pipeline V3
Usage:
  node pipeline.mjs run <topic> [--interactive] [--evolution] [--resume] [--from <step>] [--dry-run]
  node pipeline.mjs complete <projectId>
  node pipeline.mjs approve <projectId> --choice <选项>
  node pipeline.mjs resume [projectId]
  node pipeline.mjs status [projectId]
  node pipeline.mjs list

Steps: ${STEPS.map(s => s.id).join(" → ")}

Modes:
  --interactive  Enable approval gates between steps
  --evolution    Enable population-based evolution (Pop=5→3→2 for text, Pop=3 for visual)`);
  }
}

export { MoviePipeline, STEPS, VERSION };

main().catch(e => { console.error("Pipeline failed:", e); process.exit(1); });
