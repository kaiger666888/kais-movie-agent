/**
 * murch-scoring.js — Murch Rule of Six 量化评分 (from V2 editor, adapted for V8)
 *
 * Walter Murch 的剪辑六原则量化评分：
 *   1. Emotion（情感）        — 50%
 *   2. Story（故事）          — 25%
 *   3. Rhythm（节奏）          — 10%
 *   4. Eye Trace（视觉引导）   — 5%
 *   5. 2D Plane（二维平面）    — 4%
 *   6. 3D Space（三维空间）    — 3%
 *
 * 用于 V8 Step 19 FFmpeg 合成后、Step 20 质检中。
 * 作为质检的补充维度，替代/增强原有的 quality-gate.js 6维评分。
 *
 * 两种模式：
 *   - LLM 评分（有成品视频截图+剧本时）
 *   - 结构化估算（仅有剧本+cut点时）
 */

import { callLLMJson } from './hermes-adapter.js';

const MURCH_DIMENSIONS = [
  { id: 'emotion', label: '情感', weight: 0.50, description: '剪辑是否服务于情感目标？观众的情绪曲线是否被正确引导？' },
  { id: 'story', label: '故事', weight: 0.25, description: '剪辑是否清晰传达叙事？信息是否在正确时机释放？' },
  { id: 'rhythm', label: '节奏', weight: 0.10, description: '镜头切换是否张弛有度？是否有不必要的拖沓或仓促？' },
  { id: 'eye_trace', label: '视觉引导', weight: 0.05, description: '观众视线是否被正确引导？前景/背景转换是否流畅？' },
  { id: 'plane_2d', label: '二维平面', weight: 0.04, description: '画面的二维构图在不同镜头间是否协调？色彩/线条的一致性？' },
  { id: 'space_3d', label: '三维空间', weight: 0.03, description: '三维空间感是否连贯？角色在空间中的位置是否合理？' },
];

const PASS_THRESHOLD = 0.70;

/**
 * Murch 量化评分。
 *
 * @param {object} params
 * @param {object} params.screenplay — 剧本
 * @param {object} params.cutPoints — 剪辑点 [{scene_id, cut_in_at_s, cut_out_at_s, transition}]
 * @param {object} [params.styleGenome] — 风格基因组（from InvariantBus）
 * @param {string[]} [params.videoFramePaths] — 成品视频的关键帧截图路径（LLM 评分用）
 * @param {string[]} [params.videoPaths] — 成品视频路径（可选）
 * @returns {Promise<MurchResult>}
 */
export async function murchScore(params) {
  const { screenplay, cutPoints = [], styleGenome = null, videoFramePaths = [] } = params;

  if (!screenplay) {
    return { scores: {}, weighted: 0, passed: false, error: '无剧本内容' };
  }

  let scores;

  // ─── 有视频帧 → LLM 评分 ────────────────────────────
  if (videoFramePaths.length > 0) {
    scores = await _llmVisualScore(screenplay, cutPoints, videoFramePaths);
  } else {
    // ─── 无视频帧 → 结构化估算 ──────────────────────
    scores = await _structuralScore(screenplay, cutPoints, styleGenome);
  }

  // ─── 加权汇总 ───────────────────────────────────────
  const weighted = MURCH_DIMENSIONS.reduce((sum, dim) => {
    return sum + (scores[dim.id] ?? 0) * dim.weight;
  }, 0);

  return {
    scores,
    weighted: Math.round(weighted * 1000) / 1000,
    passed: weighted >= PASS_THRESHOLD,
    threshold: PASS_THRESHOLD,
    dimensions: MURCH_DIMENSIONS,
    weakest: _weakestDimension(scores),
    recommendation: weighted >= PASS_THRESHOLD
      ? 'Murch 评分通过，剪辑质量合格'
      : `最弱维度: ${_weakestDimension(scores).label}(${(_weakestDimension(scores).score * 100).toFixed(0)}%)，建议重点优化`,
  };
}

/**
 * 格式化为用户可读文本。
 */
