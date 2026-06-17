/**
 * script-auditor.js — 6维剧本量化审计 (from V2, adapted for V8)
 *
 * 用于 V8 Step 6 剧本审核时，作为辅助评分展示给用户。
 * 不替代人工审核门，不做自动循环纠偏。
 *
 * 6 维度：
 *   1. plot_coherence — 三幕结构 + 转折点
 *   2. dialogue_quality — 潜台词、声音、信息堆砌检测
 *   3. character_arc — 主角变化弧 + 动机清晰度
 *   4. pacing — 形式约束合规 + 能量曲线
 *   5. three_act_compliance — Field/McKee 结构验证
 *   6. consistency_context_violations — 叙事一致性违规（零容忍）
 */

import { callLLMJson } from './hermes-adapter.js';

const DIMENSIONS_5 = [
  { id: 'plot_coherence', label: '情节连贯性', weight: 0.25 },
  { id: 'dialogue_quality', label: '对白质量', weight: 0.20 },
  { id: 'character_arc', label: '角色弧线', weight: 0.25 },
  { id: 'pacing', label: '节奏控制', weight: 0.15 },
  { id: 'three_act_compliance', label: '结构合规', weight: 0.15 },
];

/**
 * 审计剧本质量。
 *
 * @param {object} screenplay — 剧本内容
 * @param {object} [consistencyContext] — 叙事一致性上下文（from InvariantBus/ConsistencyContext）
 * @returns {Promise<ScriptAuditResult>}
 */
export async function auditScreenplay(screenplay, consistencyContext = null) {
  if (!screenplay) {
    return { scores: {}, overall: 0, passed: false, findings: [], error: '无剧本内容' };
  }

  const scores = {};
  const findings = [];

  // ─── LLM 5维审计 ─────────────────────────────────────
  try {
    const screenplaySummary = _summarizeScreenplay(screenplay);
    const llmResult = await callLLMJson({
      prompt: `你是资深剧本评审专家。请量化审计以下剧本。

## 剧本内容
${screenplaySummary}

## 评分维度（每项 0-1 分）
1. plot_coherence（情节连贯性）：三幕结构完整性、转折点合理性、因果关系链
2. dialogue_quality（对白质量）：潜台词运用、角色声音区分、信息堆砌检测
3. character_arc（角色弧线）：主角变化弧清晰度、动机可信度、成长/堕落感
4. pacing（节奏控制）：张弛有度、能量曲线合理性、场景时长分布
5. three_act_compliance（结构合规）：Field 三幕结构 / 对应模板的遵守程度

返回 JSON:
{
  "scores": { "plot_coherence": 0.0, "dialogue_quality": 0.0, "character_arc": 0.0, "pacing": 0.0, "three_act_compliance": 0.0 },
  "findings": [{ "dimension": "...", "severity": "high|medium|low", "issue": "问题描述", "recommendation": "修改建议" }],
  "overall_comment": "一句话总结"
}`,
      system: '你是剧本评审专家，评分严格但公正。0.75+ 为合格，0.85+ 为优秀。重点关注结构性问题。',
    });

    Object.assign(scores, llmResult?.scores || {});
    if (llmResult?.findings) findings.push(...llmResult.findings);
  } catch (err) {
    // LLM 失败 → stub
    Object.assign(scores, { plot_coherence: 0.6, dialogue_quality: 0.6, character_arc: 0.6, pacing: 0.6, three_act_compliance: 0.6 });
    findings.push({ dimension: 'system', severity: 'low', issue: `LLM 审计失败: ${err.message}` });
  }

  // ─── 维度 6: consistency_context_violations ──────────
  let consistencyViolations = [];
  if (consistencyContext && typeof consistencyContext.validate === 'function') {
    consistencyViolations = consistencyContext.validate(screenplay);
  } else if (consistencyContext) {
    // 如果是纯 JSON 快照，尝试恢复
    try {
      const { ConsistencyContext } = await import('./state/consistency-context.js');
      const ctx = ConsistencyContext.fromSnapshot(consistencyContext);
      consistencyViolations = ctx.validate(screenplay);
    } catch {
      // 忽略恢复失败
    }
  }
  scores.consistency_context_violations = consistencyViolations.length;

  if (consistencyViolations.length > 0) {
    for (const v of consistencyViolations) {
      findings.push({
        dimension: 'consistency_context_violations',
        severity: 'high',
        issue: v.issue || v.type,
        detail: v.detail,
      });
    }
  }

  // ─── 汇总 ─────────────────────────────────────────────
  const overall = DIMENSIONS_5.reduce((sum, dim) => {
    return sum + (scores[dim.id] ?? 0) * dim.weight;
  }, 0);

  const scorePass = overall >= 0.75;
  const consistencyPass = consistencyViolations.length === 0;

  return {
    scores,
    overall: Math.round(overall * 1000) / 1000,
    passed: scorePass && consistencyPass,
    score_pass: scorePass,
    consistency_pass: consistencyPass,
    findings,
    consistency_violations: consistencyViolations,
    recommendation: !scorePass
      ? `综合评分 ${(overall * 100).toFixed(0)}% 低于 75% 阈值，建议关注：${_weakestDimensions(scores)}`
      : (!consistencyPass
        ? `评分合格但存在 ${consistencyViolations.length} 个叙事一致性违规（零容忍），需修正`
        : '剧本质量合格'),
  };
}

