/**
 * kais-camera — VideoAssembler
 *
 * 视频片段拼接、转场、字幕、BGM 添加。
 * 依赖 ffmpeg（系统需安装）。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";

const execFileAsync = promisify(execFile);

/**
 * 执行 ffmpeg 命令，超时保护
 */
async function ffmpeg(args, timeoutMs = 300_000) {
  const { stdout, stderr } = await execFileAsync("ffmpeg", args, {
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout, stderr };
}

export class VideoAssembler {
  constructor(config = {}) {
    this.tempDir = config.tempDir || "/tmp/openclaw/videos/tmp";
    this.defaultTransition = config.defaultTransition || "crossfade";
    this.transitionDuration = config.transitionDuration || 0.5;
  }

  /**
   * 按顺序拼接视频片段
   * @param {Array<{path: string, duration?: number}>} clips
   * @param {object} options
   * @param {string} options.transition - 'crossfade' | 'cut' | 'dissolve'
   * @param {string} options.bgm_path - BGM 文件路径
   * @param {number} options.bgm_volume - BGM 音量 (0-1)
   * @param {string} options.output_path - 输出文件路径
   * @param {string} options.subtitle_path - SRT 字幕路径
   * @returns {Promise<string>} 输出文件路径
   */
  async assemble(clips, options = {}) {
    if (!clips.length) throw new Error("无视频片段可拼接");
    if (clips.length === 1) return clips[0].path;

    const {
      transition = this.defaultTransition,
      bgm_path,
      bgm_volume = 0.3,
      output_path = "/tmp/openclaw/videos/output.mp4",
      subtitle_path,
    } = options;

    // 检查 ffmpeg
    try {
      await ffmpeg(["-version"]);
    } catch {
      throw new Error("ffmpeg 未安装，请先安装: sudo apt install ffmpeg");
    }

    // 验证所有片段存在
    for (const clip of clips) {
      if (!existsSync(clip.path)) {
        throw new Error(`视频片段不存在: ${clip.path}`);
      }
    }

    if (transition === "cut") {
      return this._concatCut(clips, { output_path, bgm_path, bgm_volume, subtitle_path });
    }

    // 带转场的拼接
    return this._concatWithTransition(clips, {
      transition,
      output_path,
      bgm_path,
      bgm_volume,
      subtitle_path,
    });
  }

  /**
   * 无缝拼接（cut）
   */
  async _concatCut(clips, { output_path, bgm_path, bgm_volume, subtitle_path }) {
    // 创建 concat 文件列表
    const concatList = clips.map(c => `file '${c.path}'`).join("\n");
    const { writeFile } = await import("node:fs/promises");
    const listPath = output_path + ".concat.txt";
    await writeFile(listPath, concatList);

    const args = ["-y", "-f", "concat", "-safe", "0", "-i", listPath];

    if (subtitle_path) {
      args.push("-vf", `subtitles='${subtitle_path}'`);
    }

    args.push("-c", "copy", output_path);
    await ffmpeg(args);
    return output_path;
  }

  /**
   * 带转场的拼接
   */
  async _concatWithTransition(clips, { transition, output_path, bgm_path, bgm_volume, subtitle_path }) {
    // 两两添加转场
    let currentPath = clips[0].path;
    const td = this.transitionDuration;

    for (let i = 1; i < clips.length; i++) {
      const outPath = `${output_path}.part${i}.mp4`;
      const xfadeType = this._getXfadeType(transition);

      const args = [
        "-y",
        "-i", currentPath,
        "-i", clips[i].path,
        "-filter_complex",
        `[0:v][1:v]xfade=transition=${xfadeType}:duration=${td}:offset=${this._getOffset(currentPath, td)}`,
        "-map", "[v]",
        "-c:v", "libx264",
        "-preset", "fast",
        outPath,
      ];

      await ffmpeg(args, 600_000);
      currentPath = outPath;
    }

    // 最后加 BGM 和字幕
    if (bgm_path || subtitle_path) {
      const finalArgs = ["-y", "-i", currentPath];

      if (bgm_path) {
        finalArgs.push("-i", bgm_path);
      }

      if (subtitle_path) {
        finalArgs.push("-vf", `subtitles='${subtitle_path}'`);
      }

      if (bgm_path) {
        finalArgs.push("-filter_complex", `[1:a]volume=${bgm_volume}[bgm]`, "-map", "0:v", "-map", "[bgm]");
      }

      finalArgs.push("-c:v", "libx264", "-preset", "fast", "-c:a", "aac", "-shortest", output_path);
      await ffmpeg(finalArgs, 600_000);
      return output_path;
    }

    // 重命名为最终输出
    const { rename } = await import("node:fs/promises");
    await rename(currentPath, output_path);
    return output_path;
  }

  /**
   * 添加转场效果
   * @param {string} clipA - 第一个片段路径
   * @param {string} clipB - 第二个片段路径
   * @param {string} transitionType - 'crossfade' | 'cut' | 'dissolve'
   * @param {string} outputPath - 输出路径
   */
  async addTransition(clipA, clipB, transitionType = "crossfade", outputPath) {
    const xfadeType = this._getXfadeType(transitionType);
    const td = this.transitionDuration;

    const args = [
      "-y",
      "-i", clipA,
      "-i", clipB,
      "-filter_complex",
      `[0:v][1:v]xfade=transition=${xfadeType}:duration=${td}:offset=5`,
      "-map", "[v]",
      "-c:v", "libx264",
      "-preset", "fast",
      outputPath,
    ];

    await ffmpeg(args);
    return outputPath;
  }

  /**
   * 添加字幕
   * @param {string} videoPath - 视频路径
   * @param {string} subtitlePath - SRT 字幕路径
   * @param {string} outputPath - 输出路径
   */
  async addSubtitle(videoPath, subtitlePath, outputPath) {
    const args = [
      "-y",
      "-i", videoPath,
      "-vf", `subtitles='${subtitlePath}'`,
      "-c:v", "libx264",
      "-preset", "fast",
      "-c:a", "copy",
      outputPath,
    ];

    await ffmpeg(args);
    return outputPath;
  }

  /**
   * 添加 BGM
   * @param {string} videoPath - 视频路径
   * @param {string} bgmPath - BGM 路径
   * @param {object} options
   * @param {number} options.volume - BGM 音量 (0-1, 默认 0.3)
   * @param {string} options.outputPath - 输出路径
   */
  async addBGM(videoPath, bgmPath, options = {}) {
    const { volume = 0.3, outputPath } = options;

    const args = [
      "-y",
      "-i", videoPath,
      "-i", bgmPath,
      "-filter_complex",
      `[1:a]volume=${volume}[bgm]`,
      "-map", "0:v",
      "-map", "0:a",
      "-map", "[bgm]",
      "-c:v", "copy",
      "-c:a", "aac",
      "-shortest",
      outputPath || videoPath.replace(/\.mp4$/, "_bgm.mp4"),
    ];

    await ffmpeg(args);
    return outputPath;
  }

  /**
   * 获取视频时长（秒）
   */
  async getDuration(videoPath) {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      videoPath,
    ]);
    return parseFloat(stdout.trim());
  }

  // --- 内部工具 ---

  _getXfadeType(transition) {
    const map = {
      crossfade: "fade",
      cut: "fadeblack",
      dissolve: "dissolve",
    };
    return map[transition] || "fade";
  }

  async _getOffset(videoPath, transitionDuration) {
    try {
      const duration = await this.getDuration(videoPath);
      return Math.max(0, duration - transitionDuration).toFixed(2);
    } catch {
      return "5"; // 默认 5 秒处
    }
  }
}

export default VideoAssembler;
