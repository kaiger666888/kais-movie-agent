/**
 * kais-storyboard-designer — 分镜设计工具库
 * ES Module
 */

import { JimengClient } from '../../../lib/jimeng-client.js';

const jimeng = new JimengClient();

// ─── 即梦 API ─────────────────────────────────────────────────

async function generateImage(prompt, ratio = '16:9') {
  try {
    const data = await jimeng.generateImage(prompt, { ratio });
    return data?.[0]?.url || null;
  } catch (e) {
    console.error('[kais-storyboard-designer] 即梦 API 失败:', e.message);
    return null;
  }
}

// ─── Prompt Building ───────────────────────────────────────────────

/**
 * Build a storyboard reference image prompt
 */
export function buildPrompt(opts) {
  const {
    shotDescription,
    character = '',
    scene = '',
    cameraAngle = '中景',
    artStyle = '电影质感，低调光',
    emotion = '',
    timeOfDay = '',
    weather = '',
  } = opts;

  const parts = [
    '电影分镜参考图',
    cameraAngle,
  ];
  if (shotDescription) parts.push(shotDescription);
  if (character) parts.push(`角色：${character}`);
  if (scene) parts.push(`场景：${scene}`);
  if (timeOfDay) parts.push(`时间：${timeOfDay}`);
  if (weather) parts.push(weather);
  if (emotion) parts.push(`情绪：${emotion}`);
  parts.push(`风格：${artStyle}`);
  parts.push('高画质，电影级构图，专业灯光');

  return parts.join('。') + '。';
}

// ─── Script Parsing ────────────────────────────────────────────────

/**
 * Parse a scenario script into a list of shots
 * @param {object} script - { scenes: [{ scene_id, characters, actions, dialogue, emotion }] }
 * @returns {Array} shots without reference_image
 */
export function parseScriptToShots(script) {
  const shots = [];
  let shotIdx = 0;

  const scenes = script.scenes || script.beats || [];
  for (const scene of scenes) {
    const sceneId = scene.scene_id || `scene_${shotIdx}`;
    const chars = scene.characters || scene.character_refs || [];

    // Scene-establishing wide shot
    shots.push({
      shot_id: `shot_${shotIdx++}`,
      scene_ref: sceneId,
      character_refs: chars,
      camera: { angle: '全景', movement: '缓慢横摇', lens: '24mm' },
      action: scene.description || scene.action || `建立${scene.location || '场景'}环境`,
      duration: 3.0,
      end_frame: null,  // 延续锚点：由 generateShotReference 填充
    });

    // Parse actions/dialogue into medium shots and close-ups
    const actions = scene.actions || [];
    const dialogue = scene.dialogue || [];

    for (const act of actions) {
      const text = typeof act === 'string' ? act : act.text || act.description || '';
      if (!text) continue;
      const isEmotional = (act.emotion || '').match(/紧张|愤怒|悲伤|恐惧|惊喜|震撼/);
      shots.push({
        shot_id: `shot_${shotIdx++}`,
        scene_ref: sceneId,
        character_refs: act.characters || chars,
        camera: {
          angle: isEmotional ? '特写' : '中景',
          movement: isEmotional ? '缓慢推进' : '固定',
          lens: isEmotional ? '85mm' : '50mm',
        },
        action: text,
        duration: isEmotional ? 2.0 : 3.0,
        end_frame: null,  // 延续锚点：由 generateShotReference 填充
      });
    }

    for (const line of dialogue) {
      const speaker = typeof line === 'string' ? null : line.speaker;
      shots.push({
        shot_id: `shot_${shotIdx++}`,
        scene_ref: sceneId,
        character_refs: speaker ? [speaker] : chars,
        camera: { angle: '过肩', movement: '固定', lens: '50mm' },
        action: typeof line === 'string' ? line : `${line.speaker}说："${line.text}"`,
        duration: 2.5,
        end_frame: null,  // 延续锚点：由 generateShotReference 填充
      });
    }

    // Closing shot
    if (scene.closing || shots.length > 1) {
      shots.push({
        shot_id: `shot_${shotIdx++}`,
        scene_ref: sceneId,
        character_refs: chars,
        camera: { angle: '中景', movement: '缓慢拉远', lens: '35mm' },
        action: scene.closing || '场景结束',
        duration: 2.0,
        end_frame: null,  // 延续锚点：由 generateShotReference 填充
      });
    }
  }

  return shots;
}

// ─── Reference Generation ──────────────────────────────────────────

/**
 * 完整分镜板生成：解析剧本 + 为每个 shot 生成参考图和 end_frame
 * @param {object} script - 剧本对象
 * @param {object} characters - 角色设定 { charId: { description } }
 * @param {object} scenes - 场景设定 { sceneId: { description } }
 * @param {string} artStyle - 美术风格
 * @param {object} options
 * @param {boolean} options.withEndFrame - 是否生成 end_frame（默认 true）
 * @param {function} options.onShotProgress - 进度回调 (current, total, shotId)
 * @returns {Promise<object>} Storyboard
 */
export async function generateStoryboard(script, characters = {}, scenes = {}, artStyle = '电影质感，低调光', options = {}) {
  const shots = parseScriptToShots(script);
  const total = shots.length;

  for (let i = 0; i < total; i++) {
    const shot = shots[i];
    options.onShotProgress?.(i + 1, total, shot.shot_id);

    // 获取角色和场景描述
    const charDescs = shot.character_refs
      .map(c => characters[c]?.description || characters[c]?.name || c)
      .join('、');
    const sceneDesc = scenes[shot.scene_ref]?.description || scenes[shot.scene_ref]?.location || '';

    try {
      const refs = await generateShotReference(shot, charDescs, sceneDesc, artStyle, {
        withEndFrame: options.withEndFrame,
      });
      shot.reference_image = refs.reference_image;
      shot.end_frame = refs.end_frame;
    } catch (e) {
      console.warn(`[storyboarder] shot ${shot.shot_id} 参考图生成失败: ${e.message}`);
    }
  }

  const storyboard = {
    type: 'Storyboard',
    version: '2.0',
    shots,
  };

  return storyboard;
}

