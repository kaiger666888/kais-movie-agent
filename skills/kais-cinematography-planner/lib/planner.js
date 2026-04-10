/**
 * kais-cinematography-planner — 场景类型→拍摄手法批量映射
 * ES Module
 */

// ─── Coverage Library（手法库）──────────────────────────────

export const SCENE_TYPES = {
  indoor_dialogue: {
    label: '室内对话',
    shootingStyle: 'shot_reverse_shot',
    consistencyProtocol: 'high',
    costLevel: 'high',
    defaultCamera: [
      { angle: '过肩', side: 'left', description: '角色A视角' },
      { angle: '过肩', side: 'right', description: '角色B视角' },
      { angle: '中景', side: 'center', description: '双人全景' },
    ],
    durationHint: '长（多镜头覆盖）',
  },
  outdoor_chase: {
    label: '室外追逐',
    shootingStyle: 'handheld_cut',
    consistencyProtocol: 'low',
    costLevel: 'low',
    defaultCamera: [
      { angle: '手持', side: 'dynamic', description: '跟拍' },
      { angle: '特写', side: 'dynamic', description: '脚步/表情' },
    ],
    durationHint: '中（快速剪辑）',
  },
  emotional_monologue: {
    label: '情感独白',
    shootingStyle: 'closeup_shallow',
    consistencyProtocol: 'medium',
    costLevel: 'medium',
    defaultCamera: [
      { angle: '特写', side: 'front', description: '面部特写' },
      { angle: '中景', side: 'side', description: '环境衬托' },
    ],
    durationHint: '中（缓慢节奏）',
  },
  action_sequence: {
    label: '动作场面',
    shootingStyle: 'action_sequence',
    consistencyProtocol: 'medium',
    costLevel: 'high',
    defaultCamera: [
      { angle: '全景', side: 'wide', description: '建立空间' },
      { angle: '中景', side: 'dynamic', description: '动作主体' },
      { angle: '特写', side: 'dynamic', description: '关键瞬间' },
    ],
    durationHint: '长（多角度覆盖）',
  },
  establishing: {
    label: '场景建立',
    shootingStyle: 'establishing_pan',
    consistencyProtocol: 'low',
    costLevel: 'medium',
    defaultCamera: [
      { angle: '全景', side: 'wide', description: '横摇建立环境' },
    ],
    durationHint: '短（3-5秒）',
  },
  intimate_moment: {
    label: '亲密时刻',
    shootingStyle: 'intimate_push',
    consistencyProtocol: 'high',
    costLevel: 'medium',
    defaultCamera: [
      { angle: '中景', side: 'front', description: '双人画面' },
      { angle: '特写', side: 'alternating', description: '表情交替' },
    ],
    durationHint: '中（缓慢节奏）',
  },
  tension_build: {
    label: '紧张氛围',
    shootingStyle: 'tension_crosscut',
    consistencyProtocol: 'low',
    costLevel: 'medium',
    defaultCamera: [
      { angle: '手持特写', side: 'alternating', description: '交叉剪辑' },
    ],
    durationHint: '中（加速节奏）',
  },
  revelation: {
    label: '揭示/转折',
    shootingStyle: 'pull_back_reveal',
    consistencyProtocol: 'medium',
    costLevel: 'medium',
    defaultCamera: [
      { angle: '特写', side: 'front', description: '聚焦细节' },
      { angle: '拉远', side: 'wide', description: '揭示全貌' },
    ],
    durationHint: '中（先紧后松）',
  },
  transition: {
    label: '场景转换',
    shootingStyle: 'match_cut',
    consistencyProtocol: 'low',
    costLevel: 'low',
    defaultCamera: [
      { angle: '匹配', side: 'any', description: '匹配剪辑' },
    ],
    durationHint: '短（1-2秒）',
  },
  montage: {
    label: '蒙太奇',
    shootingStyle: 'quick_montage',
    consistencyProtocol: 'low',
    costLevel: 'low',
    defaultCamera: [
      { angle: '混合', side: 'varied', description: '快速混剪' },
    ],
    durationHint: '短（每镜1-2秒）',
  },
};

const COST_ORDER = { low: 1, medium: 2, high: 3 };

// ─── 主函数 ───────────────────────────────────────────────

/**
 * 批量规划 Coverage Map
 * @param {Array} scenes - 场景列表，每个含 scene_id, scene_type?, location?, characters?, description?
 * @param {object} options - { maxConsecutiveHigh: 3, costThreshold: 'high' }
 * @returns {object} CoverageMap
 */
