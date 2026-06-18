/**
 * scene-bible.js — 场景 Bible 资产管理器
 *
 * 将场景资产从"单张种子图"升级为分层 Bible 包。
 * 包含：氛围定调图 → 空间全景图 → 多机位图 → 道具特写图 + 元数据。
 *
 * 资产包结构：
 *   scene-bible/
 *     atmosphere.png        — 风格锚点（文生图）
 *     establishing.png      — 空间全景（以氛围图为风格参考）
 *     keyframe-A/B/C/D.png  — 多机位锁定 Seed + 风格参考
 *     prop-1/2.png         — 道具特写
 *     scene-meta.json      — seed/palette_lock/lighting_lock/spatial_anchors/time_lock
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';

// ── 依赖注入 ──

let _jimengClient = null;

export function injectDeps({ jimengClient }) {
  _jimengClient = jimengClient;
}

// ── 场景 Bible 资产管理器 ──

export class SceneBible {
  /**
   * @param {string} workdir — 项目工作目录
   * @param {string} sceneName — 场景名称（如 "classroom", "city_street"）
   */
  constructor(workdir, sceneName) {
    this.workdir = workdir;
    this.sceneName = sceneName;
    this._bibleDir = join(workdir, 'scene-bible', sceneName);

    // 运行时状态
    this._atmosphere = null;     // { url, seed, prompt }
    this._establishing = null;   // { url, seed, prompt }
    this._keyframes = [];        // [{ id, url, seed, prompt, shotType }]
    this._props = [];            // [{ id, url, seed, prompt, description }]
    this._spatialAnchors = null; // 空间锚点定义
    this._lightingTimeLock = null; // 光影时间锁
    this._paletteLock = null;     // 色调锁定描述
  }

  // ─── 氛围定调图 ───────────────────────────────────────

  /**
   * 生成氛围定调图（文生图）。
   * 这是整个场景的风格锚点，后续所有图都以它为风格参考。
   *
   * @param {string} prompt — 氛围描述（如 "dim warm light, wooden desks, chalk dust in air, nostalgic classroom"）
   * @param {object} [options] — { model, ratio, resolution, negative_prompt }
   * @returns {Promise<{url: string, seed: string|null}>}
   */
  async generateAtmosphere(prompt, options = {}) {
    if (!_jimengClient) throw new Error('jimengClient 未注入，请先 injectDeps()');

    const {
      model = 'jimeng-5.0',
      ratio = '16:9',
      resolution = '2k',
      negative_prompt,
    } = options;

    console.log(`[SceneBible] 🌅 生成氛围定调图: "${this.sceneName}"`);

    const results = await _jimengClient.generateImage(prompt, {
      model, ratio, resolution, negative_prompt,
    });

    if (!results?.length) throw new Error(`氛围定调图生成失败: "${this.sceneName}"`);

    this._atmosphere = {
      url: results[0].url,
      seed: results[0].seed || null,
      prompt,
      generatedAt: new Date().toISOString(),
    };

    return { url: this._atmosphere.url, seed: this._atmosphere.seed };
  }

  // ─── 空间全景图 ───────────────────────────────────────

  /**
   * 以氛围图为风格参考生成空间全景图。
   * 用 compositions API，sample_strength = 0.3 保持风格一致性。
   *
   * @param {string} atmosphereUrl — 氛围图 URL
   * @param {string} prompt — 空间描述（如 "wide shot of entire classroom, rows of wooden desks, windows on left, blackboard on front wall"）
   * @param {object} [options]
   * @returns {Promise<{url: string, seed: string|null}>}
   */
  async generateEstablishing(atmosphereUrl, prompt, options = {}) {
    if (!_jimengClient) throw new Error('jimengClient 未注入');

    const {
      model = 'jimeng-5.0',
      ratio = '16:9',
      resolution = '2k',
      sample_strength = 0.3,
      negative_prompt,
    } = options;

    if (!atmosphereUrl) throw new Error('需要氛围图 URL 作为风格参考');

    console.log(`[SceneBible] 🏛️ 生成空间全景图: "${this.sceneName}"`);

    const results = await _jimengClient.compositions(prompt, {
      images: [atmosphereUrl],
      sample_strength,
      model, ratio, resolution, negative_prompt,
    });

    if (!results?.length) throw new Error(`空间全景图生成失败: "${this.sceneName}"`);

    this._establishing = {
      url: results[0].url,
      seed: results[0].seed || null,
      prompt,
      generatedAt: new Date().toISOString(),
      atmosphereRef: atmosphereUrl,
    };

    return { url: this._establishing.url, seed: this._establishing.seed };
  }

  // ─── 多机位图 ─────────────────────────────────────────

  /**
   * 锁定 Seed + 风格参考，批量生成多机位图。
   * 每个机位以氛围图为风格参考，锁定 Seed 确保空间一致。
   *
   * @param {string} atmosphereUrl — 氛围图 URL
   * @param {string} establishingUrl — 空间全景图 URL
   * @param {Array<{id, prompt, shotType}>} shots — 机位列表
   * @param {object} [options] — { model, ratio, resolution, sample_strength, seed }
   * @returns {Promise<Array<{id, url, seed, prompt, shotType}>>}
   */
  async generateKeyframes(atmosphereUrl, establishingUrl, shots, options = {}) {
    if (!_jimengClient) throw new Error('jimengClient 未注入');

    const {
      model = 'jimeng-5.0',
      ratio = '16:9',
      resolution = '2k',
      sample_strength = 0.35,
    } = options;

    console.log(`[SceneBible] 🎬 批量生成 ${shots.length} 张多机位图: "${this.sceneName}"`);

    const keyframes = [];

    for (const shot of shots) {
      // 用氛围图+全景图作为双参考
      const refImages = [atmosphereUrl, establishingUrl].filter(Boolean);

      const results = await _jimengClient.compositions(shot.prompt, {
        images: refImages,
        sample_strength,
        model, ratio, resolution,
      });

      if (results?.length) {
        const kf = {
          id: shot.id,
          url: results[0].url,
          seed: results[0].seed || null,
          prompt: shot.prompt,
          shotType: shot.shotType || 'medium',
          generatedAt: new Date().toISOString(),
        };
        keyframes.push(kf);
      } else {
        keyframes.push({
          id: shot.id,
          url: null,
          seed: null,
          prompt: shot.prompt,
          shotType: shot.shotType || 'medium',
          error: '生成失败',
        });
      }
    }

    this._keyframes = keyframes;
    return keyframes;
  }

  // ─── 道具特写图 ────────────────────────────────────────

  /**
   * 以氛围图为风格参考生成道具特写图。
   *
   * @param {string} atmosphereUrl — 氛围图 URL
   * @param {Array<{id, prompt, description}>} props — 道具列表
   * @param {object} [options]
   * @returns {Promise<Array<{id, url, seed, prompt, description}>>}
   */
  async generateProps(atmosphereUrl, props, options = {}) {
    if (!_jimengClient) throw new Error('jimengClient 未注入');

    const {
      model = 'jimeng-5.0',
      ratio = '1:1',
      resolution = '2k',
      sample_strength = 0.4,
    } = options;

    console.log(`[SceneBible] 🔍 批量生成 ${props.length} 张道具特写图: "${this.sceneName}"`);

    const results = [];

    for (const prop of props) {
      const genResults = await _jimengClient.compositions(prop.prompt, {
        images: [atmosphereUrl],
        sample_strength,
        model, ratio, resolution,
      });

      if (genResults?.length) {
        results.push({
          id: prop.id,
          url: genResults[0].url,
          seed: genResults[0].seed || null,
          prompt: prop.prompt,
          description: prop.description || '',
          generatedAt: new Date().toISOString(),
        });
      }
    }

    this._props = results;
    return results;
  }

  // ─── 锁定设置 ─────────────────────────────────────────

  /**
   * 设置空间锚点（用于 prompt 植入和一致性检查）。
   *
   * @param {object} anchors — 空间锚点定义
   * @param {string} anchors.main_subject_position — 主角在空间中的位置
   * @param {string} anchors.key_object_positions — 关键道具相对位置
   * @param {string} [anchors.exit_entry_points] — 出入口位置
   * @param {string} [anchors.light_source_direction] — 光源方向
   */
  setSpatialAnchors(anchors) {
    this._spatialAnchors = {
      ...anchors,
      setAt: new Date().toISOString(),
    };
  }

  /**
   * 设置光影时间锁（锁定特定时间的光影条件）。
   *
   * @param {object} lock
   * @param {string} lock.timeOfDay — 时间（如 "golden_hour", "midnight", "overcast_afternoon"）
   * @param {string} lock.colorTemperature — 色温描述（如 "warm 3200K", "cool 6500K"）
   * @param {string} [lock.lightSource] — 光源类型（如 "window light from left", "fluorescent overhead"）
   * @param {string} [lock.shadowDirection] — 阴影方向（如 "shadows fall to the right"）
   */
  setLightingTimeLock(lock) {
    this._lightingTimeLock = {
      ...lock,
      setAt: new Date().toISOString(),
    };
  }

  /**
   * 设置色调锁定描述。
   *
   * @param {string} description — 色调描述（如 "desaturated teal and orange, muted contrast"）
   */
  setPaletteLock(description) {
    this._paletteLock = {
      description,
      setAt: new Date().toISOString(),
    };
  }

  // ─── 查询 ─────────────────────────────────────────────

  /**
   * 获取完整的 scene-meta.json 结构。
   *
   * @returns {object} 场景元数据
   */
  getSceneMeta() {
    return {
      sceneName: this.sceneName,
      atmosphere: this._atmosphere,
      establishing: this._establishing,
      keyframes: this._keyframes,
      props: this._props,
      spatial_anchors: this._spatialAnchors,
      lighting_time_lock: this._lightingTimeLock,
      palette_lock: this._paletteLock,
      generatedAt: new Date().toISOString(),
    };
  }

  // ─── 持久化 ─────────────────────────────────────────────

  /**
   * 将所有资产元数据持久化到 scene-meta.json。
   * 图片本身由调用方下载到 _bibleDir。
   */
  async persist() {
    const meta = this.getSceneMeta();
    const metaPath = join(this._bibleDir, 'scene-meta.json');

    await mkdir(this._bibleDir, { recursive: true });
    await writeFile(metaPath, JSON.stringify(meta, null, 2));

    console.log(`[SceneBible] 💾 持久化: "${this.sceneName}" → ${metaPath}`);
    return metaPath;
  }

  /**
   * 从文件恢复 SceneBible 实例。
   *
   * @param {string} workdir
   * @param {string} sceneName
   * @returns {Promise<SceneBible>}
   */
  static async restoreFrom(workdir, sceneName) {
    const bible = new SceneBible(workdir, sceneName);
    const metaPath = join(bible._bibleDir, 'scene-meta.json');

    try {
      await access(metaPath);
    } catch {
      throw new Error(`场景 Bible 不存在: ${metaPath}`);
    }

    const raw = await readFile(metaPath, 'utf-8');
    const meta = JSON.parse(raw);

    // 还原运行时状态
    bible._atmosphere = meta.atmosphere || null;
    bible._establishing = meta.establishing || null;
    bible._keyframes = meta.keyframes || [];
    bible._props = meta.props || [];
    bible._spatialAnchors = meta.spatial_anchors || null;
    bible._lightingTimeLock = meta.lighting_time_lock || null;
    bible._paletteLock = meta.palette_lock || null;

    console.log(`[SceneBible] 📂 恢复: "${sceneName}" (氛围${bible._atmosphere ? '✓' : '✗'}, 全景${bible._establishing ? '✓' : '✗'}, 机位${bible._keyframes.length}张, 道具${bible._props.length}张)`);
    return bible;
  }
}

export default SceneBible;
