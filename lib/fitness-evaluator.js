// Fitness Evaluator — V3 LLM-as-Judge Quality Assessment
// Pure Node.js, zero external dependencies

import { execSync } from 'node:child_process';

/**
 * Scoring criteria per artifact type
 * Each dimension: 0-10 scale
 */
const SCORING_CRITERIA = {
  concept: {
    dimensions: ['原创性', '市场潜力', '执行可行性', '情感共鸣'],
    prompt: `你是一个资深影视策划评估专家。请对以下创意概念进行评分（0-10分），严格按JSON数组格式返回每个维度的分数。

评估维度：
1. 原创性 — 核心创意的新颖程度，是否避免常见套路
2. 市场潜力 — 目标受众规模、传播潜力、商业价值
3. 执行可行性 — 在当前AI工具能力范围内的可实现程度
4. 情感共鸣 — 能否引发观众强烈情感反应

请仅返回JSON数组，如：[8,7,6,9]
不要返回其他内容。

待评估内容：
`,
  },

  story: {
    dimensions: ['结构完整性', '角色深度', '情感弧线', '节奏'],
    prompt: `你是一个资深编剧评估专家。请对以下故事大纲进行评分（0-10分），严格按JSON数组格式返回每个维度的分数。

评估维度：
1. 结构完整性 — 是否有清晰的起承转合，故事逻辑是否自洽
2. 角色深度 — 角色动机是否明确，性格是否有层次
3. 情感弧线 — 情感变化是否有递进和高潮
4. 节奏 — 叙事节奏是否张弛有度，不拖沓不仓促

请仅返回JSON数组，如：[8,7,6,9]
不要返回其他内容。

待评估内容：
`,
  },

  art_direction: {
    dimensions: ['风格独特性', '一致性', '氛围感', '可执行性'],
    prompt: `你是一个资深美术指导评估专家。请对以下美术方向设计进行评分（0-10分），严格按JSON数组格式返回每个维度的分数。

评估维度：
1. 风格独特性 — 视觉风格是否鲜明、有辨识度
2. 一致性 — 色彩、光影、构图等元素是否协调统一
3. 氛围感 — 是否能有效营造故事所需的情绪氛围
4. 可执行性 — 设计方案是否可以通过AI绘图/视频工具实际生成

请仅返回JSON数组，如：[8,7,6,9]
不要返回其他内容。

待评估内容：
`,
  },

  character: {
    dimensions: ['风格独特性', '一致性', '氛围感', '可执行性'],
    prompt: `你是一个资深角色设计评估专家。请对以下角色设计进行评分（0-10分），严格按JSON数组格式返回每个维度的分数。

评估维度：
1. 风格独特性 — 角色外观和性格是否独特、有记忆点
2. 一致性 — 角色设计是否与整体美术风格协调
3. 氛围感 — 角色是否传达了预期的情感和氛围
4. 可执行性 — 角色描述是否足够具体，可以通过AI工具生成

请仅返回JSON数组，如：[8,7,6,9]
不要返回其他内容。

待评估内容：
`,
  },

  scene: {
    dimensions: ['风格独特性', '一致性', '氛围感', '可执行性'],
    prompt: `你是一个资深场景设计评估专家。请对以下场景设计进行评分（0-10分），严格按JSON数组格式返回每个维度的分数。

评估维度：
1. 风格独特性 — 场景设计是否有创意、不落俗套
2. 一致性 — 场景是否与故事设定和美术风格协调
3. 氛围感 — 场景是否有效营造了所需的氛围
4. 可执行性 — 场景描述是否足够具体，可以通过AI工具生成

请仅返回JSON数组，如：[8,7,6,9]
不要返回其他内容。

待评估内容：
`,
  },

  storyboard: {
    dimensions: ['风格独特性', '一致性', '氛围感', '可执行性'],
    prompt: `你是一个资深分镜评估专家。请对以下分镜设计进行评分（0-10分），严格按JSON数组格式返回每个维度的分数。

评估维度：
1. 风格独特性 — 镜头设计是否有创意、有视觉冲击力
2. 一致性 — 分镜是否与故事节奏和美术风格协调
3. 氛围感 — 分镜是否有效传达了每个场景的情感
4. 可执行性 — 分镜描述是否足够具体，可以通过AI视频工具生成

请仅返回JSON数组，如：[8,7,6,9]
不要返回其他内容。

待评估内容：
`,
  },
};

export class FitnessEvaluator {
  #config;
  #cache = new Map();

