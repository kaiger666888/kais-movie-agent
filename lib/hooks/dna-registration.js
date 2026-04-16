/**
 * DNA 卡注册 hooks — 参考图锚定模式
 *
 * 即梦不暴露 seed，角色/场景一致性通过以下机制实现：
 * - 角色锚定：1-2张高质量参考图（正面+全身），所有镜头 @引用 同一角色图
 * - 场景锚定：每个场景生成一张锚定帧，后续镜头复用
 * - 视频接力：Seedance 延长功能，上段成品作为下段参考保持一致性
 *
 * DNA 卡结构（character-dna.json）：
 * {
 *   "角色名": {
 *     refImages: ["正面照URL", "全身照URL"],   // 核心锚定素材
 *     description: "角色外观描述",              // 用于 prompt 补充
 *     lastFrameUrl: null,                       // 视频接力用：上段尾帧
 *     verified: true                            // 是否通过验证
 *   }
 * }
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * 注册角色 DNA — 保存参考图 + 可选验证
 * @param {object} pipeline - Pipeline 实例（含 workdir, jimengClient, characterDNA）
 * @param {Array} characters - 角色数组，每个含 { name, refImages, imageUrl, description }
 */
export async function registerCharacterDNA(pipeline, characters) {
  const { workdir, jimengClient, characterDNA } = pipeline;
  if (!jimengClient) throw new Error('jimengClient 未初始化');

  for (const char of characters) {
    // 收集参考图：优先 refImages 数组，其次 imageUrl 单图
    const refImages = char.refImages || char.imageUrls || (char.imageUrl ? [char.imageUrl] : []);
    if (!refImages.length) {
      console.warn(`[pipeline] ⚠️ 角色 ${char.name} 无参考图，DNA 卡仅保存描述`);
      characterDNA.set(char.name, {
        refImages: [],
        description: char.description || '',
        lastFrameUrl: null,
        verified: false,
      });
      continue;
    }

    // 保存 DNA 卡（参考图锚定模式，不依赖 seed）
    characterDNA.set(char.name, {
      refImages,
      description: char.description || '',
      lastFrameUrl: null,
      verified: false,
    });

    // 可选：生成验证视频确认角色一致性
    if (pipeline.config?.verifyCharacterDNA !== false) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const verification = await jimengClient.generateIdentityVerification(refImages, char.name);
          if (verification.taskId) {
            const videoUrl = await jimengClient.pollTask(verification.taskId, { timeoutMs: 300_000 });
            if (videoUrl) {
              const verPath = join(workdir, `character-${char.name}-verification.mp4`);
              await jimengClient.download(videoUrl, verPath);
              console.log(`[pipeline] ✅ 角色 ${char.name} DNA卡已注册 + 验证视频已保存`);
            }
            characterDNA.get(char.name).verified = true;
          }
          break;
        } catch (e) {
          console.warn(`[pipeline] 角色 ${char.name} DNA验证第${attempt}次失败: ${e.message}`);
          if (attempt === 3) {
            console.warn(`[pipeline] 角色 ${char.name} 验证跳过，DNA卡（参考图模式）仍可用`);
          }
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    } else {
      console.log(`[pipeline] ✅ 角色 ${char.name} DNA卡已注册（跳过验证）`);
    }
  }

  // 持久化
  const dnaPath = join(workdir, 'character-dna.json');
  await writeFile(dnaPath, JSON.stringify(Object.fromEntries(characterDNA), null, 2));
  console.log(`[pipeline] ✅ ${characterDNA.size} 个角色DNA卡已保存`);
}

/**
 * 注册场景 DNA — 为每个场景生成锚定帧
 * @param {object} pipeline
 * @param {Array} scenes - 场景数组，每个含 { name, id, prompt, imageUrl? }
 */
export async function registerSceneDNA(pipeline, scenes) {
  const { workdir, jimengClient, sceneDNA } = pipeline;
  if (!jimengClient) { console.warn('[pipeline] jimengClient 未初始化，跳过场景DNA'); return; }
  if (!scenes?.length) return;

  let generateSceneAnchor;
  try {
    ({ generateSceneAnchor } = await import('../../skills/kais-scene-designer/lib/designer.js'));
  } catch { console.warn('[pipeline] kais-scene-designer 不可用，跳过场景DNA'); return; }

  for (const scene of scenes) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const anchor = await generateSceneAnchor(scene, jimengClient);
        if (!anchor.imageUrl) throw new Error('锚点帧返回空URL');
        sceneDNA.set(scene.name || scene.id, {
          refImages: [anchor.imageUrl],  // 场景锚定图
          description: scene.prompt || '',
          lastFrameUrl: null,
          verified: true,
        });
        await jimengClient.download(anchor.imageUrl, join(workdir, `scene-${scene.name || scene.id}-anchor.png`));
        console.log(`[pipeline] ✅ 场景 ${scene.name || scene.id} 锚点帧已生成`);
        break;
      } catch (e) {
        if (attempt === 3) throw new Error(`场景 ${scene.name || scene.id} DNA卡生成失败: ${e.message}`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  const path = join(workdir, 'scene-dna.json');
  await writeFile(path, JSON.stringify(Object.fromEntries(sceneDNA), null, 2));
  console.log(`[pipeline] ✅ ${sceneDNA.size} 个场景DNA卡已保存`);
}
