/**
 * kais-character-designer — 角色设计核心逻辑
 * 
 * 核心机制：seed_lock + reference_images 确保角色跨场景一致性
 * 锦标赛模式：生成 population_size 个变体，导演选择后锁定
 */

import { JimengClient } from '../../../lib/jimeng-client.js';

const jimeng = new JimengClient();

// ── Prompt 模板 ──

const PROMPTS = {
  front: (vars) => `Character design sheet, front view portrait of ${vars.character_name}. ${vars.appearance}. ${vars.personality} reflected in expression. Art style: ${vars.style}. ${vars.art_direction}. Clean white background, professional character concept art, high detail, sharp focus on face, studio lighting. Character turnaround sheet style, front angle.`,

  side: (vars) => `Character design, full body side view of ${vars.character_name}. ${vars.appearance}. Standing in a neutral pose showing full silhouette. Art style: ${vars.style}. ${vars.art_direction}. Clean white background, character concept art, full body visible from head to toe, consistent proportions with portrait. Side profile, 3/4 body turn.`,

  expression: (vars) => `Character expression sheet, close-up 3/4 view of ${vars.character_name}. ${vars.appearance}. Three expressions: neutral, happy, determined. ${vars.personality} visible in micro-expressions. Art style: ${vars.style}. ${vars.art_direction}. Clean white background, expression study, detailed facial features, consistent with previous views. 3/4 angle close-up on face and shoulders.`,

  restyle: (vars) => `Character design of ${vars.character_name}, maintaining exact same face, body proportions, and features. ${vars.appearance}. NEW art style: ${vars.new_style}. ${vars.new_art_direction}. Same character, different artistic interpretation. Consistent with reference images provided.`,
};

// ── 多视角参考图 Prompt 模板 ──

const MULTIVIEW_PROMPTS = {
  front: (vars) => `${vars.style_prefix}, front view portrait of ${vars.character_name}, ${vars.appearance}, ${vars.personality} mood, front-facing, eyes looking at camera, symmetrical composition, upper body, clean white background, professional character reference sheet, high detail, studio lighting, identity anchor view`,

  three_quarter: (vars) => `${vars.style_prefix}, 3/4 view of ${vars.character_name}, ${vars.appearance}, ${vars.personality} mood, head turned 45 degrees, showing depth and volume of face and body, upper body, clean white background, professional character reference sheet, high detail, soft lighting, identity anchor view`,

  side: (vars) => `${vars.style_prefix}, side profile view of ${vars.character_name}, ${vars.appearance}, ${vars.personality} mood, perfect side profile, head and shoulders, clean outline showing nose bridge and jawline, clean white background, professional character reference sheet, high detail, silhouette clear, identity anchor view`,
};

// ── 即梦 API 调用 ──

async function generateImage(prompt, { seed, ratio = '3:4', resolution = '2k', images } = {}) {
  try {
    const data = await jimeng.generateImage(prompt, { seed, ratio, resolution, images });
    return data; // [{ url, seed }, ...]
  } catch (e) {
    console.error('[kais-character-designer] 即梦 API 失败:', e.message);
    return null;
  }
}

// ── 核心函数 ──

/**
 * 生成角色视觉变体（锦标赛模式）
 * @param {object} character - { name, appearance, personality }
 * @param {object} artDirection - { style, color_palette, era, mood, reference_notes }
 * @param {number} count - 变体数量（默认 3）
 * @returns {Promise<Array<{variant: string, angle: string, images: Array<{url, seed}>}>>}
 */
export async function generateVariants(character, artDirection, count = 3) {
  const vars = {
    character_name: character.name,
    appearance: character.appearance,
    personality: character.personality || '',
    style: artDirection.style || 'anime',
    art_direction: buildArtDirection(artDirection),
  };

  const angles = ['front', 'side', 'expression'];
  const variants = [];

  for (let i = 0; i < count; i++) {
    const angle = angles[i % angles.length];
    const promptFn = PROMPTS[angle];
    const prompt = promptFn(vars);

    const images = await generateImage(prompt);
    variants.push({
      variant: String.fromCharCode(65 + i), // A, B, C
      angle,
      prompt,
      images, // 可能返回多张
    });
  }

  return variants;
}

/**
 * 锁定角色一致性（seed_lock 核心机制）
 * @param {object} selectedVariant - generateVariants 返回的选定变体
 * @param {object} character - 角色信息
 * @param {object} artDirection - 美术指令
 * @param {object} [options] - { generateMultiView: boolean, assetsDir: string }
 * @returns {Promise<CharacterBible>}
 */
