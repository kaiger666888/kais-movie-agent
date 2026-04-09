// Critic Agent - kais-critic-agent
// Self-evaluation agent for artifact quality assessment
// Pure Node.js, zero external dependencies

const CLASSIC_STRUCTURES = {
  hero_journey: {
    name: '英雄之旅 (Hero\'s Journey)',
    stages: ['平凡世界', '冒险召唤', '拒绝召唤', '遇见导师', '跨越第一道门槛', '考验、盟友、敌人', '接近深渊', '严峻考验', '获得奖赏', '回归之路', '复活', '携万灵药回归'],
    beatCount: 12,
  },
  three_act: {
    name: '三幕式 (Three-Act)',
    stages: ['建置', '激励事件', '第一幕高潮', '对抗发展', '中点', '第二幕高潮', '高潮', '解决'],
    beatCount: 8,
  },
  save_the_cat: {
    name: '救猫咪 (Save the Cat)',
    stages: ['开场画面', '铺陈主题', '铺陈', '催化剂', '争论', '进入第二幕', '副线故事', '游戏时间', '中点', '坏人逼近', '失去一切', '灵魂黑夜', '进入第三幕', '结局', '终场画面'],
    beatCount: 15,
  },
  five_act: {
    name: '五幕式 (Five-Act)',
    stages: ['序幕', '上升', '高潮', '下降', '结局'],
    beatCount: 5,
  },
};

const VISUAL_DIMENSIONS = ['风格一致性', '角色辨识度', '场景氛围感', '色彩和谐度'];
const STORYBOARD_DIMENSIONS = ['镜头连贯性', '节奏变化', '视觉多样性', '可执行性'];
const CONCEPT_DIMENSIONS = ['原创性', '市场潜力', '目标受众匹配度', '执行可行性'];
const STORY_DIMENSIONS = ['结构完整性', '角色深度', '情感弧线', '节奏', '主题一致性'];

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

export class CriticAgent {
  #config;

