/**
 * cn-compliance.js — CN 平台政治合规轻量检查 (from V2 compliance_gate, simplified)
 *
 * 仅检查政治敏感内容，其他维度不限制。
 * 用于 V8 Step 20 质检前，作为 pre_check 短路机制。
 *
 * 发现硬违规 → 直接 reject，阻止发布。
 * 无违规 → 放行，进入正常质检流程。
 *
 * 注意：这是 LLM 辅助的轻量扫描，不替代人工终审。
 * 不可用于内容创作审查（只在发布前检查成品）。
 */

import { callLLM } from './hermes-adapter.js';

/**
 * 执行政治合规预检。
 *
 * @param {object} screenplay — 剧本内容（scene_list 含 dialogue/action）
 * @param {object} [generatedVisuals] — 生成图片列表（可选，检查视觉内容）
 * @returns {Promise<{ passed: boolean, findings: Array, severity: 'none'|'warning'|'hard' }>}
 */
export async function checkPoliticalCompliance(screenplay, generatedVisuals = null) {
  const findings = [];

  // ─── 提取待扫描文本 ───────────────────────────────────
  const textParts = [];

  if (screenplay) {
    const scenes = screenplay.scene_list || screenplay.scenes || [];
    for (const scene of scenes) {
      if (scene.dialogue) {
        for (const line of Array.isArray(scene.dialogue) ? scene.dialogue : [scene.dialogue]) {
          textParts.push(String(line.text || line.content || line || ''));
        }
      }
      if (scene.action) textParts.push(String(scene.action));
      if (scene.description) textParts.push(String(scene.description));
    }
    if (screenplay.logline) textParts.push(String(screenplay.logline));
    if (screenplay.title) textParts.push(String(screenplay.title));
  }

  // 截断：最多扫描 8000 字符，避免 LLM 成本过高
  const scanText = textParts.join('\n').slice(0, 8000);

  if (!scanText.trim()) {
    return { passed: true, findings: [], severity: 'none', note: '无文本内容可扫描' };
  }

  // ─── LLM 辅助扫描 ────────────────────────────────────
  try {
    const llmResult = await callLLM({
      prompt: `你是一个CN平台内容合规审核助手。请检查以下内容是否包含政治敏感内容。

仅检查以下类别（其他不检查）：
- 涉及现实政治人物/事件的隐喻或影射
- 可能被认为具有政治暗示的内容
- 涉及敏感政治话题的直接或间接表述

注意：正常的职场、家庭、情感、科幻、奇幻题材不构成政治敏感。
历史题材需要区分"历史叙事"和"现实影射"。

待检查内容：
"""
${scanText}
"""

返回 JSON（严格格式）：
{
  "passed": true/false,
  "findings": [
    {
      "severity": "hard"|"warning",
      "location": "引用原文片段",
      "issue": "问题描述",
      "recommendation": "修改建议"
    }
  ],
  "summary": "一句话总结"
}

如果没有问题，passed=true, findings=[]。`,
      system: '你是内容合规审核工具，仅关注政治敏感内容。保持客观中立，对正常创作内容不要过度解读。',
    });

    // 尝试解析 JSON
    let parsed;
    try {
      const jsonMatch = llmResult.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      }
    } catch {
      parsed = null;
    }

    if (parsed) {
      const hasHard = (parsed.findings || []).some(f => f.severity === 'hard');
      return {
        passed: !hasHard && parsed.passed !== false,
        findings: parsed.findings || [],
        severity: hasHard ? 'hard' : (parsed.findings?.length ? 'warning' : 'none'),
        summary: parsed.summary || null,
      };
    }

    // LLM 返回不可解析 → 放行（不阻塞）
    return { passed: true, findings: [], severity: 'none', note: 'LLM 返回不可解析，默认放行' };

  } catch (err) {
    // LLM 调用失败 → 放行（不阻塞管线）
    return { passed: true, findings: [], severity: 'none', note: `LLM 调用失败: ${err.message}` };
  }
}

/**
 * 快速正则预筛（在 LLM 调用前，拦截明显的硬违规关键词）。
 * 这是一层低成本的安全网。
 *
 * 实际关键词列表应放在配置文件中，这里只做结构演示。
 * @param {string} text
 * @returns {{ blocked: boolean, matches: string[] }}
 */
export function regexPreFilter(text) {
  // 这里是示例关键词框架，实际部署时应从配置加载
  const regexList = [
    // 占位：实际部署时替换为真实敏感词表
  ];

  if (regexList.length === 0) {
    return { blocked: false, matches: [] };
  }

  const matches = [];
  for (const pattern of regexList) {
    const m = text.match(pattern);
    if (m) matches.push(...m);
  }

  return { blocked: matches.length > 0, matches };
}

export default { checkPoliticalCompliance, regexPreFilter };
