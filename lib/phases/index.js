/**
 * Phase handlers — 各阶段的介入逻辑
 * pipeline 编排器通过 phaseHandlers[phaseId] 调用对应 handler
 */
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import {
  generateTopics, audienceMatch, deepAudienceAnalysis,
  registerCharacterDNA, registerSceneDNA,
  generateBlueprint, assessQuality,
  generatePoseReferences, generateShotPoses,
  analyzeScript, toGateSupplement, summarizeReport,
} from '../hooks/index.js';
import { GoldTeamClient, GoldTeamError } from '../gold-team-client.js';

/**
 * 各阶段的 before/after 钩子
 * before: 阶段执行前的预处理
 * after: 阶段执行后的后处理（数据提取、DNA注册等）
 */
export const phaseHandlers = {
  requirement: {
    after: async (pipeline, phase, phaseConfig) => {
      const req = pipeline.config;
      await writeFile(join(pipeline.workdir, 'requirement.json'), JSON.stringify(req, null, 2));

      // 四维蓝图
      try {
        await generateBlueprint(pipeline, req);
      } catch (err) {
        console.warn(`[pipeline] 蓝图生成失败（不阻塞）: ${err.message}`);
      }

      // 受众匹配
      try {
        const matchResult = await audienceMatch({ content: req, platform: pipeline.config.platform || 'douyin' });
        pipeline.audienceMatch = matchResult;
        await writeFile(join(pipeline.workdir, 'audience-match.json'), JSON.stringify(matchResult, null, 2));
        console.log('[pipeline] ✅ 受众匹配完成');
      } catch (e) {
        console.warn(`[pipeline] 受众匹配跳过: ${e.message}`);
      }

      // 选题发散
      try {
        const topics = await generateTopics(req, {
          platform: pipeline.config.platform || 'douyin',
          genre: req.genre,
          blueprint: pipeline.blueprint,
        });
        phaseConfig.data = phaseConfig.data || {};
        phaseConfig.data.candidateTopics = topics;
        pipeline.candidateTopics = topics;
        await writeFile(join(pipeline.workdir, 'candidate-topics.json'), JSON.stringify(topics, null, 2));
        console.log(`[pipeline] ✅ 选题发散完成: ${topics.length} 个`);
      } catch (e) {
        console.warn(`[pipeline] 选题发散跳过: ${e.message}`);
      }

      return { summary: { title: req.title, genre: req.genre }, metrics: { characterCount: req.characters?.length || 0 } };
    },
  },

  character: {
    after: async (pipeline, phase, phaseConfig) => {
      const characters = phaseConfig.data?.characters;
      if (!characters?.length) throw new Error('[pipeline] Phase 3 未产出角色数据');
      await registerCharacterDNA(pipeline, characters);

      // 姿态参考图生成（可选，失败不阻断）
      try {
        const poseRefs = await generatePoseReferences(pipeline, characters, {
          mode: pipeline.config.poseMode || 'mixamo',
        });
        pipeline.poseReferences = poseRefs;
        console.log(`[pipeline] ✅ 姿态参考图已生成`);
      } catch (e) {
        console.warn(`[pipeline] 姿态参考图跳过: ${e.message}`);
      }
    },
  },

  scenario: {
    after: async (pipeline, phase, phaseConfig) => {
      if (!phaseConfig.data) return;
      try {
        const analysis = await deepAudienceAnalysis({
          script: typeof phaseConfig.data === 'string' ? phaseConfig.data : phaseConfig.data.script || JSON.stringify(phaseConfig.data),
          platform: pipeline.config.platform || 'douyin',
        });
        pipeline.audienceAnalysis = analysis;
        await writeFile(join(pipeline.workdir, 'audience-analysis.json'), JSON.stringify(analysis, null, 2));
        console.log('[pipeline] ✅ 剧本受众测评完成');
      } catch (e) {
        console.warn(`[pipeline] 剧本受众测评跳过: ${e.message}`);
      }

      // 剧本量化分析（kais-story-score，可选）
      try {
        const storyReport = analyzeScript(phaseConfig.data, {
          language: 'zh',
          storyType: pipeline.config.genre || 'classic_narrative',
        });
        if (storyReport) {
          pipeline.storyScoreReport = storyReport;
          const summary = summarizeReport(storyReport);
          const scorePath = join(pipeline.workdir, 'story-score-report.json');
          await writeFile(scorePath, JSON.stringify(summary, null, 2));
          console.log(`[pipeline] ✅ 剧本量化分析完成: 弧线=${summary.arcShape}(${(summary.arcScore*100).toFixed(0)}%), 建议${summary.adviceCount}条`);
        }
      } catch (e) {
        console.warn(`[pipeline] 剧本量化分析跳过: ${e.message}`);
      }
    },
  },

  voice: {
    after: async (pipeline, phase, phaseConfig) => {
      const workdir = pipeline.workdir;
      const ttsDir = join(workdir, 'assets', 'tts');
      await mkdir(ttsDir, { recursive: true });

      // Collect dialogue lines from phaseConfig.data or scenario.json
      const dialogueLines = phaseConfig.data?.dialogueLines
        || await _loadDialogueFromScenario(workdir);
      if (!dialogueLines?.length) {
        console.log('[pipeline] Phase 4.5 无对白数据，跳过 TTS');
        return { summary: { linesProcessed: 0 }, metrics: {} };
      }

      // Build voice assignments map
      const voiceAssignments = [];

      // Try gold-team TTS first, fallback to local ZHIPU GLM-TTS
      let usedGoldTeam = false;
      try {
        const gtClient = new GoldTeamClient({
          baseUrl: pipeline.config?.goldTeam?.baseUrl,
          apiKey: pipeline.config?.goldTeam?.apiKey,
        });

        // Health check before submitting batch
        const available = await gtClient.ping(5000);
        if (!available) {
          throw new GoldTeamError('gold-team health check failed');
        }

        console.log(`[voice] gold-team 可用，开始提交 ${dialogueLines.length} 条 TTS 任务`);

        for (const line of dialogueLines) {
          const result = await gtClient.submitTTS(line.text, {
            voiceId: line.voiceId || line.voice_id || 'Vivian',
            language: line.language || 'zh',
            outputFormat: line.outputFormat || 'wav',
          });

          // Poll until done (5min timeout per line)
          const task = await gtClient.waitForTask(result.taskId, {
            pollIntervalMs: 3000,
            timeoutMs: 300000,
          });

          // Collect artifact info
          const artifacts = task.artifacts || [];
          const audioFile = artifacts[0]?.path || `${result.taskId}.wav`;
          const outputPath = join(ttsDir, `${line.id || line.lineId || result.taskId}.wav`);

          voiceAssignments.push({
            lineId: line.id || line.lineId || result.taskId,
            character: line.character || line.speaker || '',
            text: line.text,
            voiceId: line.voiceId || line.voice_id || 'Vivian',
            taskId: result.taskId,
            audioFile: basename(outputPath),
            artifactPath: audioFile,
            source: 'gold-team',
          });

          console.log(`[voice] TTS 完成: "${line.text.substring(0, 30)}..." → ${basename(outputPath)}`);
        }

        usedGoldTeam = true;
        console.log(`[voice] gold-team TTS 全部完成: ${voiceAssignments.length} 条`);
      } catch (err) {
        if (err instanceof GoldTeamError) {
          console.warn(`[voice] gold-team 不可用: ${err.message}，使用本地回退`);
          voiceAssignments.length = 0; // Clear partial results
        } else {
          throw err;
        }
      }

      // Fallback: local TTS via ZHIPU GLM-TTS
      if (!usedGoldTeam) {
        console.log(`[voice] 本地 TTS 回退: ${dialogueLines.length} 条`);
        const localResults = await _localTTSFallback(dialogueLines, ttsDir, pipeline.config);
        voiceAssignments.push(...localResults);
      }

      // Save voice_assignments.json
      await writeFile(
        join(workdir, 'voice_assignments.json'),
        JSON.stringify(voiceAssignments, null, 2),
      );

      return {
        summary: {
          linesProcessed: voiceAssignments.length,
          source: usedGoldTeam ? 'gold-team' : 'local-fallback',
        },
        metrics: {
          ttsLines: voiceAssignments.length,
          usedGoldTeam,
        },
      };
    },
  },

  scene: {
    after: async (pipeline, phase, phaseConfig) => {
      const scenes = phaseConfig.data?.scenes;
      if (!scenes?.length) {
        console.log('[pipeline] Phase 5 无场景数据，跳过场景DNA');
        return;
      }
      try {
        await registerSceneDNA(pipeline, scenes);
      } catch (e) {
        console.warn(`[pipeline] 场景DNA跳过: ${e.message}`);
      }
    },
  },

  storyboard: {
    before: async (pipeline, phase) => {
      // 为需要特定动作的分镜镜头生成姿态参考
      if (!pipeline.poseReferences || !pipeline.shots) return;
      try {
        const shotPoses = await generateShotPoses(
          pipeline, pipeline.shots, pipeline.poseReferences
        );
        pipeline.shotPoses = shotPoses;
        console.log(`[pipeline] ✅ 分镜姿态参考已生成`);
      } catch (e) {
        console.warn(`[pipeline] 分镜姿态参考跳过: ${e.message}`);
      }
    },
  },

  camera: {
    before: async (pipeline, phase) => {
      // 恢复角色 DNA（参考图锚定模式）
      if (pipeline.characterDNA.size === 0) {
        try {
          const raw = await readFile(join(pipeline.workdir, 'character-dna.json'), 'utf-8');
          const saved = JSON.parse(raw);
          for (const [name, dna] of Object.entries(saved)) pipeline.characterDNA.set(name, dna);
          console.log(`[pipeline] 恢复了 ${pipeline.characterDNA.size} 个角色DNA卡（参考图锚定模式）`);
        } catch {
          console.warn('[pipeline] ⚠️ 无角色DNA卡，视频生成将不带入角色参考图');
        }
      }

      // 注入角色参考图到 pipeline config，供 camera 阶段使用
      // 即梦通过 @引用 + images 参数实现一致性，不依赖 seed
      if (pipeline.characterDNA.size > 0) {
        const characterRefs = {};
        for (const [name, dna] of pipeline.characterDNA) {
          if (dna.refImages?.length) {
            characterRefs[name] = {
              refImages: dna.refImages,
              description: dna.description || '',
              lastFrameUrl: dna.lastFrameUrl,
            };
          }
        }
        pipeline.config._characterRefs = characterRefs;
        console.log(`[pipeline] ✅ ${Object.keys(characterRefs).length} 个角色参考图已注入（@引用锚定模式）`);
      }

      // 恢复场景 DNA（可选）
      if (pipeline.sceneDNA.size === 0) {
        try {
          const raw = await readFile(join(pipeline.workdir, 'scene-dna.json'), 'utf-8');
          const saved = JSON.parse(raw);
          for (const [name, dna] of Object.entries(saved)) pipeline.sceneDNA.set(name, dna);
        } catch { /* optional */ }
      }
      if (pipeline.sceneDNA.size > 0) {
        const sceneRefs = {};
        for (const [name, dna] of pipeline.sceneDNA) {
          if (dna.refImages?.length) {
            sceneRefs[name] = { refImages: dna.refImages, description: dna.description || '' };
          }
        }
        pipeline.config._sceneRefs = sceneRefs;
        console.log(`[pipeline] ✅ ${Object.keys(sceneRefs).length} 个场景锚定图已注入`);
      }
    },
  },

  'quality-gate': {
    after: async (pipeline) => {
      const result = await assessQuality(pipeline);

      // story-score 数据注入质量门控报告
      if (pipeline.storyScoreReport) {
        try {
          const supplement = toGateSupplement(pipeline.storyScoreReport);
          if (supplement) {
            // 追加到门控结果中
            if (result && result.metrics && result.metrics.dimensions) {
              result.metrics.storyScore = supplement;
              result.metrics.dimensions.storyScore = {
                score: pipeline.storyScoreReport.overall_score || 0,
                detail: `5维度量化: 弧线${supplement.arcMatch.bestShape} 情感覆盖${(supplement.emotionCoverage.coverageScore*100).toFixed(0)}% TTR${supplement.textQuality.ttr.toFixed(3)}`,
              };
            }
            const summary = summarizeReport(pipeline.storyScoreReport);
            const scorePath = join(pipeline.workdir, 'story-score-report.json');
            await writeFile(scorePath, JSON.stringify(summary, null, 2));
            console.log(`[pipeline] ✅ story-score数据已注入门控`);
          }
        } catch (e) {
          console.warn(`[pipeline] story-score注入跳过: ${e.message}`);
        }
      }

      return result;
    },
  },
};

