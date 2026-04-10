/**
 * kais-shooting-script — ShootingScript Generator
 *
 * Converts Storyboard → ShootingScript (VideoShot[] with prompts, seeds, motion).
 */

// ─── Motion Strength Defaults by Camera Angle ─────────────

const MOTION_BY_ANGLE = {
  'extreme-close-up': 1,
  'close-up': 1.5,
  'medium-close-up': 2,
  'medium-shot': 2.5,
  'medium-full-shot': 3,
  'full-shot': 3.5,
  'long-shot': 4.5,
  'extreme-long-shot': 2,
  'low-angle': 1,      // additive
  'high-angle': 0,
  'dutch-angle': 1,    // additive
  'over-the-shoulder': 2,
  'bird-eye-view': 1,
};

const MOTION_BOOST_WITH_MOVEMENT = {
  'extreme-close-up': 1,
  'close-up': 1.5,
  'medium-close-up': 2,
  'medium-shot': 2.5,
  'medium-full-shot': 2.5,
  'full-shot': 3,
  'long-shot': 3.5,
  'extreme-long-shot': 4,
  'low-angle': 1,
  'high-angle': 1,
  'dutch-angle': 1,
  'over-the-shoulder': 1,
  'bird-eye-view': 2,
};

// ─── Core Functions ────────────────────────────────────────

/**
 * Convert Storyboard → ShootingScript
 * @param {object} storyboard - Storyboard artifact
 * @param {object[]} characters - CharacterBible[]
 * @param {object} artDirection - ArtDirection artifact
 * @param {object[]} scenes - SceneDesign[] (optional)
 * @returns {object} ShootingScript
 */
export function storyboardToShootingScript(storyboard, characters, artDirection, scenes = []) {
  const charMap = Object.fromEntries(characters.map(c => [c.character_id, c]));
  const sceneMap = Object.fromEntries(scenes.map(s => [s.scene_id, s]));

  const shots = storyboard.shots.map((shot, idx) => {
    const descPrompt = buildVideoPrompt(shot, charMap, sceneMap, artDirection);
    const seed = computeSeed(shot, charMap, idx);
    const motionStrength = computeMotionStrength(shot);
    const aspectRatio = shot.aspect_ratio || '16:9';
    const duration = Math.round(shot.duration || 4);
    const filePaths = shot.reference_image ? [shot.reference_image] : [];

    // 提取时序锚定配置（从 storyboard shot 的 anchoring.temporal）
    const temporal = shot.anchoring?.temporal || null;

    return {
      shot_id: shot.shot_id,
      seed,
      aspect_ratio: aspectRatio,
      motion_strength: motionStrength,
      // 即梦 API 直接可用的参数
      api_params: {
        model: filePaths.length ? 'jimeng-video-seedance-2.0-fast' : 'jimeng-video-3.5-pro',
        prompt: filePaths.length ? `@1 ${descPrompt}` : descPrompt,
        ratio: aspectRatio,
        duration,
        file_paths: filePaths,
        // 时序锚定参数（供 CameraOperator 读取）
        ...(temporal ? { temporal } : {}),
      },
      // 降级方案（纯文本模型）
      fallback: {
        model: 'jimeng-video-3.5-pro',
        prompt: descPrompt,
        ratio: aspectRatio,
        duration,
      },
      // 元数据
      character_refs: shot.character_refs || [],
      scene_ref: shot.scene_ref || '',
      camera: shot.camera || {},
      // 保留完整的 anchoring 配置，供 CameraOperator 的 executeShot 直接读取
      ...(shot.anchoring ? { anchoring: shot.anchoring } : {}),
      mode: 'video',
      attempt: 1,
    };
  });

  return {
    type: 'ShootingScript',
    version: '3.0',
    shots,
  };
}

/**
 * Build video generation prompt for a single shot
 */
