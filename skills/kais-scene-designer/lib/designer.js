/**
 * kais-scene-designer/lib/designer.js
 * 场景设计引擎 — ES Module
 *
 * 生成 SceneDesign 变体、机位图、氛围时间线
 */

import { JimengClient } from '../../../lib/jimeng-client.js';

const jimeng = new JimengClient();

// ── 即梦 API 调用 ──
async function generateImage(prompt, ratio = '16:9') {
  try {
    const data = await jimeng.generateImage(prompt, { ratio });
    return data?.[0]?.url || null;
  } catch (e) {
    console.error('[kais-scene-designer] 即梦 API 失败:', e.message);
    return null;
  }
}

// ── 生成变体 ──
export async function generateVariants(scene, artDirection, count = 3) {
  const variants = [];
  for (let i = 0; i < count; i++) {
    const design = buildSceneDesign(scene, artDirection, i);
    // 为每个变体生成场景参考图
    const prompt = `电影场景概念图，${design.location}，${design.atmosphere}，${design.lighting}，电影级构图，高画质，4K`;
    const imageUrl = await generateImage(prompt);
    design.reference_image = imageUrl;
    variants.push(design);
  }
  return variants;
}

function buildSceneDesign(scene, artDirection, index) {
  const zones = ZONE_TEMPLATES[index % ZONE_TEMPLATES.length];
  const cameras = generateCameraPositions(zones, scene.location, index);

  return {
    type: 'SceneDesign',
    version: '3.0.0',
    scene_id: `scene_${slugify(scene.location)}_v${index + 1}`,
    location: scene.location,
    zones,
    camera_positions: cameras,
    atmosphere: scene.mood || deriveAtmosphere(scene.tone),
    lighting: deriveLighting(artDirection, scene.mood),
  };
}

// ── 机位图 ──
export function createCameraMap(sceneDesign) {
  const { camera_positions, zones } = sceneDesign;
  const map = {
    scene_id: sceneDesign.scene_id,
    cameras: camera_positions.map(cam => ({
      ...cam,
      zone_coverage: inferZoneCoverage(cam, zones),
    })),
    grid: generateGrid(zones, camera_positions),
  };
  return map;
}

function inferZoneCoverage(camera, zones) {
  const lookZone = zones.find(z => camera.look_at?.includes(z.replace(/_/g, ' ')));
  return lookZone ? [lookZone] : zones.slice(0, 2);
}

function generateGrid(zones, cameras) {
  const size = 10;
  const grid = Array.from({ length: size }, () => Array(size).fill('.'));
  zones.forEach((z, i) => {
    const row = Math.floor(size * (i + 1) / (zones.length + 1));
    const col = Math.floor(size / 2);
    if (row < size && col < size) grid[row][col] = 'Z';
  });
  cameras.forEach(cam => {
    const r = Math.min(size - 1, Math.max(0, Math.floor((cam.z || 0) + size / 2)));
    const c = Math.min(size - 1, Math.max(0, Math.floor((cam.x || 0) + size / 2)));
    grid[r][c] = 'C';
  });
  return grid.map(row => row.join(' '));
}

// ── 氛围时间线 ──
export function createAtmosphereTimeline(scene, storyBeats) {
  if (!storyBeats?.length) return [];

  return storyBeats.map((beat, i) => ({
    beat_id: beat.beat_id,
    sequence: beat.sequence,
    emotional_arc: beat.emotional_arc,
    atmosphere_shift: shiftForEmotion(beat.emotional_arc, i, storyBeats.length),
    lighting_change: lightingForEmotion(beat.emotional_arc),
    color_shift: colorForEmotion(beat.emotional_arc),
  }));
}

// ── 辅助函数 ──

function generateCameraPositions(zones, location, seed) {
  const rng = seededRandom(seed);
  const cameras = [
    {
      name: 'wide_establishing',
      x: 0, y: 3, z: -6,
      look_at: zones[0],
      lens: '24mm',
    },
    {
      name: 'medium_narrative',
      x: rng() * 4 - 2, y: 1.6, z: -3,
      look_at: zones[1] || zones[0],
      lens: '50mm',
    },
    {
      name: 'close_emotional',
      x: rng() * 2 - 1, y: 1.6, z: -1.5,
      look_at: zones[0],
      lens: '85mm',
    },
  ];

  if (zones.length > 3) {
    cameras.push({
      name: 'high_angle_overview',
      x: 0, y: 5, z: -2,
      look_at: zones[Math.floor(zones.length / 2)],
      lens: '35mm',
    });
  }

  return cameras;
}

function deriveAtmosphere(tone) {
  const map = {
    dark: '阴郁压抑，低饱和度，冷色调主导',
    hopeful: '温暖明亮，柔和光线，暖色调',
    tense: '高对比度，不均匀光线，色彩偏冷',
    romantic: '柔和散光，暖色晕染，朦胧质感',
    epic: '宏大壮阔，强光高对比，色彩浓郁',
  };
  return map[tone] || '自然写实，均衡光线';
}

function deriveLighting(artDirection, mood) {
  const base = artDirection?.light_quality || 'natural';
  return `${base}质感主光，配合场景氛围${mood ? `（${mood}）` : ''}，层次分明`;
}

function shiftForEmotion(arc, index, total) {
  if (!arc) return 'neutral';
  const intensity = Math.round(100 * (0.5 + 0.5 * Math.sin(Math.PI * index / Math.max(total - 1, 1))));
  return `${arc} — 强度 ${intensity}%`;
}

function lightingForEmotion(arc) {
  const map = {
    tension: '光源收紧，阴影加深',
    release: '光源扩散，阴影柔化',
    climax: '强光/全暗交替，高对比',
    calm: '均匀柔光，低对比',
    joy: '暖光增强，溢光效果',
    despair: '光源减弱，冷色主导',
  };
  return map[arc] || '维持当前光线';
}

function colorForEmotion(arc) {
  const map = {
    tension: '偏冷，饱和度降低',
    release: '回归自然，暖色渐入',
    climax: '高饱和，互补色对比',
    calm: '低饱和，单色调',
    joy: '暖色提升，金色点缀',
    despair: '去饱和，蓝灰主导',
  };
  return map[arc] || '无变化';
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
}

function seededRandom(seed) {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}
