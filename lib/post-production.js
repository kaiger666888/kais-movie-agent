/**
 * kais-post-production — 后期合成模块
 * ES Module
 *
 * 功能：
 * - 字幕生成：从剧本对白 + 时间戳生成 SRT 字幕
 * - 音频混流：TTS + BGM 合并（音量平衡）
 * - 字幕烧录：ffmpeg 硬字幕或软字幕
 * - 最终输出：输出 final.mp4（含字幕+音频）
 */

import { execFile } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ─── SRT 时间格式 ────────────────────────────────────────

function formatSrtTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

// ─── PostProduction 类 ───────────────────────────────────

export class PostProduction {
  /**
   * @param {object} config
   * @param {string} config.workdir - 工作目录
   * @param {string} config.episode - 集号
   */
  constructor(config = {}) {
    this.workdir = config.workdir || process.cwd();
    this.episode = config.episode || 'EP01';
  }

  /**
   * 生成 SRT 字幕文件
   * @param {Array<object>} dialogueLines - 对白列表
   *   每个: { text, start_time, end_time, speaker? }
   * @param {string} outputPath - 输出路径
   * @returns {Promise<string>} 字幕文件路径
   */
  async generateSubtitles(dialogueLines, outputPath) {
    outputPath = outputPath || join(this.workdir, 'subtitles.srt');
    await mkdir(dirname(outputPath), { recursive: true });

    const srtBlocks = [];
    for (let i = 0; i < dialogueLines.length; i++) {
      const line = dialogueLines[i];
      const start = line.start_time ?? 0;
      const end = line.end_time ?? (start + 2);
      const text = line.speaker ? `${line.speaker}: ${line.text}` : line.text;

      srtBlocks.push(`${i + 1}`);
      srtBlocks.push(`${formatSrtTime(start)} --> ${formatSrtTime(end)}`);
      srtBlocks.push(text);
      srtBlocks.push('');
    }

    await writeFile(outputPath, srtBlocks.join('\n'));
    return outputPath;
  }

  /**
   * 混流 TTS + BGM
   * @param {object} options
   * @param {string} options.ttsDir - TTS 音频目录
   * @param {string} options.bgmPath - BGM 音频路径
   * @param {string} options.outputDir - 输出目录
   * @param {number} options.bgmVolume - BGM 音量 (0.0-1.0, 默认 0.3)
   * @param {number} options.ttsVolume - TTS 音量 (0.0-1.0, 默认 1.0)
   * @param {string} options.ttsFormat - TTS 文件格式 (默认 mp3)
   * @returns {Promise<string>} 混合后音频路径
   */
  async mixAudio(options = {}) {
    const {
      ttsDir,
      bgmPath,
      outputDir = join(this.workdir, 'audio_mixed'),
      bgmVolume = 0.3,
      ttsVolume = 1.0,
      ttsFormat = 'mp3',
    } = options;

    await mkdir(outputDir, { recursive: true });

    // 先合并所有 TTS 片段为一个文件
    const ttsConcatPath = join(outputDir, 'tts_combined.mp3');
    const ttsListPath = join(outputDir, 'tts_list.txt');

    // 列出 TTS 文件
    const { readdir } = await import('node:fs/promises');
    let ttsFiles;
    try {
      ttsFiles = (await readdir(ttsDir))
        .filter(f => f.endsWith(`.${ttsFormat}`))
        .sort()
        .map(f => join(ttsDir, f));
    } catch {
      throw new Error(`TTS 目录不存在或为空: ${ttsDir}`);
    }

    if (ttsFiles.length === 0) {
      throw new Error('TTS 目录中没有音频文件');
    }

    // 合并 TTS
    const listContent = ttsFiles.map(f => `file '${f}'`).join('\n');
    await writeFile(ttsListPath, listContent);
    await execFileAsync('ffmpeg', [
      '-f', 'concat', '-safe', '0', '-i', ttsListPath,
      '-c', 'copy', '-y', ttsConcatPath,
    ]);

    // 混流 TTS + BGM
    const mixedPath = join(outputDir, 'audio_mixed.mp3');

    if (bgmPath) {
      await execFileAsync('ffmpeg', [
        '-i', ttsConcatPath,
        '-i', bgmPath,
        '-filter_complex',
        `[0:a]volume=${ttsVolume}[tts];[1:a]volume=${bgmVolume}[bgm];[tts][bgm]amix=inputs=2:duration=longest[aout]`,
        '-map', '[aout]',
        '-y', mixedPath,
      ]);
    } else {
      // 无 BGM，直接使用 TTS
      await execFileAsync('ffmpeg', [
        '-i', ttsConcatPath,
        '-filter_complex', `volume=${ttsVolume}`,
        '-y', mixedPath,
      ]);
    }

    return mixedPath;
  }

