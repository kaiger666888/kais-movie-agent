/**
 * ProductionModes — 生产模式注册表 + 固定规则注入器
 *
 * 支持时间轴控场法等生产方法论的可切换模式系统。
 * 模式通过 requirement.production_mode 配置，空字符串 = 默认行为。
 */

const PRODUCTION_MODES = {
  'timeline-control': {
    fixed_rules: {
      subtitle: 'disabled',
      bgm: 'none',
      sfx: 'enhanced',
    },
    asset_order: ['character-assets', 'prop-assets', 'scene-assets'],
    storyboard_format: 'timeline-shot-by-shot',
    shot_type_map: {
      '全景': 'extreme_wide',
      '远景': 'wide',
      '中景': 'medium',
      '近景': 'medium_close_up',
      '特写': 'close_up',
      '大特写': 'extreme_close_up',
    },
    movement_map: {
      '推轨': 'push_in',
      '俯拍': 'crane_up',
      '仰拍': 'static',
      '跟拍': 'orbit_cw',
      '固定': 'static',
      '左摇': 'pan_left',
      '右摇': 'pan_right',
    },
    angle_map: {
      '俯拍': 'high_angle',
      '仰拍': 'low_angle',
      '平视': 'eye_level',
      '倾斜': 'dutch_tilt',
    },
    constraints: { no_copyright_ip: true, content_safety: true },
    performance_format: true,
  },
};

/**
 * 解析生产模式名称，返回配置或 null（= 默认行为）
 * @param {string} modeName
 * @returns {object|null}
 */
export function resolveMode(modeName) {
  if (!modeName) return null;
  return PRODUCTION_MODES[modeName] || null;
}

/**
 * 将固定规则强制覆盖到 art-bible 中。
 * 固定规则不可被用户配置覆盖。
 * @param {object} artBible - 当前 art-bible 数据
 * @param {object} mode - resolveMode() 返回的模式配置
 * @returns {object} 覆盖后的 art-bible
 */
export function applyFixedRules(artBible, mode) {
  if (!mode?.fixed_rules) return artBible;
  const locked = { ...artBible };

  if (mode.fixed_rules.bgm === 'none') {
    locked.bgm_strategy = 'none';
  }
  if (mode.fixed_rules.sfx === 'enhanced') {
    locked.sfx_mode = 'enhanced';
  }
  if (mode.fixed_rules.subtitle === 'disabled') {
    locked.subtitle_mode = 'disabled';
  }

  return locked;
}

/**
 * IP 三视图提示词生成
 * @param {string} name - 角色/道具名称
 * @param {'character'|'prop'} type
 * @returns {string}
 */
export function buildIPTripleViewPrompt(name, type) {
  if (type === 'prop') {
    return `为下面道具设计IP三视图，并标注和展示道具细节特写，左上角标题'${name}道具IP设计图'，大师级排版，浅灰色纯色背景。`;
  }
  return `为下面角色设计IP三视图，并标注和展示服饰细节特写，左上角标题'${name}角色IP设计图'，大师级排版，浅灰色纯色背景。`;
}

export default { PRODUCTION_MODES, resolveMode, applyFixedRules, buildIPTripleViewPrompt };
