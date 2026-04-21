/**
 * 姿态参考图生成 hook
 * 调用 kais-blender-pose 为角色生成多姿态参考图
 * 
 * 融入点：
 * - Phase 3 after（DNA卡之后）：为每个角色生成标准姿态参考集
 * - Phase 6 before（分镜设计前）：为需要特定动作的镜头生成姿态参考
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * 为角色生成姿态参考图集
 * @param {object} pipeline - Pipeline 实例
 * @param {object[]} characters - 角色列表 [{name, refImages, personality}]
 * @param {object} options - { mode: 'mixamo'|'jimeng', poses: string[] }
 * @returns {object} { [characterName]: { poses: [{name, imageUrl, mode}] } }
 */
export async function generatePoseReferences(pipeline, characters, options = {}) {
  const { workdir } = pipeline;
  const posesDir = join(workdir, 'assets', 'poses');
  await mkdir(posesDir, { recursive: true });

  const mode = options.mode || 'mixamo';
  // 默认姿态集：根据角色性格自动选择
  const defaultPoses = {
    protagonist: ['idle_confident', 'thinking', 'walking_determined'],
    antagonist: ['idle_menacing', 'standing_power', 'pointing_accusing'],
    supporting: ['idle_relaxed', 'nodding', 'reacting_surprised'],
  };

  const results = {};

  for (const char of characters) {
    const refImages = char.refImages || char.imageUrls || (char.imageUrl ? [char.imageUrl] : []);
    const role = char.role || 'supporting';
    const requestedPoses = options.poses || defaultPoses[role] || defaultPoses.supporting;
    
    results[char.name] = { poses: [], mode };

    for (const poseName of requestedPoses) {
      try {
        let imageUrl = null;
        
        if (mode === 'mixamo') {
          // 模式 A：Mixamo 动画帧截取（需要 Blender Agent Server）
          imageUrl = await _generateMixamoPose(char.name, poseName, posesDir);
        } else {
          // 模式 B：即梦图生图（需要即梦 API）
          imageUrl = await _generateJimengPose(refImages, poseName, char.name, posesDir);
        }

        if (imageUrl) {
          results[char.name].poses.push({ name: poseName, imageUrl, mode });
          console.log(`[pose] ✅ ${char.name} - ${poseName} (${mode})`);
        }
      } catch (e) {
        console.warn(`[pose] ⚠️ ${char.name} - ${poseName} 跳过: ${e.message}`);
      }
    }
  }

  // 持久化
  const poseDataPath = join(workdir, 'pose-references.json');
  await writeFile(poseDataPath, JSON.stringify(results, null, 2));
  console.log(`[pose] ✅ 姿态参考图生成完成`);

  return results;
}

/**
 * 为分镜镜头生成特定姿态参考
 * @param {object} pipeline - Pipeline 实例
 * @param {object[]} shots - 分镜列表 [{id, character, action, description}]
 * @param {object} characterPoses - Phase 3 产出的姿态数据
 * @returns {object} { [shotId]: { character, action, imageUrl } }
 */
export async function generateShotPoses(pipeline, shots, characterPoses) {
  const { workdir } = pipeline;
  const shotPosesDir = join(workdir, 'assets', 'shot-poses');
  await mkdir(shotPosesDir, { recursive: true });

  const results = {};

  for (const shot of shots) {
    if (!shot.character || !shot.action) continue;
    
    // 先检查是否已有匹配的姿态参考
    const existing = characterPoses?.[shot.character]?.poses?.find(
      p => p.name.includes(shot.action.toLowerCase())
    );

    if (existing) {
      results[shot.id] = { character: shot.character, action: shot.action, imageUrl: existing.imageUrl, reused: true };
      continue;
    }

    // 没有现成的，需要新生成（标记为需要生成）
    results[shot.id] = { 
      character: shot.character, 
      action: shot.action, 
      imageUrl: null, 
      needsGeneration: true,
      refImages: characterPoses?.[shot.character]?.poses?.[0]?.imageUrl 
        ? [characterPoses[shot.character].poses[0].imageUrl] 
        : []
    };
  }

  const shotPosePath = join(workdir, 'shot-poses.json');
  await writeFile(shotPosePath, JSON.stringify(results, null, 2));
  return results;
}

// ─── 内部实现 ──────────────────────────────────────────

async function _generateMixamoPose(characterName, poseName, outputDir) {
  const outputPath = join(outputDir, `${characterName}_${poseName}.png`);
  console.log(`[pose] Mixamo 模式: ${characterName} - ${poseName} → ${outputPath}`);
  // placeholder: agent will execute the actual Blender workflow via kais-blender-pose SKILL.md
  return null;
}

async function _generateJimengPose(refImages, poseName, characterName, outputDir) {
  if (!refImages.length) throw new Error('无参考图');
  
  const poseDescriptions = {
    idle_confident: '自信站立，双手交叉胸前',
    thinking: '侧头思考，一手托腮',
    walking_determined: '坚定行走，目光前方',
    idle_menacing: '阴沉站立，双手背后',
    standing_power: '叉腰站立，气势逼人',
    pointing_accusing: '手指前方，怒目而视',
    idle_relaxed: '放松站立，双手自然下垂',
    nodding: '微微点头，面带微笑',
    reacting_surprised: '惊讶后退，嘴巴微张',
  };

  const description = poseDescriptions[poseName] || poseName.replace(/_/g, ' ');
  const outputPath = join(outputDir, `${characterName}_${poseName}.png`);
  
  console.log(`[pose] 即梦模式: ${characterName} - ${poseName} → ${outputPath}`);
  // placeholder: agent will call jimeng API
  return null;
}
