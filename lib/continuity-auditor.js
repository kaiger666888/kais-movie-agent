/**
 * continuity-auditor.js — 5维一致性审计框架 (V3, L1 锚点基准对比)
 *
 * 用于 V8 Step 16 一致性检查。
 * 5 个维度：
 *   1. identity_match — 跨镜头角色面部一致性（以 L1 身份锚点为基准）
 *   2. axis_compliance — 180° 轴线合规（1.0 = 100%）
 *   3. wardrobe_drift — 服装不一致次数（以 L2 造型卡片为基准）
 *   4. spatial_consistency — 空间一致性
 *   5. plot_continuity — 剧情连续性
 *
 * V3 变化（2026-06-18）：
 *   - identity_match 以 L1 身份锚点图作为评分基准
 *   - wardrobe_drift 以 L2 造型卡片作为评分基准
 *   - 支持 L1/L2 图片路径传入进行视觉对比
 *   - 降级模式仍可用 LLM 分析
 */

import { callLLM, callLLMJson, getDefaultVisionModel } from './hermes-adapter.js';
import { readFile as _fsReadFile, writeFile as _fsWriteFile, mkdir as _fsMkdir } from 'node:fs/promises';
import { join as _pathJoin } from 'node:path';
import { createHash } from 'node:crypto';

const DIMENSIONS = [
  { id: 'identity_match', label: '角色面部一致性', threshold: 0.85, weight: 0.30 },
  { id: 'axis_compliance', label: '180°轴线合规', threshold: 1.0, weight: 0.15 },
  { id: 'wardrobe_drift', label: '服装一致性', threshold: 0, weight: 0.15 },   // 0次违规
  { id: 'spatial_consistency', label: '空间一致性', threshold: 0.8, weight: 0.15 },
  { id: 'plot_continuity', label: '剧情连续性', threshold: 0.8, weight: 0.15 },
  { id: 'scene_spatial_lock', label: '场景空间锁定', threshold: 0.8, weight: 0.10 },
];

/**
 * 执行 5 维一致性审计。
 *
 * @param {object} params
 * @param {Array<{shot_id, image_path, scene_id}>} params.visuals — 生成图片列表
 * @param {Array<{id, name, face, body, wardrobe}>} [params.characterAssets] — 角色参考（from InvariantBus）
 * @param {object} [params.consistencyContext] — 叙事一致性上下文（from InvariantBus）
 * @param {object} [params.goldTeamClient] — gold-team client（用于 DINOv2 实际评分）
 * @returns {Promise<ContinuityAuditResult>}
 */