export function planCoverage(scenes, options = {}) {
  const { maxConsecutiveHigh = 3 } = options;

  const mapped = scenes.map((scene, idx) => {
    const sceneType = scene.scene_type || inferSceneType(scene);
    const typeDef = SCENE_TYPES[sceneType] || SCENE_TYPES.establishing;

    return {
      scene_id: scene.scene_id || `SC${String(idx + 1).padStart(2, '0')}`,
      scene_type: sceneType,
      scene_type_label: typeDef.label,
      location: scene.location || '',
      description: scene.description || '',
      character_refs: scene.characters || scene.character_refs || [],
      shooting_style: typeDef.shootingStyle,
      shooting_style_label: typeDef.label,
      consistency_protocol: typeDef.consistencyProtocol,
      camera_positions: [...typeDef.defaultCamera],
      estimated_cost: typeDef.costLevel,
      duration_estimate: typeDef.durationHint,
      props_anchor: extractProps(scene.description || ''),
      lighting_note: inferLighting(scene.description || ''),
    };
  });

  const conflicts = detectConflicts(mapped, { maxConsecutiveHigh });
  const costEstimate = estimateOverallCost(mapped);

  return {
    type: 'CoverageMap',
    version: '1.0',
    total_scenes: mapped.length,
    total_estimated_cost: costEstimate,
    scenes: mapped,
    conflicts,
  };
}

// ─── 冲突检测 ─────────────────────────────────────────────

/**
 * 检测三类冲突
 */
export function detectConflicts(mappedScenes, options = {}) {
  const { maxConsecutiveHigh = 3 } = options;
  const conflicts = [];

  // 1. 一致性过载
  let consecutiveHigh = 0;
  let highStart = 0;
  for (let i = 0; i < mappedScenes.length; i++) {
    if (mappedScenes[i].consistency_protocol === 'high') {
      if (consecutiveHigh === 0) highStart = i;
      consecutiveHigh++;
      if (consecutiveHigh >= maxConsecutiveHigh) {
        const sceneIds = mappedScenes.slice(highStart, i + 1).map(s => s.scene_id);
        const alternatives = mappedScenes[highStart].shooting_style !== 'shot_reverse_shot'
          ? '建议改为双人全景'
          : `建议 ${mappedScenes[highStart + 1].scene_id} 改为双人全景，降低40%算力消耗`;
        conflicts.push({
          type: 'consistency_overload',
          severity: 'warning',
          scenes: sceneIds,
          detail: `连续${consecutiveHigh}个高一致性协议场景（${mappedScenes.slice(highStart, i + 1).map(s => s.shooting_style_label).join('、')}）`,
          suggestion: alternatives,
        });
      }
    } else {
      consecutiveHigh = 0;
    }
  }

  // 2. 180度线冲突（同空间机位方向不一致）
  const locationGroups = {};
  for (const scene of mappedScenes) {
    const loc = scene.location;
    if (!loc) continue;
    if (!locationGroups[loc]) locationGroups[loc] = [];
    locationGroups[loc].push(scene);
  }
  for (const [location, scenes] of Object.entries(locationGroups)) {
    if (scenes.length < 2) continue;
    const sides = scenes.map(s => s.camera_positions[0]?.side).filter(Boolean);
    const hasLeft = sides.includes('left');
    const hasRight = sides.includes('right');
    if (hasLeft && hasRight) {
      const leftScene = scenes.find(s => s.camera_positions[0]?.side === 'left');
      const rightScene = scenes.find(s => s.camera_positions[0]?.side === 'right');
      conflicts.push({
        type: 'axis_180',
        severity: 'error',
        scenes: [leftScene.scene_id, rightScene.scene_id],
        location,
        detail: `同空间"${location}"中 ${leftScene.scene_id} 机位在左，${rightScene.scene_id} 机位在右，可能越轴`,
        suggestion: `为 ${rightScene.scene_id} 添加"越轴镜头"标签，或调整机位方向与 ${leftScene.scene_id} 一致`,
      });
    }
  }

  // 3. 道具连续性缺口（同空间道具标注不一致）
  const locationProps = {};
  for (const scene of mappedScenes) {
    const loc = scene.location;
    if (!loc || scene.props_anchor.length === 0) continue;
    if (!locationProps[loc]) locationProps[loc] = new Set();
    scene.props_anchor.forEach(p => locationProps[loc].add(p));
  }
  for (const [location, allProps] of Object.entries(locationProps)) {
    const scenesInLoc = mappedScenes.filter(s => s.location === location);
    for (const prop of allProps) {
      const scenesWithProp = scenesInLoc.filter(s => s.props_anchor.includes(prop));
      const scenesWithoutProp = scenesInLoc.filter(s => !s.props_anchor.includes(prop));
      if (scenesWithoutProp.length > 0 && scenesWithProp.length > 0 && scenesWithProp.length < scenesInLoc.length) {
        conflicts.push({
          type: 'prop_continuity',
          severity: 'info',
          scenes: scenesWithoutProp.map(s => s.scene_id),
          location,
          prop,
          detail: `"${prop}"在 ${location} 的 ${scenesWithProp.map(s => s.scene_id).join(',')} 出现，但 ${scenesWithoutProp.map(s => s.scene_id).join(',')} 未标注`,
          suggestion: `是否为所有含"${location}"标签的场景添加该道具锚点？`,
        });
      }
    }
  }

  return conflicts;
}

