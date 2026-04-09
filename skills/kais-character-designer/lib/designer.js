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
 * @returns {Promise<CharacterBible>}
 */
export async function lockConsistency(selectedVariant, character, artDirection) {
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

  return {
    type: 'CharacterBible',
    version: '1.0.0',
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
      lockConsistency(input.variant, input.character, input.artDirection)
        .then(v => { console.log(JSON.stringify(v, null, 2)); process.exit(0); })
        .catch(e => { console.error(e); process.exit(1); });
      break;
    case 'restyle':
      regenerateOnStyleChange(input.characterBible, input.newArtDirection)
        .then(v => { console.log(JSON.stringify(v, null, 2)); process.exit(0); })
        .catch(e => { console.error(e); process.exit(1); });
      break;
    default:
      console.error('用法: designer.js <generate|lock|restyle> <json-input>');
      process.exit(1);
  }
}