export async function auditContinuity(params) {
  const { visuals = [], characterAssets = [], consistencyContext = null, goldTeamClient = null, workdir = null } = params;

  if (!visuals.length) {
    return { scores: {}, overall: 0, passed: false, findings: [], error: '无视觉素材' };
  }

  const scores = {};
  const findings = [];

  // ─── 维度 1: identity_match（以 L1 身份锚点为基准）────────
  // 优先走实化后的 _getDINOv2Score (支持 GLM-4V 降级),失败/无锚点返回 null
  let identityScore = null;
  try {
    identityScore = await _getDINOv2Score(goldTeamClient, visuals, characterAssets, { workdir });
  } catch (err) {
    findings.push({ dimension: 'identity_match', severity: 'low', issue: `_getDINOv2Score 异常: ${err.message}` });
  }
  if (identityScore === null) {
    // _getDINOv2Score 无评分对(无锚点/所有调用失败) → 尝试 LLM 文本降级
    try {
      identityScore = await _llmIdentityScore(visuals, characterAssets);
    } catch (err) {
      findings.push({ dimension: 'identity_match', severity: 'low', issue: `LLM 评分降级: ${err.message}` });
      identityScore = null;
    }
  }
  scores.identity_match = identityScore;

  // ─── 维度 6: scene_spatial_lock（场景空间锁定）────────────
  try {
    const sceneMeta = params.sceneMeta || null;
    if (sceneMeta?.spatial_anchors) {
      scores.scene_spatial_lock = await _llmSceneSpatialLockScore(visuals, sceneMeta);
    } else {
      // 无 scene-meta 时跳过此维度，给满分
      scores.scene_spatial_lock = 1.0;
    }
  } catch (err) {
    scores.scene_spatial_lock = 0.8;
    findings.push({ dimension: 'scene_spatial_lock', severity: 'low', issue: `评分降级: ${err.message}` });
  }

  // ─── 维度 2-5: LLM 结构分析 ─────────────────────────
  const structuralResult = await _llmStructuralAudit(visuals, {
    characterAssets,
    consistencyContext,
  });

  Object.assign(scores, structuralResult.scores);
  findings.push(...structuralResult.findings);

  // ─── 汇总 ─────────────────────────────────────────────
  // null 分数表示"未评分" — 不计入加权(权重归零),避免污染整体均值
  const activeDims = DIMENSIONS.filter(d => scores[d.id] !== null && scores[d.id] !== undefined);
  const activeWeightTotal = activeDims.reduce((s, d) => s + d.weight, 0) || 1;
  const weightedSum = activeDims.reduce((sum, dim) => {
    const score = scores[dim.id] ?? 0;
    return sum + score * dim.weight;
  }, 0);

  const overall = activeWeightTotal > 0 ? weightedSum / activeWeightTotal : 0;

  const allPassed = DIMENSIONS.every(dim => {
    const score = scores[dim.id];
    // 未评分维度不算失败 (Phase 14 真实图生成后才会评)
    if (score === null || score === undefined) return true;
    if (dim.id === 'wardrobe_drift') {
      return score === dim.threshold;
    }
    return score >= dim.threshold;
  });

  return {
    scores,
    overall: Math.round(overall * 1000) / 1000,
    passed: allPassed,
    findings,
    dimensions: DIMENSIONS,
    recommendation: allPassed
      ? '所有维度通过阈值，可进入下一步'
      : `未通过维度: ${DIMENSIONS.filter(d => {
          if (d.id === 'wardrobe_drift') return (scores[d.id] ?? 0) !== d.threshold;
          return (scores[d.id] ?? 0) < d.threshold;
        }).map(d => d.label).join(', ')}`,
  };
}

/**
 * 针对单张生成图与 L1 身份锚点的对比审计。
 * 用于场景图/分镜首帧生成后的即时检查。
 *
 * @param {string} generatedImagePath — 待检查图片路径
 * @param {string[]} identityAnchorPaths — L1 身份锚点路径（1-3张）
 * @param {object} [featureLock] — feature_lock 文本
 * @returns {Promise<{score: number, details: string, passed: boolean}>}
 */
export async function auditImageVsL1(generatedImagePath, identityAnchorPaths, featureLock = null) {
  if (!identityAnchorPaths.length) {
    return { score: 0.5, details: '缺少 L1 身份锚点，无法评分', passed: false };
  }

  // v3.0 (Phase 19 / P7 修复): 使用 OpenAI multimodal content blocks,
  // 让视觉模型真正"看到"图片。adapter 会自动将本地路径转 base64 data URL。
  const promptBlocks = [
    { type: 'text', text: `对比以下生成图与角色身份锚点,评估面部一致性。

${featureLock ? `角色特征锁定: ${JSON.stringify(featureLock)}\n` : ''}评估维度:
1. 五官一致性(眼型、鼻型、嘴型是否匹配)
2. 发型一致性(发色、发型、长度是否匹配)
3. 肤色一致性
4. 整体相似度

返回 JSON: {
  "score": 0.0-1.0,
  "facial_match": "五官匹配评估",
  "hair_match": "发型匹配评估",
  "skin_match": "肤色匹配评估",
  "details": "总体评估",
  "issues": ["发现的问题,如无则为空数组"]
}` },
  ];
  // 先放锚点图(参考基准),最后放待检查图
  for (const anchorPath of identityAnchorPaths) {
    promptBlocks.push({ type: 'text', text: `身份锚点(角色标准外观): ${anchorPath}` });
    promptBlocks.push({ type: 'image_url', image_url: { url: anchorPath } });
  }
  promptBlocks.push({ type: 'text', text: `待检查生成图: ${generatedImagePath}` });
  promptBlocks.push({ type: 'image_url', image_url: { url: generatedImagePath } });

  try {
    const result = await callLLMJson({
      prompt: promptBlocks,
      system: '你是角色一致性审查专家。严格对比参考图和生成图的面部特征。0.85+ 为优秀,0.7-0.85 可接受但需注意,<0.7 需要重新生成。',
    });

    const score = result?.score ?? 0.7;
    return {
      score,
      details: result?.details || '评分完成',
      facial_match: result?.facial_match,
      hair_match: result?.hair_match,
      issues: result?.issues || [],
      passed: score >= 0.7,
    };
  } catch (err) {
    return { score: 0.5, details: `审计失败: ${err.message}`, passed: false };
  }
}

