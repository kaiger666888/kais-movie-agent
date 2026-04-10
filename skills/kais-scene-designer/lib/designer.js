/**
 * kais-scene-designer/lib/designer.js
 * 场景设计引擎 — ES Module（含线稿控制管线）
 *
 * 支持两种模式：
 * 1. 线稿管线模式（默认）：线稿生成 → 线稿审核 → 基于线稿渲染 → 渲染审核
 * 2. 快速模式（noSketch）：直接文生图 → 通用审核
 */

import { execSync, exec } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIB_ROOT = path.resolve(__dirname, '../../..');
const SCRIPTS_DIR = path.join(LIB_ROOT, 'lib/scripts');

// ── 线稿管线模式（默认） ──

/**
 * 生成线稿
 * @param {string} prompt - 场景描述
 * @param {string} spaceConstraints - S.P.A.C.E 空间约束
 * @param {string[]} refImages - 角色参考图路径
 * @param {object} options - { ratio, sampleStrength, model, output, depth }
 * @param {string} [options.depth] - 前后景层次，格式 "foreground=...;midground=...;background=..."
 * @returns {string} 线稿图片路径
 */
export async function generateSketch(prompt, spaceConstraints, refImages = [], options = {}) {
  const {
    ratio = '9:16',
    sampleStrength = 0.35,
    model = 'jimeng-5.0',
    output = `assets/sketches/sketch-${Date.now()}.png`,
    retry = 2,
    depth = '',
  } = options;

  const args = [
    `python3 ${SCRIPTS_DIR}/sketch-generator.py`,
    `--prompt "${escapeShell(prompt)}"`,
    `--space "${escapeShell(spaceConstraints)}"`,
    ...(depth ? [`--depth "${escapeShell(depth)}"`] : []),
    ...refImages.flatMap(r => [`--ref`, r]),
    `--output ${output}`,
    `--sample-strength ${sampleStrength}`,
    `--model ${model}`,
    `--ratio ${ratio}`,
    `--retry ${retry}`,
  ].join(' ');

  return execAsync(args);
}

/**
 * 线稿审核
 * @param {string} specPath - spec.json 路径
 * @param {string} sketchDir - 线稿图片目录
 * @returns {object} { pass: string[], fail: object[], error: string[] }
 */
export async function evaluateSketch(specPath, sketchDir) {
  const args = `python3 ${SCRIPTS_DIR}/scene-evaluator.py --mode sketch "${specPath}" "${sketchDir}"`;
  const result = await execAsync(args);
  // 读取 eval-result.json
  const { default: fs } = await import('fs');
  const resultPath = path.join(sketchDir, 'eval-result.json');
  if (fs.existsSync(resultPath)) {
    return JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
  }
  return { pass: [], fail: [], error: [], raw: result };
}

/**
 * 基于线稿渲染
 * @param {string} sketchPath - 线稿图片路径
 * @param {string} prompt - 场景描述 + 风格
 * @param {string[]} refImages - 角色参考图路径
 * @param {object} options - { style, ratio, sampleStrength, model, output }
 * @returns {string} 渲染图路径
 */
export async function renderFromSketch(sketchPath, prompt, refImages = [], options = {}) {
  const {
    style = '',
    ratio = '9:16',
    sampleStrength = 0.25,
    model = 'jimeng-5.0',
    output = `assets/scenes/render-${Date.now()}.png`,
    retry = 1,
  } = options;

  const args = [
    `python3 ${SCRIPTS_DIR}/sketch-to-render.py`,
    `--sketch "${sketchPath}"`,
    `--prompt "${escapeShell(prompt)}"`,
    ...refImages.flatMap(r => [`--ref`, r]),
    `--output ${output}`,
    `--sample-strength ${sampleStrength}`,
    `--model ${model}`,
    `--ratio ${ratio}`,
    `--retry ${retry}`,
  ];

  if (style) args.push(`--style "${escapeShell(style)}"`);

  return execAsync(args.join(' '));
}

/**
 * 渲染审核
 * @param {string} specPath - spec.json 路径
 * @param {string} renderDir - 渲染图目录
 * @returns {object} { pass: string[], fail: object[], error: string[] }
 */
export async function evaluateRender(specPath, renderDir) {
  const args = `python3 ${SCRIPTS_DIR}/scene-evaluator.py --mode render "${specPath}" "${renderDir}"`;
  const result = await execAsync(args);
  const { default: fs } = await import('fs');
  const resultPath = path.join(renderDir, 'eval-result.json');
  if (fs.existsSync(resultPath)) {
    return JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
  }
  return { pass: [], fail: [], error: [], raw: result };
}

