/**
 * 选题发散适配器
 * 聚合 1st-director(四维尺度)、quality-gate(6维度)、kais-audience(受众匹配) 的约束
 * 输出带评分的候选选题列表
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 从多个约束源聚合选题约束
 * @param {object} requirement - Phase 1 的需求确认结果
 * @param {object} options - { platform, genre, audienceProfile }
 * @returns {object} 选题约束包
 */
export function buildTopicConstraints(requirement, options = {}) {
  const constraints = {
    // 1. 四维尺度约束（来自 1st-director 理论）
    fourDimensions: {
      neuro: '选题前3秒必须能制造预测误差（悬念/反差/冲突）',
      emotion: '选题必须能引发情绪锯齿波（焦虑↔释放），避免平铺直叙',
      narrative: '选题必须有明确的价值缺口，观众能身份投射',
      social: '选题必须包含至少1个可截图瞬间+1个可引用金句的潜力',
    },
    // 2. 6维度门控约束（来自 quality-gate）
    gateDimensions: {
      hook: '选题的黄金3秒钩子强度（满分25）',
      structure: '选题是否支持心跳曲线结构（满分20）',
      realism: '选题的AIGC真实感可行性（满分20）',
      title_cover: '选题的标题封面吸引力（满分15）',
      duration: '选题在目标平台最佳时长内的可执行性（满分10）',
      engagement: '选题的互动潜力（投票/评论/分享）（满分10）',
    },
    // 3. 受众匹配约束（来自 kais-audience）
    audience: {
      platform: options.platform || 'douyin',
      targetDemographic: requirement.targetAudience || '18-35岁',
      contentPreferences: requirement.preferences || [],
      avoidTopics: [],
    },
    // 4. 平台特定约束
    platform: {
      douyin: { optimalDuration: '30-60s', format: '竖屏9:16', avoid: ['慢节奏', '说教'] },
      xiaohongshu: { optimalDuration: '15-45s', format: '竖屏3:4', avoid: ['硬广', '低质'] },
      bilibili: { optimalDuration: '60-180s', format: '横屏16:9', avoid: ['标题党', '内容空洞'] },
    },
  };

  // 合并平台约束
  if (options.platform && constraints.platform[options.platform]) {
    constraints.platformActive = constraints.platform[options.platform];
  }

  // 合并蓝图约束（如果存在）
  if (options.blueprint) {
    constraints.blueprint = options.blueprint;
  }

  return constraints;
}

/**
 * 生成选题发散 prompt（给 LLM 用）
 * 将约束包转为结构化 prompt
 */
export function buildTopicPrompt(requirement, constraints) {
  return `你是一个专业的短视频/短剧选题策划师。

## 项目需求
${JSON.stringify(requirement, null, 2)}

## 约束条件（必须遵守）

### 四维尺度（神经/情感/叙事/社会）
- 神经层：${constraints.fourDimensions.neuro}
- 情感层：${constraints.fourDimensions.emotion}
- 叙事层：${constraints.fourDimensions.narrative}
- 社会层：${constraints.fourDimensions.social}

### 6维度评分标准
- 🪝 钩子(25分)：${constraints.gateDimensions.hook}
- 🎼 结构(20分)：${constraints.gateDimensions.structure}
- 🎭 真实感(20分)：${constraints.gateDimensions.realism}
- 🖼️ 标题封面(15分)：${constraints.gateDimensions.title_cover}
- ⏱️ 时长适配(10分)：${constraints.gateDimensions.duration}
- 💬 互动潜力(10分)：${constraints.gateDimensions.engagement}

### 受众约束
- 平台：${constraints.audience.platform}
- 目标人群：${constraints.audience.targetDemographic}
${constraints.audience.contentPreferences.length ? `- 内容偏好：${constraints.audience.contentPreferences.join(', ')}` : ''}
${constraints.platformActive ? `- 平台最佳时长：${constraints.platformActive.optimalDuration}\n- 避免元素：${constraints.platformActive.avoid.join('、')}` : ''}

## 输出要求
生成 3-5 个候选选题，每个选题包含：
1. title: 一句话标题（含数字/疑问/冲突元素）
2. hook: 黄金3秒钩子描述
3. premise: 核心设定（50字内）
4. emotionalArc: 情绪曲线（焦虑→释放→更高焦虑...）
5. memePotential: 传播模因潜力（截图瞬间+金句）
6. scores: { hook, structure, realism, title_cover, duration, engagement } 各维度1-10分
7. totalScore: 总分（加权求和）
8. feasibility: AIGC制作可行性评估（高/中/低）
9. targetEmotion: 目标观众情绪（看完后的感受）

按 totalScore 降序排列。`;
}

/**
 * 调用 LLM 执行选题发散
 * @param {object} requirement - 需求
 * @param {object} options - { platform, genre, model, blueprint }
 * @returns {Promise<object[]>} 候选选题列表
 */
export async function generateTopics(requirement, options = {}) {
  const constraints = buildTopicConstraints(requirement, options);
  const prompt = buildTopicPrompt(requirement, constraints);

  const apiBase = process.env.OPENAI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4';
  const apiKey = process.env.ZHIPU_API_KEY || process.env.OPENAI_API_KEY || '';
  const model = options.model || 'glm-4-flash';

  const res = await fetch(`${apiBase}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.8,
    }),
  });

  if (!res.ok) {
    throw new Error(`选题发散 LLM 调用失败: ${res.status}`);
  }

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content || '';

  // 尝试解析 JSON 数组
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {}
  }

  // 降级：返回原始文本
  return [{ raw: content, totalScore: 0 }];
}