export async function lockConsistency(selectedVariant, character, artDirection, options = {}) {
  const { generateMultiView = true, assetsDir = null } = options;
  const seed = selectedVariant.images[0].seed;
  const referenceImages = selectedVariant.images.map(img => img.url);

  // 用锁定的 seed 补全其他角度
  const vars = {
    character_name: character.name,
    appearance: character.appearance,
    personality: character.personality || '',
    style: artDirection.style || 'anime',
    art_direction: buildArtDirection(artDirection),
  };

  const otherAngles = ['front', 'side', 'expression'].filter(a => a !== selectedVariant.angle);
  for (const angle of otherAngles) {
    const prompt = PROMPTS[angle](vars);
    const images = await generateImage(prompt, { seed }); // 复用 seed！
    referenceImages.push(...images.map(img => img.url));
  }

  const characterId = `char_${character.name.toLowerCase().replace(/\s+/g, '_')}`;

  // 构建基础 CharacterBible
  const bible = {
    type: 'CharacterBible',
    version: '2.0.0',
    character_id: characterId,
    name: character.name,
    appearance: character.appearance,
    personality: character.personality || '',
    reference_images: referenceImages,
    seed,
    consistency_lock: {
      locked: true,
      lock_version: 1,
      frozen_fields: ['appearance', 'seed'],
    },
  };

  // 生成多视角参考图
  if (generateMultiView) {
    try {
      const referenceImageForMulti = selectedVariant.images[0]?.url || null;
      const multiViewResult = await generateMultiViewReference(character, artDirection, {
        referenceImage: referenceImageForMulti,
        assetsDir,
      });

      bible.references = multiViewResult.references;

      // 将多视角图信息记录到 consistency_lock
      bible.consistency_lock.multi_view_generated = true;
      bible.consistency_lock.multi_view_images = multiViewResult.images;
    } catch (e) {
      console.warn('[kais-character-designer] 多视角参考图生成失败，继续使用单参考图模式:', e.message);
      // 向后兼容：失败时不设置 references，下游使用原有 reference_images
      bible.consistency_lock.multi_view_generated = false;
    }
  }

  return bible;
}

/**
 * 风格变更时重新生成（seed 不变）
 * @param {CharacterBible} characterBible - 已锁定的角色设定
 * @param {object} newArtDirection - 新美术指令
 * @returns {Promise<CharacterBible>}
 */
export async function regenerateOnStyleChange(characterBible, newArtDirection) {
  if (!characterBible.consistency_lock?.locked) {
    throw new Error('角色尚未锁定一致性，请先调用 lockConsistency');
  }

  const vars = {
    character_name: characterBible.name,
    appearance: characterBible.appearance,
    personality: characterBible.personality,
    new_style: newArtDirection.style,
    new_art_direction: buildArtDirection(newArtDirection),
  };

  const prompt = PROMPTS.restyle(vars);
  const images = await generateImage(prompt, {
    seed: characterBible.seed, // 关键：seed 不变
    images: characterBible.reference_images, // 参考图辅助一致性
  });

  return {
    ...characterBible,
    reference_images: images.map(img => img.url),
    consistency_lock: {
      ...characterBible.consistency_lock,
      lock_version: characterBible.consistency_lock.lock_version + 1,
    },
  };
}

/**
 * 生成多视角参考图（正面、3/4、侧面）
 *
 * 为角色生成 3 张不同视角的参考图，用于 4D 身份锚定。
 * 每张图的 prompt 包含：角色描述 + 视角指定 + 风格前缀。
 * 使用即梦 API 图生图（以 turnaround 或已有参考图作为输入）。
 *
 * @param {object} character - { name, appearance, personality }
 * @param {object} artDirection - { style, color_palette, era, mood, reference_notes, style_prefix }
 * @param {object} [options] - { referenceImage, sampleStrength, assetsDir }
 * @returns {Promise<{character_id: string, references: {front: string, three_quarter: string, side: string}}>}
 */