// ─── 成本估算 ─────────────────────────────────────────────

export function estimateOverallCost(mappedScenes) {
  const costs = mappedScenes.map(s => COST_ORDER[s.estimated_cost] || 2);
  const avg = costs.reduce((a, b) => a + b, 0) / costs.length;
  if (avg <= 1.3) return '低';
  if (avg <= 2.3) return '中';
  return '高';
}

// ─── 人工修正 ─────────────────────────────────────────────

/**
 * 应用人工修正（覆盖默认映射）
 * @param {object} coverageMap - 原始 Coverage Map
 * @param {object} overrides - { SC01: { shooting_style: 'establishing_pan' }, ... }
 * @returns {object} 修正后的 Coverage Map
 */
export function applyOverrides(coverageMap, overrides) {
  const scenes = coverageMap.scenes.map(scene => {
    const override = overrides[scene.scene_id];
    if (!override) return scene;

    const updated = { ...scene };
    if (override.shooting_style) {
      const typeDef = Object.values(SCENE_TYPES).find(t => t.shootingStyle === override.shooting_style);
      if (typeDef) {
        updated.shooting_style = typeDef.shootingStyle;
        updated.shooting_style_label = typeDef.label;
        updated.consistency_protocol = typeDef.consistencyProtocol;
        updated.estimated_cost = typeDef.costLevel;
        updated.camera_positions = [...typeDef.defaultCamera];
        updated.duration_estimate = typeDef.durationHint;
      }
    }
    if (override.consistency_protocol) updated.consistency_protocol = override.consistency_protocol;
    if (override.camera_positions) updated.camera_positions = override.camera_positions;
    return updated;
  });

  return {
    ...coverageMap,
    scenes,
    conflicts: detectConflicts(scenes),
    total_estimated_cost: estimateOverallCost(scenes),
  };
}

// ─── 场景类型推断 ─────────────────────────────────────────

function inferSceneType(scene) {
  const desc = (scene.description || '').toLowerCase();
  const loc = (scene.location || '').toLowerCase();

  // 关键词匹配
  const keywords = {
    outdoor_chase: ['追逐', '跑', '逃跑', '追', ' chase', 'run'],
    action_sequence: ['打', '战斗', '格斗', '爆炸', ' fight', 'battle', 'explosion'],
    emotional_monologue: ['独白', '自言自语', '回忆', ' monologue', 'alone'],
    intimate_moment: ['拥抱', '亲吻', '牵手', ' hug', 'kiss', 'embrace'],
    tension_build: ['紧张', '恐惧', '威胁', '暗处', ' tension', 'fear'],
    revelation: ['揭示', '发现', '转折', '真相', ' reveal', 'discover'],
    montage: ['蒙太奇', '混剪', ' montage', 'time pass'],
    transition: ['转场', '过渡', ' transition', 'cut to'],
  };

  const text = `${desc} ${loc}`;
  for (const [type, words] of Object.entries(keywords)) {
    if (words.some(w => text.includes(w))) return type;
  }

  // 位置推断
  if (loc.includes('室内') || loc.includes('房间') || loc.includes('客厅') || loc.includes('办公室') || loc.includes('indoors')) {
    return 'indoor_dialogue';
  }
  if (loc.includes('室外') || loc.includes('街道') || loc.includes('公园') || loc.includes('outdoors')) {
    return 'establishing';
  }

  return 'establishing'; // 默认
}

// ─── 辅助函数 ─────────────────────────────────────────────

function extractProps(description) {
  // 简单的道具提取：从描述中找出加引号的名词
  const matches = description.match(/[「」""'']([^「」""'']+)/g) || [];
  return matches.map(m => m.replace(/^[「」""'']/, '').replace(/[「」""'']$/, ''));
}

function inferLighting(description) {
  const desc = description.toLowerCase();
  if (desc.includes('夜景') || desc.includes('夜晚') || desc.includes('dark')) return '夜间/暗光';
  if (desc.includes('阳光') || desc.includes('白天') || desc.includes('daylight')) return '自然日光';
  if (desc.includes('霓虹') || desc.includes('赛博') || desc.includes('neon')) return '霓虹灯光';
  if (desc.includes('日落') || desc.includes('黄昏') || desc.includes('sunset')) return '黄金时刻';
  return '标准室内光';
}
