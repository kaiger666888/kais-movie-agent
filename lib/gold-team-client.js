/**
 * GoldTeamClient — GPU 任务调度客户端
 *
 * 调用 gold-team Control Node REST API 提交/查询 GPU 任务。
 * 认证: 已移除（内网互通）
 * 回调签名: HMAC-SHA256
 *
 * 参考: review-platform-client.js, jimeng-client.js
 */

import { sign as hmacSign, verify as hmacVerify } from '../shared/hmac_node.js';

export class GoldTeamError extends Error {
  constructor(message, { task = null, status = null } = {}) {
    super(message);
    this.name = 'GoldTeamError';
    this.task = task;
    this.status = status;
  }
}

export class GoldTeamClient {
  /**
   * @param {object} options
   * @param {string} [options.baseUrl] - Gold-team Control Node URL (或 GOLD_TEAM_URL env)
   * @param {number} [options.timeout=60000] - 请求超时 ms（GPU 任务可能较长）
   * @param {string} [options.callbackBaseUrl] - 回调基础 URL (或 CALLBACK_BASE_URL env)
   */
  constructor({
    baseUrl = process.env.GOLD_TEAM_URL || 'http://192.168.71.140:8900',
    timeout = 60000,
    callbackBaseUrl = process.env.CALLBACK_BASE_URL || 'http://192.168.71.140:3000',
    traceId = '',
  } = {}) {
    this._baseUrl = baseUrl.replace(/\/$/, '');
    this._timeout = timeout;
    this._callbackBaseUrl = callbackBaseUrl;
    this._callbackSecret = process.env.HMAC_SECRET_MA_GT || '';
    this._traceId = traceId;
  }

  /**
   * 提交 GPU 任务
   * @param {object} options
   * @param {string} options.taskType - 任务类型 (如 "tts_generation")
   * @param {object} options.params - 任务参数
   * @param {Array}  [options.assets=[]] - 输入资产
   * @param {number} [options.priority=5] - 优先级 1-10
   * @param {string} [options.description] - 描述
   * @param {string} [options.callbackPath] - 自定义回调路径
   * @returns {Promise<{taskId: string, state: string, createdAt: string}>}
   */
  async submitTask({ taskType, params, assets = [], priority = 5, description, callbackPath }) {
    const callbackUrl = callbackPath
      ? `${this._callbackBaseUrl}${callbackPath}`
      : `${this._callbackBaseUrl}/callback/gpu-task`;

    const body = {
      task_type: taskType,
      params,
      assets,
      priority,
      description,
      callback_url: callbackUrl,
      callback_secret: this._callbackSecret,
    };

    const result = await this._request('POST', '/api/tasks', body);
    return {
      taskId: result.data.task_id,
      state: result.data.state,
      createdAt: result.data.created_at,
    };
  }

  /**
   * 查询任务状态
   * @param {string} taskId
   * @returns {Promise<object>} 任务详情
   */
  async getTask(taskId) {
    const result = await this._request('GET', `/api/tasks/${taskId}`);
    return result.data;
  }

  /**
   * 查询任务列表
   * @param {object} [options]
   * @param {string} [options.state] - 按状态过滤
   * @param {string} [options.taskType] - 按任务类型过滤
   * @param {number} [options.limit=20]
   * @param {number} [options.offset=0]
   */
  async listTasks({ state, taskType, limit = 20, offset = 0 } = {}) {
    const params = new URLSearchParams({ limit, offset });
    if (state) params.set('state', state);
    if (taskType) params.set('task_type', taskType);
    const result = await this._request('GET', `/api/tasks?${params}`);
    return result.data;
  }

  /**
   * 等待任务完成（轮询）
   * @param {string} taskId
   * @param {object} [options]
   * @param {number} [options.pollIntervalMs=5000]
   * @param {number} [options.timeoutMs=600000] - 10min 默认超时
   * @returns {Promise<object>} 完成后的任务详情
   */
  async waitForTask(taskId, { pollIntervalMs = 5000, timeoutMs = 600000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const task = await this.getTask(taskId);
      if (task.state === 'done') return task;
      if (task.state === 'failed') {
        throw new GoldTeamError(`GPU 任务失败: ${task.error}`, { task });
      }
      await new Promise(r => setTimeout(r, pollIntervalMs));
    }
    throw new GoldTeamError(`GPU 任务超时: ${taskId}`);
  }