  /**
   * 最终合成：视频 + 音频 + 字幕
   * @param {object} options
   * @param {string} options.videoPath - 视频路径
   * @param {string} options.subtitlePath - SRT 字幕路径（可选）
   * @param {string} options.audioPath - 混合音频路径（可选）
   * @param {string} options.outputPath - 最终输出路径
   * @param {boolean} options.burnSubtitles - 是否烧录硬字幕（默认 false = 软字幕）
   * @returns {Promise<string>} 最终视频路径
   */
  async assembleFinal(options = {}) {
    const {
      videoPath,
      subtitlePath,
      audioPath,
      outputPath = join(this.workdir, 'final.mp4'),
      burnSubtitles = false,
    } = options;

    await mkdir(dirname(outputPath), { recursive: true });

    const args = ['-i', videoPath];

    // 音频
    if (audioPath) {
      args.push('-i', audioPath);
    }

    // 字幕
    if (subtitlePath && burnSubtitles) {
      // 硬字幕烧录
      args.push('-vf', `subtitles=${subtitlePath}`);
    }

    // 编码参数
    args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '23');

    if (audioPath) {
      args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
    } else {
      args.push('-c:a', 'copy');
    }

    // 软字幕（不烧录时嵌入）
    if (subtitlePath && !burnSubtitles) {
      args.push('-i', subtitlePath, '-c:s', 'mov_text');
    }

    args.push('-y', outputPath);

    await execFileAsync('ffmpeg', args);
    return outputPath;
  }

  /**
   * 一站式后期：字幕 + 混流 + 合成
   * @param {object} params
   * @param {Array} params.dialogueLines - 对白列表
   * @param {string} params.videoPath - 视频路径
   * @param {string} params.ttsDir - TTS 目录
   * @param {string} params.bgmPath - BGM 路径
   * @param {string} params.outputPath - 最终输出路径
   * @param {boolean} params.burnSubtitles - 是否烧录硬字幕
   * @returns {Promise<object>} 后期结果
   */
  async run(params = {}) {
    const result = { steps: [] };

    // 1. 生成字幕
    if (params.dialogueLines?.length) {
      const subtitlePath = await this.generateSubtitles(params.dialogueLines);
      result.subtitlePath = subtitlePath;
      result.steps.push({ step: 'subtitles', status: 'done', path: subtitlePath });
    }

    // 2. 混流音频
    if (params.ttsDir) {
      const mixedAudio = await this.mixAudio({
        ttsDir: params.ttsDir,
        bgmPath: params.bgmPath,
      });
      result.audioPath = mixedAudio;
      result.steps.push({ step: 'mixAudio', status: 'done', path: mixedAudio });
    }

    // 3. 最终合成
    if (params.videoPath) {
      const finalPath = await this.assembleFinal({
        videoPath: params.videoPath,
        subtitlePath: result.subtitlePath,
        audioPath: result.audioPath,
        outputPath: params.outputPath,
        burnSubtitles: params.burnSubtitles,
      });
      result.finalPath = finalPath;
      result.steps.push({ step: 'assemble', status: 'done', path: finalPath });
    }

    return result;
  }
}

export default PostProduction;
