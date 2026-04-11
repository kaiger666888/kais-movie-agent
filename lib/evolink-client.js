/**
 * evolink-client.js — Evolink API 客户端
 *
 * 通过 Evolink API 进行视频生成（文生视频、图生视频、首尾帧）。
 * 配置文件：~/.openclaw/.evolink.json
 *   { "apiKey": "sk-xxx", "baseUrl": "https://api.evolink.ai/v1" }
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { createWriteStream } from "node:fs";
import { get } from "node:https";
import { get as httpGet } from "node:http";

const CONFIG_PATH = join(homedir(), ".openclaw", ".evolink.json");
const DEFAULT_BASE_URL = "https://api.evolink.ai/v1";
const DEFAULT_MODEL = "seedance-1.5-pro";
const DEFAULT_DURATION = 5;
const DEFAULT_QUALITY = "720p";
const DEFAULT_ASPECT_RATIO = "16:9";
const POLL_INITIAL_DELAY_MS = 10_000;
const POLL_INTERVAL_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes

/**
 * Load config from ~/.openclaw/.evolink.json
 */
async function loadConfig() {
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    throw new Error(
      `Evolink 配置文件不存在或格式错误: ${CONFIG_PATH}\n` +
      `请创建文件，格式: {"apiKey":"sk-xxx","baseUrl":"https://api.evolink.ai/v1"}`
    );
  }
}

/**
 * Simple HTTP(S) request helper
 */
function request(url, options) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith("https");
    const lib = isHttps ? get : httpGet;
    const req = lib(url, options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        let parsed;
        try { parsed = JSON.parse(body); } catch { parsed = body; }
        if (res.statusCode >= 400) {
          const msg = parsed?.error?.message || parsed?.message || body;
          reject(new Error(`HTTP ${res.statusCode}: ${msg}`));
        } else {
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        }
      });
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

/**
 * POST JSON helper
 */
async function postJson(url, apiKey, body) {
  const payload = JSON.stringify(body);
  return request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "Content-Length": Buffer.byteLength(payload),
    },
    body: payload,
  });
}

export class EvolinkClient {
  /**
   * @param {object} [config] - 可选，不传则自动读取配置文件
   * @param {string} [config.apiKey]
   * @param {string} [config.baseUrl]
   */
  constructor(config) {
    this._config = config || null;
    this._apiKey = config?.apiKey || null;
    this._baseUrl = (config?.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  /** 懒加载配置 */
  async _ensureConfig() {
    if (!this._apiKey) {
      if (this._config) {
        throw new Error("EvolinkClient: config provided but apiKey is missing");
      }
      const cfg = await loadConfig();
      this._apiKey = cfg.apiKey;
      this._baseUrl = (cfg.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    }
  }

  /**
   * 创建视频生成任务
   * @param {string} prompt
   * @param {object} [options]
   * @param {string[]} [options.image_urls] - 0=文生视频, 1=图生视频, 2=首尾帧
   * @param {number} [options.duration] - 4-12秒
   * @param {string} [options.quality] - 480p/720p/1080p
   * @param {string} [options.aspect_ratio] - 16:9/9:16/1:1/4:3/3:4/21:9/adaptive
   * @param {boolean} [options.generate_audio]
   * @param {string} [options.model]
   * @returns {Promise<string>} taskId
   */
  async createTask(prompt, options = {}) {
    await this._ensureConfig();

    const body = {
      model: options.model || DEFAULT_MODEL,
      prompt,
      image_urls: options.image_urls || [],
      duration: options.duration || DEFAULT_DURATION,
      quality: options.quality || DEFAULT_QUALITY,
      aspect_ratio: options.aspect_ratio || DEFAULT_ASPECT_RATIO,
      generate_audio: options.generate_audio !== false,
    };

    const resp = await postJson(`${this._baseUrl}/videos/generations`, this._apiKey, body);
    const taskId = resp.data?.task_id || resp.data?.id;
    if (!taskId) {
      throw new Error(`Evolink 创建任务失败: 未返回 task_id，响应: ${JSON.stringify(resp.data)}`);
    }
    return taskId;
  }

  /**
   * 轮询任务状态
   * @param {string} taskId
   * @param {object} [options]
   * @param {number} [options.timeoutMs] - 超时毫秒数（默认10分钟）
   * @param {function} [options.onProgress] - 进度回调 (status, elapsedMs)
   * @returns {Promise<{status: string, videoUrl: string|null, progress: number}>}
   */
  async pollTask(taskId, options = {}) {
    await this._ensureConfig();

    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    const startTime = Date.now();
    const url = `${this._baseUrl}/tasks/${taskId}`;

    // Initial delay
    await sleep(POLL_INITIAL_DELAY_MS);

    while (Date.now() - startTime < timeoutMs) {
      const resp = await request(url, {
        headers: { Authorization: `Bearer ${this._apiKey}` },
      });

      const task = resp.data?.data || resp.data;
      const status = task?.status || resp.data?.status;

      options.onProgress?.(status, Date.now() - startTime);

      if (status === "completed") {
        const videoUrl = task?.output?.video_url || task?.output?.url;
        return { status: "completed", videoUrl, progress: 100 };
      }

      if (status === "failed") {
        const errMsg = task?.error?.message || task?.error || "未知错误";
        throw new Error(`Evolink 任务失败: ${errMsg}`);
      }

      await sleep(POLL_INTERVAL_MS);
    }

    throw new Error(`Evolink 任务超时 (${Math.round(timeoutMs / 1000)}s): ${taskId}`);
  }

  /**
   * 生成视频（创建 + 轮询 + 可选下载）
   * @param {string} prompt
   * @param {object} [options]
   * @returns {Promise<{url: string, localPath: string|null, duration: number, taskId: string}>}
   */
  async generateVideo(prompt, options = {}) {
    const taskId = await this.createTask(prompt, options);
    const { status, videoUrl } = await this.pollTask(taskId, {
      timeoutMs: options.timeoutMs,
      onProgress: options.onProgress,
    });

    let localPath = null;
    if (videoUrl && options.outputPath) {
      await mkdir(dirname(options.outputPath), { recursive: true });
      localPath = await this.downloadVideo(videoUrl, options.outputPath);
    }

    return {
      url: videoUrl,
      localPath,
      duration: options.duration || DEFAULT_DURATION,
      taskId,
      status,
    };
  }

  /**
   * 下载视频到本地
   * @param {string} url
   * @param {string} outputPath
   * @returns {Promise<string>} localPath
   */
  async downloadVideo(url, outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    return new Promise((resolve, reject) => {
      const isHttps = url.startsWith("https");
      const lib = isHttps ? get : httpGet;
      const file = createWriteStream(outputPath);

      lib(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // Follow redirect
          file.close();
          return this.downloadVideo(res.headers.location, outputPath).then(resolve, reject);
        }
        if (res.statusCode >= 400) {
          file.close();
          reject(new Error(`下载失败 HTTP ${res.statusCode}: ${url}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => { file.close(); resolve(outputPath); });
      }).on("error", (err) => {
        file.close();
        reject(err);
      });
    });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default EvolinkClient;