  /**
   * 提交 TTS 语音合成任务（快捷方法）
   * @param {string} text - 要合成的文本
   * @param {object} [options]
   * @param {string} [options.voiceId='Vivian'] - 语音 ID
   * @param {string} [options.language='zh'] - 语言
   * @param {string} [options.outputFormat='wav'] - 输出格式
   */
  async submitTTS(text, { voiceId = 'Vivian', language = 'zh', outputFormat = 'wav', ...rest } = {}) {
    return this.submitTask({
      taskType: 'tts_generation',
      params: {
        text,
        output_format: outputFormat,
        extra: { tts: { model_id: 'default', voice_id: voiceId, language } },
      },
      description: `TTS: ${text.substring(0, 50)}...`,
      ...rest,
    });
  }

  /**
   * 验证回调签名
   * @param {string|Buffer} body - 原始请求 body
   * @param {string} headerValue - X-HMAC-Signature header 值
   * @returns {boolean}
   */
  verifyCallback(body, headerValue) {
    return hmacVerify(body, this._callbackSecret, headerValue);
  }

  /**
   * 提交 GPU 任务（带降级）
   * gold-team 不可用时返回降级结果，不抛错。
   * @param {object} options - 同 submitTask
   * @returns {Promise<{taskId: string|null, state: string, degraded?: boolean}>}
   */
  async submitTaskDegraded(options) {
    try {
      return await this.submitTask(options);
    } catch (err) {
      console.warn(`[GoldTeamClient] GPU 服务不可用, 降级跳过: ${err.message}`);
      this._logDegraded({ taskType: options.taskType, reason: err.message });
      return {
        taskId: null,
        state: 'DEGRADED_SKIPPED',
        degraded: true,
        reason: err.message,
      };
    }
  }

  /**
   * 提交 TTS 任务（带降级）— gold-team 不可用时跳过
   * @param {string} text
   * @param {object} [options] - 同 submitTTS
   * @returns {Promise<{taskId: string|null, state: string, degraded?: boolean}>}
   */
  async submitTTSDegraded(text, options = {}) {
    return this.submitTaskDegraded({
      taskType: 'tts_generation',
      params: {
        text,
        output_format: options.outputFormat || 'wav',
        extra: { tts: { model_id: 'default', voice_id: options.voiceId || 'Vivian', language: options.language || 'zh' } },
      },
      description: `TTS: ${text.substring(0, 50)}...`,
      ...options,
    });
  }