  constructor(config = {}) {
    this.#config = {
      strictness: config.strictness ?? 0.7,  // 0-1, higher = stricter
      weights: config.weights ?? {},
    };
  }

  async evaluateConcept(concept) {
    const scores = {};
    for (const dim of CONCEPT_DIMENSIONS) {
      const base = concept[dim] ?? 5;
      // Heuristic adjustments
      let score = base;
      if (dim === '原创性') {
        score = concept.genre && !['爱情', '喜剧'].includes(concept.genre) ? base + 1 : base;
        if (concept.hooks?.length > 2) score += 1;
      }
      if (dim === '执行可行性') {
        if (concept.estimated_duration && concept.estimated_duration <= 180) score += 1;
        if (concept.estimated_duration && concept.estimated_duration > 600) score -= 2;
      }
      scores[dim] = clamp(Math.round(score * 10) / 10, 0, 10);
    }

    const overall = avg(Object.values(scores));
    const suggestions = [];
    if (scores.原创性 < 6) suggestions.push('尝试融合不同类型或加入意外元素提升原创性');
    if (scores.市场潜力 < 6) suggestions.push('参考近期热点，增加社会共鸣点');
    if (scores.执行可行性 < 6) suggestions.push('缩短时长或简化场景需求以提高可行性');

    return { scores, overall: Math.round(overall * 10) / 10, suggestions, artifact_type: 'concept' };
  }

  async evaluateStory(storyDNA) {
    const scores = {};
    for (const dim of STORY_DIMENSIONS) {
      let score = 6; // baseline
      if (dim === '结构完整性') {
        const beatCount = storyDNA.beats?.length ?? 0;
        score = clamp(beatCount >= 8 ? 8 : beatCount >= 5 ? 6 : 3, 1, 10);
        if (storyDNA.beats?.every((b, i) => b.sequence === i)) score += 1;
      }
      if (dim === '角色深度') {
        const charCount = storyDNA.characters?.length ?? 0;
        score = clamp(charCount >= 3 ? 7 : charCount >= 1 ? 5 : 2, 1, 10);
      }
      if (dim === '情感弧线') {
        const arcs = storyDNA.beats?.filter(b => b.emotional_arc).length ?? 0;
        score = clamp(arcs >= storyDNA.beats?.length * 0.5 ? 8 : arcs >= 2 ? 6 : 3, 1, 10);
      }
      if (dim === '节奏') {
        const beatCount = storyDNA.beats?.length ?? 0;
        score = clamp(beatCount >= 8 ? 7 : beatCount >= 5 ? 5 : 3, 1, 10);
      }
      if (dim === '主题一致性') {
        score = storyDNA.theme ? 7 : 3;
        if (storyDNA.logline && storyDNA.theme) score = 8;
      }
      scores[dim] = clamp(Math.round(score * 10) / 10, 0, 10);
    }

    // Match against classic structures
    const beatCount = storyDNA.beats?.length ?? 0;
    let bestMatch = null;
    let bestSimilarity = 0;
    for (const [key, struct] of Object.entries(CLASSIC_STRUCTURES)) {
      const similarity = 1 - Math.abs(beatCount - struct.beatCount) / Math.max(beatCount, struct.beatCount);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = key;
      }
    }

    const overall = avg(Object.values(scores));
    const suggestions = [];
    if (scores.结构完整性 < 7) suggestions.push(`建议参考 ${CLASSIC_STRUCTURES[bestMatch]?.name} 补充缺失的节拍`);
    if (scores.角色深度 < 6) suggestions.push('为每个主要角色添加内在矛盾和成长弧线');
    if (scores.情感弧线 < 6) suggestions.push('在每个节拍标注情感变化，确保情绪有起伏');
    if (scores.主题一致性 < 6) suggestions.push('强化 logline 与 theme 之间的呼应');

    return {
      scores,
      overall: Math.round(overall * 10) / 10,
      structure_match: bestMatch,
      structure_similarity: Math.round(bestSimilarity * 100) / 100,
      suggestions,
      artifact_type: 'story',
    };
  }

  async evaluateVisual(artDirection, characters = [], scenes = []) {
    const scores = {};
    for (const dim of VISUAL_DIMENSIONS) {
      let score = 6;
      if (dim === '风格一致性') {
        score = artDirection.style_name ? 7 : 4;
        if (artDirection.composition_rules?.length > 2) score += 1;
      }
      if (dim === '角色辨识度') {
        score = characters.length > 0 ? 7 : 4;
        if (characters.every(c => c.appearance && c.personality)) score += 1;
      }
      if (dim === '场景氛围感') {
        score = scenes.length > 0 ? 6 : 3;
        if (scenes.every(s => s.atmosphere && s.lighting)) score += 2;
      }
      if (dim === '色彩和谐度') {
        const palette = artDirection.color_palette ?? [];
        score = palette.length >= 3 ? 7 : palette.length >= 1 ? 5 : 3;
        if (palette.length >= 5) score += 1;
      }
      scores[dim] = clamp(Math.round(score * 10) / 10, 0, 10);
    }

    const overall = avg(Object.values(scores));
    const suggestions = [];
    if (scores.风格一致性 < 7) suggestions.push('统一构图规则，确保所有画面遵循相同的视觉语言');
    if (scores.角色辨识度 < 7) suggestions.push('强化每个角色的视觉特征，确保在群像中可区分');
    if (scores.场景氛围感 < 7) suggestions.push('为每个场景定义明确的氛围和光照方案');
    if (scores.色彩和谐度 < 7) suggestions.push('使用色彩理论（互补色、类似色）优化调色板');

    return { scores, overall: Math.round(overall * 10) / 10, suggestions, artifact_type: 'visual' };
  }

  async evaluateStoryboard(storyboard) {
    const shots = storyboard.shots ?? [];
    const scores = {};

    for (const dim of STORYBOARD_DIMENSIONS) {
      let score = 6;
      if (dim === '镜头连贯性') {
        score = shots.length > 1 ? 6 : 3;
        const angles = new Set(shots.map(s => s.camera?.angle).filter(Boolean));
        if (angles.size > 3) score += 2;
      }
      if (dim === '节奏变化') {
        const durations = shots.map(s => s.duration).filter(Boolean);
        if (durations.length > 1) {
          const variance = durations.reduce((a, d) => a + Math.pow(d - avg(durations), 2), 0) / durations.length;
          score = variance > 1 ? 8 : variance > 0.1 ? 6 : 4; // some variation is good
        }
      }
      if (dim === '视觉多样性') {
        const movements = new Set(shots.map(s => s.camera?.movement).filter(Boolean));
        const lenses = new Set(shots.map(s => s.camera?.lens).filter(Boolean));
        score = clamp(4 + movements.size + lenses.size, 3, 10);
      }
      if (dim === '可执行性') {
        const hasAllRequired = shots.every(s => s.shot_id && s.action && s.duration);
        score = hasAllRequired ? 8 : 4;
        if (shots.every(s => s.reference_image)) score += 1;
      }
      scores[dim] = clamp(Math.round(score * 10) / 10, 0, 10);
    }

    const overall = avg(Object.values(scores));
    const suggestions = [];
    if (scores.镜头连贯性 < 7) suggestions.push('确保相邻镜头在空间和动作上连贯，遵循180度法则');
    if (scores.节奏变化 < 7) suggestions.push('交替使用快慢镜头节奏，避免单调');
    if (scores.视觉多样性 < 7) suggestions.push('增加镜头运动和焦段的变化');
    if (scores.可执行性 < 7) suggestions.push('为每个镜头补充参考图和详细动作描述');

    return { scores, overall: Math.round(overall * 10) / 10, suggestions, artifact_type: 'storyboard' };
  }

  async suggestImprovements(artifact, evaluation) {
    const overall = evaluation.overall ?? 0;
    const suggestions = evaluation.suggestions ?? [];

    return suggestions.map((text, i) => {
      let priority = 'low';
      if (overall < 5) priority = 'high';
      else if (overall < 7) priority = 'medium';

      return {
        id: `improvement-${i}`,
        priority,
        action: text,
        expected_improvement: priority === 'high' ? '+2.0 ~ +3.0' : priority === 'medium' ? '+1.0 ~ +2.0' : '+0.5 ~ +1.0',
        dimension: Object.entries(evaluation.scores ?? {}).find(([k, v]) => v < 7)?.[0] ?? 'general',
      };
    }).sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.priority] - order[b.priority];
    });
  }
}
