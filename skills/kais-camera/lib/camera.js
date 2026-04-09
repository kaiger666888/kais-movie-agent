/**
 * kais-camera — CameraOperator
 *
 * 视频生成执行层，封装 kais-jimeng 的视频生成能力。
 * 支持 Seedance 异步生成、重试降级、静态图 fallback。
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

/**
 * 降级策略：根据重试次数调整参数
 * L1 → L2 → L3 → L4(静态图)
 */
function applyRetryStrategy(shot, attempt) {
  const params = { ...shot.api_params };
  const seed = shot.seed || 0;

  if (attempt === 1) {
    // L2: 简化 prompt，降低运动
    params.prompt = simplifyPrompt(params.prompt, "moderate");
    params.duration = Math.max(2, (params.duration || 4) - 1);
    params.seed = seed + 1000;
  } else if (attempt === 2) {
    // L3: 极简 prompt
    params.prompt = simplifyPrompt(params.prompt, "minimal");
    params.duration = 3;
    params.seed = seed + 2000;
  }
  // attempt >= 3: 降级为静态图，在 executeShot 中处理

  return params;
}

function simplifyPrompt(prompt, level) {
  if (level === "moderate") {
    // 去除风格和光影描述，保留主体+动作+场景
    return prompt
      .replace(/,\s*(cinematic|film grain|anamorphic|4K|8K|high quality|masterpiece)/gi, "")
      .replace(/,\s*(golden hour|backlight|soft shadows|dramatic lighting)[^,.]*/gi, "")
      .replace(/,\s*(subtle|gentle|slight|slow)[^,.]*(movement|breathing|blur)/gi, "")
      .trim();
  }
  if (level === "minimal") {
    // 仅保留第一句（主体+动作）
    const firstSentence = prompt.match(/^[^.!?\n]+[.!?\n]/);
    return firstSentence ? firstSentence[0].trim().replace(/[.!?\n]$/, "") : prompt.split(",")[0].trim();
  }
  return prompt;
}

export class CameraOperator {
  /**
   * @param {import('./jimeng-client.js').JimengClient} jimengClient
   * @param {object} config
   * @param {string} config.outputDir - 输出目录
   * @param {number} config.maxRetries - 最大重试次数（默认 3）
   */
  constructor(jimengClient, config = {}) {
    this.client = jimengClient;
    this.outputDir = config.outputDir || "/tmp/openclaw/videos";
    this.maxRetries = config.maxRetries ?? 3;

    // 追踪状态
    this._clips = [];
    this._costs = [];
    this._startTime = null;
  }

  /**
   * 执行单个镜头
   * @param {object} shot - VideoShot from ShootingScript
   * @param {object} options
   * @returns {Promise<object>} VideoClip
   */
  async executeShot(shot, options = {}) {
    const { dryRun = false } = options;
    const shotId = shot.shot_id;
    const apiParams = shot.api_params;
    let attempts = 0;
    let lastError = null;
    let result = null;

    // 确保输出目录存在
    await mkdir(this.outputDir, { recursive: true });

    // 尝试视频生成（L1 → L2 → L3）
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      attempts++;
      const params = attempt === 0 ? apiParams : applyRetryStrategy(shot, attempt);

      try {
        if (dryRun) {
          result = {
            shot_id: shotId,
            status: "success",
            url: join(this.outputDir, `${shotId}.mp4`),
            mode: "dry-run",
            attempts,
            duration: params.duration || 4,
            cost: 0.05,
          };
          break;
        }

        // 判断是否需要先文生图
        let filePaths = params.file_paths || [];

        if (!filePaths.length && params.model?.includes("seedance")) {
          // Seedance 需要素材 → 先文生图
          const images = await this.client.generateImage(params.prompt, {
            model: "jimeng-5.0",
            ratio: params.ratio || "16:9",
            resolution: "2k",
            seed: params.seed || shot.seed,
          });
          if (images.length > 0) {
            filePaths = [images[0].url];
          }
        }

        // 生成视频
        if (params.model?.includes("seedance") || filePaths.length > 0) {
          const videoUrl = await this.generateSeedanceVideo(params.prompt, filePaths, {
            model: params.model || "jimeng-video-seedance-2.0-fast",
            ratio: params.ratio || "16:9",
            duration: params.duration || 4,
          });

          // 下载到本地
          const localPath = join(this.outputDir, `${shotId}.mp4`);
          await this.client.download(videoUrl, localPath);

          result = {
            shot_id: shotId,
            status: "success",
            url: localPath,
            mode: "seedance",
            attempts,
            duration: params.duration || 4,
            cost: 0.05 * attempts,
          };
          this._costs.push({ shot_id: shotId, cost: 0.05, attempts });
          break;
        } else {
          // 普通视频模型
          const videoUrl = await this.client.generateVideo(params.prompt, {
            model: params.model || "jimeng-video-3.5-pro",
            ratio: params.ratio || "16:9",
            duration: params.duration || 5,
          });

          if (videoUrl) {
            const localPath = join(this.outputDir, `${shotId}.mp4`);
            await this.client.download(videoUrl, localPath);

            result = {
              shot_id: shotId,
              status: "success",
              url: localPath,
              mode: "video-model",
              attempts,
              duration: params.duration || 5,
              cost: 0.05 * attempts,
            };
            this._costs.push({ shot_id: shotId, cost: 0.05, attempts });
            break;
          }
        }
      } catch (err) {
        lastError = err;
        console.warn(`[CameraOperator] ${shotId} attempt ${attempt + 1} failed: ${err.message}`);
      }
    }

