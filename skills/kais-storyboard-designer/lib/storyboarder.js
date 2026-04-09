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
      });
    }
  }

  return shots;
}

// ─── Reference Generation ──────────────────────────────────────────

/**
 * Generate a shot reference image via 即梦 API
 * @returns {Promise<string|null>} image URL or null on failure
 */
export async function generateShotReference(shot, character, scene, artStyle) {
  const cameraDesc = [shot.camera?.angle, shot.camera?.movement].filter(Boolean).join('，');
  const prompt = buildPrompt({
    shotDescription: shot.action,
    character,
    scene,
    cameraAngle: cameraDesc,
    artStyle,
    emotion: '',
  });
  return generateImage(prompt);
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