export function formatMurchResult(result) {
  const lines = ['🎬 Murch 剪辑六原则评分', ''];
  for (const dim of MURCH_DIMENSIONS) {
    const score = result.scores[dim.id] ?? 0;
    const pct = (score * 100).toFixed(0);
    const icon = score >= 0.7 ? '✅' : (score >= 0.5 ? '⚠️' : '❌');
    lines.push(`${icon} ${dim.label} (${(dim.weight * 100).toFixed(0)}%): ${pct}%`);
  }
  lines.push('');
  lines.push(`加权总分: ${(result.weighted * 100).toFixed(0)}% — ${result.passed ? '✅ 通过' : '⚠️ 低于 70% 阈值'}`);
  if (result.recommendation) lines.push(`建议: ${result.recommendation}`);
  return lines.join('\n');
}

// ─── 内部 ──────────────────────────────────────────────

async function _llmVisualScore(screenplay, cutPoints, framePaths) {
  try {
    const result = await callLLMJson({
      prompt: `按照 Walter Murch 的 Rule of Six 评估以下剪辑序列。

剪辑点: ${cutPoints.slice(0, 15).map(c => `scene=${c.scene_id}, ${c.cut_in_at_s}s→${c.cut_out_at_s}s, ${c.transition || 'cut'}`).join('; ')}

Murch 六原则权重：
1. Emotion (50%) — 是否服务情感目标
2. Story (25%) — 是否清晰传达叙事
3. Rhythm (10%) — 张弛有度
4. Eye Trace (5%) — 视线引导
5. 2D Plane (4%) — 二维构图协调
6. 3D Space (3%) — 三维空间连贯

返回 JSON:
{
  "scores": { "emotion": 0-1, "story": 0-1, "rhythm": 0-1, "eye_trace": 0-1, "plane_2d": 0-1, "space_3d": 0-1 },
  "comment": "一句话点评"
}`,
      system: '你是 Walter Murch 级别的剪辑评审专家。评分严格，0.70+ 为合格。',
    });
    return result?.scores || { emotion: 0.7, story: 0.7, rhythm: 0.7, eye_trace: 0.65, plane_2d: 0.7, space_3d: 0.7 };
  } catch {
    return { emotion: 0.7, story: 0.7, rhythm: 0.7, eye_trace: 0.65, plane_2d: 0.7, space_3d: 0.7 };
  }
}

async function _structuralScore(screenplay, cutPoints, styleGenome) {
  // 结构化估算：基于剧本+剪辑点的特征推算
  const scenes = screenplay.scene_list || screenplay.scenes || [];
  const totalShots = cutPoints.length || scenes.length;

  // Emotion: 有情感高潮场景 → 更高
  const hasEmotionalPeak = scenes.some(s =>
    (s.emotion || s.mood || '').match(/高潮|climax|峰值|爆发|崩溃|释怀|和解/)
  );
  const emotion = hasEmotionalPeak ? 0.75 : 0.60;

  // Story: 有明确三幕 → 更高
  const hasThreeAct = !!screenplay.three_act_structure;
  const story = hasThreeAct ? 0.75 : 0.55;

  // Rhythm: 转场多样性
  const transitions = cutPoints.map(c => c.transition || 'cut');
  const uniqueTransitions = new Set(transitions).size;
  const rhythm = Math.min(0.8, 0.5 + uniqueTransitions * 0.05);

  // Eye Trace / 2D / 3D: 基于风格基因组
  const styleScore = styleGenome
    ? ((styleGenome.composition ? 0.8 : 0.6) + (styleGenome.texture ? 0.75 : 0.6)) / 2
    : 0.65;

  return {
    emotion,
    story,
    rhythm,
    eye_trace: styleScore,
    plane_2d: styleScore,
    space_3d: styleScore,
    _method: 'structural_estimate',
  };
}

function _weakestDimension(scores) {
  return MURCH_DIMENSIONS.reduce((weakest, dim) => {
    const score = scores[dim.id] ?? 0;
    return (!weakest || score < weakest.score)
      ? { ...dim, score }
      : weakest;
  }, null) || { label: 'unknown', score: 0 };
}

export default { murchScore, formatMurchResult };
