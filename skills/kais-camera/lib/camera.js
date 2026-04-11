/**
 * kais-camera — CameraOperator
 *
 * 视频生成执行层，图片生成用 kais-jimeng，视频生成用 Evolink (Seedance 1.5 Pro)。
 * 向后兼容：未传 evolinkClient 时 fallback 到 jimeng（打印警告）。
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { buildChainPlan, executeChain, buildFilePaths, assembleFinal } from "../../../lib/extension-chain.js";
import { EvolinkClient } from "../../../lib/evolink-client.js";

const DEFAULT_MODEL = "seedance-1.5-pro";

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

/**
 * 时序锚定运动类型到中文描述的映射
 * 用于构建增强的 Seedance prompt
 */
const MOTION_TYPE_MAP = {
  "slow-push-in":      "缓慢推进镜头",
  "slow-pull-out":     "缓慢拉远镜头",
  "slow-pan-left":     "缓慢左摇镜头",
  "slow-pan-right":    "缓慢右摇镜头",
  "slow-tilt-up":      "缓慢上摇镜头",
  "slow-tilt-down":    "缓慢下摇镜头",
  "slow-zoom-in":      "缓慢缩放进入",
  "slow-zoom-out":     "缓慢缩放拉远",
  "fast-push-in":      "快速推进镜头",
  "fast-pull-out":     "快速拉远镜头",
  "fast-pan-left":     "快速左摇镜头",
  "fast-pan-right":    "快速右摇镜头",
  "fast-tilt-up":      "快速上摇镜头",
  "fast-tilt-down":    "快速下摇镜头",
  "orbit-left":        "环绕左转镜头",
  "orbit-right":       "环绕右转镜头",
  "static":            "固定镜头",
  "handheld":          "手持晃动镜头",
  "dolly-zoom":        "滑动变焦",
  "crane-up":          "摇臂上升镜头",
  "crane-down":        "摇臂下降镜头",
  "tracking":          "跟踪镜头",
  "tracking-left":     "向左跟踪镜头",
  "tracking-right":    "向右跟踪镜头",
  "whip-pan":          "甩镜头",
  "dutch-roll":        "荷兰角旋转",
};

/**
 * 将速度数值映射为中文速度描述
 * @param {number} speed - 0.0~1.0 速度值
 * @returns {string} 中文速度描述
 */
function speedToDescription(speed) {
  if (speed <= 0.2) return "极慢";
  if (speed <= 0.4) return "缓慢";
  if (speed <= 0.6) return "中速";
  if (speed <= 0.8) return "较快";
  return "极速";
}

/**
 * 将 motion_strength (0~1) 映射到 Seedance 1-5 scale
 * @param {number} strength - 0.0~1.0 强度值
 * @returns {number} 1-5 的整数
 */
function strengthToSeedanceScale(strength) {
  const clamped = Math.min(1, Math.max(0, strength));
  return Math.max(1, Math.min(5, Math.round(clamped * 5)));
}

/**
 * 从 shot.anchoring.temporal 构建增强的 Seedance prompt 后缀
 *
 * 输入示例: { motion_type: "slow-push-in", motion_speed: 0.3, camera_movement: "聚焦角色面部" }
 * 输出示例: "缓慢推进镜头，聚焦角色面部，运动平滑自然，电影级运镜"
 *
 * @param {object} temporal - 时序锚定配置
 * @returns {string|null} 增强的 prompt 片段，无有效 temporal 时返回 null
 */
function buildTemporalPrompt(temporal) {
  if (!temporal) return null;

  // 检查是否有实际可用的参数（enabled 不是必须的，有 motion_type 即视为有效）
  const motionType = temporal.motion_type;
  if (!motionType && !temporal.camera_movement) return null;

  // 如果显式 enabled: false，则跳过
  if (temporal.enabled === false) return null;

  const parts = [];

  // 1. motion_type → 运动描述
  if (motionType) {
    const motionLabel = MOTION_TYPE_MAP[motionType];
    if (motionLabel) {
      parts.push(motionLabel);
    } else {
      // 未知 motion_type，直接使用原始值作为运动描述
      parts.push(motionType.replace(/[-_]/g, " "));
    }
  }

  // 2. camera_movement → 自定义运镜描述（直接追加）
  if (temporal.camera_movement) {
    parts.push(temporal.camera_movement);
  }

  // 3. motion_speed → 速度描述
  if (temporal.motion_speed != null) {
    const speedDesc = speedToDescription(temporal.motion_speed);
    parts.push(`${speedDesc}节奏`);
  }

  // 4. 运动质量标签
  parts.push("运动平滑自然");
  parts.push("电影级运镜");

  return parts.join("，");
}

/**
 * 从 shot.anchoring.temporal 提取 Seedance motion_strength (1-5 scale)
 * @param {object} temporal - 时序锚定配置
 * @returns {number|null} 1-5 整数，无配置时返回 null
 */
