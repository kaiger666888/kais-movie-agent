/**
 * DNA 卡注册 hooks（从 pipeline.js 提取）
 * 角色 DNA + 场景 DNA 的注册与持久化
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function registerCharacterDNA(pipeline, characters) {
  const { workdir, jimengClient, characterDNA } = pipeline;
  if (!jimengClient) throw new Error('jimengClient 未初始化');

  for (const char of characters) {
    const refImages = char.refImages || char.imageUrls || (char.imageUrl ? [char.imageUrl] : []);
    if (!refImages.length) throw new Error(`角色 ${char.name} 无参考图`);

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const verification = await jimengClient.generateIdentityVerification(refImages, char.name);
        const videoUrl = await jimengClient.pollTask(verification.taskId);
        characterDNA.set(char.name, { seed: verification.seed, refImages, lastFrameUrl: null });

        if (videoUrl) {
          const verPath = join(workdir, `character-${char.name}-verification.mp4`);
          await jimengClient.download(videoUrl, verPath);
          console.log(`[pipeline] ✅ 角色 ${char.name} DNA卡已注册${verification.seed ? ` (seed: ${verification.seed})` : ''}`);
        }
        break;
      } catch (e) {
        console.warn(`[pipeline] 角色 ${char.name} DNA验证第${attempt}次失败: ${e.message}`);
        if (attempt === 3) throw new Error(`角色 ${char.name} DNA卡生成失败: ${e.message}`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  const dnaPath = join(workdir, 'character-dna.json');
  await writeFile(dnaPath, JSON.stringify(Object.fromEntries(characterDNA), null, 2));
  console.log(`[pipeline] ✅ ${characterDNA.size} 个角色DNA卡已保存`);
}

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
          seed: anchor.seed, refImages: [anchor.imageUrl], lastFrameUrl: null, prompt: anchor.prompt,
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