/**
 * 完整线稿管线：线稿 → 审核 → 渲染 → 审核
 * @param {object} shot - 镜头信息 { shotId, prompt, spaceConstraints, stylePrompt, refImages, ... }
 * @param {object} options - 管线选项
 * @returns {object} { sketchPath, renderPath, evalResults }
 */
export async function runLineartPipeline(shot, options = {}) {
  const {
    maxSketchRetries = 2,
    maxRenderRetries = 1,
    ratio = '9:16',
    outputDir = 'assets',
  } = options;

  const sketchPath = path.join(outputDir, 'sketches', `${shot.shotId}.png`);
  const renderPath = path.join(outputDir, 'scenes', `${shot.shotId}.png`);

  // 从 shot.constraints 提取 depth 信息
  const depth = extractDepth(shot.constraints || shot.spaceConstraints || '');

  // Phase 1: 生成线稿
  let sketchOk = false;
  let sketchAttempts = 0;

  while (!sketchOk && sketchAttempts <= maxSketchRetries) {
    await generateSketch(shot.prompt, shot.spaceConstraints || '', shot.refImages || [], {
      output: sketchPath,
      ratio,
      depth,
    });
    sketchAttempts++;

    // Phase 2: 线稿审核
    const spec = buildSpec([{ id: shot.shotId, description: shot.prompt, constraints: shot.constraints || [] }]);
    const sketchResult = await evaluateSketch(spec, path.dirname(sketchPath));

    if (sketchResult.fail?.length === 0) {
      sketchOk = true;
    }
  }

  if (!sketchOk) {
    console.warn(`[lineart-pipeline] 线稿审核未通过 (${shot.shotId})，使用最后一次结果`);
  }

  // Phase 3: 基于线稿渲染
  let renderOk = false;
  let renderAttempts = 0;
  let sampleStrength = 0.25;

  while (!renderOk && renderAttempts <= maxRenderRetries) {
    await renderFromSketch(sketchPath, shot.prompt, shot.refImages || [], {
      style: shot.stylePrompt || '',
      output: renderPath,
      ratio,
      sampleStrength,
    });
    renderAttempts++;

    // Phase 4: 渲染审核
    const spec = buildSpec([{ id: shot.shotId, description: shot.prompt, constraints: shot.renderConstraints || [] }]);
    const renderResult = await evaluateRender(spec, path.dirname(renderPath));

    if (renderResult.fail?.length === 0) {
      renderOk = true;
    } else {
      sampleStrength -= 0.1; // 降级
    }
  }

  return { sketchPath, renderPath, sketchAttempts, renderAttempts };
}

// ── 快速模式（--no-sketch） ──

/**
 * 直接文生图（跳过线稿）
 * @param {string} prompt - 场景描述
 * @param {string} refImage - 参考图路径
 * @param {object} options - { ratio, sampleStrength, model, output }
 * @returns {string} 图片路径
 */
export async function generateDirect(prompt, refImage, options = {}) {
  // 直接使用即梦 API
  const { JimengClient } = await import(path.join(LIB_ROOT, 'lib/jimeng-client.js'));
  const jimeng = new JimengClient();
  const data = await jimeng.generateImage(prompt, {
    ratio: options.ratio || '9:16',
    images: refImage ? [refImage] : undefined,
    sample_strength: options.sampleStrength || 0.35,
  });
  return data?.[0]?.url || null;
}

// ── 原有功能（保留） ──

export async function generateVariants(scene, artDirection, count = 3) {
  const variants = [];
  for (let i = 0; i < count; i++) {
    const design = buildSceneDesign(scene, artDirection, i);
    const { JimengClient } = await import(path.join(LIB_ROOT, 'lib/jimeng-client.js'));
    const jimeng = new JimengClient();
    const prompt = `电影场景概念图，${design.location}，${design.atmosphere}，${design.lighting}，电影级构图，高画质，4K`;
    const imageUrl = await jimeng.generateImage(prompt, { ratio: '16:9' });
    design.reference_image = imageUrl?.[0]?.url || null;
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
    pipeline: 'lineart',
    scene_id: `scene_${slugify(scene.location)}_v${index + 1}`,
    location: scene.location,
    zones,
    camera_positions: cameras,
    atmosphere: scene.mood || deriveAtmosphere(scene.tone),
    lighting: deriveLighting(artDirection, scene.mood),
  };
}

export function createCameraMap(sceneDesign) {
  const { camera_positions, zones } = sceneDesign;
  return {
    scene_id: sceneDesign.scene_id,
    cameras: camera_positions.map(cam => ({
      ...cam,
      zone_coverage: inferZoneCoverage(cam, zones),
    })),
    grid: generateGrid(zones, camera_positions),
  };
}

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

