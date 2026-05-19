/**
 * SFXManager — V4.1 音效策略
 * 预览期: 提示词驱动 (嵌入视频生成 prompt)
 * 终版期: 素材库匹配 + Stable Audio 生成
 */
export class SFXManager {
  constructor({ goldTeamClient, assetBus }) {
    this.gt = goldTeamClient;
    this.bus = assetBus;
    this.libraryPath = process.env.SFX_LIBRARY_PATH || '/mnt/assets/audio/sfx';
  }

  // PHASE 7: Generate SFX hints for video generation prompts (max 3)
  generateSFXHints(audioEvents) {
    if (!audioEvents || audioEvents.length === 0) return '';

    const sfxHints = audioEvents
      .filter(e => e.type === 'sfx' || e.category === 'sfx')
      .slice(0, 3)
      .map(e => e.description || e.text);

    if (sfxHints.length === 0) return '';
    return '. Accompanying sounds: ' + sfxHints.join(', ');
  }

  // PHASE 8: Generate final SFX from library + generation
  async generateFinalSFX(requiredSFX) {
    if (!requiredSFX || requiredSFX.length === 0) return [];

    const stems = [];
    for (const sfx of requiredSFX) {
      const sample = this.matchFromLibrary(sfx.description, sfx.category);
      if (sample) {
        stems.push({
          type: sfx.category || 'sfx',
          source: 'library',
          uri: sample,
          sync_frame: sfx.expected_frame || null,
        });
      } else {
        const generated = await this._generateSFXAudio(sfx);
        stems.push({
          type: sfx.category || 'sfx',
          source: 'generated',
          uri: generated?.uri || null,
          sync_frame: sfx.expected_frame || null,
        });
      }
    }
    return stems;
  }

  matchFromLibrary(description, category) {
    // Library matching is file-based; returns path pattern
    // Actual file existence check happens at composition time
    if (!category) return null;

    const categoryMap = {
      footsteps: 'footsteps',
      impact: 'impacts',
      door: 'impacts',
      glass: 'impacts',
      fabric: 'foley',
      paper: 'foley',
      rain: 'ambience',
      wind: 'ambience',
      thunder: 'ambience',
      traffic: 'ambience',
    };

    const dir = categoryMap[category.toLowerCase()];
    if (!dir) return null;

    // Return a pattern that CompositionEngine can resolve
    return `${this.libraryPath}/${dir}/${(description || 'default').replace(/\s+/g, '_').slice(0, 30)}_01.wav`;
  }

  async _generateSFXAudio(sfx) {
    if (!this.gt) return { uri: null };

    try {
      const task = await this.gt.submitTask({
        task_type: 'sfx_generation',
        params: {
          prompt: sfx.description,
          duration: Math.min(sfx.duration || 5.0, 5.0),
          steps: 30,
          model: 'stable_audio',
          output_format: 'wav',
        },
        priority: 5,
      });

      const result = await this.gt.waitForTask(task.task_id, { pollInterval: 5000, maxWait: 300000 });
      return {
        uri: result?.output_url || result?.audio_url || null,
        duration: result?.duration || sfx.duration,
      };
    } catch {
      return { uri: null };
    }
  }
}

export default SFXManager;
