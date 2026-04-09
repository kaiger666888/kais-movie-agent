/**
 * kais-art-direction — 艺术指导风格引擎
 * ES Module
 *
 * 负责：风格生成、锁定、下游适配、一致性校验
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ─── 内置风格库 ───────────────────────────────────────────────

const STYLE_LIBRARY = {
  'film_analog': {
    name: '电影胶片感',
    name_en: 'Film Analog',
    color_palette: ['#d4a574', '#3d2b1f', '#6b8cae', '#f5f0e8', '#8b3a3a'],
    light_quality: '柔和漫射光，钨丝灯温暖感，轻微镜头眩光，胶片颗粒纹理',
    texture: '胶片颗粒感，有机材质，自然磨损',
    composition_rules: ['经典黄金分割', '浅景深虚化', '水平线稳定构图'],
    genre_affinity: ['drama', 'romance', 'documentary'],
    tone_affinity: ['nostalgic', 'warm', 'melancholic'],
    era_default: '1990s',
  },
  'cyberpunk': {
    name: '赛博朋克',
    name_en: 'Cyberpunk',
    color_palette: ['#0a1628', '#ff2d7b', '#00ff88', '#2d1b4e', '#8c9ead'],
    light_quality: '高对比度霓虹灯光，湿润路面反射，全息投影发光',
    texture: '金属锈蚀，玻璃反射，全息投影透明感，碳纤维',
    composition_rules: ['引导线透视', '前景框架遮挡', '垂直线条强调'],
    genre_affinity: ['sci-fi', 'thriller', 'action'],
    tone_affinity: ['dark', 'intense', 'gritty'],
    era_default: '2077',
  },
  'japanese_clean': {
    name: '日系清新',
    name_en: 'Japanese Clean',
    color_palette: ['#fafafa', '#f8d7da', '#d4edda', '#cce5ff', '#f0e6d3'],
    light_quality: '自然漫射光，柔和逆光，窗户透光',
    texture: '柔焦，通透空气感，轻纱飘动',
    composition_rules: ['大量留白', '低角度仰拍', '中心聚焦'],
    genre_affinity: ['romance', 'slice_of_life', 'comedy'],
    tone_affinity: ['light', 'warm', 'hopeful'],
    era_default: 'contemporary',
  },
  'dark_gothic': {
    name: '暗黑哥特',
    name_en: 'Dark Gothic',
    color_palette: ['#0d0d0d', '#5c1a1a', '#8b7d3c', '#4a4a5a', '#f0ead6'],
    light_quality: '戏剧性明暗对比，烛光摇曳，月光冷调，体积光',
    texture: '石材纹理，蕾丝细节，金属雕花，天鹅绒',
    composition_rules: ['对称构图', '垂直线条强调', '低角度仰望'],
    genre_affinity: ['horror', 'fantasy', 'mystery'],
    tone_affinity: ['dark', 'mysterious', 'somber'],
    era_default: 'medieval',
  },
  'documentary_realism': {
    name: '纪录片写实',
    name_en: 'Documentary Realism',
    color_palette: ['#5a6b5a', '#c4a35a', '#7a8a9a', '#8b8378', '#d4cfc4'],
    light_quality: '自然光源，手持拍摄光感，环境光为主',
    texture: '真实材质无修饰，皮肤毛孔，衣物纹理',
    composition_rules: ['手持构图略倾斜', '抓拍感', '不规则裁切'],
    genre_affinity: ['documentary', 'drama', 'war'],
    tone_affinity: ['realistic', 'gritty', 'neutral'],
    era_default: 'contemporary',
  },
  'dreamy_surreal': {
    name: '梦幻超现实',
    name_en: 'Dreamy Surreal',
    color_palette: ['#7b2d8e', '#00d4ff', '#ffd700', '#ff6b9d', '#e8e0f0'],
    light_quality: '柔和发光，光晕效果，棱镜折射，星光闪烁',
    texture: '流体材质，水晶透明感，星尘粒子，云雾缭绕',
    composition_rules: ['中心对称', '漂浮感', '尺寸对比'],
    genre_affinity: ['fantasy', 'surreal', 'experimental'],
    tone_affinity: ['dreamy', 'mystical', 'ethereal'],
    era_default: 'dreamscape',
  },
};

// ─── 风格匹配评分 ─────────────────────────────────────────────

function scoreStyle(style, storyDNA) {
  let score = 0;
  const { genre, tone, theme, era, mood_keywords = [] } = storyDNA;

  // Genre affinity
  if (genre && style.genre_affinity.includes(genre)) score += 30;

  // Tone affinity
  if (tone && style.tone_affinity.some(t => tone.includes(t))) score += 25;

  // Era match
  if (era && style.era_default && era.includes(style.era_default)) score += 20;

  // Mood keywords fuzzy match
  const styleKeywords = [
    style.name, style.name_en,
    ...style.color_palette.map(() => ''),
    style.light_quality, style.texture,
  ].join(' ').toLowerCase();
  for (const kw of mood_keywords) {
    if (styleKeywords.includes(kw.toLowerCase())) score += 5;
  }

  return Math.min(score, 100);
}

// ─── 核心函数 ─────────────────────────────────────────────────

// ─── 即梦 API ─────────────────────────────────────────────────

import { JimengClient } from '../../../lib/jimeng-client.js';

const jimeng = new JimengClient();

async function generateImage(prompt, ratio = '16:9') {
  try {
    const data = await jimeng.generateImage(prompt, { ratio });
    return data?.[0]?.url || null;
  } catch (e) {
    console.error('[kais-art-direction] 即梦 API 失败:', e.message);
    return null;
  }
}

/**
 * 生成风格选项（含参考图生成）
 * @param {object} storyDNA - { genre, tone, theme, era, mood_keywords }
 * @param {number} count - 生成数量（默认3）
 * @returns {Promise<Array>} ArtDirection 对象数组
 */