  /**
   * 记录降级审计日志
   */
  _logDegraded({ taskType, reason }) {
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      event: 'gpu_task_degraded',
      taskType,
      reason,
    }));
  }

  /**
   * 提交 PuLID FLUX 角色一致性注入任务
   * @param {string} imagePath - 参考角色图片路径
   * @param {object} [options]
   * @param {string} [options.prompt] - 生成提示词
   * @param {string} [options.negativePrompt] - 负面提示词
   * @param {number} [options.width=1024] - 宽度
   * @param {number} [options.height=1024] - 高度
   * @param {number} [options.steps=28] - 推理步数
   * @param {number} [options.cfgScale=3.5] - 引导系数
   * @param {number} [options.weight=1.0] - PuLID 权重
   * @param {number} [options.seed] - 随机种子
   * @param {string} [options.filenamePrefix] - 输出文件名前缀
   */
  async submitPuLIDImage(imagePath, { prompt, negativePrompt, width, height, steps, cfgScale, weight, seed, filenamePrefix, ...rest } = {}) {
    return this.submitTask({
      taskType: 'image_pulid',
      params: { image: imagePath, prompt, negative_prompt: negativePrompt, width, height, steps, cfg_scale: cfgScale, weight, seed, filename_prefix: filenamePrefix },
      description: `PuLID: ${(prompt || '').substring(0, 50)}...`,
      ...rest,
    });
  }

  /**
   * 提交 ControlNet Depth 几何锁定任务
   * @param {string} imagePath - 源图片路径
   * @param {string} depthImagePath - 深度图路径
   * @param {object} [options]
   * @param {string} [options.prompt] - 生成提示词
   * @param {string} [options.negativePrompt] - 负面提示词
   * @param {number} [options.width=1024] - 宽度
   * @param {number} [options.height=1024] - 高度
   * @param {number} [options.steps=28] - 推理步数
   * @param {number} [options.cfgScale=3.5] - 引导系数
   * @param {number} [options.strength=1.0] - ControlNet 强度
   * @param {number} [options.seed] - 随机种子
   * @param {string} [options.filenamePrefix] - 输出文件名前缀
   */
  async submitControlNetDepth(imagePath, depthImagePath, { prompt, negativePrompt, width, height, steps, cfgScale, strength, seed, filenamePrefix, ...rest } = {}) {
    return this.submitTask({
      taskType: 'controlnet_depth',
      params: { image: imagePath, depth_image: depthImagePath, prompt, negative_prompt: negativePrompt, width, height, steps, cfg_scale: cfgScale, strength, seed, filename_prefix: filenamePrefix },
      description: `ControlNet Depth: ${(prompt || '').substring(0, 50)}...`,
      ...rest,
    });
  }

  /**
   * 提交 Wan 2.1 I2V 双阶段视频生成任务
   * @param {string} imagePath - 输入图片路径
   * @param {object} [options]
   * @param {string} [options.prompt] - 视频生成提示词
   * @param {number} [options.width=832] - 视频宽度
   * @param {number} [options.height=480] - 视频高度
   * @param {number} [options.length=81] - 帧数
   * @param {number} [options.steps=20] - 推理步数
   * @param {number} [options.cfg=3.5] - 引导系数
   * @param {number} [options.shift=8.0] - 采样偏移
   * @param {number} [options.seed] - 随机种子
   * @param {string} [options.filenamePrefix] - 输出文件名前缀
   */
  async submitWanI2V(imagePath, { prompt, width, height, length, steps, cfg, shift, seed, filenamePrefix, ...rest } = {}) {
    return this.submitTask({
      taskType: 'wan_i2v',
      params: { image: imagePath, prompt, width, height, length, steps, cfg, shift, seed, filename_prefix: filenamePrefix },
      description: `Wan I2V: ${(prompt || '').substring(0, 50)}...`,
      ...rest,
    });
  }

  /**
   * 提交 4x 超分辨率任务
   * @param {string} imagePath - 输入图片路径
   * @param {object} [options]
   * @param {string} [options.upscaleModel='4x-UltraSharp.pth'] - 超分辨率模型名
   * @param {string} [options.filenamePrefix] - 输出文件名前缀
   */
  async submitUpscale(imagePath, { upscaleModel, filenamePrefix, ...rest } = {}) {
    return this.submitTask({
      taskType: 'upscale',
      params: { image: imagePath, upscale_model_name: upscaleModel || '4x-UltraSharp.pth', filename_prefix: filenamePrefix },
      description: `Upscale: ${imagePath}`,
      ...rest,
    });
  }

  /**
   * 提交面部修复任务
   * @param {string} imagePath - 输入图片路径
   * @param {object} [options]
   * @param {string} [options.model='codeformer.pth'] - 面部修复模型名
   * @param {string} [options.filenamePrefix] - 输出文件名前缀
   */
  async submitFaceRestore(imagePath, { model, filenamePrefix, ...rest } = {}) {
    return this.submitTask({
      taskType: 'face_restore',
      params: { image: imagePath, model_name: model || 'codeformer.pth', filename_prefix: filenamePrefix },
      description: `Face Restore: ${imagePath}`,
      ...rest,
    });
  }

  /**
   * 健康检查
   * @param {number} [timeoutMs=5000]
   * @returns {Promise<boolean>}
   */
  async ping(timeoutMs = 5000) {
    try {
      const resp = await fetch(`${this._baseUrl}/health`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  // --- 内部方法 ---

  async _request(method, path, body = null) {
    const url = `${this._baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json',
    };
    if (this._traceId) headers['X-Trace-Id'] = this._traceId;

    const options = {
      method,
      headers,
      signal: AbortSignal.timeout(this._timeout),
    };
    if (body) options.body = JSON.stringify(body);

    try {
      const resp = await fetch(url, options);

      const text = await resp.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new GoldTeamError(`Invalid JSON response: ${text.substring(0, 200)}`, { status: resp.status });
      }

      if (resp.status >= 400) {
        throw new GoldTeamError(`HTTP ${resp.status}: ${text.substring(0, 200)}`, { status: resp.status });
      }

      return parsed;
    } catch (err) {
      if (err instanceof GoldTeamError) throw err;
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        throw new GoldTeamError(`请求超时: ${method} ${path}`);
      }
      throw new GoldTeamError(`请求失败: ${err.message}`);
    }
  }
}

export default GoldTeamClient;