/**
 * 格式化审计结果为用户可读文本。
 */
export function formatAuditResult(result) {
  const lines = ['📊 一致性审计结果', ''];
  for (const dim of DIMENSIONS) {
    const score = result.scores[dim.id] ?? 0;
    const icon = (dim.id === 'wardrobe_drift')
      ? (score === 0 ? '✅' : '❌')
      : (score >= dim.threshold ? '✅' : '❌');
    const display = (dim.id === 'wardrobe_drift')
      ? `${score} 次违规`
      : `${(score * 100).toFixed(0)}%`;
    lines.push(`${icon} ${dim.label}: ${display} (阈值: ${dim.id === 'wardrobe_drift' ? '0次' : (dim.threshold * 100) + '%'})`);
  }
  lines.push('');
  lines.push(`综合: ${(result.overall * 100).toFixed(0)}% — ${result.passed ? '✅ 通过' : '⚠️ 需关注'}`);
  if (result.recommendation) lines.push(`建议: ${result.recommendation}`);
  return lines.join('\n');
}

// ─── 内部实现 ────────────────────────────────────────────

/**
 * 一致性打分缓存 — 避免同一 (image, anchor) 对重复调用 GLM-4V。
 * 缓存文件: .pipeline-assets/consistency-cache.json
 * 键: sha256(image_path + '\0' + anchor_path)
 * 失效语义: 文件不存在时重新创建; 缓存未命中即实时调用。
 */
const _CACHE_FILE_NAME = '.pipeline-assets/consistency-cache.json';
const _scoreCache = { _loaded: false, _map: {}, _workdir: null };

async function _loadScoreCache(workdir) {
  if (_scoreCache._loaded && _scoreCache._workdir === workdir) return _scoreCache._map;
  _scoreCache._workdir = workdir;
  _scoreCache._map = {};
  _scoreCache._loaded = true;
  try {
    const raw = await _fsReadFile(_pathJoin(workdir || '.', _CACHE_FILE_NAME), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.entries) {
      _scoreCache._map = parsed.entries;
    }
  } catch {
    /* file missing or invalid — start fresh */
  }
  return _scoreCache._map;
}

async function _persistScoreCache(workdir) {
  if (!_scoreCache._loaded) return;
  try {
    const dir = _pathJoin(workdir || '.', '.pipeline-assets');
    await _fsMkdir(dir, { recursive: true });
    const payload = {
      _version: 1,
      _purpose: 'consistency-audit GLM-4V score cache',
      entries: _scoreCache._map,
    };
    await _fsWriteFile(
      _pathJoin(workdir || '.', _CACHE_FILE_NAME),
      JSON.stringify(payload, null, 2),
    );
  } catch (err) {
    console.warn(`[continuity-auditor] 缓存持久化失败: ${err.message}`);
  }
}

function _cacheKey(imagePath, anchorPath, modelVersion = null) {
  // v3.0 (Phase 19 / P7): key 加 model_version 前缀,
  // 模型切换时旧 entry 自然 miss → 重新评分(分布可能不同)
  const inputHash = createHash('sha256')
    .update(`${imagePath}\0${anchorPath}`)
    .digest('hex');
  const mv = modelVersion || getDefaultVisionModel();
  return `${mv}:${inputHash}`;
}

/**
 * 匹配 visual 所属的角色。
 * 兼容多种字段名: visual.character (id/name), visual.character_id, visual.character_name
 */
