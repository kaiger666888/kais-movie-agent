/**
 * video-chain.js — 多镜头视频链式生成器
 *
 * 核心原则：前序视频截图包含「人物与场景的真实互动关系」，
 * 比静态空间全景图更能保持连贯性。
 *
 * 策略：
 *   - 首段镜头：氛围图 + 空间全景图 + 角色参考图
 *   - 后续段镜头：前序视频截图（替代空间全景图）+ 角色参考图
 *   - 视频截图作为场景参考，捕捉真实的空间-人物互动关系
 */

import { execSync, exec as execCb } from 'node:child_process';
import { writeFile, mkdir, unlink } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(execCb);

export class VideoChain {
  /**
   * @param {object} jimengClient — 即梦客户端实例
   * @param {object} [options]
   * @param {string} [options.tempDir] — 临时文件目录（默认 /tmp/video-chain）
   * @param {number} [options.keyframeCount] — 每段视频截取关键帧数量（默认 3）
   */
  constructor(jimengClient, options = {}) {
    this._client = jimengClient;
    this._tempDir = options.tempDir || '/tmp/video-chain';
    this._keyframeCount = options.keyframeCount || 3;
  }

  /**
   * 生成场景完整视频链（多镜头按序生成）。
   *
   * @param {object} scene — 场景信息 { id, name }
   * @param {Array<{id, prompt, duration?, cameraMovement?}>} shots — 镜头列表
   * @param {string} atmosphereImg — 氛围图 URL/路径
   * @param {string} establishingImg — 空间全景图 URL/路径
   * @param {Array<string>} charRefs — 角色参考图 URL/路径数组
   * @param {object} [options] — { model, ratio, seed, onProgress }
   * @returns {Promise<Array<{shotId, videoUrl, keyframes: string[]}>>}
   */
  async generateSceneChain(scene, shots, atmosphereImg, establishingImg, charRefs, options = {}) {
    const {
      model = 'jimeng-video-seedance-2.0',
      ratio = '16:9',
      seed,
      onProgress,
    } = options;

    const chain = [];
    let prevVideoUrl = null; // 上一段视频（用于截图提取场景参考）
    let prevKeyframes = []; // 上一段的关键帧截图

    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      onProgress?.(i, shots.length, `镜头 ${i + 1}/${shots.length}: ${shot.id}`);

      // 组装参考图
      let sceneRefImages;

      if (i === 0) {
        // 首段：氛围图 + 空间全景图
        sceneRefImages = [atmosphereImg, establishingImg].filter(Boolean);
      } else {
        // 后续段：前序视频截图替代空间全景图
        sceneRefImages = [atmosphereImg, ...prevKeyframes.slice(0, 2)].filter(Boolean);
      }

      const allRefs = [...charRefs, ...sceneRefImages];

      // 生成单镜头视频
      const videoUrl = await this.generateSingleShot(allRefs, shot.prompt, {
        model, ratio,
        duration: shot.duration || 5,
        seed: seed != null ? seed + i : undefined,
        cameraMovement: shot.cameraMovement,
      });

      // 从视频截取关键帧（用于下一段参考）
      const keyframes = await this._extractAndSaveKeyframes(videoUrl, shot.id, i);

      chain.push({
        shotId: shot.id,
        videoUrl,
        keyframes,
      });

      prevVideoUrl = videoUrl;
      prevKeyframes = keyframes;

      console.log(`[VideoChain] ✅ 镜头 ${i + 1}/${shots.length} "${shot.id}" 完成`);
    }

    return chain;
  }

  /**
   * 从视频中均匀截取关键帧。
   *
   * @param {string} videoPath — 视频文件路径（本地）
   * @param {number} [count=3] — 截取数量
   * @returns {Promise<string[]>} 关键帧图片路径数组
   */
  async extractKeyFrames(videoPath, count = 3) {
    return this._extractAndSaveKeyframes(videoPath, 'manual', 0, count);
  }

  /**
   * 生成单镜头视频（使用 Seedance 2.0）。
   *
   * @param {string[]} refs — 参考图 URL/路径数组
   * @param {string} prompt — 镜头描述
   * @param {object} [options]
   * @returns {Promise<string>} 视频 URL
   */
  async generateSingleShot(refs, prompt, options = {}) {
    const {
      model = 'jimeng-video-seedance-2.0',
      ratio = '16:9',
      duration = 5,
      seed,
      cameraMovement,
    } = options;

    if (!refs.length) {
      throw new Error('generateSingleShot 需要至少 1 张参考图');
    }

    // 构建含 @Image 绑定的 prompt
    const fullPrompt = this._buildOmniPrompt(prompt, refs, cameraMovement);

    const url = await this._client.omniReferenceVideo(fullPrompt, {
      identityImages: refs.slice(0, 3), // 前3张作为身份参考
      sceneImages: refs.slice(3),       // 后续作为场景参考
    }, { model, ratio, duration, seed });

    return url;
  }

  // ─── 内部实现 ──────────────────────────────────────────

  /**
   * 构建 Seedance omni_reference prompt。
   */
  _buildOmniPrompt(prompt, refs, cameraMovement) {
    const parts = [];

    // 身份绑定
    if (refs.length >= 1) {
      parts.push(`@Image1 provides the character's exact facial features. The character must look exactly like @Image1 throughout.`);
    }

    // 场景参考绑定
    if (refs.length > 1) {
      parts.push(`@Image${refs.length} and nearby images provide the scene environment reference. Maintain spatial consistency with these references.`);
    }

    if (cameraMovement) parts.push(cameraMovement);
    parts.push(prompt);
    parts.push('keep skin tone, hair color and clothing exactly same as reference. cinematic lighting, 4k quality.');

    return parts.join('. ');
  }

  /**
   * 从视频 URL 下载并截取关键帧到临时目录。
   */
  async _extractAndSaveKeyframes(videoUrl, shotId, shotIndex, count = null) {
    const numFrames = count || this._keyframeCount;
    const dir = join(this._tempDir, `shot-${shotId || shotIndex}`);

    await mkdir(dir, { recursive: true });

    // 下载视频
    const videoPath = join(dir, 'source.mp4');
    try {
      await this._client.download(videoUrl, videoPath);
    } catch (err) {
      console.warn(`[VideoChain] ⚠️ 下载视频失败，跳过关键帧提取: ${err.message}`);
      return [];
    }

    const keyframes = [];
    try {
      // 获取视频时长
      let duration = 5;
      try {
        const { stdout } = await execAsync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
        );
        duration = parseFloat(stdout.trim()) || 5;
      } catch { /* 默认 5 秒 */ }

      // 均匀截取关键帧
      for (let i = 0; i < numFrames; i++) {
        const timestamp = (duration / (numFrames + 1)) * (i + 1);
        const outPath = join(dir, `keyframe-${i + 1}.jpg`);

        try {
          await execAsync(
            `ffmpeg -ss ${timestamp.toFixed(2)} -i "${videoPath}" -frames:v 1 -q:v 2 "${outPath}" -y`
          );
          keyframes.push(outPath);
        } catch {
          console.warn(`[VideoChain] ⚠️ 截取关键帧 ${i + 1} 失败`);
        }
      }
    } finally {
      // 清理临时视频文件（保留关键帧图片）
      try { await unlink(videoPath); } catch { /* ignore */ }
    }

    return keyframes;
  }
}

export default VideoChain;
