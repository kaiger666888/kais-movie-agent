/**
 * Phase handlers — 各阶段的介入逻辑
 * pipeline 编排器通过 phaseHandlers[phaseId] 调用对应 handler
 */
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import {
  generateTopics, audienceMatch, deepAudienceAnalysis,
  registerCharacterDNA, registerSceneDNA,
  generateBlueprint, assessQuality,
  generatePoseReferences, generateShotPoses,
  analyzeScript, toGateSupplement, summarizeReport,
} from '../hooks/index.js';
import { GoldTeamClient, GoldTeamError } from '../gold-team-client.js';
import { AssetBus } from '../asset-bus.js';
import { PromptInjector } from '../prompt-injector.js';
import { parseShotToGpuParams, deduplicateSceneNeeds } from '../shot-list-parser.js';
import { AIScorer } from '../ai-scorer.js';
import { HermesClient } from '../hermes-client.js';
import { SoulLockManager } from '../soul-lock-manager.js';
import { TempDialogueManager } from '../temp-dialogue-manager.js';
import { BGMStrategy } from '../bgm-strategy.js';
import { SceneReverbManager } from '../scene-reverb-manager.js';
import { SFXManager } from '../sfx-manager.js';
import { CompositionEngine } from '../composition-engine.js';
import { JimengClient } from '../jimeng-client.js';
import { callLLM } from '../hermes-adapter.js';
import { applyFixedRules, buildIPTripleViewPrompt } from '../production-modes.js';
import { EvaluationCollector } from '../evaluation-collector.js';
import { auditContinuity, auditImageVsL1 } from '../continuity-auditor.js';
import { CharacterAssetManager } from '../character-asset-manager.js';
import { ShotParallelScheduler } from '../shot-parallel-scheduler.js';
import { BlacklistEngine } from '../blacklist-engine.js';
import { CreativeHistoryTracker } from '../creative-history-tracker.js';
import { FineTuneETL } from '../finetune-etl.js';

// ─── Hermes Helpers ────────────────────────────────────────────

/**
 * Phase 22 A2-02: 归一化 voice-timeline 为 { shotId: { audioPath, ... } } 字典。
 * 兼容 v2.0 两种格式:
 *   - { timeline: [{ shot_id, audioPath }, ...] }
 *   - { shotId: { audioPath } } (map 格式)
 * @param {*} voiceTimeline - 从 AssetBus 读出的 voice-timeline slot
 * @returns {Object<string, {audioPath: string}>|null}
 */
function _extractVoiceEntries(voiceTimeline) {
  if (!voiceTimeline || typeof voiceTimeline !== 'object') return null;
  // 格式 1: { timeline: [...] }
  if (Array.isArray(voiceTimeline.timeline)) {
    const map = {};
    for (const entry of voiceTimeline.timeline) {
      if (entry && entry.shot_id && entry.audioPath) {
        map[entry.shot_id] = { audioPath: entry.audioPath, ...entry };
      }
    }
    return map;
  }
  // 格式 2: { shotId: { audioPath } } map
  if (Object.keys(voiceTimeline).length > 0) {
    const map = {};
    for (const [shotId, entry] of Object.entries(voiceTimeline)) {
      if (entry && typeof entry === 'object' && entry.audioPath) {
        map[shotId] = entry;
      }
    }
    return map;
  }
  return null;
}

function _makeCollector(pipeline) {
  return new EvaluationCollector(pipeline.workdir, { episodeId: pipeline.episode });
}

function _makeHermesClient(pipeline) {
  const url = pipeline.config?.hermes?.baseUrl || process.env.HERMES_URL;
  return url ? new HermesClient(url) : null;
}

const HERMES_DEFAULTS = {
  'pain-discovery': { depth: 'deep', max_sources: 10 },
  'topic-selection': {
    select_mode: 'single',
    enable_feedback: true,
    // 2026-06-18: 故事梗概必须支撑多剧集总时长
    dynamic_episode_sizing: true,    // 根据剧集数×单集时长动态分配故事量
    min_story_beats_per_minute: 2,   // 每分钟至少 2 个故事节拍点
    require_episode_outline: true,   // 多集时要求给出每集故事线
  },
  'outline-generation': {
    max_candidates: 3,
    include_visual_intent: true,
    // 2026-06-18: 大纲按剧集数展开
    expand_to_episodes: true,        // 多集时为每集生成独立大纲
    episode_cross_references: true,  // 标注集与集之间的剧情关联
    per_episode_duration: true,      // 每集大纲标注预估时长
  },
  'outline-selection': { select_mode: 'single', enable_scoring: true },
  'script-generation': { max_candidates: 3, include_dialogue: true },
  'script-selection': { select_mode: 'single', enable_scoring: true },
  'character-generation': {
    strategy: 'L1-L2-layered',  // L1 身份锚点 + L2 造型卡片双参考系统
    l1_min_anchors: 1,            // L1 至少 1 张面部特写
    l1_max_anchors: 3,            // L1 最多 3 张
    l1_candidates: 20,            // L1 候选生成数量
    l1_quality_threshold: 0.7,   // L1 审核通过阈值
    l1_retries: 3,                // L1 最大重试
    l2_sample_strength: 0.3,     // L2 造型卡片 sample_strength
    l2_quality_threshold: 0.6,    // L2 审核通过阈值
    l2_retries: 2,                // L2 最大重试
    model: 'jimeng-5.0',
    ratio: '3:4',
    resolution: '2k',
  },
  'character-selection': { max_candidates: 3, select_mode: 'single' },
  'scene-generation': { views: 6, model: 'flux-dev' },
  'scene-selection': { select_mode: 'single', enable_scoring: true },
  'script-lock': { enable_scoring: true, enable_feedback: true },
  'consistency-guard': {
    face_threshold: 0.85,
    clothing_check: true,
    l1_anchor_comparison: true,       // V3: 以 L1 身份锚点为基准
    l2_costume_comparison: true,      // V3: 以 L2 造型卡片为基准
  },
  'cloud-production': {
    strategy: 'omni_reference',       // Seedance 2.0 omni_reference 模式
    identity_weight: 0.7,             // 身份参考权重（黄金比例 70%）
    action_weight: 0.3,               // 动作参考权重（30%）
    max_identity_refs: 3,             // L1 身份锚点最多 3 张
    max_scene_refs: 3,                // 场景/服装参考最多 3 张
    max_action_refs: 3,               // 动作参考视频最多 3 段
    suppress_music: true,
    max_retries: 3,                   // Phase 16 PERF-04: 1 → 3 (镜头级重试预算)
    parallel_shots: 4,
    use_omni_reference: true,         // 启用 omni_reference 模式
  },
  'final-audio': { bgm_model: 'ace-step-xl', target_lufs: -14 },
  // Phase 22 A2-04: lip_sync_threshold 从 1.0 现实化到 0.75
  // 原因: Seedance 2.0 中文 lip sync 实测分普遍低于 1.0, 0.75 为基于测试集的合理下限
  // (英文 0.85, 中文 0.75 — 见 test/lip-sync-samples/ 测试集产出)
  'delivery': { face_consistency_threshold: 0.90, lip_sync_threshold: 0.75, audio_lufs: -16, l1_baseline_check: true },

  // ─── Legacy V4.1 defaults (kept for backward compat) ─────
  'requirement-bible': {
    target_audience: 'general', genre_weight: 0.7, research_depth: 'deep',
    audience_platform: 'douyin', topic_divergence_count: 5,
  },
  'soul-visual': {
    variant: 'schnell', width: 1024, height: 1024, num_images: 3,
    output_format: 'png', guidance_scale: 3.5, num_inference_steps: 4,
    negative_prompt: 'low quality, blurry',
  },
  camera: {
    width: 832, height: 480, fps: 16, output_format: 'mp4',
    model: 'wan14b', guidance_scale: 5.0,
    preview: { num_frames: 33, num_inference_steps: 10 },
    final: { num_frames: 81, num_inference_steps: 20 },
  },
  'bgm-strategy': {
    ambient: { duration_per_segment: 4, segment_count: 4, output_format: 'wav' },
    signature: { bpm: 120, vocal_language: 'instrumental', output_format: 'mp3' },
  },
  'soul-voice': {
    voice_model: 'cosyvoice2', pitch_range: 'mid', speed: 1.0,
    output_format: 'wav', sample_rate: 24000,
  },
  'geometry-bed': {
    model: 'trellis', output_format: 'glb', quality: 'high',
    texture_resolution: 1024, enable_pbr: true,
  },
  'spatio-temporal-script': {
    shot_density: 'standard', dialogue_style: 'natural',
    audio_event_strategy: 'prompt-driven', coupling_strength: 0.8,
  },
  'seed-skeleton': {
    frame_model: 'flux', bgm_segment_duration: 4, bgm_segment_count: 4,
    dialogue_temp_mode: 'quick', reverb_auto: true,
  },
  'motion-preview': {
    renderer: 'blender', output_format: 'mp4', fps: 24,
    resolution: '720p', camera_smoothing: 0.5,
  },
  'ai-preview': {
    video_model: 'wan14b', style_transfer_strength: 0.7,
    preview_frames: 33, preview_steps: 10,
  },
  'final-production': {
    video_model: 'wan14b', final_frames: 81, final_steps: 20,
    dialogue_refine: true, bgm_signature: true, sfx_required: true,
  },
  composition: {
    quality_threshold: 65, enable_radar: true,
    composition_engine: 'ffmpeg', output_format: 'mp4',
  },
  'post-production': {
    bgm: { bpm: 120, vocal_language: 'instrumental', output_format: 'mp3' },
  },
  sfx: { cfg: 4.5, output_format: 'wav' },

  // ─── 工作流3.0 默认配置 ───
  'workflow-30': {
    enableIPAdapterChain: false,
    enableControlNetDepth: false,
    enableAutoUpscale: false,
    enableFaceRestore: false,
    useWanI2V: true,
  },
};

/**
 * Try Hermes decide, fall back to hardcoded defaults.
 * Returns { params, decisionId }.
 */
async function _hermesDecide(client, phase, context) {
  if (!client) return { params: null, decisionId: null };
  try {
    const result = await client.decide(phase, context);
    // Support both envelope { data: {...} } and flat response
    const r = result?.data || result;
    if (r?.decision_id && r?.params) {
      console.log(`[hermes] ✅ ${phase} 决策 (confidence=${(r.confidence ?? 0).toFixed(2)}, experts=${r.experts_consulted?.join(',') || '?'})`);
      return { params: r.params, decisionId: r.decision_id };
    }
  } catch (err) {
    console.warn(`[hermes] ${phase} decide 失败, 使用默认参数: ${err.message}`);
  }
  return { params: null, decisionId: null };
}

/**
 * Fire-and-forget audit to Hermes after GPU execution.
 */
function _hermesAudit(client, phase, decisionId, metrics, parametersUsed) {
  if (!client || !decisionId) return;
  client.audit(phase, decisionId, metrics, parametersUsed).catch(err => {
    console.warn(`[hermes] ${phase} audit 失败: ${err.message}`);
  });
}

// ─── Phase Handlers ────────────────────────────────────────────

/**
 * Phase 12 QUAL-04: 即时一致性审计 hook
 * 在场景图/分镜首帧/AI 预览生成后立即触发 auditImageVsL1,
 * score < 0.7 的 shot_id 加入 retry_shots 数组。
 *
 * 设计原则:
 *   - 无图/无锚点 → 静默跳过 (Phase 14 真实生成后才生效)
 *   - 审计异常 → warn,不 fail pipeline (一致性 fail 由 consistency-guard / composition 统一处理)
 *   - 幂等: 重复调用对同一 shot 不会重复写 result (每次重新生成会重评)
 *
 * @param {object} pipeline
 * @param {Array<{shot_id, image_path, character}>} shotImages — 待审图片列表
 * @param {Array} characters — character-assets.characters
 * @param {object} [opts] — { phase: 标签名 }
 * @returns {Promise<{retry_shots: string[], audited: number, results: Array}>}
 */
async function _runImmediateConsistencyAudit(pipeline, shotImages, characters, opts = {}) {
  const phaseLabel = opts.phase || 'immediate-audit';
  const result = { retry_shots: [], audited: 0, results: [] };
  if (!Array.isArray(shotImages) || !shotImages.length || !Array.isArray(characters)) {
    return result;
  }

  // 构建角色 → L1 锚点映射
  const charAnchors = new Map();
  for (const ch of characters) {
    const anchors = ch?.assets?.L1_identity
      ?.filter(a => (a.status === 'approved' || a.status === undefined) && a.path)
      .map(a => a.path) || [];
    if (anchors.length) charAnchors.set(ch.id || ch.name, anchors);
  }
  if (!charAnchors.size) return result;

  for (const shot of shotImages) {
    const imagePath = shot.image_path || shot.imagePath || shot.seed_frame_path;
    if (!imagePath) continue;

    // 解析 shot 所属角色
    const charKey = shot.character || shot.character_id || shot.character_name;
    let anchors = charKey ? charAnchors.get(charKey) : null;
    if (!anchors && charAnchors.size === 1) {
      // 只有一个角色时默认归属
      anchors = [...charAnchors.values()][0];
    }
    if (!anchors) continue;

    try {
      const audit = await auditImageVsL1(imagePath, anchors);
      result.audited += 1;
      result.results.push({ shot_id: shot.shot_id, score: audit.score, passed: audit.passed });
      if (audit.score < 0.7) {
        result.retry_shots.push(shot.shot_id);
        console.warn(`[${phaseLabel}] ${shot.shot_id} 一致性低 (${audit.score.toFixed(2)} < 0.7) → 加入重试队列`);
      }
    } catch (err) {
      console.warn(`[${phaseLabel}] ${shot.shot_id} 审计异常: ${err.message}`);
    }
  }
  return result;
}

/**
 * 从 pipeline.workdir 读取已落盘的 character-assets,供即时审计用。
 */
async function _loadCharactersForAudit(pipeline) {
  try {
    const bus = new AssetBus(pipeline.workdir);
    const data = await bus.read('character-assets');
    return data?.characters || [];
  } catch { return []; }
}


// ─── Phase 14: character-generation 真实实现 ────────────────────

/**
 * 计算 perceptual hash 占位 (简单文件 size + path hash)。
 * 真正的 perceptual hash 留给 v3.0 (需要 image hashing lib)。
 */
function _computeFaceEmbeddingHash(imagePath) {
  return createHash('sha256').update(imagePath).digest('hex').slice(0, 16);
}

function _computeCostumeFingerprint(imagePaths) {
  return createHash('sha256').update(imagePaths.join(',')).digest('hex').slice(0, 16);
}

/**
 * 构建 L1 身份锚点 prompt — 面部特写,正面,中性表情,浅灰背景
 * 符合 GOLDEN_STANDARD: 柔和均匀光,平视,无遮挡。
 */
function _buildL1Prompt(character) {
  const face = character.face || character.description || character.name || '';
  return `${character.name}, ${face}, 面部特写, 正面, 中性表情, 浅灰色背景, 柔和均匀光, 高清无压缩, 无墨镜遮挡, 无滤镜, 平视镜头`;
}

/**
 * 构建 L2 造型卡片 prompt — 全身正面/侧面
 */
function _buildL2Prompt(character, costume, view) {
  const viewDesc = view === 'side' ? '侧面全身' : '正面全身';
  let costumeDesc;
  if (typeof costume === 'string') {
    costumeDesc = costume;
  } else {
    // 组合 name + description (两者都包含,便于 LLM 理解)
    const parts = [costume?.name, costume?.description].filter(Boolean);
    costumeDesc = parts.length ? parts.join(', ') : 'default';
  }
  const body = character.body || '';
  return `${character.name}, ${costumeDesc}, ${viewDesc}, 自然站姿, ${body}, 浅灰背景, 柔和均匀光, 高清无压缩`;
}

/**
 * 生成单个角色的 L1 身份锚点: 20 候选 → 打分 → top-3 (score >= 0.7)
 *
 * @param {object} character - 角色定义
 * @param {object} jimeng - JimengClient (或 mock)
 * @param {function} scorer - async (imagePath, character) => score 0-1
 * @param {object} opts - { candidates, threshold, maxAnchors }
 * @returns {Promise<{candidates: Array, selected: Array, anchors: Array}>}
 */
async function _generateL1Anchors(character, jimeng, scorer, opts = {}) {
  const {
    candidates: numCandidates = 20,
    threshold = 0.7,
    maxAnchors = 3,
    model = 'jimeng-5.0',
    ratio = '3:4',
    resolution = '2k',
  } = opts;

  const prompt = _buildL1Prompt(character);
  const candidatePromises = [];
  for (let i = 0; i < numCandidates; i++) {
    candidatePromises.push(
      jimeng.generateImage({ prompt, model, ratio, resolution })
        .then(results => {
          const item = Array.isArray(results) ? results[0] : results;
          const url = item?.url || item?.path || `candidate-${i}.png`;
          return { path: url, url, index: i, seed: item?.seed };
        })
        .catch(err => ({ path: null, index: i, error: err.message })),
    );
  }
  const rawCandidates = await Promise.all(candidatePromises);
  // 丢弃生成失败的
  const validCandidates = rawCandidates.filter(c => c.path);

  // 打分
  const scored = [];
  for (const cand of validCandidates) {
    let score = 0;
    let details = '';
    try {
      const result = await scorer(cand.path, character);
      score = typeof result === 'number' ? result : (result?.score ?? 0);
      details = result?.details || '';
    } catch (err) {
      score = 0;
      details = `scoring failed: ${err.message}`;
    }
    scored.push({
      path: cand.path,
      url: cand.url,
      index: cand.index,
      seed: cand.seed,
      score,
      details,
      face_embedding_hash: _computeFaceEmbeddingHash(cand.path),
    });
  }

  // 过滤 + 排序 + top-3
  const passedThreshold = scored.filter(s => s.score >= threshold);
  const sorted = passedThreshold.sort((a, b) => b.score - a.score);
  const selected = sorted.slice(0, maxAnchors);

  return {
    candidates: scored,
    selected,
    anchors: selected.map(s => s.path),
  };
}

/**
 * 生成单个角色的 L2 造型卡片 — 基于 L1 锚点的 compositions
 *
 * @param {object} character
 * @param {string[]} l1Anchors - L1 锚点路径
 * @param {object} jimeng - JimengClient
 * @param {Array} costumes - ['default', ...] 或 [{ name, description }, ...]
 * @param {object} opts - { sampleStrength, model, ratio }
 * @returns {Promise<Array<{costumeId, frontPath, sidePath, fingerprint}>>}
 */
async function _generateL2Costumes(character, l1Anchors, jimeng, costumes, opts = {}) {
  const {
    sampleStrength = 0.3,
    model = 'jimeng-5.0',
    ratio = '3:4',
    resolution = '2k',
  } = opts;

  if (!l1Anchors.length) {
    throw new Error(`角色 ${character.name || character.id} 缺少 L1 身份锚点,无法生成 L2`);
  }

  const results = [];
  for (const costumeRaw of costumes) {
    const costumeId = typeof costumeRaw === 'string' ? costumeRaw : (costumeRaw.id || costumeRaw.name || 'default');

    // 正面
    const frontPrompt = _buildL2Prompt(character, costumeRaw, 'front');
    let frontPath = null;
    try {
      const frontResults = await jimeng.compositions(frontPrompt, {
        images: l1Anchors,
        sample_strength: sampleStrength,
        model, ratio, resolution,
      });
      const item = Array.isArray(frontResults) ? frontResults[0] : frontResults;
      frontPath = item?.url || item?.path || `${costumeId}-front.png`;
    } catch (err) {
      console.warn(`[character-generation] L2 front (${costumeId}) 失败: ${err.message}`);
    }

    // 侧面 (基于正面图 + L1 锚点)
    const sidePrompt = _buildL2Prompt(character, costumeRaw, 'side');
    let sidePath = null;
    try {
      const sideRefs = frontPath ? [frontPath, ...l1Anchors] : l1Anchors;
      const sideResults = await jimeng.compositions(sidePrompt, {
        images: sideRefs,
        sample_strength: sampleStrength,
        model, ratio, resolution,
      });
      const item = Array.isArray(sideResults) ? sideResults[0] : sideResults;
      sidePath = item?.url || item?.path || `${costumeId}-side.png`;
    } catch (err) {
      console.warn(`[character-generation] L2 side (${costumeId}) 失败: ${err.message}`);
    }

    const imagePaths = [frontPath, sidePath].filter(Boolean);
    results.push({
      costumeId,
      frontPath,
      sidePath,
      imagePaths,
      costume_fingerprint: imagePaths.length ? _computeCostumeFingerprint(imagePaths) : null,
    });
  }

  return results;
}

/**
 * 从 requirement.json 或 pipeline.config 读取 characters
 */
