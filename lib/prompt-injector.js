/**
 * PromptInjector — Prompt 自动注入器 (V2)
 *
 * 所有 GPU 任务的 prompt 不再由 Phase 手写，而是按固定顺序自动拼接：
 * [art-bible.style_anchor] + [art-bible.lighting_rules]
 * + [character.core_prompt] + [scene.core_prompt]
 * + [shot-list.camera指令] + [原始prompt]
 */
import { AssetBus } from './asset-bus.js';

export class PromptInjector {
  constructor(assetBus) {
    this._bus = assetBus;
  }

  async inject(rawPrompt, options = {}) {
    const parts = [];
    const mode = options.mode || null;

    // Art bible anchor
    if (!options.skipArtBible) {
      const bible = await this._bus.read('art-bible');
      if (bible) {
        if (bible.style_anchor) {
          let anchor = bible.style_anchor;
          if (mode?.performance_format) anchor += ', performance-oriented animation acting';
          parts.push(anchor);
        }
        if (bible.lighting_rules) parts.push(bible.lighting_rules);
      }
    }

    // Character core prompt
    if (options.character && !options.skipCharacter) {
      const charAssets = await this._bus.read('character-assets');
      if (charAssets?.characters) {
        const char = charAssets.characters.find(c => c.name === options.character);
        if (char?.core_prompt) parts.push(char.core_prompt);
      }
    }

    // Scene core prompt
    if (options.scene && !options.skipScene) {
      const sceneAssets = await this._bus.read('scene-assets');
      if (sceneAssets?.scenes) {
        const scene = sceneAssets.scenes.find(s => s.id === options.scene);
        if (scene?.core_prompt) parts.push(scene.core_prompt);
      }
    }

    // Shot camera directive
    if (options.shotId && !options.skipShot) {
      const shotList = await this._bus.read('shot-list');
      if (shotList?.shots) {
        const shot = shotList.shots.find(s => s.id === options.shotId);
        if (shot) {
          const camParts = [shot.shot_size, shot.angle, shot.movement, `focal ${shot.lens}`]
            .filter(Boolean);
          if (camParts.length) parts.push(camParts.join(', '));
        }
      }
    }

    // Original prompt last
    if (rawPrompt) parts.push(rawPrompt);

    // V4.1: Audio-visual fusion — SFX hints embedded in video prompt
    if (options.audioEvent) parts.push(options.audioEvent);

    // V4.1: Reverb hint for acoustic context
    if (options.reverbHint) parts.push(options.reverbHint);

    // Mode-aware: enhanced SFX hint
    if (mode?.fixed_rules?.sfx === 'enhanced') {
      parts.push('enhanced sound design, detailed foley, rich ambient audio');
    }

    return parts.join(', ');
  }

  async injectNegative(options = {}) {
    const base = 'low quality, blurry, watermark, text, deformed, ugly, bad anatomy';
    const mode = options.mode || null;
    if (mode?.fixed_rules?.subtitle === 'disabled') {
      return base + ', subtitles, text overlay, on-screen text';
    }
    return base;
  }

  /**
   * Generate IP triple-view prompt for character or prop.
   * @param {string} name - Character or prop name
   * @param {'character'|'prop'} type
   * @returns {string}
   */
  injectIPDesignPrompt(name, type) {
    if (type === 'prop') {
      return `为下面道具设计IP三视图，并标注和展示道具细节特写，左上角标题'${name}道具IP设计图'，大师级排版，浅灰色纯色背景。`;
    }
    return `为下面角色设计IP三视图，并标注和展示服饰细节特写，左上角标题'${name}角色IP设计图'，大师级排版，浅灰色纯色背景。`;
  }
}

export default PromptInjector;
