/**
 * PromptInjector — Prompt 自动注入器 (V3)
 *
 * 集成 L1/L2 双参考系统一致性策略：
 *   - 含角色场景：注入 art-bible + scene + camera + action，**不注入面部描述**
 *   - feature_lock 通过 compositions API 的 images 字段传递，不写进 prompt
 *   - 视频场景：注入 @Image N 绑定语法（Seedance 2.0 omni_reference）
 *
 * 注入顺序（图片生成）：
 *   [art-bible.style_anchor] + [art-bible.lighting_rules]
 *   + [scene.core_prompt]
 *   + [shot-list.camera指令]
 *   + [原始 action/scene prompt]
 *   + [CONSISTENCY LOCK（仅降级模式）]
 *
 * 注入顺序（视频生成）：
 *   [@Image 绑定声明] + [art-bible] + [scene] + [camera]
 *   + [原始 action prompt]
 *
 * 2026-06-18: 零面部描述策略 — 面部特征通过参考图传递，prompt 不写面部
 */
import { AssetBus } from './asset-bus.js';

export class PromptInjector {
  constructor(assetBus) {
    this._bus = assetBus;
  }

  /**
   * 注入图片生成 prompt（compositions API 用）。
   *
   * 核心变化：不再注入 character.core_prompt（含面部描述），
   * 面部特征通过 compositions 的 images 字段 + L1 身份锚点传递。
   *
   * @param {string} rawPrompt — 动作/场景描述（不含面部）
   * @param {object} options
   * @param {string} [options.mode] — 生产模式
   * @param {string} [options.character] — 角色名（用于获取 feature_lock 降级注入）
   * @param {string} [options.scene] — 场景 ID
   * @param {string} [options.shotId] — 镜头 ID
   * @param {boolean} [options.useConsistencyLock] — 降级时启用 CONSISTENCY LOCK 文本
   * @param {boolean} [options.skipArtBible] — 跳过 art-bible
   * @param {string} [options.audioEvent] — 音效提示
   * @param {string} [options.reverbHint] — 混响提示
   * @returns {Promise<string>}
   */
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

    // ⚠️ V3 变化：不再注入 character.core_prompt（面部描述）
    // 面部特征通过 compositions API 的 images 字段传递
    // 仅在降级模式（无参考图）时才注入 feature_lock 文本约束
    if (options.useConsistencyLock && options.character && !options.skipCharacter) {
      const featureLock = this._getFeatureLock(options.character);
      if (featureLock) {
        parts.push(this._buildConsistencyLockText(featureLock));
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

    // Original prompt last（动作/场景描述，零面部描述）
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

  /**
   * 注入视频生成 prompt（Seedance 2.0 omni_reference 用）。
   *
   * 核心变化：加入 @Image N 绑定语法，声明参考图用途。
   *
   * @param {string} rawPrompt — 动作/场景描述
   * @param {object} options
   * @param {string[]} options.identityImageRefs — @Image 绑定声明（如 ["@Image1", "@Image2"]）
   * @param {string[]} [options.sceneImageRefs] — 场景/服装 @Image 绑定
   * @param {string[]} [options.videoRefs] — 动作参考 @Video 绑定
   * @param {string} [options.scene] — 场景 ID
   * @param {string} [options.shotId] — 镜头 ID
   * @param {string} [options.audioEvent] — 音效提示
   * @returns {Promise<string>}
   */
  async injectVideoPrompt(rawPrompt, options = {}) {
    const parts = [];

    // @Image/@Video 绑定声明
    const { identityImageRefs = [], sceneImageRefs = [], videoRefs = [] } = options;

    if (identityImageRefs.length) {
      const idList = identityImageRefs.join(' and ');
      parts.push(`${idList} provides the character's exact facial features, hairstyle and skin tone throughout the entire video.`);
    }

    if (sceneImageRefs.length) {
      const sceneList = sceneImageRefs.join(' and ');
      parts.push(`${sceneList} provides the current costume, pose reference and scene composition.`);
    }

    if (videoRefs.length) {
      const videoList = videoRefs.join(' and ');
      parts.push(`Reference ${videoList} for motion style only (30% weight). Do not alter the character's face.`);
    }

    // Art bible
    const bible = await this._bus.read('art-bible');
    if (bible) {
      if (bible.style_anchor) parts.push(bible.style_anchor);
      if (bible.lighting_rules) parts.push(bible.lighting_rules);
    }

    // Scene + camera
    if (options.scene) {
      const sceneAssets = await this._bus.read('scene-assets');
      if (sceneAssets?.scenes) {
        const scene = sceneAssets.scenes.find(s => s.id === options.scene);
        if (scene?.core_prompt) parts.push(scene.core_prompt);
      }
    }

    if (options.shotId) {
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

    // 原始 prompt（动作/场景描述，零面部描述）
    if (rawPrompt) parts.push(rawPrompt);

    // 一致性强制声明
    parts.push('keep skin tone and hair color exactly same as reference. cinematic lighting, 4k quality.');

    // Audio hints
    if (options.audioEvent) parts.push(options.audioEvent);

    return parts.join('. ');
  }

  /**
   * 注入负面 prompt。
   */
  async injectNegative(options = {}) {
    const base = 'low quality, blurry, watermark, text, deformed, ugly, bad anatomy';
    const mode = options.mode || null;
    if (mode?.fixed_rules?.subtitle === 'disabled') {
      return base + ', subtitles, text overlay, on-screen text';
    }
    return base;
  }

  /**
   * 生成 IP 三视图设计 prompt。
   */
  injectIPDesignPrompt(name, type) {
    if (type === 'prop') {
      return `为下面道具设计IP三视图，并标注和展示道具细节特写，左上角标题'${name}道具IP设计图'，大师级排版，浅灰色纯色背景。`;
    }
    return `为下面角色设计IP三视图，并标注和展示服饰细节特写，左上角标题'${name}角色IP设计图'，大师级排版，浅灰色纯色背景。`;
  }

  // ─── 内部方法 ──────────────────────────────────────────

  /**
   * 从 AssetBus 获取角色的 feature_lock。
   * @private
   */
  async _getFeatureLock(characterName) {
    const charAssets = await this._bus.read('character-assets');
    if (!charAssets?.characters) return null;
    const char = charAssets.characters.find(c => c.name === characterName);
    return char?.feature_lock || null;
  }

  /**
   * 构建 CONSISTENCY LOCK 文本（降级模式，无参考图时使用）。
   * @private
   */
  _buildConsistencyLockText(featureLock) {
    const lockParts = [];
    if (featureLock.hair) lockParts.push(`same ${featureLock.hair}`);
    if (featureLock.eyes) lockParts.push(`same ${featureLock.eyes}`);
    if (featureLock.clothing) lockParts.push(`same ${featureLock.clothing}`);
    if (featureLock.distinctive) lockParts.push(`same ${featureLock.distinctive}`);
    if (!lockParts.length) return '';
    return `CONSISTENCY LOCK: This is the SAME character as the reference image. ${lockParts.join(', ')}. DO NOT change appearance.`;
  }
}

export default PromptInjector;
