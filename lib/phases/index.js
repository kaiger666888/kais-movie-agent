/**
 * Phase handlers — 各阶段的介入逻辑
 * pipeline 编排器通过 phaseHandlers[phaseId] 调用对应 handler
 */
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  generateTopics, audienceMatch, deepAudienceAnalysis,
  registerCharacterDNA, registerSceneDNA,
  generateBlueprint, assessQuality,
} from '../hooks/index.js';

/**
 * 各阶段的 before/after 钩子
 * before: 阶段执行前的预处理
 * after: 阶段执行后的后处理（数据提取、DNA注册等）
 */
export const phaseHandlers = {
  requirement: {
    after: async (pipeline, phase, phaseConfig) => {
      const req = pipeline.config;
      await writeFile(join(pipeline.workdir, 'requirement.json'), JSON.stringify(req, null, 2));

      // 四维蓝图
      try {
        await generateBlueprint(pipeline, req);
      } catch (err) {
        console.warn(`[pipeline] 蓝图生成失败（不阻塞）: ${err.message}`);
      }

      // 受众匹配
      try {
        const matchResult = await audienceMatch({ content: req, platform: pipeline.config.platform || 'douyin' });
        pipeline.audienceMatch = matchResult;
        await writeFile(join(pipeline.workdir, 'audience-match.json'), JSON.stringify(matchResult, null, 2));
        console.log('[pipeline] ✅ 受众匹配完成');
      } catch (e) {
        console.warn(`[pipeline] 受众匹配跳过: ${e.message}`);
      }

      // 选题发散
      try {
        const topics = await generateTopics(req, {
          platform: pipeline.config.platform || 'douyin',
          genre: req.genre,
          blueprint: pipeline.blueprint,
        });
        phaseConfig.data = phaseConfig.data || {};
        phaseConfig.data.candidateTopics = topics;
        pipeline.candidateTopics = topics;
        await writeFile(join(pipeline.workdir, 'candidate-topics.json'), JSON.stringify(topics, null, 2));
        console.log(`[pipeline] ✅ 选题发散完成: ${topics.length} 个`);
      } catch (e) {
        console.warn(`[pipeline] 选题发散跳过: ${e.message}`);
      }

      return { summary: { title: req.title, genre: req.genre }, metrics: { characterCount: req.characters?.length || 0 } };
    },
  },

  character: {
    after: async (pipeline, phase, phaseConfig) => {
      const characters = phaseConfig.data?.characters;
      if (!characters?.length) throw new Error('[pipeline] Phase 3 未产出角色数据');
      await registerCharacterDNA(pipeline, characters);
    },
  },

  scenario: {
    after: async (pipeline, phase, phaseConfig) => {
      if (!phaseConfig.data) return;
      try {
        const analysis = await deepAudienceAnalysis({
          script: typeof phaseConfig.data === 'string' ? phaseConfig.data : phaseConfig.data.script || JSON.stringify(phaseConfig.data),
          platform: pipeline.config.platform || 'douyin',
        });
        pipeline.audienceAnalysis = analysis;
        await writeFile(join(pipeline.workdir, 'audience-analysis.json'), JSON.stringify(analysis, null, 2));
        console.log('[pipeline] ✅ 剧本受众测评完成');
      } catch (e) {
        console.warn(`[pipeline] 剧本受众测评跳过: ${e.message}`);
      }
    },
  },

  scene: {
    after: async (pipeline, phase, phaseConfig) => {
      const scenes = phaseConfig.data?.scenes;
      if (!scenes?.length) {
        console.log('[pipeline] Phase 5 无场景数据，跳过场景DNA');
        return;
      }
      try {
        await registerSceneDNA(pipeline, scenes);
      } catch (e) {
        console.warn(`[pipeline] 场景DNA跳过: ${e.message}`);
      }
    },
  },

  camera: {
    before: async (pipeline, phase) => {
      // 恢复角色 DNA（参考图锚定模式）
      if (pipeline.characterDNA.size === 0) {
        try {
          const raw = await readFile(join(pipeline.workdir, 'character-dna.json'), 'utf-8');
          const saved = JSON.parse(raw);
          for (const [name, dna] of Object.entries(saved)) pipeline.characterDNA.set(name, dna);
          console.log(`[pipeline] 恢复了 ${pipeline.characterDNA.size} 个角色DNA卡（参考图锚定模式）`);
        } catch {
          console.warn('[pipeline] ⚠️ 无角色DNA卡，视频生成将不带入角色参考图');
        }
      }

      // 注入角色参考图到 pipeline config，供 camera 阶段使用
      // 即梦通过 @引用 + images 参数实现一致性，不依赖 seed
      if (pipeline.characterDNA.size > 0) {
        const characterRefs = {};
        for (const [name, dna] of pipeline.characterDNA) {
          if (dna.refImages?.length) {
            characterRefs[name] = {
              refImages: dna.refImages,
              description: dna.description || '',
              lastFrameUrl: dna.lastFrameUrl,
            };
          }
        }
        pipeline.config._characterRefs = characterRefs;
        console.log(`[pipeline] ✅ ${Object.keys(characterRefs).length} 个角色参考图已注入（@引用锚定模式）`);
      }

      // 恢复场景 DNA（可选）
      if (pipeline.sceneDNA.size === 0) {
        try {
          const raw = await readFile(join(pipeline.workdir, 'scene-dna.json'), 'utf-8');
          const saved = JSON.parse(raw);
          for (const [name, dna] of Object.entries(saved)) pipeline.sceneDNA.set(name, dna);
        } catch { /* optional */ }
      }
      if (pipeline.sceneDNA.size > 0) {
        const sceneRefs = {};
        for (const [name, dna] of pipeline.sceneDNA) {
          if (dna.refImages?.length) {
            sceneRefs[name] = { refImages: dna.refImages, description: dna.description || '' };
          }
        }
        pipeline.config._sceneRefs = sceneRefs;
        console.log(`[pipeline] ✅ ${Object.keys(sceneRefs).length} 个场景锚定图已注入`);
      }
    },
  },

  'quality-gate': {
    after: async (pipeline) => {
      return await assessQuality(pipeline);
    },
  },
};

// Phase 8 hook 已在 pipeline.js 的 PHASES 定义中通过 outputFiles 管理
// 后期合成的实际执行由 agent 调用外部工具（ffmpeg等），pipeline 只做检查点