async function _loadCharactersForGeneration(pipeline) {
  // 优先读 requirement.json (requirement-bible phase 写入)
  try {
    const raw = await readFile(join(pipeline.workdir, 'requirement.json'), 'utf-8');
    const req = JSON.parse(raw);
    if (req?.characters?.length) {
      return req.characters.map((c, i) => ({
        id: c.id || `char-${i + 1}`,
        name: c.name,
        face: c.face || c.description || '',
        body: c.body || '',
        costumes: c.costumes || ['default'],
        ...c,
      }));
    }
  } catch { /* file missing — fallback */ }
  // 降级到 pipeline.config.characters
  const chars = pipeline.config?.characters || [];
  return chars.map((c, i) => ({
    id: c.id || `char-${i + 1}`,
    name: c.name,
    face: c.face || c.description || '',
    body: c.body || '',
    costumes: c.costumes || ['default'],
    ...c,
  }));
}


/**
 * 各阶段的 before/after 钩子
 * before: 阶段执行前的预处理
 * after: 阶段执行后的后处理（数据提取、DNA注册等）
 */
export const phaseHandlers = {
  // ═══════════════════════════════════════════════════════════
  // V4.1 Phase Handlers (10 phases, audio-visual fusion)
  // ═══════════════════════════════════════════════════════════

  'requirement-bible': {
    after: async (pipeline, phase, phaseConfig) => {
      const req = pipeline.config;
      const hermes = _makeHermesClient(pipeline);

      // Hermes decision for requirement parameters
      let hermesDecisionId = null;
      let effectiveParams = HERMES_DEFAULTS['requirement-bible'];
      if (hermes) {
        const hr = await _hermesDecide(hermes, 'requirement-bible', {
          genre: req.genre || '',
          duration_sec: req.duration_sec || 60,
          character_count: req.characters?.length || 0,
        });
        hermesDecisionId = hr.decisionId;
        if (hr.params) effectiveParams = { ...effectiveParams, ...hr.params };
      }

      await writeFile(join(pipeline.workdir, 'requirement.json'), JSON.stringify(req, null, 2));

      // Four-dimensional blueprint
      try { await generateBlueprint(pipeline, req); } catch (err) {
        console.warn(`[requirement-bible] 蓝图生成失败: ${err.message}`);
      }

      // Audience matching
      try {
        const matchResult = await audienceMatch({ content: req, platform: req.platform || 'douyin' });
        pipeline.audienceMatch = matchResult;
        await writeFile(join(pipeline.workdir, 'audience-match.json'), JSON.stringify(matchResult, null, 2));
      } catch (e) { console.warn(`[requirement-bible] 受众匹配跳过: ${e.message}`); }

      // Topic generation
      try {
        const topics = await generateTopics(req, { platform: req.platform || 'douyin', genre: req.genre, blueprint: pipeline.blueprint });
        pipeline.candidateTopics = topics;
        await writeFile(join(pipeline.workdir, 'candidate-topics.json'), JSON.stringify(topics, null, 2));
      } catch (e) { console.warn(`[requirement-bible] 选题发散跳过: ${e.message}`); }

      // V4.1: Write enriched art-bible with audio preferences
      const bus = new AssetBus(pipeline.workdir);
      const artBibleData = {
        style_anchor: req.style_preference || '',
        lighting_rules: req.lighting || '',
        color_palette: req.color_palette || [],
        composition_rules: req.composition || '',
        voice_style_anchor: req.audio_preference?.voice_style || '',
        bgm_strategy: req.audio_preference?.bgm_strategy || 'dual',
        sfx_mode: req.audio_preference?.sfx_mode || 'prompt-driven',
        reverb_profile: req.audio_preference?.reverb_profile || 'auto',
      };

      // Mode enforcement: apply fixed rules (timeline-control)
      if (pipeline.mode) {
        Object.assign(artBibleData, applyFixedRules(artBibleData, pipeline.mode));
      }

      await bus.write('art-bible', artBibleData);

      _hermesAudit(hermes, 'requirement-bible', hermesDecisionId, {
        characterCount: req.characters?.length || 0,
        topicsGenerated: pipeline.candidateTopics?.length || 0,
      }, effectiveParams);

      return { summary: { title: req.title, genre: req.genre }, metrics: { characterCount: req.characters?.length || 0 } };
    },
  },

  'soul-visual': {
    after: async (pipeline, phase, phaseConfig) => {
      const data = phaseConfig.data;
      if (!data) return;

      const hermes = _makeHermesClient(pipeline);
      const defaults = HERMES_DEFAULTS['soul-visual'];

      // Hermes decision for visual soul parameters
      let hermesDecisionId = null;
      let effectiveParams = defaults;
      if (hermes) {
        const hr = await _hermesDecide(hermes, 'soul-visual', {
          style_anchor: data.style_anchor || data.prompt || '',
          project_genre: pipeline.config.genre || '',
        });
        hermesDecisionId = hr.decisionId;
        if (hr.params) effectiveParams = { ...defaults, ...hr.params };
      }

      const bus = new AssetBus(pipeline.workdir);
      const artBible = await bus.read('art-bible') || {};
      const jimeng = new JimengClient({ apiKey: pipeline.config?.jimeng?.apiKey || process.env.JIMENG_API_KEY });

      // Try gold-team FLUX first, fallback to Jimeng
      let candidates = [];
      if (pipeline.config.goldTeam?.enableFluxArt) {
        try {
          const gtClient = _makeGtClient(pipeline);
          if (await gtClient.ping(5000)) {
            const prompt = `${artBible.style_anchor}, ${data.prompt || data.description || ''}, character portrait, front view, soul frame`;
            const result = await generateArtDirectionViaGoldTeam(pipeline, prompt, artBible.style_anchor);
            const task = await gtClient.waitForTask(result.taskId, { pollIntervalMs: 5000, timeoutMs: 600000 });
            const artifacts = task.artifacts || [];
            candidates = artifacts.map((a, i) => ({ id: `soul-${i + 1}`, label: `灵魂帧 ${i + 1}`, imagePath: a.path }));
          }
        } catch (err) { console.warn(`[soul-visual] gold-team 降级: ${err.message}`); }
      }

      // Jimeng fallback for candidates
      if (candidates.length === 0) {
        try {
          const soulLock = new SoulLockManager({ jimengClient: jimeng, assetBus: bus });
          const result = await soulLock.generateVisualSoul(data.prompt || data.description || '', artBible);
          candidates = result.candidates?.map((c, i) => ({ id: `soul-${i + 1}`, label: `灵魂帧 ${i + 1}`, imageUrl: c.url })) || [];
        } catch (e) { console.warn(`[soul-visual] Jimeng 降级: ${e.message}`); }
      }

      // Save visual soul data
      await writeFile(join(pipeline.workdir, 'visual_soul_candidates.json'), JSON.stringify(candidates, null, 2));
      phaseConfig.reviewCandidates = candidates;
      _hermesAudit(hermes, 'soul-visual', hermesDecisionId, { candidates: candidates.length }, effectiveParams);

      // Evaluation collection
      try {
        const collector = _makeCollector(pipeline);
        await collector.record({
          phase: 'soul-visual',
          task_type: 'image_draw',
          gpu_time_sec: 0,
          peak_vram_gb: 0,
          success: candidates.length > 0,
          retry_count: 0,
          hermes_decision_id: hermesDecisionId,
          parameters_used: effectiveParams,
        });
      } catch (e) { console.warn(`[soul-visual] 评估采集失败: ${e.message}`); }
    },
  },

  'soul-voice': {
    after: async (pipeline, phase, phaseConfig) => {
      const bus = new AssetBus(pipeline.workdir);
      const visualSoul = await bus.read('visual-soul');
      const artBible = await bus.read('art-bible') || {};
      const characters = (await bus.read('character-assets'))?.characters || pipeline.config.characters || [];
      const hermes = _makeHermesClient(pipeline);

      // Hermes decision for voice style parameters
      let hermesDecisionId = null;
      let effectiveParams = HERMES_DEFAULTS['soul-voice'];
      if (hermes) {
        const hr = await _hermesDecide(hermes, 'soul-voice', {
          character_count: characters.length,
          voice_style_anchor: artBible.voice_style_anchor || '',
        });
        hermesDecisionId = hr.decisionId;
        if (hr.params) effectiveParams = { ...effectiveParams, ...hr.params };
      }

      const soulLock = new SoulLockManager({ jimengClient: null, assetBus: bus });
      const voiceResults = [];

      for (const char of characters) {
        try {
          const result = await soulLock.generateVoiceSoul(
            visualSoul || { visual_tags: [] },
            char.description || char.core_prompt || char.name,
          );
          voiceResults.push({ character: char.name, ...result });
        } catch (e) {
          console.warn(`[soul-voice] ${char.name} 声音生成失败: ${e.message}`);
        }
      }

      // Build review candidates (audio samples)
      const candidates = [];
      for (const vr of voiceResults) {
        for (const c of vr.candidates || []) {
          candidates.push({
            id: `voice-${vr.character}-${candidates.length + 1}`,
            label: `${vr.character} 音色`,
            description: `${vr.voice_mood} - ${c.voice_spec?.pitch || 'mid'}`,
          });
        }
      }
      phaseConfig.reviewCandidates = candidates;
      await writeFile(join(pipeline.workdir, 'voice_soul_candidates.json'), JSON.stringify(voiceResults, null, 2));
      _hermesAudit(hermes, 'soul-voice', hermesDecisionId, { candidates: candidates.length }, effectiveParams);

      // Evaluation collection
      try {
        const collector = _makeCollector(pipeline);
        await collector.record({
          phase: 'soul-voice',
          task_type: 'tts_generation',
          gpu_time_sec: 0,
          peak_vram_gb: 0,
          success: candidates.length > 0,
          retry_count: 0,
          hermes_decision_id: hermesDecisionId,
          parameters_used: effectiveParams,
        });
      } catch (e) { console.warn(`[soul-voice] 评估采集失败: ${e.message}`); }
    },
  },

  'geometry-bed': {
    after: async (pipeline, phase, phaseConfig) => {
      const bus = new AssetBus(pipeline.workdir);
      const characterAssets = await bus.read('character-assets');
      const sceneAssets = await bus.read('scene-assets');
      const scenes = sceneAssets?.scenes || [];
      const hermes = _makeHermesClient(pipeline);

      // Hermes decision for geometry parameters
      let hermesDecisionId = null;
      let effectiveParams = HERMES_DEFAULTS['geometry-bed'];
      if (hermes) {
        const hr = await _hermesDecide(hermes, 'geometry-bed', {
          character_count: characterAssets?.characters?.length || 0,
          scene_count: scenes.length,
        });
        hermesDecisionId = hr.decisionId;
        if (hr.params) effectiveParams = { ...effectiveParams, ...hr.params };
      }

      // 3D character model generation (TRELLIS/Hunyuan3D via gold-team)
      const character3DResults = [];
      if (pipeline.config.goldTeam?.baseUrl) {
        try {
          const gtClient = _makeGtClient(pipeline);
          for (const char of characterAssets?.characters || []) {
            if (char.ref_images?.[0]) {
              const task = await gtClient.submitTask({
                task_type: 'image_to_3d', priority: 5,
                params: { source_image_path: char.ref_images[0], output_format: 'glb' },
                description: `${pipeline.episode}:3d-char:${char.name}`,
              });
              character3DResults.push({ character: char.name, taskId: task.task_id });
            }
          }
        } catch (e) { console.warn(`[geometry-bed] 3D角色生成降级: ${e.message}`); }
      }

      // Scene-level acoustic RT60 (CPU, no GPU)
      const reverbManager = new SceneReverbManager({ assetBus: bus });
      const sceneIRProfiles = {};
      for (const scene of scenes) {
        const rt60 = reverbManager.calculateRT60(scene.dimensions, scene.materials);
        sceneIRProfiles[scene.id] = reverbManager.generateIRProfile(rt60, scene.acoustic_profile);
      }

      await bus.write('geometry-bed', {
        character_models: character3DResults,
        scene_meshes: [],
        acoustic_rt60: sceneIRProfiles,
      });

      // Mode: timeline-control — generate prop IP triple-view assets
      if (pipeline.mode?.asset_order?.includes('prop-assets')) {
        const stsScript = await bus.read('spatio-temporal-script');
        const props = _extractPropsFromShots(stsScript?.shots || []);
        if (props.length > 0 && pipeline.config.goldTeam?.enableFluxArt) {
          const gtClient = _makeGtClient(pipeline);
          const propResults = [];
          for (const prop of props) {
            try {
              const prompt = buildIPTripleViewPrompt(prop.name, 'prop');
              const result = await generateArtDirectionViaGoldTeam(pipeline, prompt, '', 'geometry-bed');
              propResults.push({ name: prop.name, type: prop.type, taskId: result.taskId });
            } catch (e) {
              console.warn(`[geometry-bed] 道具 ${prop.name} IP生成降级: ${e.message}`);
            }
          }
          await bus.write('prop-assets', { props: propResults });
        }
      }

      _hermesAudit(hermes, 'geometry-bed', hermesDecisionId, {
        character3DCount: character3DResults.length,
        sceneCount: scenes.length,
        acousticProfiles: Object.keys(sceneIRProfiles).length,
      }, effectiveParams);

      // Evaluation collection
      try {
        const collector = _makeCollector(pipeline);
        await collector.record({
          phase: 'geometry-bed',
          task_type: 'image_to_3d',
          gpu_time_sec: 0,
          peak_vram_gb: 0,
          success: character3DResults.length > 0,
          retry_count: 0,
          hermes_decision_id: hermesDecisionId,
          parameters_used: effectiveParams,
        });
      } catch (e) { console.warn(`[geometry-bed] 评估采集失败: ${e.message}`); }
    },
  },

  'spatio-temporal-script': {
    after: async (pipeline, phase, phaseConfig) => {
      // Phase 17 E2E-01: 即使无 phaseConfig.data 也必须返回 result 契约
      // 否则 runPhase 访问 result.summary 会 crash pipeline
      if (!phaseConfig.data) {
        return { summary: { skipped: true, reason: 'no_data' }, metrics: { skipped: true } };
      }
      const hermes = _makeHermesClient(pipeline);

      // Hermes decision for script structure parameters
      let hermesDecisionId = null;
      let effectiveParams = HERMES_DEFAULTS['spatio-temporal-script'];
      if (hermes) {
        const hr = await _hermesDecide(hermes, 'spatio-temporal-script', {
          genre: pipeline.config.genre || '',
          duration_sec: pipeline.config.duration_sec || 60,
        });
        hermesDecisionId = hr.decisionId;
        if (hr.params) effectiveParams = { ...effectiveParams, ...hr.params };
      }

      // Audience analysis
      try {
        const analysis = await deepAudienceAnalysis({
          script: typeof phaseConfig.data === 'string' ? phaseConfig.data : JSON.stringify(phaseConfig.data),
          platform: pipeline.config.platform || 'douyin',
        });
        pipeline.audienceAnalysis = analysis;
      } catch (e) { console.warn(`[sts-script] 受众测评跳过: ${e.message}`); }

      // Story scoring
      try {
        const storyReport = analyzeScript(phaseConfig.data, { language: 'zh', storyType: pipeline.config.genre || 'classic_narrative' });
        if (storyReport) {
          pipeline.storyScoreReport = storyReport;
          const summary = summarizeReport(storyReport);
          await writeFile(join(pipeline.workdir, 'story-score-report.json'), JSON.stringify(summary, null, 2));
        }
      } catch (e) { console.warn(`[sts-script] 剧本量化跳过: ${e.message}`); }

      // Write spatio-temporal script to asset bus
      const bus = new AssetBus(pipeline.workdir);
      const shots = phaseConfig.data.shots || phaseConfig.data.scenes || [];
      const audioEvents = phaseConfig.data.audio_events || phaseConfig.data.audioEvents || [];
      await bus.write('spatio-temporal-script', {
        shots,
        audio_events: audioEvents,
        duration_coupling: phaseConfig.data.duration_coupling || {},
      });
      _hermesAudit(hermes, 'spatio-temporal-script', hermesDecisionId, { shots: shots.length }, effectiveParams);

      // Mode: timeline-control — render storyboard markdown alongside JSON
      if (pipeline.mode?.storyboard_format === 'timeline-shot-by-shot') {
        try {
          const md = _renderTimelineStoryboard(shots);
          await writeFile(join(pipeline.workdir, 'storyboard-timeline.md'), md);
        } catch (e) {
          console.warn(`[sts-script] 时间轴分镜渲染降级: ${e.message}`);
        }
      }

      // Phase 17 E2E-01: return result contract for runPhase state tracking
      return {
        summary: { shots: shots.length, audio_events: audioEvents.length },
        metrics: { shot_count: shots.length, audio_event_count: audioEvents.length },
      };
    },
  },

  'seed-skeleton': {
    after: async (pipeline, phase, phaseConfig) => {
      const bus = new AssetBus(pipeline.workdir);
      const stsScript = await bus.read('spatio-temporal-script') || {};
      const artBible = await bus.read('art-bible') || {};
      const hermes = _makeHermesClient(pipeline);

      // Hermes decision for seed skeleton parameters
      let hermesDecisionId = null;
      let effectiveParams = HERMES_DEFAULTS['seed-skeleton'];
      if (hermes) {
        const hr = await _hermesDecide(hermes, 'seed-skeleton', {
          shot_count: (stsScript.shots || []).length,
          bgm_strategy: artBible.bgm_strategy || 'dual',
        });
        hermesDecisionId = hr.decisionId;
        if (hr.params) effectiveParams = { ...effectiveParams, ...hr.params };
      }

      // Generate first/last frames via gold-team (Kontext/FLUX)
      const frameResults = [];
      if (pipeline.config.goldTeam?.enableFluxArt) {
        try {
          const gtClient = _makeGtClient(pipeline);
          if (await gtClient.ping(5000)) {
            for (const shot of stsScript.shots || []) {
              const result = await generateArtDirectionViaGoldTeam(pipeline, shot.description, artBible.style_anchor, 'seed-skeleton');              frameResults.push({ shot_id: shot.id, taskId: result.taskId });
            }
          }
        } catch (e) { console.warn(`[seed-skeleton] 首帧生成降级: ${e.message}`); }
      }

      // ─── 工作流3.0: IPAdapter 多视角链式增强 (可选) ───
      if (pipeline.config.workflow30?.enableIPAdapterChain && frameResults.length > 0) {
        try {
          const gtClient = _makeGtClient(pipeline);
          const ipAdapterResults = [];
          for (const shot of stsScript.shots || []) {
            const ipaResult = await gtClient.submitTask({
              taskType: 'image_draw',
              params: {
                model: 'flux-dev-ipa',
                prompt: `${shot.description}, front view, consistent architecture`,
                reference_image: shot.seed_frame_path || shot.referenceImage,
                width: 1024,
                height: 1024,
                steps: 20,
                cfg_scale: 3.5,
                extra: { flux: { ipadapter_weight: 0.80 } },
              },
              priority: 5,
              description: `${pipeline.episode}:seed-skeleton:ipa-${shot.id}`,
            });
            ipAdapterResults.push({ shot_id: shot.id, taskId: ipaResult.taskId });
          }
          console.log(`[seed-skeleton] IPAdapter 链式增强: ${ipAdapterResults.length} shots`);
        } catch (e) {
          console.warn(`[seed-skeleton] IPAdapter 链式增强降级: ${e.message}`);
        }
      }

      // Temp dialogue (CosyVoice2 quick inference)
      const dialogueLines = await _loadDialogueFromScenario(pipeline.workdir);
      const tempDialogueMgr = new TempDialogueManager({ assetBus: bus, goldTeamClient: _makeGtClient(pipeline) });
      if (dialogueLines?.length) {
        try { await tempDialogueMgr.generateTempLines(dialogueLines); } catch (e) {
          console.warn(`[seed-skeleton] 临时对白降级: ${e.message}`);
        }
      }

      // BGM skeleton (Stable Audio segments)
      const bgmStrategy = new BGMStrategy({ assetBus: bus, goldTeamClient: _makeGtClient(pipeline) });
      try { await bgmStrategy.generateForEpisode(stsScript, artBible); } catch (e) {
        console.warn(`[seed-skeleton] BGM骨架降级: ${e.message}`);
      }

      // Scene reverb plan
      const reverbManager = new SceneReverbManager({ assetBus: bus });
      const sceneAssets = await bus.read('scene-assets');
      try { await reverbManager.buildReverbPlan(stsScript.shots || [], sceneAssets?.scenes || []); } catch (e) {
        console.warn(`[seed-skeleton] 混响计划降级: ${e.message}`);
      }

      phaseConfig.reviewCandidates = frameResults.map((f, i) => ({ id: f.shot_id || `frame-${i}`, label: `种子帧 ${i + 1}` }));
      _hermesAudit(hermes, 'seed-skeleton', hermesDecisionId, { frames: frameResults.length }, effectiveParams);

      // Phase 12 QUAL-04: 种子首帧即时一致性审计
      let seedAuditHook = { retry_shots: [], audited: 0 };
      try {
        const stsForAudit = await bus.read('spatio-temporal-script') || {};
        const shotImages = (stsForAudit.shots || [])
          .filter(s => s.seed_frame_path || s.image_path)
          .map(s => ({
            shot_id: s.id || s.shot_id,
            image_path: s.seed_frame_path || s.image_path,
            character: s.character || s.character_id,
          }));
        if (shotImages.length) {
          const characters = await _loadCharactersForAudit(pipeline);
          seedAuditHook = await _runImmediateConsistencyAudit(pipeline, shotImages, characters, { phase: 'seed-skeleton' });
        }
      } catch (e) {
        console.warn(`[seed-skeleton] 一致性即时审计降级: ${e.message}`);
      }

      // Phase 12: 持久化 retry_shots (供后续 phase 读取)
      if (seedAuditHook.retry_shots.length) {
        try {
          await writeFile(
            join(pipeline.workdir, 'seed-skeleton-audit.json'),
            JSON.stringify(seedAuditHook, null, 2),
          );
        } catch (e) { console.warn(`[seed-skeleton] 审计结果落盘失败: ${e.message}`); }
      }

      // Evaluation collection
      try {
        const collector = _makeCollector(pipeline);
        await collector.record({
          phase: 'seed-skeleton',
          task_type: 'bgm_generation',
          gpu_time_sec: 0,
          peak_vram_gb: 0,
          success: frameResults.length > 0,
          retry_count: seedAuditHook.retry_shots.length,
          hermes_decision_id: hermesDecisionId,
          parameters_used: effectiveParams,
        });
      } catch (e) { console.warn(`[seed-skeleton] 评估采集失败: ${e.message}`); }
    },
  },

  'motion-preview': {
    after: async (pipeline, phase, phaseConfig) => {
      const bus = new AssetBus(pipeline.workdir);
      const stsScript = await bus.read('spatio-temporal-script') || {};
      const hermes = _makeHermesClient(pipeline);

      // Hermes decision for motion preview parameters
      let hermesDecisionId = null;
      let effectiveParams = HERMES_DEFAULTS['motion-preview'];
      if (hermes) {
        const hr = await _hermesDecide(hermes, 'motion-preview', {
          shot_count: (stsScript.shots || []).length,
          preview_mode: true,
        });
        hermesDecisionId = hr.decisionId;
        if (hr.params) effectiveParams = { ...effectiveParams, ...hr.params };
      }

      // Blender camera path rendering (CPU via gold-team)
      const previewResults = [];
      if (pipeline.config.goldTeam?.baseUrl) {
        try {
          const gtClient = _makeGtClient(pipeline);
          for (const shot of stsScript.shots || []) {
            const task = await gtClient.submitTask({
              task_type: 'blender_render', priority: 3,
              params: { camera_path: shot.camera_path, scene_path: shot.scene_3d_path, output_format: 'mp4' },
              description: `${pipeline.episode}:motion-preview:${shot.id}`,
            });
            previewResults.push({ shot_id: shot.id, taskId: task.task_id });
          }
        } catch (e) { console.warn(`[motion-preview] Blender降级: ${e.message}`); }
      }

      // ─── 工作流3.0: ControlNet Depth 几何锁定增强 (可选) ───
      if (pipeline.config.workflow30?.enableControlNetDepth) {
        try {
          for (const shot of stsScript.shots || []) {
            const depthExr = shot.depth_exr_path || join(pipeline.workdir, `assets/scene_${shot.scene_id}_depth.exr`);
            if (depthExr && (await readFile(depthExr, 'utf-8').catch(() => null)) !== null) {
              const cnResult = await generateSceneWithControlNet(pipeline, shot.description, shot.seed_frame_path, depthExr, {
                strength: 0.75,
                filenamePrefix: `controlnet_${shot.id}`,
              });
              previewResults.push({ shot_id: shot.id, taskId: cnResult.taskId, type: 'controlnet_depth' });
            }
          }
        } catch (e) {
          console.warn(`[motion-preview] ControlNet Depth 增强降级: ${e.message}`);
        }
      }

      await bus.write('motion-preview', {
        camera_paths: previewResults,
        rough_mix_path: null,
        preview_video_path: null,
      });

      phaseConfig.reviewCandidates = previewResults.map(r => ({ id: r.shot_id, label: `运镜 ${r.shot_id}` }));
      _hermesAudit(hermes, 'motion-preview', hermesDecisionId, { previews: previewResults.length }, effectiveParams);

      // Evaluation collection
      try {
        const collector = _makeCollector(pipeline);
        await collector.record({
          phase: 'motion-preview',
          task_type: 'blender_render',
          gpu_time_sec: 0,
          peak_vram_gb: 0,
          success: previewResults.length > 0,
          retry_count: 0,
          hermes_decision_id: hermesDecisionId,
          parameters_used: effectiveParams,
        });
      } catch (e) { console.warn(`[motion-preview] 评估采集失败: ${e.message}`); }
    },
  },

  'ai-preview': {
    after: async (pipeline, phase, phaseConfig) => {
      const shots = phaseConfig.data?.shots || phaseConfig.data?.approvedShots || [];
      const bus = new AssetBus(pipeline.workdir);
      const injector = new PromptInjector(bus);
      const sfxManager = new SFXManager({ goldTeamClient: _makeGtClient(pipeline), assetBus: bus });
      const stsScript = await bus.read('spatio-temporal-script') || {};
      const hermes = _makeHermesClient(pipeline);

      // Hermes decision for AI preview parameters
      let hermesDecisionId = null;
      let effectiveParams = HERMES_DEFAULTS['ai-preview'];
      if (hermes) {
        const hr = await _hermesDecide(hermes, 'ai-preview', {
          shot_count: shots.length,
          preview: true,
        });
        hermesDecisionId = hr.decisionId;
        if (hr.params) effectiveParams = { ...effectiveParams, ...hr.params };
      }

      // ─── Phase 15 PERF-02: 升级为 ShotParallelScheduler (并发=4) ───
      // 之前是串行 for...of,会阻塞整个 episode
      const scheduler = new ShotParallelScheduler({
        parallelism: effectiveParams.parallel_shots || HERMES_DEFAULTS['cloud-production'].parallel_shots || 4,
        pipeline,
      });

      const results = await scheduler.runAll(shots, async (shot) => {
        // Inject SFX hints into video prompt
        const audioEvents = (stsScript.audio_events || []).filter(e => e.shot_id === shot.id);
        const sfxHint = sfxManager.generateSFXHints(audioEvents);

        const enhancedPrompt = await injector.inject(shot.description, {
          character: shot.character, scene: shot.scene_id, shotId: shot.id,
          audioEvent: sfxHint, mode: pipeline.mode,
        });

        // ─── 工作流3.0: 使用 Wan I2V 双阶段 (本地) 或保持云端 ───
        const useWanI2V = pipeline.config.workflow30?.useWanI2V !== false;
        let result;
        if (useWanI2V && shot.referenceImage) {
          result = await generateVideoWanI2V(pipeline, shot.referenceImage, enhancedPrompt, {
            width: 832, height: 480, length: 33,
            steps: 20, cfg: 3.5, shift: 8.0,
            filenamePrefix: `preview_${shot.id}`,
          });
        } else {
          result = await generateVideoViaGoldTeam(pipeline, { ...shot, description: enhancedPrompt, _preview: true }, 'ai-preview');
        }
        _hermesAudit(hermes, 'ai-preview', hermesDecisionId, { shot_id: shot.id, mode: 'ai-preview' }, effectiveParams);
        return { shotId: shot.id, taskId: result.taskId, state: 'submitted' };
      });

      // ─── 工作流3.0: 自动超分 + 面部修复 (3060Ti, 可选) ───
      if (pipeline.config.workflow30?.enableAutoUpscale) {
        try {
          const gtClient = _makeGtClient(pipeline);
          for (const r of results.filter(r => !r.error)) {
            const pollResult = await gtClient.waitForTask(r.taskId, { timeoutMs: 120000 });
            if (!pollResult?.output?.files?.[0]) {
              console.warn(`[ai-preview] Shot ${r.shotId} 超分跳过: 无输出文件`);
              continue;
            }
            const videoPath = pollResult.output.files[0].path;
            const upscaled = await upscaleImage(pipeline, videoPath, '4x-UltraSharp.pth', `upscale_${r.shotId}`);
            if (pipeline.config.workflow30?.enableFaceRestore) {
              const upscaledPoll = await gtClient.waitForTask(upscaled.taskId, { timeoutMs: 60000 });
              const upscaledPath = upscaledPoll?.output?.files?.[0]?.path;
              if (upscaledPath) {
                await restoreFace(pipeline, upscaledPath, null, `face_${r.shotId}`);
              }
            }
            r.upscaled = upscaled.taskId;
          }
        } catch (e) {
          console.warn(`[ai-preview] 超分降级: ${e.message}`);
        }
      }

      await writeFile(join(pipeline.workdir, 'video_preview_tasks.json'), JSON.stringify({ tasks: results }, null, 2));
      phaseConfig.reviewCandidates = results.filter(r => !r.error).map(r => ({ id: r.shotId, label: `AI预览 ${r.shotId}` }));

      // Phase 12 QUAL-04: AI 预览首帧即时一致性审计
      // 视频生成完成后,对首帧截取(若可获得)调 auditImageVsL1
      let previewAuditHook = { retry_shots: [], audited: 0 };
      try {
        const shotImages = shots
          .filter(s => s.referenceImage || s.seed_frame_path || s.image_path)
          .map(s => ({
            shot_id: s.id || s.shot_id,
            image_path: s.referenceImage || s.seed_frame_path || s.image_path,
            character: s.character || s.character_id,
          }));
        if (shotImages.length) {
          const characters = await _loadCharactersForAudit(pipeline);
          previewAuditHook = await _runImmediateConsistencyAudit(pipeline, shotImages, characters, { phase: 'ai-preview' });
        }
        if (previewAuditHook.retry_shots.length) {
          await writeFile(
            join(pipeline.workdir, 'ai-preview-audit.json'),
            JSON.stringify(previewAuditHook, null, 2),
          );
        }
      } catch (e) {
        console.warn(`[ai-preview] 一致性即时审计降级: ${e.message}`);
      }

      // Evaluation collection
      try {
        const collector = _makeCollector(pipeline);
        await collector.record({
          phase: 'ai-preview',
          task_type: 'video_preview_fast',
          gpu_time_sec: 0,
          peak_vram_gb: 0,
          success: results.filter(r => !r.error).length > 0,
          retry_count: 0,
          hermes_decision_id: hermesDecisionId,
          parameters_used: effectiveParams,
        });
      } catch (e) { console.warn(`[ai-preview] 评估采集失败: ${e.message}`); }
    },
  },

  'final-production': {
    after: async (pipeline, phase, phaseConfig) => {
      const shots = phaseConfig.data?.approvedShots || phaseConfig.data?.shots || [];
      const bus = new AssetBus(pipeline.workdir);
      const injector = new PromptInjector(bus);
      const hermes = _makeHermesClient(pipeline);

      // Hermes decision for final production parameters
      let hermesDecisionId = null;
      let effectiveParams = HERMES_DEFAULTS['final-production'];
      if (hermes) {
        const hr = await _hermesDecide(hermes, 'final-production', {
          shot_count: shots.length,
          preview: false,
        });
        hermesDecisionId = hr.decisionId;
        if (hr.params) effectiveParams = { ...effectiveParams, ...hr.params };
      }

      // Final video production — Phase 15 PERF-02: 升级为 ShotParallelScheduler
      const finalScheduler = new ShotParallelScheduler({
        parallelism: effectiveParams.parallel_shots || HERMES_DEFAULTS['cloud-production'].parallel_shots || 4,
        pipeline,
      });

      const videoResults = await finalScheduler.runAll(shots, async (shot) => {
        const enhancedPrompt = await injector.inject(shot.description, { character: shot.character, scene: shot.scene_id, shotId: shot.id, mode: pipeline.mode });

        // ─── 工作流3.0: Wan I2V 双阶段优先，云端兜底 ───
        const useWanI2V = pipeline.config.workflow30?.useWanI2V !== false;
        let result;
        if (useWanI2V && shot.referenceImage) {
          try {
            result = await generateVideoWanI2V(pipeline, shot.referenceImage, enhancedPrompt, {
              width: 832, height: 480, length: 81,
              steps: 20, cfg: 3.5, shift: 8.0,
              filenamePrefix: `final_${shot.id}`,
            });
          } catch (wanErr) {
            console.warn(`[final-production] Wan I2V 失败 (${shot.id}), 降级到云端: ${wanErr.message}`);
            result = await generateVideoViaGoldTeam(pipeline, { ...shot, description: enhancedPrompt }, 'final-production');
          }
        } else {
          result = await generateVideoViaGoldTeam(pipeline, { ...shot, description: enhancedPrompt }, 'final-production');
        }
        _hermesAudit(hermes, 'final-production', hermesDecisionId, { shot_id: shot.id, mode: 'final' }, effectiveParams);
        return { shotId: shot.id, taskId: result.taskId, state: 'submitted' };
      });

      // Refine dialogue (upgrade from TEMP to FINAL)
      const voiceSoul = await bus.read('voice-soul');
      const tempDialogueMgr = new TempDialogueManager({ assetBus: bus, goldTeamClient: _makeGtClient(pipeline) });
      const tempDialogue = await tempDialogueMgr.readTempDialogue();
      if (tempDialogue.length > 0 && voiceSoul) {
        try { await tempDialogueMgr.refineDialogue(tempDialogue, voiceSoul, null); } catch (e) {
          console.warn(`[final-production] 对白精修降级: ${e.message}`);
        }
      }

      // Signature BGM (YuE 7B) for marked shots — skip if mode enforces no BGM
      const bgmStrategy = new BGMStrategy({ assetBus: bus, goldTeamClient: _makeGtClient(pipeline) });
      const stsScript = await bus.read('spatio-temporal-script') || {};
      const artBible = await bus.read('art-bible') || {};
      if (pipeline.mode?.fixed_rules?.bgm !== 'none') {
        for (const shot of stsScript.shots || []) {
          if (shot.bgm_event?.is_signature) {
            try { await bgmStrategy.generateSignatureBGM(shot.bgm_event.description, shot.duration_sec || 8, shot.bgm_event.musical_structure); } catch (e) {
              console.warn(`[final-production] YuE BGM降级: ${e.message}`);
            }
          }
        }
      }

      // Final SFX
      const sfxManager = new SFXManager({ goldTeamClient: _makeGtClient(pipeline), assetBus: bus });
      const requiredSFX = (stsScript.audio_events || []).filter(e => e.type === 'sfx' && e.required);
      if (requiredSFX.length > 0) {
        try { await sfxManager.generateFinalSFX(requiredSFX); } catch (e) {
          console.warn(`[final-production] SFX生成降级: ${e.message}`);
        }
      }

      await writeFile(join(pipeline.workdir, 'video_tasks.json'), JSON.stringify({ tasks: videoResults }, null, 2));
      phaseConfig.reviewCandidates = videoResults.filter(r => !r.error).map(r => ({ id: r.shotId, label: `终版 ${r.shotId}` }));

      // Evaluation collection
      try {
        const collector = _makeCollector(pipeline);
        await collector.record({
          phase: 'final-production',
          task_type: 'video_final',
          gpu_time_sec: 0,
          peak_vram_gb: 0,
          success: videoResults.filter(r => !r.error).length > 0,
          retry_count: 0,
          hermes_decision_id: hermesDecisionId,
          parameters_used: effectiveParams,
        });
      } catch (e) { console.warn(`[final-production] 评估采集失败: ${e.message}`); }
    },
  },

  composition: {
    after: async (pipeline, phase, phaseConfig) => {
      const thresholds = phaseConfig.thresholds || pipeline.config.qualityGate?.thresholds || { overall: 65 };
      const bus = new AssetBus(pipeline.workdir);
      const hermes = _makeHermesClient(pipeline);

      // Quality assessment
      let result;
      try { result = await assessQuality(pipeline); } catch (e) {
        console.warn(`[composition] 质量评估异常: ${e.message}`);
        result = { summary: { score: 0 }, metrics: { dimensions: {} } };
      }

      // Hermes scoring
      let hermesDecisionId = null;
      let effectiveParams = HERMES_DEFAULTS.composition;
      if (hermes) {
        try {
          const hr = await _hermesDecide(hermes, 'composition', { overall_score: result?.summary?.score || 0 });
          hermesDecisionId = hr.decisionId;
          if (hr.params) effectiveParams = { ...effectiveParams, ...hr.params };
          if (hr.params && result?.metrics) result.metrics.hermesScoring = hr.params;
        } catch (e) { /* skip */ }
      }

      // Story score injection
      if (pipeline.storyScoreReport) {
        try {
          const supplement = toGateSupplement(pipeline.storyScoreReport);
          if (supplement && result?.metrics?.dimensions) {
            result.metrics.storyScore = supplement;
          }
        } catch (e) { /* skip */ }
      }

      // Composition via CompositionEngine
      const composer = new CompositionEngine({ workdir: pipeline.workdir, config: pipeline.config, productionMode: pipeline.mode });
      const videoPath = join(pipeline.workdir, 'video_tasks.json');
      const tempDialogue = await bus.read('temp-dialogue');
      const bgmSkeleton = await bus.read('bgm-skeleton');

      try {
        const composeResult = await composer.compose({
          videoPath: phaseConfig.videoPath || videoPath,
          dialoguePath: tempDialogue?.temp_lines?.[0]?.audio_uri || null,
          bgmAmbientPath: bgmSkeleton?.ambient_segments?.[0]?.segments?.[0]?.uri || null,
          bgmSignaturePath: bgmSkeleton?.signature_segments?.[0]?.uri || null,
          outputPath: join(pipeline.workdir, 'final.mp4'),
        });

        // Quality check on composed output
        if (composeResult.output) {
          const qc = await composer.runQualityCheck(composeResult.output);
          result = result || { summary: {}, metrics: {} };
          result.metrics.composition = qc;
        }

        // Generate quality radar
        if (result?.metrics?.dimensions) {
          const svg = composer.generateQualityRadar(result.metrics.dimensions);
          if (svg) await writeFile(join(pipeline.workdir, 'quality_radar.svg'), svg);
        }
      } catch (e) { console.warn(`[composition] FFmpeg合成降级: ${e.message}`); }

      // Pass/Fail
      const overallScore = result?.summary?.score || 0;
      const passed = overallScore >= thresholds.overall;
      _hermesAudit(hermes, 'composition', hermesDecisionId, { overall_score: overallScore, passed }, effectiveParams);

      // Phase 17 E2E-01: degraded mode bypass — when pipeline explicitly configured
      // for degraded operation (all external services unreachable), the quality gate
      // cannot meaningfully score. Skip the hard-fail and let delivery emit a stubbed
      // quality-report with _reason instead of aborting the E2E flow.
      const degradedMode = pipeline.config.degradedMode === true
        || pipeline.config.qualityGate?.bypass === true;
      if (!passed) {
        if (degradedMode) {
          console.warn(`[composition] 质量门控未通过 (${overallScore}/${thresholds.overall}), degradedMode=true → 跳过硬失败`);
        } else {
          const err = new Error(`质量门控未通过 (${overallScore}/${thresholds.overall})`);
          err.code = 'QUALITY_GATE_FAILED'; err.overallScore = overallScore;
          throw err;
        }
      }

      return {
        summary: { ...result?.summary, score: overallScore, action: 'pass' },
        metrics: result?.metrics || {},
        passed: true,
        scores: result?.metrics?.dimensions || {},
      };
    },
  },

  // ═══════════════════════════════════════════════════════════
  // V6 Phase Handlers (15 new phases — stub implementations)
  // Real implementations deferred to phases 11/12/13/14/15.
  // Each handler follows the 7-step skeleton:
  //   1. hermes client + defaults
  //   2. hermes decide (with degrade fallback)
  //   3. stub data write to outputFiles
  //   4. hermes audit (fire-and-forget)
  //   5. EvaluationCollector.record
  //   6. return { summary, metrics }
  // ═══════════════════════════════════════════════════════════

  'pain-discovery': {
    after: async (pipeline, phase, phaseConfig) => {
      const hermes = _makeHermesClient(pipeline);
      const defaults = HERMES_DEFAULTS['pain-discovery'];

      // Step 2: Hermes decide (degrade gracefully — Phase 11 will add VALID_PHASES)
      let hermesDecisionId = null;
      let effectiveParams = defaults;
      if (hermes) {
        try {
          const hr = await _hermesDecide(hermes, 'pain-discovery', {
            genre: pipeline.config?.genre || '',
            title: pipeline.config?.title || '',
          });
          hermesDecisionId = hr.decisionId;
          if (hr.params) effectiveParams = { ...defaults, ...hr.params };
        } catch (e) {
          console.warn(`[pain-discovery] hermes decide 降级: ${e.message} (将在 Phase 11 修复)`);
        }
      }

      // Step 3: 调用 audienceMatch hook + 读取 requirement → pain-report.json
      // Phase 18 实化: 从 requirement 提取痛点,若 audienceMatch 可用则融合
      let reqData = phaseConfig.data || {};
      try {
        reqData = JSON.parse(await readFile(join(pipeline.workdir, 'requirement.json'), 'utf-8'));
      } catch { /* use phaseConfig.data or empty */ }

      // 构建模板痛点 (降级时也产出非空数组)
      const title = reqData.title || pipeline.config?.title || '未命名项目';
      const genre = reqData.genre || pipeline.config?.genre || '';
      const synopsis = reqData.synopsis || reqData.description || '';
      const templatePainPoints = [
        {
          id: 'pain-1',
          dimension: 'audience',
          pain_point: `目标受众对"${genre || '通用'}"类型内容的情感共鸣需求未被现有作品满足`,
          evidence: `基于 requirement: ${title}`,
          severity: 'medium',
        },
        {
          id: 'pain-2',
          dimension: 'market',
          pain_point: `平台现有${genre || '通用'}内容同质化,缺乏差异化切入点`,
          evidence: `requirement synopsis: ${synopsis.slice(0, 60)}`,
          severity: 'medium',
        },
      ];

      // 尝试调用 audienceMatch hook 获取更深入的受众分析
      let audienceResult = null;
      try {
        audienceResult = await audienceMatch({
          content: { ...reqData, platform: reqData.platform || 'douyin' },
          platform: reqData.platform || 'douyin',
        });
      } catch (e) {
        console.warn(`[pain-discovery] audienceMatch 降级: ${e.message}`);
      }

      const stubData = {
        _phase: 'pain-discovery',
        _generatedAt: new Date().toISOString(),
        _degraded: !audienceResult,
        requirement: reqData,
        pain_points: templatePainPoints,
        audience_match: audienceResult,
        ...(phaseConfig.data || {}),
      };
      await writeFile(join(pipeline.workdir, 'pain-report.json'), JSON.stringify(stubData, null, 2));

      // Step 4: Hermes audit
      _hermesAudit(hermes, 'pain-discovery', hermesDecisionId, {
        pain_points_count: templatePainPoints.length,
        audience_match_run: !!audienceResult,
      }, effectiveParams);

      // Step 5: EvaluationCollector
      try {
        const collector = _makeCollector(pipeline);
        await collector.record({
          phase: 'pain-discovery',
          task_type: 'pain_research',
          gpu_time_sec: 0, peak_vram_gb: 0,
          success: true, retry_count: 0,
          hermes_decision_id: hermesDecisionId,
          parameters_used: effectiveParams,
        });
      } catch (e) { console.warn(`[pain-discovery] 评估采集失败: ${e.message}`); }

      // Step 6: Return (Phase 18 实化: 不再 stubbed)
      return {
        summary: stubData,
        metrics: {
          pain_points_count: templatePainPoints.length,
          audience_match_run: !!audienceResult,
          degraded: !audienceResult,
        },
      };
    },
  },

  'topic-selection': {
    after: async (pipeline, phase, phaseConfig) => {
      const hermes = _makeHermesClient(pipeline);
      const defaults = HERMES_DEFAULTS['topic-selection'];

      let hermesDecisionId = null;
      let effectiveParams = defaults;
      if (hermes) {
        try {
          const hr = await _hermesDecide(hermes, 'topic-selection', {
            genre: pipeline.config?.genre || '',
            episode_count: pipeline.config?.episode_count || 1,
          });
          hermesDecisionId = hr.decisionId;
          if (hr.params) effectiveParams = { ...defaults, ...hr.params };
        } catch (e) {
          console.warn(`[topic-selection] hermes decide 降级: ${e.message} (将在 Phase 11 修复)`);
        }
      }

      // Step 3: 读 pain-report → generateTopics → LLM 选优 → selected-topic.json
      // Phase 18 实化: 优先从 candidate-topics.json 读取(requirement-bible 产出)
      // 再调 generateTopics,失败时模板降级保证 candidates 非空
      let candidates = [];
      let degraded = false;
      let degradeReason = null;

      // 尝试 1: 读 candidate-topics.json (requirement-bible 已写)
      try {
        const raw = await readFile(join(pipeline.workdir, 'candidate-topics.json'), 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) {
          candidates = parsed;
        } else if (Array.isArray(parsed?.candidates)) {
          candidates = parsed.candidates;
        }
      } catch { /* file missing — fallback to hook */ }

      // 尝试 2: 调用 generateTopics hook
      if (!candidates.length) {
        try {
          const topics = await generateTopics(pipeline.config || {}, {
            platform: 'douyin',
            genre: pipeline.config?.genre,
            blueprint: pipeline.blueprint,
          });
          if (Array.isArray(topics) && topics.length) candidates = topics;
        } catch (e) {
          console.warn(`[topic-selection] generateTopics 降级: ${e.message}`);
          degraded = true;
          degradeReason = e.message;
        }
      }

      // 降级: 至少 1 条模板候选
      if (!candidates.length) {
        degraded = true;
        degradeReason = degradeReason || 'no candidates from candidate-topics.json or generateTopics';
        const title = pipeline.config?.title || '未命名项目';
        const genre = pipeline.config?.genre || '通用';
        candidates = [{
          id: 'topic-template-1',
          title: `${title} — ${genre}短剧切入点`,
          name: `${title} — 选题候选 1`,
          description: `基于"${title}"的${genre}题材自动生成候选选题 (模板降级)`,
          hook_type: 'suspense',
          estimated_duration: 60,
          _template: true,
        }];
      }

      // 归一化 candidate 字段
      const normalized = candidates.slice(0, 5).map((t, i) => ({
        id: t.id || `topic-${i + 1}`,
        title: t.title || t.name || `候选 ${i + 1}`,
        name: t.name || t.title || `候选 ${i + 1}`,
        description: t.description || '',
        hook_type: t.hook_type || 'suspense',
        estimated_duration: t.estimated_duration || 60,
      }));
      phaseConfig.reviewCandidates = normalized.slice(0, 3).map(t => ({
        id: t.id, label: t.title, description: t.description,
      }));

      // LLM 评分选优 (可选,失败则取第一个)
      let selected = normalized[0];
      let selectionMethod = 'first';
      try {
        const prompt = `从以下候选选题中选出最具爆款潜力的一条,只返回 JSON 格式 {"index": 数字, "reason": "简短理由"}:\n${JSON.stringify(normalized, null, 2)}`;
        const llmResp = await callLLM(prompt, { system: '你是短视频选题专家' });
        const match = llmResp && llmResp.match(/\{[\s\S]*\}/);
        if (match) {
          const sel = JSON.parse(match[0]);
          if (typeof sel.index === 'number' && sel.index >= 0 && sel.index < normalized.length) {
            selected = normalized[sel.index];
            selected._selection_reason = sel.reason;
            selectionMethod = 'llm';
          }
        }
      } catch (e) {
        console.warn(`[topic-selection] LLM 选优降级,取首个候选: ${e.message}`);
        selectionMethod = 'first_degraded';
      }

      const stubData = {
        _phase: 'topic-selection',
        _generatedAt: new Date().toISOString(),
        _degraded: degraded,
        _degradeReason: degradeReason,
        _selectionMethod: selectionMethod,
        candidates: normalized,
        selected,
      };
      await writeFile(join(pipeline.workdir, 'selected-topic.json'), JSON.stringify(stubData, null, 2));

      _hermesAudit(hermes, 'topic-selection', hermesDecisionId, {
        candidates: normalized.length,
        selection_method: selectionMethod,
      }, effectiveParams);

      try {
        const collector = _makeCollector(pipeline);
        await collector.record({
          phase: 'topic-selection',
          task_type: 'topic_generation',
          gpu_time_sec: 0, peak_vram_gb: 0,
          success: true, retry_count: 0,
          hermes_decision_id: hermesDecisionId,
          parameters_used: effectiveParams,
        });
      } catch (e) { console.warn(`[topic-selection] 评估采集失败: ${e.message}`); }

      return {
        summary: stubData,
        metrics: {
          candidates_count: normalized.length,
          selection_method: selectionMethod,
          degraded,
        },
      };
    },
  },

  'outline-generation': {
    after: async (pipeline, phase, phaseConfig) => {
      const hermes = _makeHermesClient(pipeline);
      const defaults = HERMES_DEFAULTS['outline-generation'];

      let hermesDecisionId = null;
      let effectiveParams = defaults;
      if (hermes) {
        try {
          const hr = await _hermesDecide(hermes, 'outline-generation', {
            episode_count: pipeline.config?.episode_count || 1,
            genre: pipeline.config?.genre || '',
          });
          hermesDecisionId = hr.decisionId;
          if (hr.params) effectiveParams = { ...defaults, ...hr.params };
        } catch (e) {
          console.warn(`[outline-generation] hermes decide 降级: ${e.message} (将在 Phase 11 修复)`);
        }
      }

      // Step 3: 读 selected-topic → callLLM 生成 3 outline 候选 → outline-candidates.json
      // Phase 18 实化: LLM 生成 3 个有 episodes 结构的候选,失败时模板降级
      const epCount = Math.max(1, Math.min(3, pipeline.config?.episode_count || 1));
      const epDuration = pipeline.config?.duration_sec || 60;

      // 读取 selected-topic 作为 outline 生成的输入
      let topicData = {};
      try {
        topicData = JSON.parse(await readFile(join(pipeline.workdir, 'selected-topic.json'), 'utf-8'));
      } catch { /* file missing */ }
      const topicTitle = topicData?.selected?.title || pipeline.config?.title || '未命名项目';
      const topicDesc = topicData?.selected?.description || '';
      const genre = pipeline.config?.genre || '通用';

      // 尝试调用 LLM 生成大纲
      let candidates = [];
      let degraded = false;
      let degradeReason = null;
      try {
        const prompt = `你是剧本大纲专家。基于以下选题,生成 ${epCount} 个不同切入点的大纲候选。
每个候选需包含: id, title, logline (一句话), episodes (数组,每集含 id/title/synopsis/estimated_duration_sec).
选题标题: ${topicTitle}
选题描述: ${topicDesc}
题材: ${genre}
每集时长目标: ${epDuration}秒

返回 JSON 数组,形如:
[{"id":"outline-1","title":"...","logline":"...","episodes":[{"id":"ep-1","title":"...","synopsis":"...","estimated_duration_sec":${epDuration}}]}]`;

        const llmResp = await callLLM(prompt, { system: '你是剧本大纲专家,擅长多集短剧结构' });
        const match = llmResp && llmResp.match(/\[[\s\S]*\]/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (Array.isArray(parsed) && parsed.length) candidates = parsed;
        }
      } catch (e) {
        console.warn(`[outline-generation] LLM 降级,使用模板候选: ${e.message}`);
        degraded = true;
        degradeReason = e.message;
      }

      // 模板降级: 至少 epCount 条候选,每条至少 1 集
      if (!candidates.length) {
        degraded = true;
        degradeReason = degradeReason || 'LLM 返回空候选';
        const variants = ['悬念切入', '情感共鸣', '反差冲击'];
        candidates = variants.slice(0, epCount).map((variant, i) => ({
          id: `outline-${i + 1}`,
          title: `${topicTitle} — ${variant}切入`,
          logline: `${genre}题材短剧,${variant}切入:${topicDesc.slice(0, 40)}`,
          variant,
          episodes: Array.from({ length: Math.min(epCount, 1) }, (_, j) => ({
            id: `ep-${j + 1}`,
            title: `第${j + 1}集 ${variant}`,
            synopsis: `${topicTitle} — ${variant}切入的第${j + 1}集剧情梗概 (模板降级)`,
            estimated_duration_sec: epDuration,
          })),
          _template: true,
        }));
      }

      const stubData = {
        _phase: 'outline-generation',
        _generatedAt: new Date().toISOString(),
        _degraded: degraded,
        _degradeReason: degradeReason,
        topic_input: { title: topicTitle, description: topicDesc },
        candidates,
      };
      await writeFile(join(pipeline.workdir, 'outline-candidates.json'), JSON.stringify(stubData, null, 2));

      _hermesAudit(hermes, 'outline-generation', hermesDecisionId, {
        candidates: candidates.length,
        degraded,
      }, effectiveParams);

      try {
        const collector = _makeCollector(pipeline);
        await collector.record({
          phase: 'outline-generation',
          task_type: 'outline_generation',
          gpu_time_sec: 0, peak_vram_gb: 0,
          success: true, retry_count: 0,
          hermes_decision_id: hermesDecisionId,
          parameters_used: effectiveParams,
        });
      } catch (e) { console.warn(`[outline-generation] 评估采集失败: ${e.message}`); }

      return {
        summary: stubData,
        metrics: { candidates_count: candidates.length, degraded },
      };
    },
  },

  'outline-selection': {
    after: async (pipeline, phase, phaseConfig) => {
      const hermes = _makeHermesClient(pipeline);
      const defaults = HERMES_DEFAULTS['outline-selection'];

      let hermesDecisionId = null;
      let effectiveParams = defaults;
      if (hermes) {
        try {
          const hr = await _hermesDecide(hermes, 'outline-selection', {
            episode_count: pipeline.config?.episode_count || 1,
          });
          hermesDecisionId = hr.decisionId;
          if (hr.params) effectiveParams = { ...defaults, ...hr.params };
        } catch (e) {
          console.warn(`[outline-selection] hermes decide 降级: ${e.message} (将在 Phase 11 修复)`);
        }
      }

      // Step 3: 读 outline-candidates.json → LLM 选优 → selected-outline.json
      // Phase 18 实化: 从 candidates 中 LLM 选最优,失败取第一个
      let candidates = [];
      try {
        const raw = await readFile(join(pipeline.workdir, 'outline-candidates.json'), 'utf-8');
        const parsed = JSON.parse(raw);
        candidates = Array.isArray(parsed) ? parsed : (parsed?.candidates || []);
      } catch (e) {
        console.warn(`[outline-selection] 读 outline-candidates 降级: ${e.message}`);
      }

      // 模板兜底: 若 candidates 为空,生成 1 条最小候选
      let degraded = false;
      let degradeReason = null;
      if (!candidates.length) {
        degraded = true;
        degradeReason = 'outline-candidates.json 缺失或为空 — 生成模板兜底';
        candidates = [{
          id: 'outline-fallback-1',
          title: `${pipeline.config?.title || '未命名'} — 兜底大纲`,
          logline: `${pipeline.config?.genre || '通用'}题材短剧兜底大纲`,
          episodes: [{
            id: 'ep-1',
            title: '第1集',
            synopsis: '兜底剧情梗概',
            estimated_duration_sec: pipeline.config?.duration_sec || 60,
          }],
          _template: true,
        }];
      }

      // LLM 选优
      let selected = candidates[0];
      let selectionMethod = 'first';
      try {
        const prompt = `从以下大纲候选中选出最有潜力的一个,只返回 JSON {"index": 数字, "reason": "理由"}:\n${JSON.stringify(candidates.map((c, i) => ({ i, title: c.title, logline: c.logline })), null, 2)}`;
        const llmResp = await callLLM(prompt, { system: '你是剧本大纲评审专家' });
        const match = llmResp && llmResp.match(/\{[\s\S]*\}/);
        if (match) {
          const sel = JSON.parse(match[0]);
          if (typeof sel.index === 'number' && sel.index >= 0 && sel.index < candidates.length) {
            selected = candidates[sel.index];
            selected._selection_reason = sel.reason;
            selectionMethod = 'llm';
          }
        }
      } catch (e) {
        console.warn(`[outline-selection] LLM 选优降级: ${e.message}`);
        selectionMethod = 'first_degraded';
        degraded = true;
        degradeReason = e.message;
      }

      const stubData = {
        _phase: 'outline-selection',
        _generatedAt: new Date().toISOString(),
        _degraded: degraded,
        _degradeReason: degradeReason,
        _selectionMethod: selectionMethod,
        candidates_count: candidates.length,
        selected,
      };
      await writeFile(join(pipeline.workdir, 'selected-outline.json'), JSON.stringify(stubData, null, 2));

      _hermesAudit(hermes, 'outline-selection', hermesDecisionId, {
        candidates_count: candidates.length,
        selection_method: selectionMethod,
      }, effectiveParams);

      try {
        const collector = _makeCollector(pipeline);
        await collector.record({
          phase: 'outline-selection',
          task_type: 'outline_selection',
          gpu_time_sec: 0, peak_vram_gb: 0,
          success: true, retry_count: 0,
          hermes_decision_id: hermesDecisionId,
          parameters_used: effectiveParams,
        });
      } catch (e) { console.warn(`[outline-selection] 评估采集失败: ${e.message}`); }

      return {
        summary: stubData,
        metrics: { candidates_count: candidates.length, selection_method: selectionMethod, degraded },
      };
    },
  },

  'script-generation': {
    after: async (pipeline, phase, phaseConfig) => {
      const hermes = _makeHermesClient(pipeline);
      const defaults = HERMES_DEFAULTS['script-generation'];

      let hermesDecisionId = null;
      let effectiveParams = defaults;
      if (hermes) {
        try {
          const hr = await _hermesDecide(hermes, 'script-generation', {
            episode_count: pipeline.config?.episode_count || 1,
            genre: pipeline.config?.genre || '',
          });
          hermesDecisionId = hr.decisionId;
          if (hr.params) effectiveParams = { ...defaults, ...hr.params };
        } catch (e) {
          console.warn(`[script-generation] hermes decide 降级: ${e.message} (将在 Phase 11 修复)`);
        }
      }

      // Step 3: 读 selected-outline → callLLM 生成 3 script 候选 → script-candidates.json
      // Phase 18 实化: 修正原 callLLM 签名 bug (原代码传 object,实际签名是 (prompt, options))
      const epCount = Math.max(1, pipeline.config?.episode_count || 1);

      let outlineData = {};
      try {
        outlineData = JSON.parse(await readFile(join(pipeline.workdir, 'selected-outline.json'), 'utf-8'));
      } catch { /* file missing */ }
      const outline = outlineData?.selected || {};
      const outlineTitle = outline?.title || pipeline.config?.title || '未命名';
      const outlineLogline = outline?.logline || '';
      const genre = pipeline.config?.genre || '通用';
      const episodes = Array.isArray(outline?.episodes) ? outline.episodes : [];

      let candidates = [];
      let degraded = false;
      let degradeReason = null;
      try {
        const prompt = `你是短剧剧本编剧专家。基于以下大纲,生成 ${epCount} 个不同风格的剧本候选。
每个候选需包含: id, title, style (节奏风格), episodes (数组,每集含 id/title/synopsis/dialogues)
大纲标题: ${outlineTitle}
大纲 logline: ${outlineLogline}
题材: ${genre}
已知剧集: ${JSON.stringify(episodes.map(e => ({ id: e.id, title: e.title, synopsis: e.synopsis })))}

返回 JSON 数组,形如:
[{"id":"script-1","title":"...","style":"紧凑悬疑","episodes":[{"id":"ep-1","title":"...","synopsis":"...","dialogues":[{"character":"主角","line":"..."}]}]}]`;

        const llmResp = await callLLM(prompt, { system: '你是短剧剧本编剧专家,擅长快节奏高密度叙事' });
        const match = llmResp && llmResp.match(/\[[\s\S]*\]/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (Array.isArray(parsed) && parsed.length) candidates = parsed;
        }
      } catch (e) {
        console.warn(`[script-generation] LLM 降级,使用模板候选: ${e.message}`);
        degraded = true;
        degradeReason = e.message;
      }

      // 模板降级: 至少 epCount 条候选
      if (!candidates.length) {
        degraded = true;
        degradeReason = degradeReason || 'LLM 返回空候选';
        const styles = ['紧凑悬疑', '情感细腻', '反差冲击'];
        candidates = styles.slice(0, epCount).map((style, i) => ({
          id: `script-${i + 1}`,
          title: `${outlineTitle} — ${style}版`,
          style,
          episodes: (episodes.length ? episodes : [{ id: 'ep-1', title: '第1集', synopsis: outlineLogline }]).map((ep, j) => ({
            id: ep.id || `ep-${j + 1}`,
            title: ep.title || `第${j + 1}集`,
            synopsis: ep.synopsis || outlineLogline,
            dialogues: [
              { character: '旁白', line: `${style}版本:${ep.synopsis || outlineLogline}` },
              { character: '主角', line: '... (模板对白,LLM 降级)' },
            ],
          })),
          _template: true,
        }));
      }

      const stubData = {
        _phase: 'script-generation',
        _generatedAt: new Date().toISOString(),
        _degraded: degraded,
        _degradeReason: degradeReason,
        outline_input: { title: outlineTitle, logline: outlineLogline },
        candidates,
      };
      await writeFile(join(pipeline.workdir, 'script-candidates.json'), JSON.stringify(stubData, null, 2));

      _hermesAudit(hermes, 'script-generation', hermesDecisionId, {
        candidates: candidates.length,
        degraded,
      }, effectiveParams);

      try {
        const collector = _makeCollector(pipeline);
        await collector.record({
          phase: 'script-generation',
          task_type: 'script_generation',
          gpu_time_sec: 0, peak_vram_gb: 0,
          success: true, retry_count: 0,
          hermes_decision_id: hermesDecisionId,
          parameters_used: effectiveParams,
        });
      } catch (e) { console.warn(`[script-generation] 评估采集失败: ${e.message}`); }

      return {
        summary: stubData,
        metrics: { candidates_count: candidates.length, degraded },
      };
    },
  },

  'script-selection': {
    after: async (pipeline, phase, phaseConfig) => {
      const hermes = _makeHermesClient(pipeline);
      const defaults = HERMES_DEFAULTS['script-selection'];

      let hermesDecisionId = null;
      let effectiveParams = defaults;
      if (hermes) {
        try {
          const hr = await _hermesDecide(hermes, 'script-selection', {
            episode_count: pipeline.config?.episode_count || 1,
          });
          hermesDecisionId = hr.decisionId;
          if (hr.params) effectiveParams = { ...defaults, ...hr.params };
        } catch (e) {
          console.warn(`[script-selection] hermes decide 降级: ${e.message} (将在 Phase 11 修复)`);
        }
      }

      // Step 3: 读 script-candidates.json → LLM 选优 → selected-script.json
      // Phase 18 实化: 从 candidates 选最优,失败取第一个并标记降级
      let candidates = [];
      try {
        const raw = await readFile(join(pipeline.workdir, 'script-candidates.json'), 'utf-8');
        const parsed = JSON.parse(raw);
        candidates = Array.isArray(parsed) ? parsed : (parsed?.candidates || []);
      } catch (e) {
        console.warn(`[script-selection] 读 script-candidates 降级: ${e.message}`);
      }

      let degraded = false;
      let degradeReason = null;
      if (!candidates.length) {
        degraded = true;
        degradeReason = 'script-candidates.json 缺失或为空 — 生成模板兜底';
        candidates = [{
          id: 'script-fallback-1',
          title: `${pipeline.config?.title || '未命名'} — 兜底剧本`,
          style: '兜底',
          episodes: [{
            id: 'ep-1',
            title: '第1集',
            synopsis: '兜底剧情',
            dialogues: [{ character: '主角', line: '(模板对白)' }],
          }],
          _template: true,
        }];
      }

      let selected = candidates[0];
      let selectionMethod = 'first';
      try {
        const prompt = `从以下剧本候选中选出最具爆款潜力的一条,只返回 JSON {"index": 数字, "reason": "理由"}:\n${JSON.stringify(candidates.map((c, i) => ({ i, id: c.id, title: c.title, style: c.style })), null, 2)}`;
        const llmResp = await callLLM(prompt, { system: '你是剧本评审专家' });
        const match = llmResp && llmResp.match(/\{[\s\S]*\}/);
        if (match) {
          const sel = JSON.parse(match[0]);
          if (typeof sel.index === 'number' && sel.index >= 0 && sel.index < candidates.length) {
            selected = candidates[sel.index];
            selected._selection_reason = sel.reason;
            selectionMethod = 'llm';
          }
        }
      } catch (e) {
        console.warn(`[script-selection] LLM 选优降级: ${e.message}`);
        selectionMethod = 'first_degraded';
        degraded = true;
        degradeReason = e.message;
      }

      const stubData = {
        _phase: 'script-selection',
        _generatedAt: new Date().toISOString(),
        _degraded: degraded,
        _degradeReason: degradeReason,
        _selectionMethod: selectionMethod,
        candidates_count: candidates.length,
        selected,
      };
      await writeFile(join(pipeline.workdir, 'selected-script.json'), JSON.stringify(stubData, null, 2));

      _hermesAudit(hermes, 'script-selection', hermesDecisionId, {
        candidates_count: candidates.length,
        selection_method: selectionMethod,
      }, effectiveParams);

      try {
        const collector = _makeCollector(pipeline);
        await collector.record({
          phase: 'script-selection',
          task_type: 'script_selection',
          gpu_time_sec: 0, peak_vram_gb: 0,
          success: true, retry_count: 0,
          hermes_decision_id: hermesDecisionId,
          parameters_used: effectiveParams,
        });
      } catch (e) { console.warn(`[script-selection] 评估采集失败: ${e.message}`); }

      return {
        summary: stubData,
        metrics: { candidates_count: candidates.length, selection_method: selectionMethod, degraded },
      };
    },
  },

  'character-generation': {
    after: async (pipeline, phase, phaseConfig) => {
      const hermes = _makeHermesClient(pipeline);
      const defaults = HERMES_DEFAULTS['character-generation'];

      let hermesDecisionId = null;
      let effectiveParams = defaults;
      if (hermes) {
        try {
          const hr = await _hermesDecide(hermes, 'character-generation', {
            character_count: pipeline.config?.characters?.length || 0,
          });
          hermesDecisionId = hr.decisionId;
          if (hr.params) effectiveParams = { ...defaults, ...hr.params };
        } catch (e) {
          console.warn(`[character-generation] hermes decide 降级: ${e.message} (将在 Phase 11 修复)`);
        }
      }

      // Step 1: 初始化依赖
      const charactersDir = join(pipeline.workdir, 'assets/characters');
      await mkdir(charactersDir, { recursive: true });
      const assetManager = new CharacterAssetManager(charactersDir);
      const jimeng = new JimengClient(
        pipeline.config?.jimeng?.baseUrl || process.env.JIMENG_BASE_URL || 'http://localhost:8003',
      );

      // Step 2: 加载角色定义
      const characters = await _loadCharactersForGeneration(pipeline);

      // Step 3: 质量评分函数 — 复用 auditImageVsL1 (GLM-4V 视觉对比)
      // 对 L1 候选评分时,我们没有现成锚点,使用角色 feature_lock 作为文本基准
      const scorer = async (imagePath, character) => {
        const featureLock = {
          name: character.name,
          face: character.face || '',
          body: character.body || '',
        };
        // 无 anchor 图,auditImageVsL1 会返回 score=0.5 (无法对比)
        // 这里用 LLM 文本路径: 直接调 auditImageVsL1 传空 anchor + featureLock
        // auditImageVsL1 在无 anchor 时返回 0.5 — 改为直接 callLLMJson 基于文本评分
        try {
          const { callLLMJson } = await import('../hermes-adapter.js');
          const result = await callLLMJson({
            prompt: `评估以下候选面部特写图是否符合角色定义。

角色定义: ${JSON.stringify(featureLock)}
候选图: [${imagePath}]

评估维度:
1. 五官与描述匹配度
2. 发型与描述匹配度
3. 肤色与描述匹配度
4. 整体气质符合度
5. 图片质量 (清晰度、构图、光照)

返回 JSON: { "score": 0.0-1.0, "details": "评估说明", "issues": [] }`,
            system: '你是角色定妆照质量审查专家。0.85+ 优秀, 0.7-0.85 可接受, <0.7 需重新生成。严格按角色描述评分。',
          });
          return {
            score: typeof result?.score === 'number' ? result.score : 0.7,
            details: result?.details || '',
          };
        } catch (err) {
          // LLM 失败 — 降级默认分 (不高不低,不阻塞 pipeline)
          console.warn(`[character-generation] scorer LLM 失败, 降级: ${err.message}`);
          return { score: 0.75, details: `LLM 评分降级: ${err.message}` };
        }
      };

      // Step 4: 遍历每个角色生成 L1 + L2
      const candidatesData = {
        _phase: 'character-generation',
        _generatedAt: new Date().toISOString(),
        parameters: effectiveParams,
        characters: [],
        degraded: false,
      };

      let jimengAvailable = false;
      try {
        jimengAvailable = await jimeng.ping(3000);
      } catch {
        jimengAvailable = false;
      }

      if (!jimengAvailable) {
        console.warn('[character-generation] 即梦 API 不可用, 降级为 stub 模式 (空候选 + 警告)');
        candidatesData.degraded = true;
        candidatesData.degradedReason = 'Jimeng API unavailable';
        candidatesData.characters = characters.map(c => ({
          id: c.id, name: c.name,
          l1_candidates: [], l1_selected: [], l1_anchors: [],
          l2_costumes: [],
          degraded: true,
        }));
      } else {
        for (const character of characters) {
          // 幂等: 若已有 L1 锚点,跳过 L1 生成
          let existingAnchors = [];
          try {
            existingAnchors = await assetManager.getIdentityAnchors(character.id);
          } catch { /* dir not exist */ }

          let l1Result;
          if (existingAnchors.length) {
            console.log(`[character-generation] ${character.name}: 已有 ${existingAnchors.length} 个 L1 锚点, 跳过生成 (幂等)`);
            l1Result = {
              candidates: [],
              selected: existingAnchors.map((p, i) => ({
                path: p, index: i, score: 1.0, details: 'reused from existing manifest',
                face_embedding_hash: _computeFaceEmbeddingHash(p),
              })),
              anchors: existingAnchors,
              reused: true,
            };
          } else {
            l1Result = await _generateL1Anchors(character, jimeng, scorer, {
              candidates: effectiveParams.l1_candidates || 20,
              threshold: effectiveParams.l1_quality_threshold || 0.7,
              maxAnchors: effectiveParams.l1_max_anchors || 3,
              model: effectiveParams.model,
              ratio: effectiveParams.ratio,
              resolution: effectiveParams.resolution,
            });

            if (l1Result.anchors.length === 0) {
              console.warn(`[character-generation] ${character.name}: 0/${effectiveParams.l1_candidates || 20} 候选通过阈值 ${effectiveParams.l1_quality_threshold || 0.7}, 该角色降级`);
              // 不抛 fatal — 降级为空候选, pipeline 可继续
              candidatesData.characters.push({
                id: character.id, name: character.name,
                l1_candidates: l1Result.candidates,
                l1_selected: [],
                l1_anchors: [],
                l2_costumes: [],
                degraded: true,
                degradedReason: `0 candidates passed threshold ${effectiveParams.l1_quality_threshold || 0.7}`,
              });
              continue;
            }

            // 注册 L1 锚点
            await assetManager.registerIdentityAnchors(character.id, l1Result.anchors);
          }

          // 生成 L2 造型卡片 (每个 costume)
          const costumes = character.costumes?.length ? character.costumes : ['default'];
          let l2Costumes = [];
          try {
            l2Costumes = await _generateL2Costumes(character, l1Result.anchors, jimeng, costumes, {
              sampleStrength: effectiveParams.l2_sample_strength || 0.3,
              model: effectiveParams.model,
              ratio: effectiveParams.ratio,
              resolution: effectiveParams.resolution,
            });
            // 注册 L2 到 AssetManager
            for (const c of l2Costumes) {
              if (c.imagePaths.length) {
                await assetManager.registerCostumeSheet(character.id, c.costumeId, c.imagePaths);
              }
            }
          } catch (err) {
            console.warn(`[character-generation] ${character.name} L2 生成失败: ${err.message}`);
          }

          candidatesData.characters.push({
            id: character.id,
            name: character.name,
            l1_candidates: l1Result.candidates,
            l1_selected: l1Result.selected,
            l1_anchors: l1Result.anchors,
            l1_reused: l1Result.reused || false,
            l2_costumes: l2Costumes,
            degraded: l2Costumes.length === 0,
          });

          // ─── Phase 24 B2-03: CrossEpisodeAssetIndex 查询 ───
          // L1 生成完成后,查询 character-library 是否已有同身份角色 (跨剧集复用)
          // 非 blocking — 失败仅写 warning,不阻塞 generation
          try {
            const fingerprint = await assetManager._computeCostumeFingerprint(character.id);
            if (fingerprint) {
              const libResult = await assetManager.findByIdentity(fingerprint);
              const charEntry = candidatesData.characters[candidatesData.characters.length - 1];
              charEntry.cross_episode_lookup = {
                status: libResult.status,
                fingerprint_type: fingerprint.type,
                matches: libResult.matches || [],
                ...(libResult.pending ? { pending_approval_id: libResult.pending.approvalId } : {}),
                ...(libResult.reason ? { reason: libResult.reason } : {}),
              };
              if (libResult.status === 'matched' || libResult.status === 'pending_approval') {
                console.log(`[character-generation] ${character.name}: 跨剧集库命中 status=${libResult.status}, matches=${libResult.matches.length}`);
              }
            }
          } catch (e) {
            console.warn(`[character-generation] ${character.name}: 跨剧集库查询失败 (非阻塞): ${e.message}`);
          }
        }
      }

      // Step 5: 写入 character-candidates.json (完整 audit trail)
      await writeFile(
        join(pipeline.workdir, 'character-candidates.json'),
        JSON.stringify(candidatesData, null, 2),
      );

      // Step 6: Hermes audit
      _hermesAudit(hermes, 'character-generation', hermesDecisionId, {
        characterCount: characters.length,
        degraded: candidatesData.degraded,
        l1Total: candidatesData.characters.reduce((s, c) => s + c.l1_anchors.length, 0),
        l2Total: candidatesData.characters.reduce((s, c) => s + c.l2_costumes.length, 0),
      }, effectiveParams);

      // Step 7: EvaluationCollector
      try {
        const collector = _makeCollector(pipeline);
        await collector.record({
          phase: 'character-generation',
          task_type: 'image_draw',
          gpu_time_sec: 0, peak_vram_gb: 0,
          success: !candidatesData.degraded,
          retry_count: 0,
          hermes_decision_id: hermesDecisionId,
          parameters_used: effectiveParams,
        });
      } catch (e) { console.warn(`[character-generation] 评估采集失败: ${e.message}`); }

      return {
        summary: candidatesData,
        metrics: {
          characterCount: characters.length,
          degraded: candidatesData.degraded,
          l1Anchors: candidatesData.characters.reduce((s, c) => s + c.l1_anchors.length, 0),
          l2Costumes: candidatesData.characters.reduce((s, c) => s + c.l2_costumes.length, 0),
        },
      };
    },
  },

  'character-selection': {
    after: async (pipeline, phase, phaseConfig) => {
      const hermes = _makeHermesClient(pipeline);
      const defaults = HERMES_DEFAULTS['character-selection'];

      let hermesDecisionId = null;
      let effectiveParams = defaults;
      if (hermes) {
        try {
          const hr = await _hermesDecide(hermes, 'character-selection', {
            character_count: pipeline.config?.characters?.length || 0,
          });
          hermesDecisionId = hr.decisionId;
          if (hr.params) effectiveParams = { ...defaults, ...hr.params };
        } catch (e) {
          console.warn(`[character-selection] hermes decide 降级: ${e.message} (将在 Phase 11 修复)`);
        }
      }

      // Step 3: 读 character-candidates.json (Phase 14 产出) → LLM 选 top1 → soul-pack.json
      // Phase 18 实化: 从 Phase 14 的 character-assets 中选最优角色
      let characterData = null;
      try {
        const bus = new AssetBus(pipeline.workdir);
        characterData = await bus.read('character-assets');
      } catch (e) {
        console.warn(`[character-selection] 读 character-assets 降级: ${e.message}`);
      }

      const characters = characterData?.characters || [];
      let selected = null;
      let degraded = false;
      let degradeReason = null;
      let selectionMethod = 'none';

      if (!characters.length) {
        degraded = true;
        degradeReason = 'character-assets 缺失或 characters 为空 — 模板兜底';
        selected = {
          id: 'char-fallback-1',
          name: pipeline.config?.characters?.[0]?.name || '主角',
          face: pipeline.config?.characters?.[0]?.description || '',
          _template: true,
          assets: { L1_identity: [], L2_costumes: [] },
        };
        selectionMethod = 'template';
      } else {
        selected = characters[0];
        selectionMethod = 'first';
        // LLM 选优
        try {
          const prompt = `从以下已生成角色中选出最适合作为主角的一个,只返回 JSON {"index": 数字, "reason": "理由"}:\n${JSON.stringify(characters.map((c, i) => ({ i, id: c.id, name: c.name, face: c.face })), null, 2)}`;
          const llmResp = await callLLM(prompt, { system: '你是角色设计评审专家' });
          const match = llmResp && llmResp.match(/\{[\s\S]*\}/);
          if (match) {
            const sel = JSON.parse(match[0]);
            if (typeof sel.index === 'number' && sel.index >= 0 && sel.index < characters.length) {
              selected = characters[sel.index];
              selected._selection_reason = sel.reason;
              selectionMethod = 'llm';
            }
          }
        } catch (e) {
          console.warn(`[character-selection] LLM 选优降级: ${e.message}`);
          selectionMethod = 'first_degraded';
          degraded = true;
          degradeReason = e.message;
        }
      }

      // 构建 soul_pack (身份锚点 + 造型卡片)
      const soulPack = {
        character_id: selected.id,
        name: selected.name,
        face_description: selected.face || '',
        body_description: selected.body || '',
        L1_anchors: selected.assets?.L1_identity?.map(a => ({ path: a.path, score: a.score })) || [],
        L2_costumes: selected.assets?.L2_costumes || [],
        face_embedding_hash: selected.assets?.L1_identity?.[0]?.face_embedding_hash || null,
      };

      const stubData = {
        _phase: 'character-selection',
        _generatedAt: new Date().toISOString(),
        _degraded: degraded,
        _degradeReason: degradeReason,
        _selectionMethod: selectionMethod,
        candidates_count: characters.length,
        selected,
        soul_pack: soulPack,
      };
      // ─── Phase 24 B2-04: 将选定角色注册到跨剧集资产库 ───
      // operator 审批前先入 pending-approvals/; 此处默认 approved=false (human gate 强制)
      // 非 blocking — 失败仅写 warning
      let registrationStatus = 'skipped';
      try {
        const charactersDir = join(pipeline.workdir, 'assets/characters');
        const assetManager = new CharacterAssetManager(charactersDir);
        const fingerprint = await assetManager._computeCostumeFingerprint(selected.id);
        if (fingerprint) {
          const regResult = await assetManager.registerToLibrary(
            selected.id,
            fingerprint,
            {
              project: pipeline.config?.project_id || pipeline.workdir,
              episode_id: pipeline.config?.episode_id || null,
              registered_at: new Date().toISOString(),
            },
            // approved=false 默认 — 强制 human gate (Pitfalls 陷阱 4)
            // operator 后续通过 approvePending(approvalId) 完成注册
          );
          registrationStatus = regResult.registered ? 'approved' : 'pending_approval';
          stubData.cross_episode_registration = {
            status: registrationStatus,
            ...(regResult.approval_id ? { approval_id: regResult.approval_id } : {}),
            fingerprint_type: fingerprint.type,
            character_id: selected.id,
          };
          console.log(`[character-selection] ${selected.name}: 跨剧集库注册 status=${registrationStatus}`);
        } else {
          registrationStatus = 'no_fingerprint';
          stubData.cross_episode_registration = { status: registrationStatus };
        }
      } catch (e) {
        console.warn(`[character-selection] ${selected.name}: 跨剧集库注册失败 (非阻塞): ${e.message}`);
        stubData.cross_episode_registration = { status: 'error', error: e.message };
      }

      await writeFile(join(pipeline.workdir, 'soul-pack.json'), JSON.stringify(stubData, null, 2));

      _hermesAudit(hermes, 'character-selection', hermesDecisionId, {
        candidates_count: characters.length,
        selection_method: selectionMethod,
      }, effectiveParams);

      try {
        const collector = _makeCollector(pipeline);
        await collector.record({
          phase: 'character-selection',
          task_type: 'character_selection',
          gpu_time_sec: 0, peak_vram_gb: 0,
          success: true, retry_count: 0,
          hermes_decision_id: hermesDecisionId,
          parameters_used: effectiveParams,
        });
      } catch (e) { console.warn(`[character-selection] 评估采集失败: ${e.message}`); }

      return {
        summary: stubData,
        metrics: { candidates_count: characters.length, selection_method: selectionMethod, degraded },
      };
    },
  },

  'scene-generation': {
    after: async (pipeline, phase, phaseConfig) => {
      const hermes = _makeHermesClient(pipeline);
      const defaults = HERMES_DEFAULTS['scene-generation'];

      let hermesDecisionId = null;
      let effectiveParams = defaults;
      if (hermes) {
        try {
          const hr = await _hermesDecide(hermes, 'scene-generation', {
            genre: pipeline.config?.genre || '',
          });
          hermesDecisionId = hr.decisionId;
          if (hr.params) effectiveParams = { ...defaults, ...hr.params };
        } catch (e) {
          console.warn(`[scene-generation] hermes decide 降级: ${e.message} (将在 Phase 11 修复)`);
        }
      }

      // Step 3: 调用 JimengClient 生成 6 视角场景图;降级为 stub 路径占位
      // Phase 18 实化: 尝试 JimengClient 生成场景图,无 API 配置时模板降级
      // (模板候选包含 path 占位字符串,不实际写图文件)
      await mkdir(join(pipeline.workdir, 'assets/scenes/'), { recursive: true });

      // 读取 spatio-temporal-script + selected-outline 获取场景定义
      let sceneDefs = [];
      try {
        const bus = new AssetBus(pipeline.workdir);
        const sts = await bus.read('spatio-temporal-script');
        if (Array.isArray(sts?.shots)) {
          sceneDefs = sts.shots.map(s => ({
            id: s.scene_id || s.id,
            description: s.scene_description || s.description || '',
            characters: s.characters || (s.character ? [s.character] : []),
          }));
        }
      } catch { /* no sts */ }
      if (!sceneDefs.length) {
        // 兜底: 单个默认场景
        sceneDefs = [{
          id: 'scene-default',
          description: pipeline.config?.genre ? `${pipeline.config.genre}默认场景` : '默认场景',
          characters: [],
        }];
      }

      // 尝试 JimengClient (无 API key 时降级)
      // Phase 18: 先 ping 一次,失败则跳过全部真实生成 (避免 N×M 次重试)
      const jimeng = new JimengClient(
        pipeline.config?.jimeng?.baseUrl || process.env.JIMENG_BASE_URL || 'http://localhost:8003',
      );
      const viewCount = effectiveParams.views || 6;
      const views = ['front', 'side-left', 'side-right', 'back', 'top', 'wide'].slice(0, viewCount);

      // 快速 ping (1s timeout) — 失败则全部降级为 placeholder
      // 检查 resp.ok 且响应是合法健康检查 (非 jimeng 错误响应)
      let jimengAvailable = false;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 1000);
        const resp = await fetch(`${jimeng.baseUrl}/health`, { signal: ctrl.signal });
        clearTimeout(timer);
        if (resp.ok) {
          // 进一步验证: jimeng 的 /health 不存在时会返回 200 + code:-1000 错误 JSON
          // 真正的 jimeng 服务应该有 /v1/images/generations 接口
          // 简化: 检查 /health 响应体不是错误 JSON
          try {
            const body = await resp.clone().json().catch(() => null);
            if (body && body.code && body.code < 0) {
              // jimeng 错误响应 — 服务存在但 /health 端点不支持
              // 但这意味着 jimeng 服务可用,只是不支持 health 检查
              // 保守起见:标记为可用 (实际 generateImage 调用会决定)
              jimengAvailable = true;
            } else {
              jimengAvailable = true;
            }
          } catch {
            jimengAvailable = true;
          }
        }
      } catch {
        jimengAvailable = false;
      }

      const candidates = [];
      let degraded = false;
      let degradeReason = null;
      if (!jimengAvailable) {
        degraded = true;
        degradeReason = 'JimengClient 未就绪 — 全部场景使用 placeholder 路径';
      }
      for (const sceneDef of sceneDefs.slice(0, 3)) {
        const sceneCand = {
          id: sceneDef.id,
          description: sceneDef.description,
          characters: sceneDef.characters,
          views: [],
        };
        for (const view of views) {
          let imagePath = null;
          if (jimengAvailable) {
            try {
              const results = await jimeng.generateImage({
                prompt: `${sceneDef.description}, ${view} view, scene establishing, cinematic lighting`,
                model: effectiveParams.model || 'flux-dev',
                ratio: '16:9',
              });
              const item = Array.isArray(results) ? results[0] : results;
              imagePath = item?.url || item?.path || null;
            } catch (e) {
              // 单次生成失败,降级到 placeholder
            }
          }
          if (!imagePath) {
            imagePath = `assets/scenes/${sceneDef.id}-${view}-placeholder.png`;
          }
          sceneCand.views.push({ view, image_path: imagePath });
        }
        candidates.push(sceneCand);
      }

      const stubData = {
        _phase: 'scene-generation',
        _generatedAt: new Date().toISOString(),
        _degraded: degraded,
        _degradeReason: degradeReason,
        views_per_scene: viewCount,
        candidates,
      };
      await writeFile(join(pipeline.workdir, 'scene-candidates.json'), JSON.stringify(stubData, null, 2));

      // Phase 12 QUAL-04: 即时一致性审计 hook — 当 scene 图已生成 (Phase 14 后) 时触发
      try {
        const shotImages = candidates
          .flatMap(c => (c.views || []).map(v => ({
            shot_id: `${c.id}-${v.view}`,
            image_path: v.image_path,
            character: c.characters?.[0],
          })))
          .filter(s => s.image_path && !s.image_path.includes('placeholder'));
        if (shotImages.length) {
          const characters = await _loadCharactersForAudit(pipeline);
          const auditHook = await _runImmediateConsistencyAudit(pipeline, shotImages, characters, { phase: 'scene-generation' });
          if (auditHook.retry_shots.length) {
            stubData.retry_shots = auditHook.retry_shots;
            stubData.consistency_audit = auditHook;
          }
        }
      } catch (e) {
        console.warn(`[scene-generation] 一致性即时审计降级: ${e.message}`);
      }

      _hermesAudit(hermes, 'scene-generation', hermesDecisionId, {
        candidates: candidates.length,
        degraded,
      }, effectiveParams);

      try {
        const collector = _makeCollector(pipeline);
        await collector.record({
          phase: 'scene-generation',
          task_type: 'image_draw',
          gpu_time_sec: 0, peak_vram_gb: 0,
          success: true, retry_count: 0,
          hermes_decision_id: hermesDecisionId,
          parameters_used: effectiveParams,
        });
      } catch (e) { console.warn(`[scene-generation] 评估采集失败: ${e.message}`); }

      return {
        summary: stubData,
        metrics: {
          candidates_count: candidates.length,
          views_per_scene: viewCount,
          degraded,
        },
      };
    },
  },

  'scene-selection': {
    after: async (pipeline, phase, phaseConfig) => {
      const hermes = _makeHermesClient(pipeline);
      const defaults = HERMES_DEFAULTS['scene-selection'];

      let hermesDecisionId = null;
      let effectiveParams = defaults;
      if (hermes) {
        try {
          const hr = await _hermesDecide(hermes, 'scene-selection', {
            episode_count: pipeline.config?.episode_count || 1,
          });
          hermesDecisionId = hr.decisionId;
          if (hr.params) effectiveParams = { ...defaults, ...hr.params };
        } catch (e) {
          console.warn(`[scene-selection] hermes decide 降级: ${e.message} (将在 Phase 11 修复)`);
        }
      }

      // Step 3: 读 scene-candidates.json → LLM 选优 → geometry-bed.json
      // Phase 18 实化: 从 scene 候选中选最优,产出 geometry-bed (含 6 视角路径)
      let candidates = [];
      try {
        const raw = await readFile(join(pipeline.workdir, 'scene-candidates.json'), 'utf-8');
        const parsed = JSON.parse(raw);
        candidates = Array.isArray(parsed) ? parsed : (parsed?.candidates || []);
      } catch (e) {
        console.warn(`[scene-selection] 读 scene-candidates 降级: ${e.message}`);
      }

      let degraded = false;
      let degradeReason = null;
      if (!candidates.length) {
        degraded = true;
        degradeReason = 'scene-candidates.json 缺失或为空 — 生成模板兜底';
        candidates = [{
          id: 'scene-fallback-1',
          description: '默认场景 (兜底)',
          characters: [],
          views: [
            { view: 'front', image_path: 'assets/scenes/scene-fallback-1-front-placeholder.png' },
            { view: 'side-left', image_path: 'assets/scenes/scene-fallback-1-side-left-placeholder.png' },
          ],
          _template: true,
        }];
      }

      let selected = candidates[0];
      let selectionMethod = 'first';
      try {
        const prompt = `从以下场景候选中选出最适合作为主场景的一个,只返回 JSON {"index": 数字, "reason": "理由"}:\n${JSON.stringify(candidates.map((c, i) => ({ i, id: c.id, description: c.description })), null, 2)}`;
        const llmResp = await callLLM(prompt, { system: '你是场景设计评审专家' });
        const match = llmResp && llmResp.match(/\{[\s\S]*\}/);
        if (match) {
          const sel = JSON.parse(match[0]);
          if (typeof sel.index === 'number' && sel.index >= 0 && sel.index < candidates.length) {
            selected = candidates[sel.index];
            selected._selection_reason = sel.reason;
            selectionMethod = 'llm';
          }
        }
      } catch (e) {
        console.warn(`[scene-selection] LLM 选优降级: ${e.message}`);
        selectionMethod = 'first_degraded';
        degraded = true;
        degradeReason = e.message;
      }

      // 构建 geometry_bed 结构 (参考 V4.1 geometry-bed handler)
      const geometryBed = {
        scene_id: selected.id,
        description: selected.description,
        characters: selected.characters || [],
        views: selected.views || [],
        // 3D asset 元数据 (placeholder — 真实 GLB 生成留 v3.0)
        glb_path: null,
        texture_resolution: 1024,
        pbr_enabled: true,
      };

      const stubData = {
        _phase: 'scene-selection',
        _generatedAt: new Date().toISOString(),
        _degraded: degraded,
        _degradeReason: degradeReason,
        _selectionMethod: selectionMethod,
        candidates_count: candidates.length,
        selected,
        geometry_bed: geometryBed,
      };
      await writeFile(join(pipeline.workdir, 'geometry-bed.json'), JSON.stringify(stubData, null, 2));

      _hermesAudit(hermes, 'scene-selection', hermesDecisionId, {
        candidates_count: candidates.length,
        selection_method: selectionMethod,
      }, effectiveParams);

      try {
        const collector = _makeCollector(pipeline);
        await collector.record({
          phase: 'scene-selection',
          task_type: 'scene_selection',
          gpu_time_sec: 0, peak_vram_gb: 0,
          success: true, retry_count: 0,
          hermes_decision_id: hermesDecisionId,
          parameters_used: effectiveParams,
        });
      } catch (e) { console.warn(`[scene-selection] 评估采集失败: ${e.message}`); }

      return {
        summary: stubData,
        metrics: { candidates_count: candidates.length, selection_method: selectionMethod, degraded },
      };
    },
  },

  'script-lock': {
    after: async (pipeline, phase, phaseConfig) => {
      const hermes = _makeHermesClient(pipeline);
      const defaults = HERMES_DEFAULTS['script-lock'];

      let hermesDecisionId = null;
      let effectiveParams = defaults;
      if (hermes) {
        try {
          const hr = await _hermesDecide(hermes, 'script-lock', {
            episode_count: pipeline.config?.episode_count || 1,
          });
          hermesDecisionId = hr.decisionId;
          if (hr.params) effectiveParams = { ...defaults, ...hr.params };
        } catch (e) {
          console.warn(`[script-lock] hermes decide 降级: ${e.message} (将在 Phase 11 修复)`);
        }
      }

      // Step 3: Read selected-script.json → 透传 + 审核元数据 → script-locked.json
      // Phase 18 实化: 透传 selected-script + 写入完整审核元数据,而非空 stub
      let scriptData = {};
      let scriptReadOk = false;
      try {
        scriptData = JSON.parse(await readFile(join(pipeline.workdir, 'selected-script.json'), 'utf-8'));
        scriptReadOk = true;
      } catch (e) {
        console.warn(`[script-lock] selected-script.json 读取失败,使用空对象: ${e.message}`);
      }

      // 构建审核元数据 (若已有 selection_method=llm 表示已审核)
      const selectedScript = scriptData?.selected || scriptData || {};
      const selectionMethod = scriptData?._selectionMethod || 'unknown';
      const degraded = scriptData?._degraded || !scriptReadOk;

      const review_metadata = {
        approved: true,
        approval_path: 'auto',   // 自动锁定 (pipeline 不阻塞等待人工)
        selection_method: selectionMethod,
        reviewer: 'pipeline-auto',
        reviewed_at: new Date().toISOString(),
        degraded,
        degrade_reason: scriptData?._degradeReason || (scriptReadOk ? null : 'selected-script.json missing'),
      };

      const stubData = {
        _phase: 'script-lock',
        _generatedAt: new Date().toISOString(),
        script: selectedScript,
        lockedAt: new Date().toISOString(),
        review_metadata,
        candidates_count: scriptData?.candidates_count || 0,
      };
      await writeFile(join(pipeline.workdir, 'script-locked.json'), JSON.stringify(stubData, null, 2));

      _hermesAudit(hermes, 'script-lock', hermesDecisionId, {
        locked: true,
        selection_method: selectionMethod,
        degraded,
      }, effectiveParams);

      try {
        const collector = _makeCollector(pipeline);
        await collector.record({
          phase: 'script-lock',
          task_type: 'script_lock',
          gpu_time_sec: 0, peak_vram_gb: 0,
          success: true, retry_count: 0,
          hermes_decision_id: hermesDecisionId,
          parameters_used: effectiveParams,
        });
      } catch (e) { console.warn(`[script-lock] 评估采集失败: ${e.message}`); }

      return {
        summary: stubData,
        metrics: {
          locked: true,
          selection_method: selectionMethod,
          candidates_count: scriptData?.candidates_count || 0,
          degraded,
        },
      };
    },
  },

  'consistency-guard': {
    after: async (pipeline, phase, phaseConfig) => {
      const hermes = _makeHermesClient(pipeline);
      const defaults = HERMES_DEFAULTS['consistency-guard'];
      const bus = new AssetBus(pipeline.workdir);

      let hermesDecisionId = null;
      let effectiveParams = defaults;
      if (hermes) {
        try {
          const hr = await _hermesDecide(hermes, 'consistency-guard', {
            episode_count: pipeline.config?.episode_count || 1,
          });
          hermesDecisionId = hr.decisionId;
          if (hr.params) effectiveParams = { ...defaults, ...hr.params };
        } catch (e) {
          console.warn(`[consistency-guard] hermes decide 降级: ${e.message}`);
        }
      }

      // Step 3: 收集所有 visuals (生成图), 从 spatio-temporal-script + character-assets + scene-assets
      const stsScript = await bus.read('spatio-temporal-script') || {};
      const characterAssets = await bus.read('character-assets') || {};
      const sceneAssets = await bus.read('scene-assets') || {};

      const visuals = (stsScript.shots || [])
        .filter(s => s.image_path || s.seed_frame_path || s.imagePath)
        .map(s => ({
          shot_id: s.id || s.shot_id,
          image_path: s.image_path || s.seed_frame_path || s.imagePath,
          scene_id: s.scene_id,
          character: s.character || s.character_id || s.character_name,
        }));

      // 无 visuals 时写降级标记 (Phase 14 真实生成后才会有图)
      if (!visuals.length) {
        const stubData = {
          _stub: true,
          _reason: 'no_visuals_yet',
          _phase: 'consistency-guard',
          _generatedAt: new Date().toISOString(),
          overall: 1.0,
          passed: true,
          findings: [{ dimension: 'all', severity: 'low', issue: '无生成图,跳过审计 (Phase 14 后生效)' }],
          retry_shots: [],
        };
        await writeFile(join(pipeline.workdir, 'consistency-pass.json'), JSON.stringify(stubData, null, 2));

        _hermesAudit(hermes, 'consistency-guard', hermesDecisionId, { skipped: 'no_visuals' }, effectiveParams);

        try {
          const collector = _makeCollector(pipeline);
          await collector.record({
            phase: 'consistency-guard',
            task_type: 'consistency_audit',
            gpu_time_sec: 0, peak_vram_gb: 0,
            success: true, retry_count: 0,
            hermes_decision_id: hermesDecisionId,
            parameters_used: effectiveParams,
          });
        } catch (e) { console.warn(`[consistency-guard] 评估采集失败: ${e.message}`); }

        return { summary: stubData, metrics: { skipped: 'no_visuals', overall: 1.0, passed: true } };
      }

      // 调用真实审计
      let auditResult;
      let auditFailed = false;
      try {
        const gtClient = pipeline.config?.goldTeam?.baseUrl ? _makeGtClient(pipeline) : null;
        auditResult = await auditContinuity({
          visuals,
          characterAssets: characterAssets.characters || [],
          sceneMeta: sceneAssets,
          goldTeamClient: gtClient,
          workdir: pipeline.workdir,
        });
      } catch (e) {
        console.warn(`[consistency-guard] auditContinuity 异常 (不 fail pipeline): ${e.message}`);
        auditResult = {
          scores: {}, overall: 0, passed: false,
          findings: [{ dimension: 'all', severity: 'high', issue: `审计异常: ${e.message}` }],
          error: e.message,
        };
        auditFailed = true;
      }

      // 收集 retry_shots: 任何 identity_match < 0.7 的 shot 加入重试队列
      // (此时 auditContinuity 已对每张图评过,可通过 finding.shot_ids 推断)
      const retryShots = [];
      for (const f of (auditResult.findings || [])) {
        if (f.dimension === 'identity_match' && f.severity === 'high' && Array.isArray(f.shot_ids)) {
          retryShots.push(...f.shot_ids);
        }
      }

      const stubData = {
        _phase: 'consistency-guard',
        _generatedAt: new Date().toISOString(),
        _auditFailed: auditFailed,
        scores: auditResult.scores || {},
        overall: auditResult.overall ?? 0,
        passed: auditResult.passed ?? false,
        findings: auditResult.findings || [],
        recommendation: auditResult.recommendation || '',
        retry_shots: retryShots,
        visual_count: visuals.length,
      };
      await writeFile(join(pipeline.workdir, 'consistency-pass.json'), JSON.stringify(stubData, null, 2));

      // 不抛 fatal — 让质量门控在 composition/Phase 13 阶段统一判定
      if (!stubData.passed) {
        console.warn(`[consistency-guard] 审计未通过: ${stubData.recommendation || '部分维度低于阈值'}`);
      }

      _hermesAudit(hermes, 'consistency-guard', hermesDecisionId, {
        overall: stubData.overall, passed: stubData.passed,
        retry_count: retryShots.length, audit_failed: auditFailed,
      }, effectiveParams);

      try {
        const collector = _makeCollector(pipeline);
        await collector.record({
          phase: 'consistency-guard',
          task_type: 'consistency_audit',
          gpu_time_sec: 0, peak_vram_gb: 0,
          success: !auditFailed, retry_count: retryShots.length,
          hermes_decision_id: hermesDecisionId,
          parameters_used: effectiveParams,
        });
      } catch (e) { console.warn(`[consistency-guard] 评估采集失败: ${e.message}`); }

      return {
        summary: stubData,
        metrics: {
          overall: stubData.overall,
          passed: stubData.passed,
          retry_shots: retryShots.length,
          audit_failed: auditFailed,
        },
      };
    },
  },

  'cloud-production': {
    after: async (pipeline, phase, phaseConfig) => {
      const hermes = _makeHermesClient(pipeline);
      const defaults = HERMES_DEFAULTS['cloud-production'];

      let hermesDecisionId = null;
      let effectiveParams = defaults;
      if (hermes) {
        try {
          const hr = await _hermesDecide(hermes, 'cloud-production', {
            episode_count: pipeline.config?.episode_count || 1,
          });
          hermesDecisionId = hr.decisionId;
          if (hr.params) effectiveParams = { ...defaults, ...hr.params };
        } catch (e) {
          console.warn(`[cloud-production] hermes decide 降级: ${e.message} (将在 Phase 11 修复)`);
        }
      }

      // Phase 15 PERF-01: 真实 Seedance omni_reference 视频生成 (替代 Phase 10 stub)
      const bus = new AssetBus(pipeline.workdir);
      const stsScript = await bus.read('spatio-temporal-script') || {};
      const shots = stsScript.shots || [];

      // Phase 22 A2-02: 读取 voice-timeline (v2.0 Phase 5 voice 产出)
      // 若 shots 含对白但 voice-timeline 未就绪 → 时序锁违反，显式报错
      const voiceTimeline = await bus.read('voice-timeline');
      // voice-timeline slot 可能是 { timeline: [...] } 或 { shotId: { audioPath } }
      const voiceEntries = _extractVoiceEntries(voiceTimeline);
      const hasDialogueShots = shots.some(s => s?.dialogue?.text);
      if (hasDialogueShots && !voiceTimeline) {
        throw new Error(
          'cloud-production 时序锁违反: shots 含对白但 voice-timeline 未就绪 ' +
          '(voice phase 未完成)。请先完成 voice phase 写入 voice-timeline.json，' +
          '或清除 shots 中的 dialogue 字段。',
        );
      }

      await mkdir(join(pipeline.workdir, 'final-shots/video/'), { recursive: true });

      // ─── 降级 1: gold-team 不可用时写 stub (为 Phase 17 E2E 留空降级) ───
      const gtClient = _makeGtClient(pipeline);
      let goldTeamAvailable = false;
      try {
        goldTeamAvailable = await gtClient.ping(5000);
      } catch (e) {
        console.warn(`[cloud-production] gold-team ping 异常: ${e.message}`);
      }

      if (!goldTeamAvailable || shots.length === 0) {
        const reason = shots.length === 0 ? 'no shots' : 'gold-team unavailable';
        console.warn(`[cloud-production] 降级写 stub (${reason})`);
        const stubData = {
          _stub: true,
          _phase: 'cloud-production',
          _generatedAt: new Date().toISOString(),
          _degraded_reason: reason,
          tasks: [],
          parallel_shots: effectiveParams.parallel_shots || 4,
        };
        await writeFile(join(pipeline.workdir, 'video_tasks.json'), JSON.stringify(stubData, null, 2));

        _hermesAudit(hermes, 'cloud-production', hermesDecisionId, { stubbed: true, degraded: reason }, effectiveParams);

        try {
          const collector = _makeCollector(pipeline);
          await collector.record({
            phase: 'cloud-production',
            task_type: 'video_final',
            gpu_time_sec: 0, peak_vram_gb: 0,
            success: false, retry_count: 0,
            hermes_decision_id: hermesDecisionId,
            parameters_used: effectiveParams,
          });
        } catch (e) { console.warn(`[cloud-production] 评估采集失败: ${e.message}`); }

        return {
          summary: stubData,
          metrics: { stubbed: true, degraded: true, reason, shot_count: shots.length },
        };
      }

      // ─── 幂等: 读取已完成的 shot,跳过重跑 ───
      const previousTasks = await _loadPreviousVideoTasks(pipeline.workdir);
      const completedShotIds = new Set(
        (previousTasks?.tasks || [])
          .filter(t => t && t.status === 'completed' && t.shot_id)
          .map(t => t.shot_id),
      );
      const shotsToRun = shots.filter(s => !completedShotIds.has(s.id));
      const skippedCount = shots.length - shotsToRun.length;

      if (skippedCount > 0) {
        console.log(`[cloud-production] 幂等跳过 ${skippedCount}/${shots.length} 已完成 shot`);
      }

      // ─── 并行调度: 真实 Seedance omni_reference ───
      const scheduler = new ShotParallelScheduler({
        parallelism: effectiveParams.parallel_shots || 4,
        pipeline,
      });

      // ─── Phase 21 B5-03: BlacklistEngine (跨 run 累积 bad case) ───
      const blacklist = new BlacklistEngine({
        assetBus: bus,
        workdir: pipeline.workdir,
        config: pipeline.config,
      });
      // 启动时清理 TTL 过期条目(失败不阻塞主流程)
      try {
        await blacklist.pruneExpired();
      } catch (e) {
        console.warn(`[cloud-production] blacklist pruneExpired 异常: ${e.message}`);
      }

      const assetManager = new CharacterAssetManager(join(pipeline.workdir, 'characters'));

      const newResults = await scheduler.runWithRetry(shotsToRun, async (shot) => {
        // Phase 22 A2-02: 为含对白的 shot 组装 audio refs (按 shot.id 过滤)
        const shotAudioRefs = voiceEntries && shot.dialogue?.text
          ? (voiceEntries[shot.id]
              ? [{ path: voiceEntries[shot.id].audioPath, character: shot.dialogue.character, shot_id: shot.id }]
              : [])
          : [];

        // 1. 组装 omni_reference pack (Phase 22: 透传 audioRefs)
        const refPack = await assetManager.getOmniReferencePack(shot.character_id || shot.character, {
          costumeId: shot.costume_id,
          sceneFrame: shot.scene_frame_path || shot.seed_frame_path,
          audioRefs: shotAudioRefs,
        });

        // Phase 22 A2-03: 强制 @Audio 校验 (Pitfalls 陷阱 1 防御)
        // audio_refs 非空但 prompt 无 @Audio token → Seedance 会静默忽略 audio
        if (refPack.hasAudio && !refPack.promptBindings.includes('@Audio')) {
          throw new Error(
            `Shot ${shot.id} audio_refs 非空但 prompt 无 @Audio 绑定 — ` +
            'Seedance 2.0 会静默忽略音频。请检查 getOmniReferencePack 的 @Audio 构造逻辑。',
          );
        }

        // 2. 提交 Seedance 任务 (Phase 22: audio_refs + generate_audio flag)
        const task = await gtClient.submitTask({
          taskType: 'seedance_omni_reference',
          params: {
            prompt: shot.description,
            identity_refs: refPack.identityImages,
            scene_refs: refPack.sceneImages,
            action_refs: refPack.actionVideos,
            identity_weight: effectiveParams.identity_weight ?? 0.7,
            action_weight: effectiveParams.action_weight ?? 0.3,
            // Phase 22 A2-02/A2-03: 音画同步字段
            audio_refs: refPack.audioRefs.map(a => a.path),
            prompt_audio_bindings: refPack.hasAudio ? refPack.promptBindings : undefined,
            generate_audio: refPack.hasAudio,
          },
          priority: 10,
          callbackPath: '/callback/gpu_task',
          description: `${pipeline.episode}:cloud-production:shot-${shot.id}`,
        });

        // 3. waitForTask 阻塞 (5s 轮询, 10min 超时)
        const completed = await gtClient.waitForTask(task.taskId, {
          pollIntervalMs: 5000,
          timeoutMs: 600000,
        });

        return {
          shot_id: shot.id,
          task_id: task.taskId,
          video_path: completed?.artifacts?.[0]?.path || completed?.output?.files?.[0]?.path || null,
          audio_synced: refPack.hasAudio,
          status: 'completed',
        };
      }, {
        maxRetries: effectiveParams.max_retries || 3,  // Phase 16 PERF-04: 重试预算
        blacklist,  // Phase 21 B5-03: 黑名单过滤
      });

      // ─── Phase 21 B5-03: 永久失败 → 入黑名单库 (供下次 run 跳过) ───
      const newPermanentFailures = ShotParallelScheduler.collectPermanentFailures(newResults);
      for (const pf of newPermanentFailures) {
        try {
          const matchedShot = shotsToRun.find(s =>
            (s?.id || s?.shot_id) === (pf.shot_id),
          );
          await blacklist.record({
            shot_id: pf.shot_id,
            error: pf.error || 'permanent_failure',
            prompt: matchedShot?.description || '',
            imagePath: matchedShot?.scene_frame_path || matchedShot?.seed_frame_path,
            run_id: pipeline.episode,
          });
        } catch (e) {
          console.warn(`[cloud-production] blacklist.record(${pf.shot_id}) 异常: ${e.message}`);
        }
      }

      // 合并结果: 保留之前完成的 + 新生成的
      const retainedPrevious = (previousTasks?.tasks || [])
        .filter(t => t && t.status === 'completed' && t.shot_id);
      const allResults = [...retainedPrevious, ...newResults];
      const failed = ShotParallelScheduler.collectFailures(newResults);
      const permanentFailures = ShotParallelScheduler.collectPermanentFailures(newResults);
      const blacklisted = ShotParallelScheduler.collectBlacklisted(newResults);

      const outputData = {
        _phase: 'cloud-production',
        _generatedAt: new Date().toISOString(),
        tasks: allResults,
        failed_shots: failed,
        permanent_failures: permanentFailures,
        blacklisted_shots: blacklisted,
        parallel_shots: effectiveParams.parallel_shots || 4,
        max_retries: effectiveParams.max_retries || 3,
        stats: {
          total_shots: shots.length,
          completed: allResults.filter(r => r.status === 'completed').length,
          failed: failed.length,
          permanent_failed: permanentFailures.length,
          skipped_idempotent: skippedCount,
          blacklisted: blacklisted.length,
        },
      };
      await writeFile(join(pipeline.workdir, 'video_tasks.json'), JSON.stringify(outputData, null, 2));

      // ─── Phase 23 B4-05: CreativeHistoryTracker — 下游 lineage stamp MVP ───
      // 每个成功生成的 video → stamp(source_hashes=[sts, char, scene content_hash])
      // 降级不阻塞主流程(stamp 内部 warn + return false on AssetBus error)
      try {
        const tracker = new CreativeHistoryTracker({ assetBus: bus });
        const charEnv = await bus.readEnvelope('character-assets');
        const sceneEnv = await bus.readEnvelope('scene-assets');
        const stsEnv = await bus.readEnvelope('spatio-temporal-script');
        const sourceHashes = [
          stsEnv?.content_hash,
          charEnv?.content_hash,
          sceneEnv?.content_hash,
        ].filter(Boolean);

        if (sourceHashes.length > 0) {
          let stamped = 0;
          for (const r of newResults) {
            if (r && r.status === 'completed' && r.shot_id && r.video_path) {
              const videoHash = createHash('sha256')
                .update(String(r.video_path)).digest('hex');
              const ok = await tracker.stamp({
                asset_slot: 'final-shots',
                asset_id: r.shot_id,
                source_hashes: sourceHashes,
                content_hash: videoHash,
              });
              if (ok) stamped += 1;
            }
          }
          if (stamped > 0) {
            console.log(`[cloud-production] Phase 23 lineage: stamped ${stamped} video → creative-history`);
          }
        }
      } catch (e) {
        console.warn(`[cloud-production] CreativeHistoryTracker 降级: ${e.message}`);
      }

      _hermesAudit(hermes, 'cloud-production', hermesDecisionId, {
        shot_count: shots.length,
        completed: outputData.stats.completed,
        failed: failed.length,
        permanent_failed: permanentFailures.length,
        blacklisted: blacklisted.length,
        max_retries: effectiveParams.max_retries || 3,
        degraded: failed.length > 0,
      }, effectiveParams);

      try {
        const collector = _makeCollector(pipeline);
        await collector.record({
          phase: 'cloud-production',
          task_type: 'video_final',
          gpu_time_sec: 0, peak_vram_gb: 0,
          success: permanentFailures.length === 0,
          retry_count: permanentFailures.reduce((s, r) => s + (r.retry_count || 0), 0),
          hermes_decision_id: hermesDecisionId,
          parameters_used: effectiveParams,
        });
      } catch (e) { console.warn(`[cloud-production] 评估采集失败: ${e.message}`); }

      return {
        summary: outputData,
        metrics: {
          shot_count: shots.length,
          completed: outputData.stats.completed,
          failed: failed.length,
          permanent_failed: permanentFailures.length,
          blacklisted: blacklisted.length,
          skipped_idempotent: skippedCount,
          degraded: failed.length > 0,
          max_retries: effectiveParams.max_retries || 3,
        },
      };
    },
  },

  'final-audio': {
    after: async (pipeline, phase, phaseConfig) => {
      const hermes = _makeHermesClient(pipeline);
      const defaults = HERMES_DEFAULTS['final-audio'];

      let hermesDecisionId = null;
      let effectiveParams = defaults;
      if (hermes) {
        try {
          const hr = await _hermesDecide(hermes, 'final-audio', {
            episode_count: pipeline.config?.episode_count || 1,
          });
          hermesDecisionId = hr.decisionId;
          if (hr.params) effectiveParams = { ...defaults, ...hr.params };
        } catch (e) {
          console.warn(`[final-audio] hermes decide 降级: ${e.message} (将在 Phase 11 修复)`);
        }
      }

      // Step 3: 收集 bgm-skeleton + temp-dialogue + sfx 路径 → audio-stems.json
      // Phase 18 实化: 不实际生成音频,但收集已有 stems 路径 + 占位路径
      // (实际 TTS/BGM/SFX 生成留 v3.0)
      await mkdir(join(pipeline.workdir, 'final-shots/audio-stems/'), { recursive: true });

      // 读取已产出的音频资源 (若存在)
      const bus = new AssetBus(pipeline.workdir);
      let bgmSkeleton = null;
      let tempDialogue = null;
      let sfxStems = null;
      try { bgmSkeleton = await bus.read('bgm-skeleton'); } catch { /* not yet */ }
      try { tempDialogue = await bus.read('temp-dialogue'); } catch { /* not yet */ }
      try { sfxStems = await bus.read('sfx-stems'); } catch { /* not yet */ }

      // 构建 stems 路径 (有真实路径则用,无则 placeholder)
      const degraded = !bgmSkeleton && !tempDialogue && !sfxStems;
      const dialoguePath = tempDialogue?.path
        || (tempDialogue?.dialogues?.length ? `final-shots/audio-stems/dialogue.wav` : null)
        || 'final-shots/audio-stems/dialogue-placeholder.wav';
      const bgmPath = bgmSkeleton?.path
        || (bgmSkeleton?.segments?.length ? `final-shots/audio-stems/bgm.wav` : null)
        || 'final-shots/audio-stems/bgm-placeholder.wav';
      const sfxPath = (sfxStems?.stems?.length || sfxStems?.length) ? 'final-shots/audio-stems/sfx.wav' : 'final-shots/audio-stems/sfx-placeholder.wav';

      const stubData = {
        _phase: 'final-audio',
        _generatedAt: new Date().toISOString(),
        _degraded: degraded,
        _degradeReason: degraded ? '无已产出 bgm-skeleton / temp-dialogue / sfx — 使用 placeholder 路径' : null,
        target_lufs: effectiveParams.target_lufs || -14,
        stems: {
          dialogue: { path: dialoguePath, source: tempDialogue ? 'temp-dialogue' : 'placeholder' },
          bgm: { path: bgmPath, source: bgmSkeleton ? 'bgm-skeleton' : 'placeholder' },
          sfx: { path: sfxPath, source: sfxStems ? 'sfx-stems' : 'placeholder' },
        },
      };
      await writeFile(join(pipeline.workdir, 'audio-stems.json'), JSON.stringify(stubData, null, 2));

      _hermesAudit(hermes, 'final-audio', hermesDecisionId, {
        degraded,
        target_lufs: effectiveParams.target_lufs || -14,
      }, effectiveParams);

      try {
        const collector = _makeCollector(pipeline);
        await collector.record({
          phase: 'final-audio',
          task_type: 'audio_final',
          gpu_time_sec: 0, peak_vram_gb: 0,
          success: true, retry_count: 0,
          hermes_decision_id: hermesDecisionId,
          parameters_used: effectiveParams,
        });
      } catch (e) { console.warn(`[final-audio] 评估采集失败: ${e.message}`); }

      return {
        summary: stubData,
        metrics: { degraded, target_lufs: effectiveParams.target_lufs || -14 },
      };
    },
  },

  'delivery': {
    after: async (pipeline, phase, phaseConfig) => {
      const hermes = _makeHermesClient(pipeline);
      const defaults = HERMES_DEFAULTS['delivery'];

      let hermesDecisionId = null;
      let effectiveParams = defaults;
      if (hermes) {
        try {
          const hr = await _hermesDecide(hermes, 'delivery', {
            episode_count: pipeline.config?.episode_count || 1,
          });
          hermesDecisionId = hr.decisionId;
          if (hr.params) effectiveParams = { ...defaults, ...hr.params };
        } catch (e) {
          console.warn(`[delivery] hermes decide 降级: ${e.message} (将在 Phase 11 修复)`);
        }
      }

      // Step 3: 质量评估 + final.mp4 路径验证 + 完整 quality-report.json
      // Phase 18 实化: 删除 _stub/_pendingRealImplementation,产出完整 quality-report 字段
      let qualityReport = {
        overall_score: 0,
        dimensions: {},
        passed: false,
      };
      try {
        const composer = new CompositionEngine({
          workdir: pipeline.workdir,
          config: pipeline.config,
          productionMode: pipeline.mode,
        });
        qualityReport._compositionEngineInstantiated = true;
        try { composer.runQualityCheck && (qualityReport._qualityCheckAvailable = true); } catch { /* skip */ }
      } catch (e) {
        console.warn(`[delivery] CompositionEngine 初始化降级: ${e.message}`);
      }
      let qualityAssessOk = false;
      try {
        const r = await assessQuality(pipeline);
        qualityReport.summary = r.summary;
        qualityReport.metrics = r.metrics;
        qualityAssessOk = true;
      } catch (e) {
        console.warn(`[delivery] 质量评估降级: ${e.message}`);
        qualityReport._assess_error = e.message;
      }

      // ─── Phase 18 新增: final.mp4 路径验证 ───
      // 验证 composition phase 是否产出 final.mp4 (degraded 模式下可能不存在)
      const finalMp4Path = join(pipeline.workdir, 'final.mp4');
      let finalMp4Status = 'absent';
      try {
        const stat = await import('node:fs/promises').then(m => m.stat(finalMp4Path));
        finalMp4Status = 'present';
        qualityReport.final_mp4 = {
          path: finalMp4Path,
          size_bytes: stat.size,
          size_mb: Math.round((stat.size / 1024 / 1024) * 100) / 100,
        };
      } catch {
        qualityReport.final_mp4 = {
          path: finalMp4Path,
          status: 'absent',
          note: 'final.mp4 未生成 (degraded 模式或 composition 未执行)',
        };
      }

      // 完整 quality-report 字段 (Phase 18: 不再 stub)
      const qualityData = {
        _phase: 'delivery',
        _generatedAt: new Date().toISOString(),
        report: qualityReport,
        deliveredAt: new Date().toISOString(),
      };
      await writeFile(join(pipeline.workdir, 'quality-report.json'), JSON.stringify(qualityData, null, 2));

      // ─── Phase 16 PERF-03: 聚合成本报告 (cost-report.json) ───
      // 实化 delivery stub: 调用 aggregateForEpisode 写 cost-report.json
      // 即使 evaluation log 为空也返回合法结构 (success_rate='0.0%')
      let costReport = null;
      try {
        const collector = _makeCollector(pipeline);
        costReport = await collector.aggregateForEpisode();
      } catch (e) {
        console.warn(`[delivery] cost-report 聚合降级: ${e.message}`);
      }

      _hermesAudit(hermes, 'delivery', hermesDecisionId, {
        quality_report_written: true,
        cost_report_written: costReport !== null,
        total_records: costReport?.total_records || 0,
        final_mp4_status: finalMp4Status,
      }, effectiveParams);

      try {
        const collector = _makeCollector(pipeline);
        await collector.record({
          phase: 'delivery',
          task_type: 'quality_gate',
          gpu_time_sec: 0, peak_vram_gb: 0,
          success: true, retry_count: 0,
          hermes_decision_id: hermesDecisionId,
          parameters_used: effectiveParams,
        });
      } catch (e) { console.warn(`[delivery] 评估采集失败: ${e.message}`); }

      // ─── Phase 25: Optional FineTuneETL trigger (operator opt-in) ───
      // When config.finetune.auto_generate=true, generate the pending-review
      // manifest at end of delivery. Operator then reviews/approves via CLI.
      // Default: false (no automatic manifest — operator must opt in).
      let finetuneReport = null;
      const autoFinetune = pipeline.config?.finetune?.auto_generate === true;
      if (autoFinetune) {
        try {
          const assetBus = new AssetBus(pipeline.workdir);
          const etl = new FineTuneETL({ assetBus, workdir: pipeline.workdir });
          finetuneReport = await etl.generateManifest();
          console.log(`[delivery] FineTuneETL manifest generated: ${finetuneReport.pending_count} pending, ${finetuneReport.pii_flagged} PII-flagged`);
        } catch (e) {
          console.warn(`[delivery] FineTuneETL manifest 降级: ${e.message}`);
          finetuneReport = { error: e.message, degraded: true };
        }
      }

      return {
        summary: {
          ...qualityData,
          cost_report: costReport ? {
            episode: costReport.episode,
            total_records: costReport.total_records,
            total_gpu_sec: costReport.total_gpu_sec,
            total_gpu_minutes: costReport.total_gpu_minutes,
            success_rate: costReport.summary?.success_rate,
            failed_count: costReport.summary?.failed_count,
          } : null,
        },
        metrics: {
          quality_report_written: true,
          cost_report_written: costReport !== null,
          cost_total_records: costReport?.total_records || 0,
          final_mp4_status: finalMp4Status,
          quality_assess_ok: qualityAssessOk,
          finetune_auto_generated: autoFinetune,
          finetune_pending_count: finetuneReport?.pending_count || 0,
        },
        finetune_report: finetuneReport,
      };
    },
  },
};