function extractSeedanceStrength(temporal) {
  if (!temporal || temporal.motion_strength == null) return null;
  if (temporal.enabled === false) return null;
  return strengthToSeedanceScale(temporal.motion_strength);
}

export class CameraOperator {
  /**
   * @param {import('./jimeng-client.js').JimengClient} jimengClient - 即梦客户端（生图）
   * @param {object} config
   * @param {string} config.outputDir - 输出目录
   * @param {number} config.maxRetries - 最大重试次数（默认 3）
   * @param {import('../../../lib/evolink-client.js').EvolinkClient} [config.evolinkClient] - Evolink 客户端（生视频）
   */
  constructor(jimengClient, config = {}) {
    this.client = jimengClient; // jimeng — 继续负责生图
    this.evolinkClient = config.evolinkClient || null;
    this.outputDir = config.outputDir || "/tmp/openclaw/videos";
    this.maxRetries = config.maxRetries ?? 3;

    // 向后兼容警告
    if (!this.evolinkClient) {
      console.warn("[CameraOperator] 未传入 evolinkClient，视频生成将 fallback 到 jimeng（不推荐）");
    }

    // 追踪状态
    this._clips = [];
    this._costs = [];
    this._startTime = null;
  }

  /** 是否使用 evolink */
  get _useEvolink() {
    return !!this.evolinkClient;
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

    // ── 时序锚定：从 shot.anchoring.temporal 构建增强 prompt ──
    const temporal = shot.anchoring?.temporal;
    const temporalSuffix = buildTemporalPrompt(temporal);
    const temporalStrength = extractSeedanceStrength(temporal);

    // 确保输出目录存在
    await mkdir(this.outputDir, { recursive: true });

    // 尝试视频生成（L1 → L2 → L3）
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      attempts++;
      let params = attempt === 0 ? apiParams : applyRetryStrategy(shot, attempt);

      try {
        // ── 时序锚定增强：在 Seedance prompt 中注入运动描述 ──
        if (temporalSuffix && attempt === 0) {
          // 仅首次尝试注入完整 temporal，重试时降级策略已简化 prompt
          const originalPrompt = params.prompt || "";
          // 避免重复注入（如果 prompt 已包含 temporal 内容）
          if (!originalPrompt.includes(temporalSuffix)) {
            params = { ...params, prompt: `${originalPrompt}，${temporalSuffix}` };
          }
        }

        if (dryRun) {
          result = {
            shot_id: shotId,
            status: "success",
            url: join(this.outputDir, `${shotId}.mp4`),
            mode: "dry-run",
            attempts,
            duration: params.duration || 4,
            cost: 0.05,
            temporal_enhanced: !!temporalSuffix,
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
        if (params.model?.includes("seedance") || filePaths.length > 0 || this._useEvolink) {
          const localPath = join(this.outputDir, `${shotId}.mp4`);

          if (this._useEvolink) {
            // ── Evolink 路径 ──
            const evolinkOptions = {
              model: params.model || DEFAULT_MODEL,
              aspect_ratio: params.ratio || "16:9",
              duration: params.duration || 4,
              image_urls: filePaths.length > 0 ? filePaths : [],
              outputPath: localPath,
            };
            const videoResult = await this.evolinkClient.generateVideo(params.prompt, evolinkOptions);

            result = {
              shot_id: shotId,
              status: "success",
              url: videoResult.localPath || localPath,
              mode: "evolink-seedance",
              attempts,
              duration: params.duration || 4,
              cost: 0.05 * attempts,
              temporal_enhanced: !!temporalSuffix,
              taskId: videoResult.taskId,
            };
          } else {
            // ── Fallback: jimeng 路径（向后兼容） ──
            const seedanceOptions = {
              model: params.model || "jimeng-video-seedance-2.0-fast",
              ratio: params.ratio || "16:9",
              duration: params.duration || 4,
            };
            if (temporalStrength != null) {
              seedanceOptions.motion_strength = temporalStrength;
            }

            const videoUrl = await this.generateSeedanceVideo(params.prompt, filePaths, seedanceOptions);
            await this.client.download(videoUrl, localPath);

            result = {
              shot_id: shotId,
              status: "success",
              url: localPath,
              mode: "seedance",
              attempts,
              duration: params.duration || 4,
              cost: 0.05 * attempts,
              temporal_enhanced: !!temporalSuffix,
            };
          }
          this._costs.push({ shot_id: shotId, cost: 0.05, attempts });
          break;
        } else {
          // 普通视频模型（jimeng）
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
   * 检测 shots 是否为延长链模式
   * 判断依据：所有 shot 都有 end_frame 字段
   */
  _isChainMode(shots) {
    return shots.length > 0 && shots.every(s => s.end_frame);
  }

  /**
   * 延长链模式：使用 extension-chain 引擎执行
   * @param {object} shootingScript - ShootingScript（shots 含 end_frame）
   * @param {object} options
   * @param {string} options.ttsPath - 完整 TTS 音频路径
   * @param {string} options.bgmPath - 完整 BGM 音频路径
   * @param {function} options.onProgress - 进度回调
   * @param {function} options.onPhaseComplete - 阶段完成回调
   * @returns {Promise<object>} ChainResult
   */
  async executeChainMode(shootingScript, options = {}) {
    const shots = shootingScript.shots || [];
    if (!this._isChainMode(shots)) {
      throw new Error('executeChainMode: 并非所有 shot 都有 end_frame 字段');
    }

    const chainOutputDir = join(this.outputDir, 'chain');
    await mkdir(chainOutputDir, { recursive: true });

    // 1. 构建延长链计划
    const plan = buildChainPlan(shots, chainOutputDir);

    // 2. 执行延长链
    const self = this;
    const chainResult = await executeChain(plan, {
      ttsPath: options.ttsPath,
      bgmPath: options.bgmPath,
      retryCount: this.maxRetries,
      onProgress: options.onProgress,
      async generate(shot) {
        // 构建正确的 file_paths
        const filePaths = buildFilePaths(shot);
        const prompt = shot.prompt;

        if (self._useEvolink) {
          // ── Evolink 路径 ──
          await mkdir(dirname(shot.videoPath), { recursive: true });
          const videoResult = await self.evolinkClient.generateVideo(prompt, {
            model: DEFAULT_MODEL,
            aspect_ratio: shot.ratio || '16:9',
            duration: shot.duration || 4,
            image_urls: filePaths,
            outputPath: shot.videoPath,
          });
          return videoResult.url;
        } else {
          // ── Fallback: jimeng 路径 ──
          const seedanceOptions = {
            model: 'jimeng-video-seedance-2.0-fast',
            ratio: '16:9',
            duration: shot.duration || 4,
          };

          const temporal = shot.anchoring?.temporal;
          const temporalStrength = extractSeedanceStrength(temporal);
          if (temporalStrength != null) {
            seedanceOptions.motion_strength = temporalStrength;
          }

          const videoUrl = await self.generateSeedanceVideo(prompt, filePaths, seedanceOptions);
          await mkdir(dirname(shot.videoPath), { recursive: true });
          await self.client.download(videoUrl, shot.videoPath);
          return videoUrl;
        }
      },
    });

    // 3. 如果全部成功，合并最终视频
    if (chainResult.success && chainResult.videos.length > 1) {
      const videoPaths = chainResult.videos.map(v => {
        const shot = plan.shots[v.index];
        return shot.videoPath;
      });
      const finalPath = join(this.outputDir, 'chain_final.mp4');
      try {
        await assembleFinal(videoPaths, options.bgmPath, finalPath);
        chainResult.finalVideo = finalPath;
      } catch (e) {
        console.warn(`[CameraOperator] 延长链合并失败: ${e.message}`);
        chainResult.finalVideo = null;
      }
    }

    return chainResult;
  }

  /**
   * 批量执行所有镜头
   * 自动检测是否为延长链模式（shots 含 end_frame），选择对应执行路径
   * @param {object} shootingScript - ShootingScript
   * @param {object} options
   * @param {number} options.concurrency - 并发数（默认 1）
   * @param {function} options.onProgress - 进度回调 (current, total, shotId)
   * @param {function} options.onShotComplete - 单镜头完成回调 (clip)
   * @param {string} options.ttsPath - TTS 音频路径（延长链模式使用）
   * @param {string} options.bgmPath - BGM 音频路径（延长链模式使用）
   * @returns {Promise<object>} VideoClipList 或 ChainResult
   */
  async executeAll(shootingScript, options = {}) {
    const { concurrency = 1, onProgress, onShotComplete } = options;
    const shots = shootingScript.shots || [];
    this._clips = [];
    this._costs = [];
    this._startTime = Date.now();

    // 延长链模式：所有 shot 都有 end_frame → 使用 extension-chain
    if (this._isChainMode(shots)) {
      const chainResult = await this.executeChainMode(shootingScript, options);
      // 统一为 VideoClipList 格式
      return {
        type: 'VideoClipList',
        version: '3.0',
        mode: 'extension-chain',
        clips: chainResult.videos.map(v => {
          const shot = chainResult._plan?.shots?.[v.index];
          return {
            shot_id: v.shotId,
            status: 'success',
            url: shot?.videoPath || null,
            mode: 'chain',
            duration: v.duration,
          };
        }),
        chain: chainResult,
        total_cost: 0.05 * chainResult.videos.length,
        total_duration: chainResult.totalDuration,
        success_rate: chainResult.videos.length / shots.length,
      };
    }

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