export async function generateMultiViewReference(character, artDirection, options = {}) {
  const {
    referenceImage = null,     // 用于图生图的参考图路径（turnaround 等）
    sampleStrength = 0.35,     // 参考图影响强度
    assetsDir = null,          // 资产保存目录
  } = options;

  const stylePrefix = artDirection.style_prefix || buildStylePrefix(artDirection);

  const vars = {
    character_name: character.name,
    appearance: character.appearance,
    personality: character.personality || '',
    style_prefix: stylePrefix,
  };

  const characterId = `char_${character.name.toLowerCase().replace(/\s+/g, '_')}`;

  // 三视角配置
  const views = [
    { key: 'front',         filename: 'front-source.png',   promptFn: MULTIVIEW_PROMPTS.front },
    { key: 'three_quarter', filename: '3q-source.png',      promptFn: MULTIVIEW_PROMPTS.three_quarter },
    { key: 'side',          filename: 'side-source.png',    promptFn: MULTIVIEW_PROMPTS.side },
  ];

  const references = {};
  const imagesMeta = {};

  for (const view of views) {
    const prompt = view.promptFn(vars);

    const genOptions = {
      ratio: '3:4',
      resolution: '2k',
    };

    // 如果有参考图，使用图生图模式
    if (referenceImage) {
      genOptions.images = [referenceImage];
      genOptions.seed = undefined; // 图生图不强制 seed
    }

    const result = await generateImage(prompt, genOptions);

    if (result && result.length > 0) {
      const url = result[0].url;
      // 如果有资产目录，构建本地路径
      const localPath = assetsDir
        ? `${assetsDir}/${characterId}/${view.filename}`
        : `assets/characters/${characterId}/${view.filename}`;

      references[view.key] = localPath;
      imagesMeta[view.key] = { url, seed: result[0].seed, localPath };
    } else {
      // 生成失败时记录空路径，保持结构完整
      const fallbackPath = assetsDir
        ? `${assetsDir}/${characterId}/${view.filename}`
        : `assets/characters/${characterId}/${view.filename}`;
      references[view.key] = fallbackPath;
      imagesMeta[view.key] = null;
      console.warn(`[kais-character-designer] ${view.key} 视角参考图生成失败`);
    }
  }

  return {
    character_id: characterId,
    references,
    images: imagesMeta,           // 原始 API 返回的 url/seed 元数据
    style_prefix: stylePrefix,    // 记录使用的风格前缀
    sample_strength: sampleStrength,
  };
}

/**
 * 构建 STYLE_PREFIX（从 ArtDirection 提取）
 * @param {object} artDirection
 * @returns {string}
 */
function buildStylePrefix(artDirection) {
  const parts = [];
  if (artDirection.style) parts.push(artDirection.style);
  if (artDirection.era) parts.push(`${artDirection.era} era`);
  if (artDirection.mood) parts.push(`${artDirection.mood} mood`);
  if (artDirection.color_palette?.length) parts.push(`palette: ${artDirection.color_palette.join('/')}`);
  if (artDirection.reference_notes) parts.push(artDirection.reference_notes);
  return parts.join(', ');
}

// ── 工具函数 ──

function buildArtDirection(artDirection) {
  const parts = [];
  if (artDirection.era) parts.push(`${artDirection.era} era`);
  if (artDirection.color_palette?.length) parts.push(`color palette: ${artDirection.color_palette.join(', ')}`);
  if (artDirection.mood) parts.push(`${artDirection.mood} mood`);
  if (artDirection.reference_notes) parts.push(artDirection.reference_notes);
  return parts.join('. ');
}

// ── CLI 入口 ──

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const cmd = process.argv[2];
  const input = JSON.parse(process.argv[3] || '{}');

  switch (cmd) {
    case 'generate':
      generateVariants(input.character, input.artDirection, input.count)
        .then(v => { console.log(JSON.stringify(v, null, 2)); process.exit(0); })
        .catch(e => { console.error(e); process.exit(1); });
      break;
    case 'lock':
      lockConsistency(input.variant, input.character, input.artDirection, {
        generateMultiView: input.generateMultiView !== false,
        assetsDir: input.assetsDir || null,
      })
        .then(v => { console.log(JSON.stringify(v, null, 2)); process.exit(0); })
        .catch(e => { console.error(e); process.exit(1); });
      break;
    case 'restyle':
      regenerateOnStyleChange(input.characterBible, input.newArtDirection)
        .then(v => { console.log(JSON.stringify(v, null, 2)); process.exit(0); })
        .catch(e => { console.error(e); process.exit(1); });
      break;
    case 'multiview':
      generateMultiViewReference(input.character, input.artDirection, {
        referenceImage: input.referenceImage || null,
        sampleStrength: input.sampleStrength || 0.35,
        assetsDir: input.assetsDir || null,
      })
        .then(v => { console.log(JSON.stringify(v, null, 2)); process.exit(0); })
        .catch(e => { console.error(e); process.exit(1); });
      break;
    default:
      console.error('用法: designer.js <generate|lock|restyle|multiview> <json-input>');
      process.exit(1);
  }
}