// Phase 8 hook 已在 pipeline.js 的 PHASES 定义中通过 outputFiles 管理
// 后期合成的实际执行由 agent 调用外部工具（ffmpeg等），pipeline 只做检查点

// ─── Voice Phase Helper Functions ────────────────────────────

/**
 * Load dialogue lines from scenario.json on disk.
 * Extracts lines from the scenario structure (various formats supported).
 */
async function _loadDialogueFromScenario(workdir) {
  try {
    const raw = await readFile(join(workdir, 'scenario.json'), 'utf-8');
    const scenario = JSON.parse(raw);

    // Try common scenario structures
    const lines = [];

    // Format 1: scenario.dialogues[]
    if (Array.isArray(scenario.dialogues)) {
      for (const d of scenario.dialogues) {
        lines.push({
          id: d.id || `line-${lines.length + 1}`,
          text: d.text || d.content || '',
          character: d.character || d.speaker || '',
          voiceId: d.voiceId || d.voice_id,
          emotion: d.emotion,
        });
      }
      return lines;
    }

    // Format 2: scenario.scenes[].shots[].dialogue
    if (Array.isArray(scenario.scenes)) {
      for (const scene of scenario.scenes) {
        const shots = scene.shots || [];
        for (const shot of shots) {
          if (shot.dialogue) {
            lines.push({
              id: shot.id || shot.shot_id || `line-${lines.length + 1}`,
              text: shot.dialogue.text || shot.dialogue.content || shot.dialogue,
              character: shot.dialogue.character || shot.dialogue.speaker || '',
              voiceId: shot.dialogue.voiceId || shot.dialogue.voice_id,
              emotion: shot.dialogue.emotion,
            });
          }
        }
      }
      return lines;
    }

    // Format 3: scenario.lines[] (flat structure)
    if (Array.isArray(scenario.lines)) {
      for (const l of scenario.lines) {
        lines.push({
          id: l.id || `line-${lines.length + 1}`,
          text: l.text || l.content || '',
          character: l.character || l.speaker || '',
          voiceId: l.voiceId || l.voice_id,
          emotion: l.emotion,
        });
      }
      return lines;
    }

    return lines;
  } catch {
    return null;
  }
}

