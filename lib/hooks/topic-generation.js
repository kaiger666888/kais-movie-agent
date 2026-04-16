/**
 * 选题发散 hook
 * 从 topic-selector-adapter.js 精简而来
 */
import { callLLMJson } from '../llm.js';

const PLATFORM_CONSTRAINTS = {
  douyin: { optimalDuration: '30-60s', format: '竖屏9:16', avoid: ['慢节奏', '说教'] },
  xiaohongshu: { optimalDuration: '15-45s', format: '竖屏3:4', avoid: ['硬广', '低质'] },
  bilibili: { optimalDuration: '60-180s', format: '横屏16:9', avoid: ['标题党', '内容空洞'] },
};

function buildPrompt(req, opts = {}) {
  const platform = opts.platform || 'douyin';
  const pc = PLATFORM_CONSTRAINTS[platform] || PLATFORM_CONSTRAINTS.douyin;

  return `你是专业的短视频选题策划师。

## 项目需求
${JSON.stringify(req, null, 2)}

## 约束
- 平台：${platform}（${pc.optimalDuration}，${pc.format}）
- 避免：${pc.avoid.join('、')}
- 目标人群：${req.targetAudience || '18-35岁'}

## 四维尺度
- 神经层：前3秒必须制造预测误差（悬念/反差/冲突）
- 情感层：必须能引发情绪锯齿波（焦虑↔释放）
- 叙事层：必须有明确的价值缺口，观众能身份投射
- 社会层：必须包含至少1个可截图瞬间+1个可引用金句

## 输出要求
生成 3-5 个候选选题，每个包含：
1. title, hook, premise, emotionalArc, memePotential
2. scores: { hook, structure, realism, title_cover, duration, engagement } (各1-10)
3. totalScore, feasibility, targetEmotion
按 totalScore 降序。输出 JSON 数组。`;
}

export async function generateTopics(requirement, options = {}) {
  const prompt = buildPrompt(requirement, options);
  try {
    return await callLLMJson(prompt, { model: options.model });
  } catch {
    return [{ raw: 'generation-failed', totalScore: 0 }];
  }
}