export async function generateStyleOptions(storyDNA, count = 3) {
  const scored = Object.entries(STYLE_LIBRARY).map(([id, style]) => ({
    id,
    style,
    score: scoreStyle(style, storyDNA),
  }));

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, count);

  const results = await Promise.all(top.map(async ({ id, style }) => {
    // 为每个风格生成参考图
    const refPrompt = `电影风格参考图，${style.name}风格，${style.light_quality}，${style.texture}，展示典型场景氛围，电影级构图，高画质`;
    const refUrl = await generateImage(refPrompt);
    return {
      type: 'ArtDirection',
      version: '3.0',
      style_id: id,
      style_name: style.name,
      color_palette: style.color_palette,
      light_quality: style.light_quality,
      texture: style.texture,
      composition_rules: style.composition_rules,
      reference_images: refUrl ? [refUrl] : [],
      match_score: top[0].style.id === id ? 'recommended' : 'alternative',
    };
  }));

  return results;
}

/**
 * 锁定风格
 * @param {object} artDirection - 选中的 ArtDirection 对象
 * @param {string} workspace - 工作目录路径（默认当前）
 * @returns {string} 锁文件路径
 */
export function lockStyle(artDirection, workspace = process.cwd()) {
  const lockPath = join(workspace, '.art-direction-lock.json');
  const lockData = {
    ...artDirection,
    locked_at: new Date().toISOString(),
  };
  writeFileSync(lockPath, JSON.stringify(lockData, null, 2), 'utf-8');
  return lockPath;
}

/**
 * 读取已锁定的风格
 * @param {string} workspace
 * @returns {object|null}
 */
export function getLockedStyle(workspace = process.cwd()) {
  const lockPath = join(workspace, '.art-direction-lock.json');
  if (!existsSync(lockPath)) return null;
  return JSON.parse(readFileSync(lockPath, 'utf-8'));
}

/**
 * 获取指定 Skill 维度的风格指南
 * @param {string} skillType - 'character', 'scene', 'storyboard', 'generation'
 * @param {string} workspace
 * @returns {object} 该 Skill 应遵守的风格约束
 */
export function getStyleGuideForSkill(skillType, workspace = process.cwd()) {
  const locked = getLockedStyle(workspace);
  if (!locked) return null;

  const guides = {
    character: {
      color_palette: locked.color_palette,
      texture: locked.texture,
      light_quality: locked.light_quality,
      notes: `角色配色须在 ${locked.style_name} 色彩体系内，服装质感遵循「${locked.texture}」`,
    },
    scene: {
      color_palette: locked.color_palette,
      light_quality: locked.light_quality,
      texture: locked.texture,
      composition_rules: locked.composition_rules,
      notes: `场景整体氛围须匹配「${locked.style_name}」，光效遵循「${locked.light_quality}」`,
    },
    storyboard: {
      color_palette: locked.color_palette,
      composition_rules: locked.composition_rules,
      light_quality: locked.light_quality,
      notes: `分镜构图遵循「${locked.composition_rules.join('、')}」，保持风格统一`,
    },
    generation: {
      color_palette: locked.color_palette,
      light_quality: locked.light_quality,
      texture: locked.texture,
      composition_rules: locked.composition_rules,
      style_name: locked.style_name,
      notes: `文生图/视频 prompt 须包含风格关键词，确保与「${locked.style_name}」一致`,
    },
  };

  return guides[skillType] || guides.generation;
}

/**
 * 校验产出与锁定风格的一致性
 * @param {object} artifact - 待校验的产出（须包含 color_palette 或 style_name）
 * @param {string} workspace
 * @returns {{ consistent: boolean, score: number, issues: string[] }}
 */
export function validateConsistency(artifact, workspace = process.cwd()) {
  const locked = getLockedStyle(workspace);
  if (!locked) {
    return { consistent: true, score: 100, issues: ['未锁定风格，跳过校验'] };
  }

  const issues = [];
  let score = 100;

  // 检查色彩重叠度
  if (artifact.color_palette && artifact.color_palette.length > 0) {
    const overlap = artifact.color_palette.filter(c =>
      locked.color_palette.some(lc => colorDistance(c, lc) < 80)
    ).length;
    const overlapRatio = overlap / artifact.color_palette.length;
    if (overlapRatio < 0.4) {
      issues.push(`色彩偏离：仅 ${Math.round(overlapRatio * 100)}% 与锁定风格匹配`);
      score -= 40;
    } else if (overlapRatio < 0.7) {
      issues.push(`色彩部分偏离：${Math.round(overlapRatio * 100)}% 匹配`);
      score -= 15;
    }
  }

  // 检查风格名引用
  if (artifact.style_name && artifact.style_name !== locked.style_name) {
    issues.push(`风格名称不匹配：产出「${artifact.style_name}」vs 锁定「${locked.style_name}」`);
    score -= 30;
  }

  return {
    consistent: score >= 70,
    score: Math.max(0, score),
    issues: issues.length > 0 ? issues : ['风格一致'],
  };
}

// ─── 工具函数 ─────────────────────────────────────────────────

/**
 * 两个 hex 颜色的欧氏距离（0-441）
 */
function colorDistance(hex1, hex2) {
  const c1 = hexToRgb(hex1);
  const c2 = hexToRgb(hex2);
  if (!c1 || !c2) return 999;
  return Math.sqrt(
    (c1.r - c2.r) ** 2 +
    (c1.g - c2.g) ** 2 +
    (c1.b - c2.b) ** 2
  );
}

function hexToRgb(hex) {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}
