/**
 * reference-prompt-builder.js — 角色一致性 Prompt 模板系统
 *
 * 核心原则：
 *   1. 角色参考只传脸，智能参考传衣服/姿势
 *   2. prompt 只写动作/场景/镜头语言，零面部描述
 *   3. @Image N 绑定参考图（Seedance 2.0 omni_reference）
 *   4. CONSISTENCY LOCK 文本约束
 */

/**
 * 构建 compositions API 的 prompt（图片生成）。
 *
 * @param {object} params
 * @param {string} params.action — 角色动作（如 "坐在桌前吃面"）
 * @param {string} params.scene — 场景描述（如 "赛博朋克风格厨房"）
 * @param {string} params.camera — 镜头语言（如 "medium shot, eye level"）
 * @param {object} params.featureLock — 角色特征锁定 { hair, eyes, clothing, distinctive }
 * @returns {string} 完整 prompt
 */
export function buildCompositionPrompt(params = {}) {
  const { action, scene, camera, featureLock } = params;

  const parts = [];

  // 场景和动作
  if (camera) parts.push(camera);
  if (action) parts.push(action);
  if (scene) parts.push(scene);

  // CONSISTENCY LOCK（文本约束，作为 backup）
  if (featureLock) {
    const lockParts = [];
    if (featureLock.hair) lockParts.push(`same ${featureLock.hair}`);
    if (featureLock.eyes) lockParts.push(`same ${featureLock.eyes}`);
    if (featureLock.clothing) lockParts.push(`same ${featureLock.clothing}`);
    if (featureLock.distinctive) lockParts.push(`same ${featureLock.distinctive}`);
    if (lockParts.length) {
      parts.push(`CONSISTENCY LOCK: This is the SAME character as the reference image. ${lockParts.join(', ')}. DO NOT change appearance.`);
    }
  }

  return parts.join(', ');
}

/**
 * 构建 Seedance 2.0 omni_reference 视频生成的 prompt。
 *
 * @param {object} params
 * @param {string[]} params.identityImageRefs — L1 身份锚点 @Image 编号（如 ["@Image1", "@Image2"]）
 * @param {string[]} params.sceneImageRefs — 场景/服装 @Image 编号
 * @param {string} params.action — 动作描述
 * @param {string} params.scene — 场景描述
 * @param {string} [params.cameraMovement] — 运镜描述
 * @param {string[]} [params.videoRefs] — 动作参考 @Video 编号
 * @param {string} [params.audioRef] — 音频参考 @Audio 编号
 * @returns {string} 完整 prompt 含 @ 绑定
 */
export function buildOmniReferencePrompt(params = {}) {
  const {
    identityImageRefs = [],
    sceneImageRefs = [],
    videoRefs = [],
    audioRef,
    action,
    scene,
    cameraMovement,
  } = params;

  const parts = [];

  // 身份绑定声明
  if (identityImageRefs.length) {
    const idList = identityImageRefs.join(' and ');
    parts.push(`${idList} provides the character's exact facial features, hairstyle and skin tone. The character must look exactly like ${idList} throughout the entire video.`);
  }

  // 场景/服装绑定
  if (sceneImageRefs.length) {
    const sceneList = sceneImageRefs.join(' and ');
    parts.push(`${sceneList} provides the current costume, pose reference and scene composition.`);
  }

  // 动作参考绑定
  if (videoRefs.length) {
    const videoList = videoRefs.join(' and ');
    parts.push(`Reference ${videoList} for motion style only (30% weight). Do not alter the character's face from ${identityImageRefs[0] || 'the identity reference'}.`);
  }

  // 音频参考
  if (audioRef) {
    parts.push(`${audioRef} provides rhythm and beat structure. Visual changes sync to the audio beats.`);
  }

  // 动作和场景
  if (cameraMovement) parts.push(cameraMovement);
  if (action) parts.push(action);
  if (scene) parts.push(scene);

  // 一致性强制声明
  parts.push('keep skin tone and hair color exactly same as reference. cinematic lighting, 4k quality.');

  return parts.join('. ');
}

/**
 * 生成 L1 身份锚点图（定妆照）的 prompt 模板。
 *
 * @param {object} characterDesc — 角色外貌描述
 * @param {string} characterDesc.face — 面部特征
 * @param {string} characterDesc.hair — 发型发色
 * @param {string} characterDesc.body — 体型
 * @param {string} characterDesc.skinTone — 肤色
 * @param {string} [artStyle] — 美术风格
 * @returns {string} 定妆照 prompt
 */
export function buildIdentityAnchorPrompt(characterDesc = {}, artStyle = '') {
  const { face, hair, body, skinTone } = characterDesc;

  const parts = [];
  if (face) parts.push(face);
  if (hair) parts.push(hair);
  if (skinTone) parts.push(skinTone);
  if (body) parts.push(body);

  parts.push('portrait, head and shoulders shot');
  parts.push('facing camera directly, neutral expression, mouth slightly closed');
  parts.push('soft even lighting, no harsh shadows');
  parts.push('light gray background (#D3D3D3)');
  parts.push('high resolution, no compression artifacts, no filters');

  if (artStyle) parts.push(artStyle);

  return parts.join(', ');
}

/**
 * 生成 L2 造型卡片的 prompt 模板。
 *
 * @param {object} params
 * @param {object} params.characterDesc — 角色外貌
 * @param {string} params.costumeDescription — 服装描述
 * @param {string} params.view — 'front' | 'side' | 'back'
 * @param {string} [artStyle]
 * @returns {string} 造型卡片 prompt
 */
export function buildCostumeSheetPrompt(params = {}) {
  const { characterDesc = {}, costumeDescription, view = 'front', artStyle = '' } = params;

  const viewMap = {
    front: 'full body front view, standing pose, facing camera directly',
    side: 'full body side view, standing pose, profile facing left',
    back: 'full body back view, standing pose, seen from behind',
  };

  const parts = [];
  if (characterDesc.face) parts.push(characterDesc.face);
  if (characterDesc.hair) parts.push(characterDesc.hair);
  if (characterDesc.body) parts.push(characterDesc.body);
  parts.push(costumeDescription);
  parts.push(viewMap[view] || viewMap.front);
  parts.push('clean background, character design sheet style');
  parts.push('neutral expression');
  parts.push('full body visible from head to toe');

  if (artStyle) parts.push(artStyle);

  return parts.join(', ');
}

/**
 * 生成分镜首帧的 prompt 模板（用于 compositions API）。
 *
 * @param {object} params
 * @param {string} params.action — 动作描述
 * @param {string} params.sceneSetting — 场景设定
 * @param {string} params.cameraShot — 镜头景别
 * @param {object} [params.featureLock] — 角色特征锁定
 * @param {string} [params.artStyle] — 美术风格
 * @returns {string} 分镜首帧 prompt
 */
export function buildSceneFramePrompt(params = {}) {
  const { action, sceneSetting, cameraShot, featureLock, artStyle } = params;

  return buildCompositionPrompt({
    action,
    scene: sceneSetting,
    camera: cameraShot,
    featureLock,
  }) + (artStyle ? `, ${artStyle}` : '');
}

export default {
  buildCompositionPrompt,
  buildOmniReferencePrompt,
  buildIdentityAnchorPrompt,
  buildCostumeSheetPrompt,
  buildSceneFramePrompt,
};