export function buildVideoPrompt(shot, charMap, sceneMap, artDirection) {
  const parts = [];

  // Style
  if (artDirection?.style_name) {
    parts.push(artDirection.style_name);
  }
  if (artDirection?.texture) {
    parts.push(artDirection.texture + ' texture');
  }

  // Characters
  const charDescs = (shot.character_refs || []).map(ref => {
    const c = charMap[ref];
    return c ? c.appearance : '';
  }).filter(Boolean);
  if (charDescs.length) parts.push(charDescs.join(', '));

  // Action
  if (shot.action) parts.push(shot.action);

  // Scene
  if (shot.scene_ref && sceneMap[shot.scene_ref]) {
    const scene = sceneMap[shot.scene_ref];
    const sceneDesc = [scene.location, scene.atmosphere, scene.lighting].filter(Boolean).join(', ');
    parts.push('in ' + sceneDesc);
  }

  // Camera
  if (shot.camera?.angle) {
    let cam = shot.camera.angle.replace(/-/g, ' ') + ' shot';
    if (shot.camera?.movement) cam += `, ${shot.camera.movement}`;
    if (shot.camera?.lens) cam += `, ${shot.camera.lens} lens`;
    parts.push(cam);
  }

  // Light quality
  if (artDirection?.light_quality) {
    parts.push(artDirection.light_quality + ' lighting');
  }

  // Universal quality tags
  parts.push('cinematic', 'high quality', '4K');

  return parts.join(', ');
}

/**
 * Apply retry/degradation strategy
 * @param {object} shot - VideoShot
 * @param {number} attempt - 1-4
 * @returns {object} Modified VideoShot for this attempt
 */
export function applyRetryStrategy(shot, attempt) {
  if (attempt <= 1) return { ...shot, mode: 'video' };

  const degraded = structuredClone(shot);
  const prompt = shot.api_params.prompt.replace(/^@1\s*/, ''); // strip @1 prefix

  if (attempt === 2) {
    const segments = prompt.split(', ');
    const core = segments.slice(0, Math.min(3, segments.length));
    const tail = segments.slice(-2);
    const simplified = [...core, 'simplified', ...tail].join(', ');
    degraded.api_params = { ...shot.api_params, prompt: simplified };
    degraded.fallback = { ...shot.fallback, prompt: simplified };
    degraded.motion_strength = Math.max(1, shot.motion_strength - 2);
    degraded.mode = 'video';
  } else if (attempt === 3) {
    const segments = prompt.split(', ');
    const minimal = segments.slice(0, 2).join(', ') + ', cinematic';
    degraded.api_params = { ...shot.api_params, prompt: minimal, model: 'jimeng-video-3.5-pro', file_paths: [] };
    degraded.fallback = { ...shot.fallback, prompt: minimal };
    degraded.motion_strength = 2;
    degraded.mode = 'video';
  } else {
    const segments = prompt.split(', ');
    const imgPrompt = segments.slice(0, 3).join(', ') + ', high quality, 4K';
    degraded.api_params = { model: 'jimeng-5.0', prompt: imgPrompt, ratio: shot.api_params.ratio || '16:9' };
    degraded.fallback = degraded.api_params;
    degraded.mode = 'image';
  }

  degraded.attempt = attempt;
  return degraded;
}

/**
 * Estimate total cost in credits
 * @param {object} shootingScript - ShootingScript
 * @param {number} creditPerVideo - credits per video (default 0.05)
 * @param {number} creditPerImage - credits per image (default 0.01)
 * @returns {object} { videos, estimatedCredits, worstCaseCredits }
 */
export function estimateTotalCost(shootingScript, creditPerVideo = 0.05, creditPerImage = 0.01) {
  const videos = shootingScript.shots.length;
  const estimatedCredits = videos * creditPerVideo;
  // Worst case: every shot fails 3 times (3 video retries + 1 image fallback)
  const worstCaseCredits = videos * (3 * creditPerVideo + creditPerImage);
  return { videos, estimatedCredits, worstCaseCredits };
}

// ─── Helpers ───────────────────────────────────────────────

function computeSeed(shot, charMap, shotIndex) {
  // Use first character's seed as base, offset by shot index
  const primaryChar = charMap[shot.character_refs?.[0]];
  const base = primaryChar?.seed || 10000;
  return base + shotIndex * 1000;
}

function computeMotionStrength(shot) {
  const angle = shot.camera?.angle || 'medium-shot';
  const hasMovement = !!shot.camera?.movement;

  // Look up base motion
  let motion = MOTION_BY_ANGLE[angle] ?? 2.5;

  // Additive angles (low-angle, dutch-angle)
  if (['low-angle', 'dutch-angle'].includes(angle)) {
    const baseAngle = 'medium-shot';
    motion = (MOTION_BY_ANGLE[baseAngle] ?? 2.5) + (MOTION_BY_ANGLE[angle] ?? 0);
  }

  // Boost if camera has movement
  if (hasMovement) {
    motion += (MOTION_BOOST_WITH_MOVEMENT[angle] ?? 2);
  }

  // Clamp 0-10
  return Math.round(Math.min(10, Math.max(0, motion)) * 10) / 10;
}
