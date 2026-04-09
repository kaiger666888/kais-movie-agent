// Prompt Mutator — V3 Evolutionary Prompt Engineering
// Pure Node.js, zero external dependencies

const SYNONYM_MAP = {
  '温暖': ['治愈', '温馨', '柔和'],
  '黑暗': ['阴郁', '深邃', '沉重'],
  '快速': ['急促', '迅猛', '飞速'],
  '孤独': ['寂寞', '落寞', '形单影只'],
  '浪漫': ['唯美', '诗意', '缱绻'],
  '悬疑': ['烧脑', '迷离', '诡异'],
  '幽默': ['诙谐', '轻松', '有趣'],
  '震撼': ['壮观', '惊艳', '磅礴'],
  '反转': ['逆袭', '颠覆', '意想不到'],
  '冲突': ['矛盾', '对抗', '碰撞'],
  '成长': ['蜕变', '觉醒', '破茧'],
  '牺牲': ['奉献', '成全', '舍己'],
  '秘密': ['隐藏', '谜团', '真相'],
  '逃离': ['出走', '挣脱', '破局'],
  '重逢': ['再遇', '归途', '相遇'],
};

const ARCHETYPE_TEMPLATES = [
  '英雄之旅：主角从平凡出发→经历试炼→获得成长→回归并改变世界',
  '三幕剧：建立→冲突→解决，在第二幕中点设置重大转折',
  '对比叙事：两个平行世界/人生的交叉对比，最终殊途同归',
  '倒计时：在有限时间内完成看似不可能的任务',
  '密室解谜：封闭空间中的线索收集与真相揭示',
  '情感双螺旋：两条情感线交织上升，最终合二为一',
  '环形结构：结尾呼应开头，但主角已完全改变',
  '罗生门效应：同一事件的多视角叙述，拼凑真相',
];

const HOTSPOT_INJECTIONS = [
  '加入当下热门的社会话题元素',
  '融入AI时代的人类困境思考',
  '添加反内卷/躺平的文化隐喻',
  '结合数字化生存的焦虑与希望',
  '加入"算法推荐"对人生的隐喻',
  '融入Z世代的生活态度',
  '加入环保/可持续发展的隐喻',
  '结合远程办公时代的孤独感',
];

export class PromptMutator {
  #config;

