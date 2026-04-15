/**
 * kais-audience 适配器
 * kais-audience 是提示词驱动的 skill（无可调用的 JS 模块），
 * 本适配器读取其 SKILL.md + personas，生成结构化的 prompt 供后续阶段使用。
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIENCE_SKILL_DIR = join(__dirname, '..', 'skills', 'kais-audience');

/**
 * 加载 kais-audience 的 SKILL.md 和人设文件
 */
function loadAudienceContext() {
  const skillMd = join(AUDIENCE_SKILL_DIR, 'SKILL.md');
  if (!existsSync(skillMd)) {
    throw new Error(`kais-audience SKILL.md not found at ${skillMd}`);
  }

  const personasDir = join(AUDIENCE_SKILL_DIR, 'personas');
  const personas = [];
  if (existsSync(personasDir)) {
    for (const file of readdirSync(personasDir).filter(f => f.endsWith('.md'))) {
      personas.push(readFileSync(join(personasDir, file), 'utf-8'));
    }
  }

  return {
    skillPrompt: readFileSync(skillMd, 'utf-8'),
    personas,
  };
}

/**
 * 快速受众匹配（Phase 1 后调用）
 * @param {object} params
 * @param {object} params.content - 需求数据（title, genre, synopsis 等）
 * @param {string} params.platform - 目标平台
 * @returns {object} 匹配结果
 */
export async function audienceMatch({ content, platform = 'douyin' }) {
  const { skillPrompt } = loadAudienceContext();

  // 返回结构化的 prompt 指令，供后续 AI 调用使用
  return {
    mode: 'audience-match',
    platform,
    content: {
      title: content.title || '',
      genre: content.genre || '',
      synopsis: content.synopsis || content.description || '',
    },
    // 附带完整的 audience skill 指令，供 agent 在后续阶段使用
    skillPrompt,
    instruction: `请按照 kais-audience 的"受众匹配模式"分析以下内容，输出核心受众画像、匹配度、平台适配建议。`,
    // 占位结果（实际由 AI 填充）
    topAudience: null,
    matchScores: null,
  };
}

/**
 * 深度剧本测评（Phase 4 后调用）
 * @param {object} params
 * @param {string} params.script - 剧本内容
 * @param {string} params.platform - 目标平台
 * @returns {object} 测评结果
 */
export async function deepAudienceAnalysis({ script, platform = 'douyin' }) {
  const { skillPrompt, personas } = loadAudienceContext();

  return {
    mode: 'deep-analysis',
    platform,
    script: typeof script === 'string' ? script.substring(0, 5000) : JSON.stringify(script),
    personasLoaded: personas.length,
    // 附带完整的 audience skill 指令 + 人设
    skillPrompt,
    personas,
    instruction: `请按照 kais-audience 的"深度测评模式"对以下剧本进行完整分析，包括情绪曲线、毒点检测、完播率预测。使用加载的 ${personas.length} 个人设文件组建评审团。`,
    // 占位结果（实际由 AI 填充）
    toxicPoints: [],
    predictedRetention: null,
    emotionCurve: null,
    totalScore: null,
  };
}

/**
 * 生成受众测评的 prompt 上下文（供 agent 在管线中使用）
 */
export function getAudiencePromptContext(mode = 'deep') {
  const { skillPrompt, personas } = loadAudienceContext();
  const modeInstructions = {
    match: '受众匹配模式：分析内容特征，匹配目标人群，输出核心受众画像。',
    deep: '深度测评模式：组建12人评审团，模拟投票，输出完播率预测+毒点检测+情绪曲线。',
    quick: '快速投票模式：对多个选题进行快速排名，输出评分表。',
  };

  return {
    systemPrompt: `${skillPrompt}\n\n## 当前模式\n${modeInstructions[mode] || modeInstructions.deep}`,
    personas,
    personasDir: join(AUDIENCE_SKILL_DIR, 'personas'),
  };
}