// ─── Reference Generation (single shot) ──────────────────────────────────────────

/**
 * Generate a shot reference image via 即梦 API
 * Also generates an end_frame (tail frame) for extension-chain continuity
 * @param {object} shot - shot 对象
 * @param {string} character - 角色描述
 * @param {string} scene - 场景描述
 * @param {string} artStyle - 美术风格
 * @param {object} options
 * @param {boolean} options.withEndFrame - 是否同时生成 end_frame（默认 true）
 * @returns {Promise<{reference_image: string|null, end_frame: string|null}>}
 */
export async function generateShotReference(shot, character, scene, artStyle, options = {}) {
  const { withEndFrame = true } = options;
  const cameraDesc = [shot.camera?.angle, shot.camera?.movement].filter(Boolean).join('，');
  const prompt = buildPrompt({
    shotDescription: shot.action,
    character,
    scene,
    cameraAngle: cameraDesc,
    artStyle,
    emotion: '',
  });
  const reference_image = await generateImage(prompt);

  // 生成 end_frame：描述该镜头的目标尾帧画面
  let end_frame = null;
  if (withEndFrame && reference_image) {
    // 尾帧 prompt：强调"最终画面"，通常是动作结束后的状态
    const endPrompt = buildPrompt({
      shotDescription: `${shot.action}（最终画面定格）`,
      character,
      scene,
      cameraAngle: cameraDesc,
      artStyle,
      emotion: '',
    });
    end_frame = await generateImage(endPrompt);
  }

  return { reference_image, end_frame };
}

// ─── Validation ────────────────────────────────────────────────────

const SHOT_ID_RE = /^shot_[a-z0-9_]+$/;

/**
 * Validate a storyboard object
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateStoryboard(sb) {
  const errors = [];
  const warnings = [];

  if (!sb.type || sb.type !== 'Storyboard') errors.push('Missing type=Storyboard');
  if (!sb.version) warnings.push('Missing version');
  if (!Array.isArray(sb.shots) || sb.shots.length === 0) errors.push('shots must be non-empty array');

  const sceneRefs = new Set();
  const charRefs = new Set();

  for (const shot of sb.shots || []) {
    if (!shot.shot_id) errors.push(`Shot missing shot_id`);
    else if (!SHOT_ID_RE.test(shot.shot_id)) warnings.push(`shot_id "${shot.shot_id}" doesn't match pattern`);
    if (!shot.scene_ref) errors.push(`Shot ${shot.shot_id}: missing scene_ref`);
    else sceneRefs.add(shot.scene_ref);
    if (!Array.isArray(shot.character_refs)) errors.push(`Shot ${shot.shot_id}: character_refs must be array`);
    else shot.character_refs.forEach(c => charRefs.add(c));
    if (!shot.camera?.angle) errors.push(`Shot ${shot.shot_id}: missing camera.angle`);
    if (!shot.action) errors.push(`Shot ${shot.shot_id}: missing action`);
    if (typeof shot.duration !== 'number' || shot.duration <= 0) errors.push(`Shot ${shot.shot_id}: invalid duration`);
    if (!shot.reference_image) warnings.push(`Shot ${shot.shot_id}: no reference_image`);
  }

  // Check continuity: character should appear in at least 2 shots
  const charCount = {};
  for (const shot of sb.shots || []) {
    for (const c of shot.character_refs || []) {
      charCount[c] = (charCount[c] || 0) + 1;
    }
  }
  for (const [c, n] of Object.entries(charCount)) {
    if (n === 1) warnings.push(`Character ${c} only appears in 1 shot — consider more coverage`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: { totalShots: (sb.shots || []).length, totalDuration: (sb.shots || []).reduce((s, sh) => s + (sh.duration || 0), 0) },
  };
}

// ─── Cost Estimation ───────────────────────────────────────────────

/**
 * Estimate production cost for a storyboard
 * @returns {{ imageGenCost: number, videoGenCost: number, totalCost: number, breakdown: object }}
 */
export function estimateProductionCost(sb) {
  const shots = sb.shots || [];
  const imageCostPerShot = 0.05;  // RMB per image
  const videoCostPerShot = 0.50;  // RMB per video (4s)
  const revisionFactor = 1.3;     // assume 30% revisions

  const totalImages = shots.length;
  const totalVideos = shots.length; // assume 1 video per shot

  const imageGenCost = totalImages * imageCostPerShot * revisionFactor;
  const videoGenCost = totalVideos * videoCostPerShot * revisionFactor;
  const totalDuration = shots.reduce((s, sh) => s + (sh.duration || 0), 0);

  return {
    imageGenCost: Math.round(imageGenCost * 100) / 100,
    videoGenCost: Math.round(videoGenCost * 100) / 100,
    totalCost: Math.round((imageGenCost + videoGenCost) * 100) / 100,
    breakdown: {
      totalShots: shots.length,
      totalImages,
      totalVideos,
      totalDurationSeconds: Math.round(totalDuration * 10) / 10,
      estimatedMinutes: Math.round(totalDuration / 60 * 10) / 10,
      costPerMinute: Math.round((imageGenCost + videoGenCost) / (totalDuration / 60) * 100) / 100,
    },
  };
}