  constructor(config = {}) {
    this.#config = {
      llmCommand: config.llmCommand || null, // e.g. 'openclaw chat --model glm-5-turbo'
      cacheResults: config.cacheResults ?? true,
    };
  }

  /**
   * Evaluate an artifact and return fitness scores
   * @param {object|string} artifact - The artifact to evaluate (object or JSON string)
   * @param {string} type - concept|story|art_direction|character|scene|storyboard
   * @returns {object} { scores: { dimension: value }, total: number, dimensions: string[] }
   */
  async evaluate(artifact, type) {
    const criteria = SCORING_CRITERIA[type];
    if (!criteria) {
      throw new Error(`Unknown artifact type: ${type}. Valid: ${Object.keys(SCORING_CRITERIA).join(', ')}`);
    }

    const content = typeof artifact === 'string' ? artifact : JSON.stringify(artifact, null, 2);
    const cacheKey = `${type}:${content.slice(0, 200)}`;

    if (this.#config.cacheResults && this.#cache.has(cacheKey)) {
      return this.#cache.get(cacheKey);
    }

    const result = await this.llmJudge(content, criteria.prompt, criteria.dimensions);

    if (this.#config.cacheResults) {
      this.#cache.set(cacheKey, result);
    }

    return result;
  }

  /**
   * LLM-as-Judge: use LLM to score an artifact
   */
  async llmJudge(artifactContent, systemPrompt, dimensions) {
    // If no LLM command configured, use heuristic scoring
    if (!this.#config.llmCommand) {
      return this.#heuristicScore(artifactContent, dimensions);
    }

    try {
      const fullPrompt = `${systemPrompt}${artifactContent}`;
      const escaped = fullPrompt.replace(/'/g, "'\\''");
      const output = execSync(`echo '${escaped}' | ${this.#config.llmCommand}`, {
        timeout: 60000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Parse JSON array from output
      const jsonMatch = output.match(/\[[\d.,\s]+\]/);
      if (jsonMatch) {
        const scores = JSON.parse(jsonMatch[0]);
        return this.#buildResult(scores, dimensions);
      }
    } catch (e) {
      // Fall back to heuristic
      console.warn(`[FitnessEvaluator] LLM scoring failed: ${e.message}, using heuristic`);
    }

    return this.#heuristicScore(artifactContent, dimensions);
  }

  /**
   * Evaluate population diversity (avoid premature convergence)
   * @param {Array} population - Array of evaluated artifacts { scores }
   * @returns {number} 0-1 diversity score (1 = highly diverse)
   */
  evaluateDiversity(population) {
    if (population.length < 2) return 1.0;

    const scoreVectors = population.map(p => {
      const s = p.scores || {};
      return Object.values(s);
    });

    // Calculate pairwise cosine distance
    let totalDistance = 0;
    let pairs = 0;

    for (let i = 0; i < scoreVectors.length; i++) {
      for (let j = i + 1; j < scoreVectors.length; j++) {
        totalDistance += this.#cosineDistance(scoreVectors[i], scoreVectors[j]);
        pairs++;
      }
    }

    return pairs > 0 ? totalDistance / pairs : 1.0;
  }

  /**
   * Quick quality check — returns boolean if artifact meets minimum threshold
   */
  async quickCheck(artifact, type, minScore = 5.0) {
    const result = await this.evaluate(artifact, type);
    return result.total / result.dimensions.length >= minScore;
  }

  // ── Private methods ──

  #buildResult(scores, dimensions) {
    const scoreObj = {};
    for (let i = 0; i < dimensions.length; i++) {
      scoreObj[dimensions[i]] = Math.min(10, Math.max(0, scores[i] || 0));
    }
    const values = Object.values(scoreObj);
    return {
      scores: scoreObj,
      total: values.reduce((a, b) => a + b, 0),
      dimensions,
    };
  }

  #cosineDistance(a, b) {
    if (a.length === 0 || b.length === 0) return 1.0;
    const len = Math.min(a.length, b.length);
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    if (denom === 0) return 1.0;
    // cosine similarity → distance
    return 1.0 - (dot / denom);
  }

  /**
   * Heuristic scoring when no LLM is available
   * Uses content analysis proxies for quality estimation
   */
  #heuristicScore(content, dimensions) {
    const len = content.length;
    const sentenceCount = (content.match(/[。！？.!?]/g) || []).length;
    const uniqueChars = new Set(content.replace(/\s/g, '')).size;

    // Base score from content richness
    const richnessScore = Math.min(10, (len / 100) * 2 + (sentenceCount / 5) * 2 + (uniqueChars / 50) * 2);
    const baseScore = Math.min(8, Math.max(3, richnessScore));

    // Add some randomness to simulate evaluation variance (±1.5)
    const noise = () => (Math.random() - 0.5) * 3;

    const scores = dimensions.map(() =>
      Math.round(Math.min(10, Math.max(1, baseScore + noise())) * 10) / 10
    );

    return this.#buildResult(scores, dimensions);
  }
}