  constructor(config = {}) {
    this.#config = {
      temperature: config.temperature ?? 0.7,
      maxMutations: config.maxMutations ?? 3,
    };
  }

  /**
   * Mutate a prompt using a specific strategy
   * @param {string} prompt - Original prompt
   * @param {string} strategy - conservative|radical|reversal|micro|archetype
   * @param {object} context - { topic, genre, previousAttempts, evaluation }
   * @returns {string} Mutated prompt
   */
  mutate(prompt, strategy = 'conservative', context = {}) {
    const mutators = {
      conservative: () => this.#conservative(prompt, context),
      radical: () => this.#radical(prompt, context),
      reversal: () => this.#reversal(prompt, context),
      micro: () => this.#micro(prompt, context),
      archetype: () => this.#archetype(prompt, context),
    };
    return (mutators[strategy] || mutators.conservative)();
  }

  /**
   * Crossover: blend core elements from two prompts
   * @returns {string} Child prompt
   */
  crossover(promptA, promptB) {
    // Extract key phrases (sentences or clauses)
    const extractPhrases = (p) => p.split(/[。！？\n]/).filter(s => s.trim().length > 2);
    const phrasesA = extractPhrases(promptA);
    const phrasesB = extractPhrases(promptB);

    if (phrasesA.length === 0 || phrasesB.length === 0) {
      return Math.random() < 0.5 ? promptA : promptB;
    }

    // Take ~60% from A, ~40% from B
    const takeFromA = Math.ceil(phrasesA.length * 0.6);
    const takeFromB = Math.ceil(phrasesB.length * 0.4);

    const shuffledA = [...phrasesA].sort(() => Math.random() - 0.5).slice(0, takeFromA);
    const shuffledB = [...phrasesB].sort(() => Math.random() - 0.5).slice(0, takeFromB);

    // Interleave
    const child = [];
    const maxLen = Math.max(shuffledA.length, shuffledB.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < shuffledA.length) child.push(shuffledA[i].trim());
      if (i < shuffledB.length) child.push(shuffledB[i].trim());
    }

    return child.join('。') + '。';
  }

  /**
   * Adaptive mutation based on evaluation feedback
   * @param {string} prompt
   * @param {object} evaluation - { scores: { dimension: value }, feedback }
   * @param {Array} previousAttempts - [ { prompt, scores } ]
   * @returns {string}
   */
  adaptiveMutate(prompt, evaluation, previousAttempts = []) {
    const scores = evaluation.scores || {};
    const dimensions = Object.entries(scores);

    if (dimensions.length === 0) {
      return this.mutate(prompt, 'conservative', { evaluation, previousAttempts });
    }

    // Find weakest dimension
    const [weakestDim, weakestVal] = dimensions.sort((a, b) => a[1] - b[1])[0];
    const [strongestDim] = dimensions.sort((a, b) => b[1] - a[1])[0];

    // Build targeted mutation instruction
    const boostInstructions = {
      '原创性': '请大幅改变核心设定，加入前所未有的创意元素',
      '市场潜力': '请优化为目标受众更容易理解和共鸣的表达方式',
      '执行可行性': '请简化复杂设定，确保可以通过现有工具实现',
      '情感共鸣': '请加强情感描写，让观众能产生强烈的共情',
      '结构完整性': '请确保故事有清晰的开头、发展和结尾',
      '角色深度': '请丰富角色的内心世界和动机',
      '情感弧线': '请设计更明显和动人的情感转折',
      '节奏': '请调整叙事节奏，张弛有度',
      '风格独特性': '请加入更独特和鲜明的视觉风格元素',
      '一致性': '请确保整体风格和氛围保持统一',
      '氛围感': '请加强环境描写和氛围营造',
      '可执行性': '请确保设计方案可以通过AI工具实际生成',
    };

    const instruction = boostInstructions[weakestDim] || '请优化整体质量';
    const avoidNote = previousAttempts.length > 0
      ? `\n\n注意：避免以下已尝试的方向：${previousAttempts.slice(-3).map(a => a.prompt.slice(0, 50)).join('；')}`
      : '';

    return `${prompt}\n\n【优化指令】${instruction}。当前"${weakestDim}"维度评分较低(${weakestVal}/10)，请重点提升。保持"${strongestDim}"方面的优势。${avoidNote}`;
  }

  // ── Private mutation strategies ──

  #conservative(prompt, context) {
    // Substitute 1-2 keywords with synonyms
    let result = prompt;
    const keys = Object.keys(SYNONYM_MAP);
    const substitutions = Math.min(2, Math.floor(keys.length * this.#config.temperature));

    for (let i = 0; i < substitutions; i++) {
      const key = keys[Math.floor(Math.random() * keys.length)];
      if (result.includes(key)) {
        const synonyms = SYNONYM_MAP[key];
        const replacement = synonyms[Math.floor(Math.random() * synonyms.length)];
        result = result.replace(key, replacement);
      }
    }

    // Add slight variation instruction
    const variations = [
      '\n\n请在保持核心创意的基础上，对表达方式做适度创新。',
      '\n\n请用更精炼的语言重新组织，同时保留核心元素。',
      '\n\n请在细节层面加入一些意想不到的小惊喜。',
    ];
    result += variations[Math.floor(Math.random() * variations.length)];
    return result;
  }

  #radical(prompt, context) {
    const topic = context.topic || '这个概念';
    const genre = context.genre || '当前类型';

    const radicalTransforms = [
      `将${topic}的核心设定完全反转，创造一个截然对立的版本。保留${genre}类型的基本框架，但颠覆所有预期。`,
      `把${topic}放到一个完全不同的文化/时代背景中重新构想。融合两种看似矛盾的${genre}子类型。`,
      `如果${topic}是一个游戏/梦境/模拟，它的"真实世界"是什么样的？从这个角度重新创作。`,
      `用非线性叙事重构${topic}——从结尾开始倒叙，打破传统叙事结构。`,
      `将${topic}中次要元素放大为主角，原来的主角变为背景。`,
    ];

    const transform = radicalTransforms[Math.floor(Math.random() * radicalTransforms.length)];
    return `${prompt}\n\n【激进变异】${transform}`;
  }

  #reversal(prompt, context) {
    const reversals = [
      '\n\n【反转变异】将故事结局完全反转：如果原计划是HE(大团圆)，改为BE(悲剧)或开放式结局；反之亦然。',
      '\n\n【反转变异】将主角和反派的立场对调——让"好人"有黑暗面，"坏人"有合理动机。',
      '\n\n【反转变异】将时间线倒置：从结局开始，逐步揭示导致这个结局的原因。',
      '\n\n【反转变异】将核心情感反转：温暖变为冰冷，喜剧变为悲剧，平静变为混乱。',
      '\n\n【反转变异】将视角反转：从"被观察者"的角度讲述原本由"观察者"叙述的故事。',
    ];
    return prompt + reversals[Math.floor(Math.random() * reversals.length)];
  }

  #micro(prompt, context) {
    const injection = HOTSPOT_INJECTIONS[Math.floor(Math.random() * HOTSPOT_INJECTIONS.length)];
    const microVariations = [
      `\n\n【微创新】${injection}，但不要改变故事的核心走向。`,
      `\n\n【微创新】在现有基础上加入一个精妙的细节/隐喻，让作品更有层次感。${injection}。`,
      `\n\n【微创新】保持整体不变，但在某个关键场景加入出人意料的反转细节。`,
      `\n\n【微创新】${injection}，通过一个小物件或小事件串联整个叙事。`,
    ];
    return prompt + microVariations[Math.floor(Math.random() * microVariations.length)];
  }

  #archetype(prompt, context) {
    const template = ARCHETYPE_TEMPLATES[Math.floor(Math.random() * ARCHETYPE_TEMPLATES.length)];
    return `${prompt}\n\n【结构模板】请按照以下经典叙事结构重新组织：${template}\n注意：不要机械套用，而是将结构精神融入你的创意中。`;
  }
}