    // 所有重试失败 → 降级为静态图
    if (!result) {
      result = await this.fallbackToImage(shot);
    }

    this._clips.push(result);
    return result;
  }

  /**
   * 批量执行所有镜头
   * @param {object} shootingScript - ShootingScript
   * @param {object} options
   * @param {number} options.concurrency - 并发数（默认 1）
   * @param {function} options.onProgress - 进度回调 (current, total, shotId)
   * @param {function} options.onShotComplete - 单镜头完成回调 (clip)
   * @returns {Promise<object>} VideoClipList
   */
  async executeAll(shootingScript, options = {}) {
    const { concurrency = 1, onProgress, onShotComplete } = options;
    const shots = shootingScript.shots || [];
    this._clips = [];
    this._costs = [];
    this._startTime = Date.now();

    // 信号量控制并发
    const semaphore = new Semaphore(concurrency);
    const results = [];

    const tasks = shots.map(async (shot) => {
      await semaphore.acquire();
      try {
        onProgress?.(results.length + 1, shots.length, shot.shot_id);
        const clip = await this.executeShot(shot);
        results.push(clip);
        onShotComplete?.(clip);
        return clip;
      } finally {
        semaphore.release();
      }
    });

    await Promise.all(tasks);

    return {
      type: "VideoClipList",
      version: "3.0",
      clips: this._clips,
      total_cost: this._costs.reduce((s, c) => s + c.cost, 0),
      total_duration: this._clips.reduce((s, c) => s + (c.duration || 0), 0),
      success_rate: this._clips.filter(c => c.status === "success").length / shots.length,
    };
  }

  /**
   * Seedance 异步视频生成
   */
  async generateSeedanceVideo(prompt, filePaths, options = {}) {
    if (!filePaths.length) {
      throw new Error("Seedance 需要素材文件 (file_paths)");
    }

    const { model = "jimeng-video-seedance-2.0-fast", ratio = "16:9", duration = 4 } = options;

    // 提交异步任务
    const taskId = await this.client.submitSeedanceTask(prompt, filePaths, { model, ratio, duration });
    if (!taskId) throw new Error("Seedance 任务提交失败，无 task_id");

    // 轮询等待结果
    const videoUrl = await this.client.pollTask(taskId);
    return videoUrl;
  }

  /**
   * 降级为静态图（表型可塑性）
   */
  async fallbackToImage(shot) {
    const shotId = shot.shot_id;
    const fallbackParams = shot.fallback || shot.api_params;
    const prompt = simplifyPrompt(fallbackParams.prompt, "minimal");

    try {
      const images = await this.client.generateImage(prompt, {
        model: "jimeng-5.0",
        ratio: fallbackParams.ratio || "16:9",
        resolution: "2k",
        seed: shot.seed || 0,
      });

      if (images.length > 0) {
        const localPath = join(this.outputDir, `${shotId}_fallback.png`);
        await this.client.download(images[0].url, localPath);

        const clip = {
          shot_id: shotId,
          status: "fallback",
          url: localPath,
          mode: "image",
          attempts: this.maxRetries + 1,
          duration: 0,
          cost: 0.05 * (this.maxRetries + 1),
          fallback_reason: "视频生成3次失败，降级为静态图",
        };
        this._costs.push({ shot_id: shotId, cost: clip.cost, attempts: clip.attempts });
        return clip;
      }
    } catch (err) {
      console.error(`[CameraOperator] ${shotId} 静态图 fallback 也失败: ${err.message}`);
    }

    return {
      shot_id: shotId,
      status: "failed",
      url: null,
      mode: "none",
      attempts: this.maxRetries + 1,
      duration: 0,
      cost: 0.05 * (this.maxRetries + 1),
      error: "所有尝试均失败",
    };
  }

  /**
   * 获取当前进度
   */
  getProgress() {
    const total = this._clips.length;
    const success = this._clips.filter(c => c.status === "success").length;
    const fallback = this._clips.filter(c => c.status === "fallback").length;
    const failed = this._clips.filter(c => c.status === "failed").length;
    const elapsed = this._startTime ? ((Date.now() - this._startTime) / 1000).toFixed(1) : "0";

    return { total, success, fallback, failed, elapsed_seconds: Number(elapsed) };
  }

  /**
   * 获取成本报告
   */
  getCostReport() {
    const totalCost = this._costs.reduce((s, c) => s + c.cost, 0);
    const totalAttempts = this._costs.reduce((s, c) => s + c.attempts, 0);
    return {
      total_cost: totalCost,
      total_attempts: totalAttempts,
      avg_attempts: this._costs.length ? (totalAttempts / this._costs.length).toFixed(1) : 0,
      details: this._costs,
    };
  }
}

/** 简单信号量 */
class Semaphore {
  constructor(max) {
    this.max = max;
    this.current = 0;
    this.queue = [];
  }
  acquire() {
    if (this.current < this.max) {
      this.current++;
      return Promise.resolve();
    }
    return new Promise(resolve => this.queue.push(resolve));
  }
  release() {
    this.current--;
    if (this.queue.length > 0) {
      this.current++;
      this.queue.shift()();
    }
  }
}

export default CameraOperator;