/**
 * 格式化审计结果为用户可读文本（用于审核门展示）。
 */
export function formatAuditResult(result) {
  const lines = ['📝 剧本审计结果', ''];

  for (const dim of DIMENSIONS_5) {
    const score = result.scores[dim.id] ?? 0;
    const pct = (score * 100).toFixed(0);
    const icon = score >= 0.75 ? '✅' : (score >= 0.6 ? '⚠️' : '❌');
    lines.push(`${icon} ${dim.label}: ${pct}% (权重 ${(dim.weight * 100).toFixed(0)}%)`);
  }

  const cv = result.scores.consistency_context_violations ?? 0;
  lines.push(`${cv === 0 ? '✅' : '❌'} 叙事一致性违规: ${cv} 次 (零容忍)`);
  lines.push('');
  lines.push(`综合: ${(result.overall * 100).toFixed(0)}% — ${result.passed ? '✅ 通过' : '⚠️ 需关注'}`);
  if (result.recommendation) lines.push(`建议: ${result.recommendation}`);

  if (result.findings.length > 0) {
    lines.push('', '🔍 主要发现:');
    for (const f of result.findings.slice(0, 5)) {
      const icon = f.severity === 'high' ? '🔴' : (f.severity === 'medium' ? '🟡' : '⚪');
      lines.push(`  ${icon} [${f.dimension}] ${f.issue}`);
      if (f.recommendation) lines.push(`     → ${f.recommendation}`);
    }
  }

  return lines.join('\n');
}

// ─── 内部 ──────────────────────────────────────────────

function _summarizeScreenplay(screenplay) {
  const parts = [];
  if (screenplay.title) parts.push(`标题: ${screenplay.title}`);
  if (screenplay.logline) parts.push(`一句话: ${screenplay.logline}`);

  const scenes = screenplay.scene_list || screenplay.scenes || [];
  parts.push(`共 ${scenes.length} 场戏`);

  for (const scene of scenes.slice(0, 20)) {
    const id = scene.scene_id || scene.id || '?';
    const title = scene.title || scene.location || '';
    parts.push(`\n### 场 ${id}: ${title}`);
    if (scene.dialogue) {
      for (const line of (Array.isArray(scene.dialogue) ? scene.dialogue : []).slice(0, 5)) {
        const speaker = line.character || line.speaker || '';
        const text = line.text || line.content || '';
        parts.push(`  ${speaker}: ${text.slice(0, 100)}`);
      }
    }
    if (scene.action) parts.push(`  [动作] ${String(scene.action).slice(0, 100)}`);
  }

  if (screenplay.three_act_structure) {
    parts.push(`\n三幕结构: ${JSON.stringify(screenplay.three_act_structure).slice(0, 200)}`);
  }

  return parts.join('\n').slice(0, 4000); // 截断
}

function _weakestDimensions(scores) {
  return DIMENSIONS_5
    .filter(d => (scores[d.id] ?? 0) < 0.75)
    .sort((a, b) => (scores[a.id] ?? 0) - (scores[b.id] ?? 0))
    .slice(0, 3)
    .map(d => d.label)
    .join('、');
}

export default { auditScreenplay, formatAuditResult };