/**
 * Local TTS fallback using ZHIPU GLM-TTS API.
 * Used when gold-team is unavailable.
 */
async function _localTTSFallback(dialogueLines, ttsDir, config) {
  const apiKey = config?.zhipuApiKey || process.env.ZHIPU_API_KEY || '';
  const apiUrl = config?.zhipuApiUrl || process.env.ZHIPU_API_URL || 'https://open.bigmodel.cn/api/paas/v4/audio/speech';
  const assignments = [];

  if (!apiKey) {
    console.warn('[voice] ZHIPU_API_KEY 未配置，本地 TTS 跳过 — 生成占位文件');
    for (const line of dialogueLines) {
      const placeholderFile = `${line.id || line.lineId || assignments.length + 1}.wav`;
      assignments.push({
        lineId: line.id || line.lineId || `line-${assignments.length + 1}`,
        character: line.character || line.speaker || '',
        text: line.text,
        voiceId: line.voiceId || line.voice_id || 'Vivian',
        audioFile: placeholderFile,
        source: 'placeholder',
      });
    }
    return assignments;
  }

  for (const line of dialogueLines) {
    const voiceId = line.voiceId || line.voice_id || 'male-qn-qingse';
    const fileName = `${line.id || line.lineId || assignments.length + 1}.wav`;
    const outputPath = join(ttsDir, fileName);

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'glm-4-voice',
          input: line.text,
          voice: voiceId,
          response_format: 'wav',
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        throw new Error(`GLM-TTS HTTP ${response.status}: ${await response.text().then(t => t.substring(0, 200))}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(outputPath, buffer);

      assignments.push({
        lineId: line.id || line.lineId || `line-${assignments.length + 1}`,
        character: line.character || line.speaker || '',
        text: line.text,
        voiceId,
        audioFile: fileName,
        source: 'local-zhipu',
      });

      console.log(`[voice] 本地 TTS: "${line.text.substring(0, 30)}..." → ${fileName}`);
    } catch (err) {
      console.warn(`[voice] 本地 TTS 失败 ("${line.text.substring(0, 20)}..."): ${err.message}`);
      assignments.push({
        lineId: line.id || line.lineId || `line-${assignments.length + 1}`,
        character: line.character || line.speaker || '',
        text: line.text,
        voiceId,
        audioFile: fileName,
        source: 'failed',
        error: err.message,
      });
    }
  }

  return assignments;
}