function _matchCharacterForScore(visual, characters) {
  if (!characters?.length) return null;
  const candidates = [
    visual.character,
    visual.character_id,
    visual.character_name,
    visual.characterId,
  ].filter(Boolean);
  for (const c of candidates) {
    const match = characters.find(ch =>
      ch.id === c || ch.name === c ||
      (typeof c === 'string' && ch.name?.toLowerCase() === c.toLowerCase()),
    );
    if (match) return match;
  }
  // 无显式标识: 若只有一个角色,默认归属
  if (characters.length === 1) return characters[0];
  return null;
}

/**
 * 收集角色已审核通过的 L1 身份锚点路径。
 */
function _getApprovedL1Anchors(character) {
  const anchors = character?.assets?.L1_identity;
  if (!Array.isArray(anchors)) return [];
  return anchors
    .filter(a => (a.status === 'approved' || a.status === undefined) && a.path)
    .map(a => a.path);
}

/**
 * 实化后的 DINOv2 一致性打分。
 *
 * 优先级:
 *   1. 若 client (gold-team) 暴露 DINOv2 embedding 接口 → 走余弦相似度
 *   2. 否则降级 GLM-4V 视觉对比
 *
 * 任何调用失败 → 返回 null (不是假分数)。上层 auditContinuity 需识别 null。
 *
 * @param {object|null} client — gold-team client (可选)
 * @param {Array<{shot_id, image_path, scene_id, character?}>} visuals
 * @param {Array<{id, name, assets?}>} characters
 * @param {object} [opts]
 * @param {string} [opts.workdir] — 用于缓存路径解析
 * @returns {Promise<number|null>} 0-1 分数,null 表示无法评分
 */