export function buildConsistencyPrompt(stylePrefix, scene, character, angle) {
  return `${stylePrefix}, ${scene}, ${character}, ${angle}`;
}

export function selectReferenceImage(shotType, referenceImages) {
  // 全景 → 3/4 全身, 中景 → 按朝向, 特写 → 正面肖像, 动作 → 最接近姿态
  const angleMap = {
    wide: ['3quarter-body', 'full-body', 'side-profile'],
    medium: ['3quarter-body', 'side-profile', 'front-portrait'],
    close_up: ['front-portrait', 'expression-calm', '3quarter-body'],
    action: ['action-typing', '3quarter-body', 'full-body'],
  };
  const preferred = angleMap[shotType] || angleMap.medium;
  for (const suffix of preferred) {
    const found = referenceImages.find(r => r.includes(suffix));
    if (found) return found;
  }
  return referenceImages[0] || null;
}

// ── 辅助函数 ──

/**
 * 从 constraints 中提取 DEPTH 字段值
 * 支持两种来源：
 * 1. constraints 数组中包含 "DEPTH:..." 的字符串
 * 2. spaceConstraints 字符串中包含 "DEPTH:..." 的部分
 * @param {string[]|string} constraints - 约束数组或空格约束字符串
 * @returns {string} depth 值（如 "foreground=...;midground=...;background=..."），无则返回空串
 */
function extractDepth(constraints) {
  if (Array.isArray(constraints)) {
    for (const c of constraints) {
      if (typeof c === 'string' && c.startsWith('DEPTH:')) {
        return c.slice(6).trim();
      }
    }
    return '';
  }
  if (typeof constraints === 'string') {
    const match = constraints.match(/DEPTH:\s*(.+)/i);
    return match ? match[1].trim() : '';
  }
  return '';
}

function buildSpec(shots) {
  const fs = require('fs');
  const os = require('os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-spec-'));
  const specPath = path.join(tmpDir, 'spec.json');
  fs.writeFileSync(specPath, JSON.stringify({ shots }, null, 2));
  return specPath;
}

function execAsync(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 180000 }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

function escapeShell(str) {
  return str.replace(/"/g, '\\"').replace(/'/g, "'\\''").replace(/\$/g, '\\$');
}

const ZONE_TEMPLATES = [
  ['work_area', 'storage_area', 'entrance', 'window_area'],
  ['central_stage', 'audience_area', 'backstage', 'exit_path'],
  ['living_area', 'kitchen_zone', 'study_corner', 'balcony'],
  ['command_center', 'rest_area', 'equipment_room', 'corridor'],
];

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

function generateCameraPositions(zones, location, seed) {
  const rng = seededRandom(seed);
  const cameras = [
    { name: 'wide_establishing', x: 0, y: 3, z: -6, look_at: zones[0], lens: '24mm' },
    { name: 'medium_narrative', x: rng() * 4 - 2, y: 1.6, z: -3, look_at: zones[1] || zones[0], lens: '50mm' },
    { name: 'close_emotional', x: rng() * 2 - 1, y: 1.6, z: -1.5, look_at: zones[0], lens: '85mm' },
  ];
  if (zones.length > 3) {
    cameras.push({ name: 'high_angle_overview', x: 0, y: 5, z: -2, look_at: zones[Math.floor(zones.length / 2)], lens: '35mm' });
  }
  return cameras;
}

function deriveAtmosphere(tone) {
  const map = { dark: '阴郁压抑，低饱和度，冷色调主导', hopeful: '温暖明亮，柔和光线，暖色调', tense: '高对比度，不均匀光线，色彩偏冷', romantic: '柔和散光，暖色晕染，朦胧质感', epic: '宏大壮阔，强光高对比，色彩浓郁' };
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
  const map = { tension: '光源收紧，阴影加深', release: '光源扩散，阴影柔化', climax: '强光/全暗交替，高对比', calm: '均匀柔光，低对比', joy: '暖光增强，溢光效果', despair: '光源减弱，冷色主导' };
  return map[arc] || '维持当前光线';
}

function colorForEmotion(arc) {
  const map = { tension: '偏冷，饱和度降低', release: '回归自然，暖色渐入', climax: '高饱和，互补色对比', calm: '低饱和，单色调', joy: '暖色提升，金色点缀', despair: '去饱和，蓝灰主导' };
  return map[arc] || '无变化';
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
}

function seededRandom(seed) {
  let s = seed * 9301 + 49297;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}