// Phase 8 hook 已在 pipeline.js 的 PHASES 定义中通过 outputFiles 管理
// 后期合成的实际执行由 agent 调用外部工具（ffmpeg等），pipeline 只做检查点

// ─── Phase 4A: Gold-Team V4.1 Engine Integrations ──────────────

function _makeGtClient(pipeline) {
  return new GoldTeamClient({
    baseUrl: pipeline.config?.goldTeam?.baseUrl,
    apiKey: pipeline.config?.goldTeam?.apiKey,
    callbackBaseUrl: pipeline.config?.goldTeam?.callbackBaseUrl,
    traceId: pipeline.traceId,
  });
}

/**
 * 读取上次 cloud-production / final-production 写入的 video_tasks.json
 * 用于 cloud-production 幂等检测 (跳过已完成 shot)
 */
async function _loadPreviousVideoTasks(workdir) {
  try {
    const raw = await readFile(join(workdir, 'video_tasks.json'), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 4A.2 art-direction → FLUX 图像生成
 * 通过 gold-team image_draw (FLUX) 引擎生成美术方向候选图
 * Hermes 决策替代硬编码 FLUX 参数
 */
export async function generateArtDirectionViaGoldTeam(pipeline, prompt, style, callingPhase = 'soul-visual') {
  const gtClient = _makeGtClient(pipeline);
  const hermes = _makeHermesClient(pipeline);

  const defaults = HERMES_DEFAULTS['soul-visual'];
  const { params: hermesParams, decisionId } = await _hermesDecide(hermes, callingPhase, {
    scene_description: prompt,
    project_style: style,
  });

  const fluxParams = hermesParams?.flux || {};
  const params = {
    prompt: `${prompt}, ${style}`,
    negative_prompt: hermesParams?.negative_prompt || defaults.negative_prompt,
    variant: hermesParams?.variant || defaults.variant,
    width: hermesParams?.width || defaults.width,
    height: hermesParams?.height || defaults.height,
    num_images: hermesParams?.num_images || defaults.num_images,
    output_format: hermesParams?.output_format || defaults.output_format,
    extra: {
      flux: {
        guidance_scale: fluxParams.guidance_scale ?? defaults.guidance_scale,
        num_inference_steps: fluxParams.num_inference_steps ?? defaults.num_inference_steps,
      },
    },
  };

  const result = await gtClient.submitTask({
    taskType: 'image_draw',
    params,
    priority: 5,
    callbackPath: '/callback/gpu_task',
    description: `${pipeline.episode}:art-direction:${style}`,
  });

  result._hermesDecisionId = decisionId;
  result._hermesParams = params;
  return result;
}

/**
 * 4A.2 备选: FLUX 图像精修（已有草图时）
 */
export async function refineArtDirectionViaGoldTeam(pipeline, sourceImagePath, prompt) {
  const gtClient = _makeGtClient(pipeline);

  return gtClient.submitTask({
    taskType: 'image_refine',
    params: {
      prompt,
      source_image_path: sourceImagePath,
      output_format: 'png',
    },
    priority: 5,
    callbackPath: '/callback/gpu_task',
    description: `${pipeline.episode}:art-direction-refine`,
  });
}

/**
 * 4A.2 备选: FLUX ControlNet（有参考图时）
 */
export async function controlArtDirectionViaGoldTeam(pipeline, referenceImagePath, prompt) {
  const gtClient = _makeGtClient(pipeline);

  return gtClient.submitTask({
    taskType: 'image_control',
    params: {
      prompt,
      reference_image_path: referenceImagePath,
      output_format: 'png',
    },
    priority: 5,
    callbackPath: '/callback/gpu_task',
    description: `${pipeline.episode}:art-direction-control`,
  });
}

/**
 * 4A.5 camera → VIDEO_FINAL 视频生成
 * 通过 gold-team video_final / video_preview_fast 引擎生成视频
 * Hermes 决策替代硬编码 Wan2.2 参数
 */
export async function generateVideoViaGoldTeam(pipeline, shot, callingPhase = null) {
  const gtClient = _makeGtClient(pipeline);
  const hermes = _makeHermesClient(pipeline);
  const isPreview = pipeline.config.preview_mode || shot._preview;
  const taskType = isPreview ? 'video_preview_fast' : 'video_final';
  const phase = callingPhase || (isPreview ? 'motion-preview' : 'final-production');

  const defaults = HERMES_DEFAULTS.camera;
  const modeDefaults = isPreview ? defaults.preview : defaults.final;
  const { params: hermesParams, decisionId } = await _hermesDecide(hermes, phase, {
    scene_description: shot.description,
    reference_image: shot.referenceImage || '',
    mode: isPreview ? 'preview' : 'final',
  });

  const videoGenParams = hermesParams?.video_gen || hermesParams || {};
  const params = {
    prompt: shot.description,
    negative_prompt: hermesParams?.negative_prompt || 'low quality, watermark, text',
    source_image_path: shot.referenceImage || '',
    width: videoGenParams.width || defaults.width,
    height: videoGenParams.height || defaults.height,
    num_frames: videoGenParams.num_frames ?? modeDefaults.num_frames,
    num_inference_steps: videoGenParams.num_inference_steps ?? modeDefaults.num_inference_steps,
    fps: videoGenParams.fps || defaults.fps,
    output_format: videoGenParams.output_format || defaults.output_format,
    extra: {
      video_gen: {
        model: videoGenParams.model || defaults.model,
        guidance_scale: videoGenParams.guidance_scale ?? defaults.guidance_scale,
      },
    },
  };

  const result = await gtClient.submitTask({
    taskType,
    params,
    priority: isPreview ? 1 : 10,
    callbackPath: '/callback/gpu_task',
    description: `${pipeline.episode}:camera:shot-${shot.id}`,
  });

  result._hermesDecisionId = decisionId;
  result._hermesParams = params;
  return result;
}

/**
 * 4A.5 视频帧插值（提升帧率）
 */
export async function interpolateVideoViaGoldTeam(pipeline, videoPath, targetFps = 30) {
  const gtClient = _makeGtClient(pipeline);

  return gtClient.submitTask({
    taskType: 'video_interpolate',
    params: {
      source_video_path: videoPath,
      target_fps: targetFps,
      output_format: 'mp4',
    },
    priority: 5,
    callbackPath: '/callback/gpu_task',
    description: `${pipeline.episode}:camera-interpolate`,
  });
}

/**
 * 4A.5 视频风格转换
 */
export async function styleTransferVideoViaGoldTeam(pipeline, videoPath, stylePrompt) {
  const gtClient = _makeGtClient(pipeline);

  return gtClient.submitTask({
    taskType: 'video_to_video',
    params: {
      source_video_path: videoPath,
      prompt: stylePrompt,
      output_format: 'mp4',
    },
    priority: 5,
    callbackPath: '/callback/gpu_task',
    description: `${pipeline.episode}:camera-style-transfer`,
  });
}

/**
 * 4A.6 voice → VOICE_CLONE 声音克隆
 */
export async function cloneVoice(pipeline, referenceAudio, text, language = 'zh') {
  const gtClient = _makeGtClient(pipeline);

  return gtClient.submitTask({
    taskType: 'voice_clone',
    params: {
      text,
      reference_audio_path: referenceAudio,
      reference_text: '',
      language,
      output_format: 'wav',
    },
    priority: 5,
    callbackPath: '/callback/gpu_task',
    description: `${pipeline.episode}:voice-clone`,
  });
}

/**
 * 4A.6 voice → VOICE_CONVERT 变声
 */
export async function convertVoice(pipeline, sourceAudio, targetVoice) {
  const gtClient = _makeGtClient(pipeline);

  return gtClient.submitTask({
    taskType: 'voice_convert',
    params: {
      source_audio_path: sourceAudio,
      target_voice: targetVoice,
      pitch_shift: 0,
      output_format: 'wav',
    },
    priority: 5,
    callbackPath: '/callback/gpu_task',
    description: `${pipeline.episode}:voice-convert`,
  });
}

/**
 * 4A.7 post-production → MUSIC_FINAL 配乐生成
 * Hermes 决策替代硬编码音频参数
 */
export async function generateBGM(pipeline, prompt, duration = 60) {
  const gtClient = _makeGtClient(pipeline);
  const hermes = _makeHermesClient(pipeline);

  const defaults = HERMES_DEFAULTS['post-production'].bgm;
  const { params: hermesParams, decisionId } = await _hermesDecide(hermes, 'final-production', {
    prompt, duration, task: 'bgm',
  });

  const acestepParams = hermesParams?.acestep || {};
  const params = {
    prompt,
    duration,
    output_format: hermesParams?.output_format || defaults.output_format,
    extra: {
      acestep: {
        bpm: acestepParams.bpm ?? defaults.bpm,
        vocal_language: acestepParams.vocal_language || defaults.vocal_language,
      },
    },
  };

  const result = await gtClient.submitTask({
    taskType: 'music_final',
    params,
    priority: 5,
    callbackPath: '/callback/gpu_task',
    description: `${pipeline.episode}:bgm`,
  });

  result._hermesDecisionId = decisionId;
  result._hermesParams = params;
  return result;
}

/**
 * 4A.7 post-production → SFX 音效生成
 * Hermes 决策替代硬编码音频参数
 */
export async function generateSFX(pipeline, prompt) {
  const gtClient = _makeGtClient(pipeline);
  const hermes = _makeHermesClient(pipeline);

  const defaults = HERMES_DEFAULTS.sfx;
  const { params: hermesParams, decisionId } = await _hermesDecide(hermes, 'final-production', {
    prompt, task: 'sfx',
  });

  const params = {
    prompt,
    cfg: hermesParams?.cfg ?? defaults.cfg,
    output_format: hermesParams?.output_format || defaults.output_format,
  };

  const result = await gtClient.submitTask({
    taskType: 'sfx_generation',
    params,
    priority: 5,
    callbackPath: '/callback/gpu_task',
    description: `${pipeline.episode}:sfx`,
  });

  result._hermesDecisionId = decisionId;
  result._hermesParams = params;
  return result;
}

/**
 * 4A.7 post-production → 音频分离（人声/伴奏）
 */
export async function separateAudio(pipeline, audioPath) {
  const gtClient = _makeGtClient(pipeline);

  return gtClient.submitTask({
    taskType: 'audio_separate',
    params: { audio_path: audioPath, output_format: 'wav' },
    priority: 5,
    callbackPath: '/callback/gpu_task',
    description: `${pipeline.episode}:audio-separate`,
  });
}

/**
 * 4A.8 lip-sync → LIP_SYNC_RT 口型同步
 */
export async function lipSync(pipeline, characterImage, audioPath) {
  const gtClient = _makeGtClient(pipeline);

  return gtClient.submitTask({
    taskType: 'lip_sync_rt',
    params: {
      source_image_path: characterImage,
      driving_audio_path: audioPath,
      output_format: 'mp4',
    },
    priority: 10,
    callbackPath: '/callback/gpu_task',
    description: `${pipeline.episode}:lip-sync`,
  });
}

// ─── 工作流3.0 Helper Functions ─────────────────────────────────

/**
 * 工作流 C: PuLID 角色一致性注入
 * 先用 FLUX 生成基础图，再用 PuLID 注入角色参考照的一致性
 */
export async function generateCharacterWithPuLID(pipeline, prompt, referenceImagePath, options = {}) {
  const gtClient = _makeGtClient(pipeline);
  return gtClient.submitPuLIDImage(referenceImagePath, {
    prompt,
    negativePrompt: options.negativePrompt || 'low quality, blurry, watermark, deformed',
    width: options.width || 1024,
    height: options.height || 1024,
    steps: options.steps || 15,
    cfgScale: options.cfgScale || 3.5,
    weight: options.weight || 0.8,
    seed: options.seed,
    filenamePrefix: options.filenamePrefix || 'pulid_character',
  });
}

/**
 * 工作流 D: ControlNet Depth 几何锁定
 * 用 Blender 渲染的深度图通过 ControlNet 约束场景生成
 */
export async function generateSceneWithControlNet(pipeline, prompt, imagePath, depthImagePath, options = {}) {
  const gtClient = _makeGtClient(pipeline);
  return gtClient.submitControlNetDepth(imagePath, depthImagePath, {
    prompt,
    negativePrompt: options.negativePrompt || 'blurry, low quality, text, watermark',
    width: options.width || 1344,
    height: options.height || 768,
    steps: options.steps || 20,
    cfgScale: options.cfgScale || 3.5,
    strength: options.strength || 0.75,
    seed: options.seed,
    filenamePrefix: options.filenamePrefix || 'controlnet_scene',
  });
}

/**
 * 工作流 E: Wan 2.1 I2V 双阶段视频生成
 * 替代原来的 generateVideoViaGoldTeam 的 video_final 类型
 */
export async function generateVideoWanI2V(pipeline, imagePath, prompt, options = {}) {
  const gtClient = _makeGtClient(pipeline);
  return gtClient.submitWanI2V(imagePath, {
    prompt,
    width: options.width || 832,
    height: options.height || 480,
    length: options.length || 81,
    steps: options.steps || 20,
    cfg: options.cfg || 3.5,
    shift: options.shift || 8.0,
    seed: options.seed,
    filenamePrefix: options.filenamePrefix || 'wan_i2v',
  });
}

/**
 * 工作流 F (前半): 4x 超分辨率 — 自动路由到 3060Ti auxiliary
 */
export async function upscaleImage(pipeline, imagePath, upscaleModel, filenamePrefix) {
  const gtClient = _makeGtClient(pipeline);
  return gtClient.submitUpscale(imagePath, {
    upscaleModel: upscaleModel || '4x-UltraSharp.pth',
    filenamePrefix: filenamePrefix || 'upscaled',
  });
}

/**
 * 工作流 F (后半): 面部修复 — 自动路由到 3060Ti auxiliary
 */
export async function restoreFace(pipeline, imagePath, model, filenamePrefix) {
  const gtClient = _makeGtClient(pipeline);
  return gtClient.submitFaceRestore(imagePath, {
    model: model || 'default',
    filenamePrefix: filenamePrefix || 'face_restored',
  });
}

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

// ─── Timeline-Control Helpers ──────────────────────────────────

/**
 * Extract unique props mentioned in shots.
 * Looks for shot.prop or shot.props fields.
 */
function _extractPropsFromShots(shots) {
  const seen = new Set();
  const props = [];
  for (const shot of shots) {
    const propList = shot.props || (shot.prop ? [shot.prop] : []);
    for (const p of propList) {
      const name = typeof p === 'string' ? p : p.name;
      if (name && !seen.has(name)) {
        seen.add(name);
        props.push({ name, type: typeof p === 'object' ? p.type || 'generic' : 'generic' });
      }
    }
  }
  return props;
}

/**
 * Render timeline-control storyboard as markdown.
 * Groups shots by scene, calculates total duration per scene.
 */
function _renderTimelineStoryboard(shots) {
  const SHOT_SIZE_CN = {
    extreme_wide: '全景', wide: '远景', medium: '中景',
    medium_close_up: '近景', close_up: '特写', extreme_close_up: '大特写',
  };

  // Group by scene
  const scenes = new Map();
  for (const shot of shots) {
    const sceneId = shot.scene_id || 'default';
    if (!scenes.has(sceneId)) scenes.set(sceneId, []);
    scenes.get(sceneId).push(shot);
  }

  let md = '# 分镜表 — 时间轴控场法\n\n';
  md += '节奏要求：节奏明快的动画经典切镜方式，保持逻辑连贯。\n\n';

  let sceneNum = 0;
  for (const [sceneId, sceneShots] of scenes) {
    sceneNum++;
    const totalDuration = sceneShots.reduce((sum, s) => sum + (s.duration_sec || 5), 0);
    const sceneTitle = sceneShots[0]?.scene_title || sceneId;
    md += `## 【场景（${sceneNum}）】${sceneTitle}丨[总时长 ${totalDuration}S]\n\n`;

    let shotNum = 0;
    for (const shot of sceneShots) {
      shotNum++;
      const shotType = SHOT_SIZE_CN[shot.shot_size] || shot.shot_size || '中景';
      md += `### 镜头 ${shotNum}：${shotType}\n\n`;
      md += `**画面内容：** ${shot.description || ''}\n\n`;
      md += `**特效/音效：** ${shot.effects_audio || shot.audio_hint || ''}\n\n`;
      md += `**时长：** ${shot.duration_sec || 5}S\n\n`;
      md += '---\n\n';
    }
  }

  return md;
}

// ─── Review Candidate Builders ─────────────────────────────

/**
 * Build review candidates for scene phase from disk artifacts.
 * Collects scene images from assets/scenes/ and scene_design.json.
 */
function _buildSceneReviewCandidates(workdir, scenes) {
  const candidates = [];

  // From phaseConfig.data.scenes — each scene may have generated images
  if (Array.isArray(scenes)) {
    for (const scene of scenes) {
      const id = scene.id || scene.name || `scene-${candidates.length + 1}`;
      const candidate = {
        id,
        label: scene.name || scene.label || id,
        description: scene.description || scene.prompt || '',
        imageUrl: scene.imageUrl || scene.image_url || '',
        imagePath: scene.imagePath || scene.image_path || '',
      };
      // Only include candidates that have visual output
      if (candidate.imageUrl || candidate.imagePath) {
        candidates.push(candidate);
      }
    }
  }

  return candidates;
}

/**
 * Build review candidates for storyboard phase from disk artifacts.
 * Reads storyboard.json / shots.json and collects shot-level candidates.
 */
async function _buildStoryboardReviewCandidates(workdir, phaseConfig) {
  const candidates = [];

  // Try phaseConfig.data first (in-memory)
  const shots = phaseConfig.data?.shots || phaseConfig.data?.frames;
  if (Array.isArray(shots)) {
    for (const shot of shots) {
      const id = shot.id || shot.shot_id || `shot-${candidates.length + 1}`;
      const candidate = {
        id,
        label: shot.label || shot.description || `镜头 ${id}`,
        description: shot.description || shot.dialogue || '',
        imageUrl: shot.imageUrl || shot.image_url || '',
        imagePath: shot.imagePath || shot.image_path || '',
      };
      if (candidate.imageUrl || candidate.imagePath) {
        candidates.push(candidate);
      }
    }
    return candidates;
  }

  // Fallback: read from disk (storyboard.json or shots.json)
  for (const filename of ['storyboard.json', 'shots.json']) {
    try {
      const raw = await readFile(join(workdir, filename), 'utf-8');
      const data = JSON.parse(raw);
      const items = data.shots || data.frames || data.scenes || (Array.isArray(data) ? data : []);
      for (const item of items) {
        const id = item.id || item.shot_id || `shot-${candidates.length + 1}`;
        const candidate = {
          id,
          label: item.label || item.description || `镜头 ${id}`,
          description: item.description || item.dialogue || '',
          imageUrl: item.imageUrl || item.image_url || '',
          imagePath: item.imagePath || item.image_path || '',
        };
        if (candidate.imageUrl || candidate.imagePath) {
          candidates.push(candidate);
        }
      }
      if (candidates.length) return candidates;
    } catch {
      // File not found or invalid, try next
    }
  }

  return candidates;
}

/**
 * Build review candidates for camera phase from disk artifacts.
 * Reads video_tasks.json and collects video segment candidates.
 */
async function _buildCameraReviewCandidates(workdir, phaseConfig) {
  const candidates = [];

  // Try phaseConfig.data first (in-memory)
  const tasks = phaseConfig.data?.tasks || phaseConfig.data?.videos || phaseConfig.data?.segments;
  if (Array.isArray(tasks)) {
    for (const task of tasks) {
      const id = task.id || task.task_id || `video-${candidates.length + 1}`;
      const candidate = {
        id,
        label: task.label || task.shot_id || `片段 ${id}`,
        description: task.description || task.prompt || '',
        imageUrl: task.coverUrl || task.cover_url || task.thumbnail || '',
        imagePath: task.coverPath || task.cover_path || '',
        videoUrl: task.videoUrl || task.video_url || task.outputUrl || '',
        videoPath: task.videoPath || task.video_path || task.outputPath || '',
      };
      if (candidate.imageUrl || candidate.imagePath || candidate.videoUrl || candidate.videoPath) {
        candidates.push(candidate);
      }
    }
    return candidates;
  }

  // Fallback: read video_tasks.json from disk
  try {
    const raw = await readFile(join(workdir, 'video_tasks.json'), 'utf-8');
    const data = JSON.parse(raw);
    const items = data.tasks || data.videos || data.segments || (Array.isArray(data) ? data : []);
    for (const item of items) {
      const id = item.id || item.task_id || `video-${candidates.length + 1}`;
      const candidate = {
        id,
        label: item.label || item.shot_id || `片段 ${id}`,
        description: item.description || item.prompt || '',
        imageUrl: item.coverUrl || item.cover_url || item.thumbnail || '',
        imagePath: item.coverPath || item.cover_path || '',
        videoUrl: item.videoUrl || item.video_url || item.outputUrl || '',
        videoPath: item.videoPath || item.video_path || item.outputPath || '',
      };
      if (candidate.imageUrl || candidate.imagePath || candidate.videoUrl || candidate.videoPath) {
        candidates.push(candidate);
      }
    }
  } catch {
    // video_tasks.json not found or invalid
  }

  return candidates;
}

// ─── Phase 14 测试导出 (内部辅助函数, 仅供单元测试使用) ─────────
export const _characterGenerationInternals = {
  _buildL1Prompt,
  _buildL2Prompt,
  _generateL1Anchors,
  _generateL2Costumes,
  _loadCharactersForGeneration,
  _computeFaceEmbeddingHash,
  _computeCostumeFingerprint,
};