async function _getDINOv2Score(client, visuals, characters, opts = {}) {
  const workdir = opts.workdir || process.cwd();
  await _loadScoreCache(workdir);

  // v3.0: 缓存键按当前视觉模型版本命名空间化
  const currentModelVersion = getDefaultVisionModel();
  const scores = [];
  let cacheHits = 0;
  let cacheMisses = 0;

  for (const visual of visuals) {
    const imagePath = visual.image_path || visual.seed_frame_path || visual.imagePath;
    if (!imagePath) continue;

    const character = _matchCharacterForScore(visual, characters);
    if (!character) continue;

    const anchorPaths = _getApprovedL1Anchors(character);
    if (!anchorPaths.length) continue;

    // 单图对多锚点:取锚点均值作为该图的分数
    const perAnchorScores = [];
    for (const anchorPath of anchorPaths) {
      const key = _cacheKey(imagePath, anchorPath, currentModelVersion);
      let score = _scoreCache._map[key];

      if (typeof score === 'number') {
        cacheHits += 1;
        perAnchorScores.push(score);
        continue;
      }

      cacheMisses += 1;
      score = await _scoreOnePair(client, imagePath, anchorPath, character);
      if (typeof score === 'number') {
        _scoreCache._map[key] = score;
        perAnchorScores.push(score);
      }
    }

    if (perAnchorScores.length) {
      const imageMean = perAnchorScores.reduce((a, b) => a + b, 0) / perAnchorScores.length;
      scores.push(imageMean);
    }
  }

  // 有变更才持久化
  if (cacheMisses > 0) {
    await _persistScoreCache(workdir);
  }

  if (!scores.length) {
    // 无任何可评分对 — 返回 null 让上层知道是未评分而非合格
    return null;
  }
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/**
 * 对单对 (image, anchor) 调用一致性评分。
 * 优先 DINOv2(若 gold-team 支持),否则 GLM-4V。
 * 失败 → 返回 null。
 */
async function _scoreOnePair(client, imagePath, anchorPath, character) {
  // 优先路径: gold-team DINOv2 embedding
  if (client && typeof client.submitTask === 'function') {
    try {
      const score = await _tryDINOv2Embedding(client, imagePath, anchorPath);
      if (typeof score === 'number') return score;
    } catch (err) {
      console.warn(`[continuity-auditor] DINOv2 降级到 GLM-4V: ${err.message}`);
    }
  }

  // 降级路径: GLM-4V 视觉对比
  try {
    const result = await callLLMJson({
      prompt: `对比以下生成图与角色身份锚点的面部一致性。

身份锚点(角色标准外观): [${anchorPath}]
待检查生成图: [${imagePath}]
${character?.feature_lock ? `角色特征锁定: ${JSON.stringify(character.feature_lock)}` : ''}

评估维度:
1. 五官一致性(眼型/鼻型/嘴型是否匹配)
2. 发型一致性(发色/发型/长度)
3. 肤色一致性
4. 整体相似度

返回 JSON: { "score": 0.0-1.0, "reasoning": "...", "issues": [] }`,
      system: '你是角色一致性审查专家。严格对比参考图和生成图。0.85+ 优秀,0.7-0.85 可接受,<0.7 需重新生成。',
      model: process.env.ZHIPU_VISION_MODEL || 'glm-4.6v',
    });
    const score = typeof result?.score === 'number' ? result.score : null;
    return score;
  } catch (err) {
    console.warn(`[continuity-auditor] GLM-4V 评分失败 (${imagePath}): ${err.message}`);
    return null;
  }
}

/**
 * 若 gold-team 提供 DINOv2 embedding 接口,计算余弦相似度。
 * 不支持时返回 null,让上层走 GLM-4V 路径。
 */
async function _tryDINOv2Embedding(client, imagePath, anchorPath) {
  if (!client?.submitTask) return null;
  // 启发式探测: 仅当 client 明确暴露 DINOv2 能力时使用
  const capabilities = client.capabilities || client.getCapabilities?.() || {};
  const supportsDINOv2 = capabilities.dinov2_embedding ||
    capabilities.dinov2 ||
    Array.isArray(capabilities.taskTypes) && capabilities.taskTypes.includes('dinov2_embedding');
  if (!supportsDINOv2) return null;

  const embed = async (imgPath) => {
    const task = await client.submitTask({
      task_type: 'dinov2_embedding',
      priority: 3,
      params: { image_path: imgPath },
      description: `consistency-audit:embed:${imgPath}`,
    });
    const completed = await client.waitForTask(task.task_id || task.taskId, {
      pollIntervalMs: 2000,
      timeoutMs: 60000,
    });
    const vector = completed?.artifacts?.[0]?.embedding ||
      completed?.output?.embedding || completed?.embedding;
    if (!Array.isArray(vector)) throw new Error('DINOv2 响应缺少 embedding');
    return vector;
  };

  const v1 = await embed(imagePath);
  const v2 = await embed(anchorPath);
  return _cosineSimilarity(v1, v2);
}

function _cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return null;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return null;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

async function _llmIdentityScore(visuals, characters) {
  try {
    // 提取 L1 身份锚点路径作为对比基准
    const anchorRefs = characters
      .filter(c => c.assets?.L1_identity)
      .map(c => ({
        name: c.name,
        anchors: c.assets.L1_identity
          .filter(img => img.status === 'approved')
          .map(img => img.path),
      }))
      .filter(c => c.anchors.length > 0);

    const anchorInfo = anchorRefs.length
      ? anchorRefs.map(a => `${a.name}: L1锚点[${a.anchors.join(', ')}]`).join('; ')
      : characters.map(c => `${c.name}: ${JSON.stringify(c.face || c.description || 'no detail')}`).join('; ');

    const result = await callLLMJson({
      prompt: `评估以下镜头序列中角色面部与身份锚点的一致性。

镜头: ${visuals.slice(0, 10).map(v => `shot_id=${v.shot_id}, image=[${v.image_path}], scene=${v.scene_id || 'unknown'}`).join('; ')}
角色身份锚点（基准参考）: ${anchorInfo}

评分标准：
- 0.90+: 优秀，面部高度一致
- 0.85-0.89: 良好，轻微可接受差异
- 0.70-0.84: 一般，有明显差异但可辨识
- <0.70: 差，需要重新生成

返回 JSON: { "identity_match": 0.0-1.0, "reasoning": "简要说明", "weak_shots": ["一致性最差的 shot_id"] }`,
      system: '你是视频制作一致性分析师。以 L1 身份锚点为基准，评估跨镜头角色面部一致性。',
    });
    // QUAL-01 (v2.0): LLM 失败时返回 null(不再 0.7 假分数),让 auditContinuity 知道这是未评分
    return result?.identity_match ?? null;
  } catch {
    return null;
  }
}

async function _llmStructuralAudit(visuals, context) {
  try {
    // 提取 L2 造型卡片路径用于服装一致性检查
    const costumeRefs = (context.characterAssets || [])
      .filter(c => c.assets?.L2_costumes)
      .map(c => ({
        name: c.name,
        costumes: Object.entries(c.assets.L2_costumes).map(([id, imgs]) => ({
          id,
          images: [imgs.front?.path, imgs.side?.path].filter(Boolean),
        })),
      }));

    const costumeInfo = costumeRefs.length
      ? costumeRefs.map(c => `${c.name}: 造型[${c.costumes.map(co => `${co.id}=[${co.images.join(',')}]`).join(', ')}]`).join('; ')
      : (context.characterAssets || []).map(c => c.name).join(', ') || '无';

    const result = await callLLMJson({
      prompt: `分析以下镜头序列的结构一致性。

镜头: ${visuals.slice(0, 20).map(v => `shot_id=${v.shot_id}, image=[${v.image_path}], scene=${v.scene_id || 'unknown'}`).join('; ')}
角色造型基准（L2造型卡片）: ${costumeInfo}

评估 4 个维度，返回 JSON:
{
  "scores": {
    "axis_compliance": 0.0-1.0,
    "wardrobe_drift": 0-N (服装与L2造型卡片不一致的次数),
    "spatial_consistency": 0.0-1.0,
    "plot_continuity": 0.0-1.0
  },
  "findings": [{ "dimension": "...", "severity": "high|medium|low", "issue": "...", "shot_ids": ["..."] }]
}`,
      system: '你是视频一致性审计专家。axis_compliance 检查 180° 轴线规则；wardrobe_drift 对比 L2 造型卡片计算不一致次数；spatial 检查空间连贯性；plot 检查剧情连续性。',
    });
    // QUAL-01 (v2.0): LLM 失败时各维度返回 null(不再 0.8 假分数)
    return {
      scores: result?.scores || { axis_compliance: null, wardrobe_drift: null, spatial_consistency: null, plot_continuity: null },
      findings: result?.findings || [],
    };
  } catch {
    return {
      scores: { axis_compliance: null, wardrobe_drift: null, spatial_consistency: null, plot_continuity: null },
      findings: [],
    };
  }
}

/**
 * 场景空间锁定评分：对比生成图 vs scene-meta.json 中的 spatial_anchors。
 * 使用 LLM 视觉分析检查空间锚点的一致性。
 */
async function _llmSceneSpatialLockScore(visuals, sceneMeta) {
  try {
    const anchors = sceneMeta.spatial_anchors;
    const anchorDesc = [
      anchors.main_subject_position ? `主角位置: ${anchors.main_subject_position}` : '',
      anchors.key_object_positions ? `道具位置: ${anchors.key_object_positions}` : '',
      anchors.exit_entry_points ? `出入口: ${anchors.exit_entry_points}` : '',
      anchors.light_source_direction ? `光源方向: ${anchors.light_source_direction}` : '',
    ].filter(Boolean).join('; ');

    const result = await callLLMJson({
      prompt: `检查以下生成图是否符合场景空间锚点定义。

空间锚点定义: ${anchorDesc}
镜头图片: ${visuals.slice(0, 10).map(v => `shot_id=${v.shot_id}, image=[${v.image_path}]`).join('; ')}

评分标准：
- 0.9+: 空间锚点完全一致
- 0.8-0.89: 基本一致，轻微偏差可接受
- <0.8: 明显空间偏移，需要关注

返回 JSON: { "scene_spatial_lock": 0.0-1.0, "reasoning": "分析说明", "violations": ["违反的锚点，如无则为空数组"] }`,
      system: '你是场景一致性审查专家。检查生成图中的空间元素是否与预定义的空间锚点一致。',
    });
    return result?.scene_spatial_lock ?? 0.8;
  } catch {
    return 0.8;
  }
}

export default { auditContinuity, auditImageVsL1, formatAuditResult };
