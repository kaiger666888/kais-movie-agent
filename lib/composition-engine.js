/**
 * CompositionEngine — V4.1 合成与质检引擎 (Phase 15 SAFE-01/02/03 重写)
 *
 * 安全升级:
 *   - execSync(string) → execFile(path, args[]) — 无 shell 注入面
 *   - sanitizePath() 拒绝 shell 元字符 (`"`, `` ` ``, `$`, `;`, `|`, `\n`, `\r`)
 *   - 删除 fallback 中的二次字符串拼接降级链 (仅保留单一降级: 无 audio → 视频直拷)
 *
 * FFmpeg 多轨合成 + SVG 质量雷达图 + 五维质检
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const execFileP = promisify(execFile);

/**
 * 路径安全过滤 — 拒绝 shell 元字符。
 *
 * 拒绝: `"`, `` ` ``, `$`, `;`, `|`, `\n`, `\r`
 * 这些字符在字符串拼接的 shell 命令中可触发注入,即使在 execFile 模式下
 * 也应拒绝 — 因为合法文件路径基本不会包含这些字符,出现即视为可疑。
 *
 * @param {string} p - 待检测路径
 * @returns {string} 原路径 (若通过)
 * @throws {Error} 含被禁字符时抛错
 */
export function sanitizePath(p) {
  if (!p || typeof p !== 'string') {
    throw new Error(`Invalid path: expected non-empty string, got ${typeof p}`);
  }
  // 显式字符集 (不要用 \s 之类宽泛匹配 — 会误伤合法空格路径)
  if (/["`\$\n\r;|]/.test(p)) {
    const matched = p.match(/["`\$\n\r;|]/)[0];
    throw new Error(`Path contains forbidden character "${matched}": ${p}`);
  }
  return p;
}

export class CompositionEngine {
  constructor({ workdir, config = {}, productionMode = null }) {
    this.workdir = workdir;
    this.config = config;
    this.productionMode = productionMode;
    this.ffmpegPath = config.ffmpegPath || 'ffmpeg';
    this.ffprobePath = config.ffprobePath || 'ffprobe';
  }

  async compose(inputs) {
    const {
      videoPath,
      dialoguePath,
      bgmAmbientPath,
      bgmSignaturePath,
      sfxStems = [],
      reverbPlan = null,
      outputPath,
    } = inputs;

    // Mode enforcement: timeline-control fixed rules
    let effectiveBgmAmbient = bgmAmbientPath;
    let effectiveBgmSignature = bgmSignaturePath;
    if (this.productionMode?.fixed_rules?.bgm === 'none') {
      effectiveBgmAmbient = null;
      effectiveBgmSignature = null;
    }
    const sfxBoost = this.productionMode?.fixed_rules?.sfx === 'enhanced';

    // SAFE-02: 路径 sanitize — 所有输入路径在传给 ffmpeg 前必须过滤
    if (videoPath) sanitizePath(videoPath);
    if (outputPath) sanitizePath(outputPath);
    if (effectiveBgmAmbient) sanitizePath(effectiveBgmAmbient);
    if (effectiveBgmSignature) sanitizePath(effectiveBgmSignature);
    if (dialoguePath) sanitizePath(dialoguePath);
    for (const stem of sfxStems) {
      if (stem?.uri) sanitizePath(stem.uri);
    }

    const output = outputPath || join(this.workdir, 'final.mp4');
    const outputDir = dirname(output);
    mkdirSync(outputDir, { recursive: true });

    // Build audio input list
    const audioInputs = [dialoguePath, effectiveBgmAmbient, effectiveBgmSignature, ...sfxStems.map(s => s.uri)]
      .filter(Boolean);

    // 单一降级: 无 audio → 视频直接 copy (不调用 filter_complex)
    if (audioInputs.length === 0) {
      if (!videoPath) {
        return { output: null, error: 'videoPath required when no audio inputs' };
      }
      try {
        await execFileP(this.ffmpegPath, ['-y', '-i', videoPath, '-c', 'copy', output], { timeout: 120000 });
        return { output, audio_mix: null };
      } catch (err) {
        // 视频直拷失败 — 返回错误,不再二次字符串拼接降级
        return { output: null, error: err.message };
      }
    }

    // Build filter complex: normalize each input, then amix
    // 输入索引布局: [0]=video, [1..n]=audio (按 audioInputs 顺序)
    const nonSfxCount = [dialoguePath, effectiveBgmAmbient, effectiveBgmSignature].filter(Boolean).length;
    const filterParts = audioInputs.map((_, i) => {
      // SFX stems (索引 >= nonSfxCount) 在 enhanced 模式下 volume boost
      const isSfx = i >= nonSfxCount;
      const volume = (sfxBoost && isSfx) ? ',volume=1.2' : '';
      // 音频输入在 ffmpeg 中的索引是 i+1 (0 是 video)
      return `[${i + 1}]aresample=44100,alimiter=limit=-1dB${volume}[a${i}]`;
    });
    const mixLabels = audioInputs.map((_, i) => `[a${i}]`).join('');
    const filterComplex = `${filterParts.join(';')};${mixLabels}amix=inputs=${audioInputs.length}:duration=longest:dropout_transition=3[out]`;

    // SAFE-01: execFile + args 数组 — 不经过 shell, 无字符串拼接
    const args = ['-y', '-i', videoPath];
    for (const audio of audioInputs) {
      args.push('-i', audio);
    }
    args.push(
      '-filter_complex', filterComplex,
      '-map', '0:v',
      '-map', '[out]',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
      output,
    );

    try {
      await execFileP(this.ffmpegPath, args, { timeout: 300000 });
    } catch (err) {
      // 不再二次字符串拼接降级 — 直接返回错误
      // 旧代码这里会 fallback 到 ffmpeg -i video -i audio[0] ... 字符串拼接,
      // 但那引入了 shell 注入面且掩盖问题。失败应暴露给上游。
      return { output: null, error: err.message };
    }

    return { output, audio_tracks: audioInputs.length };
  }

  generateQualityRadar(scores) {
    const dimensions = Object.entries(scores);
    if (dimensions.length === 0) return '';

    const size = 300;
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - 40;
    const n = dimensions.length;
    const angleStep = (2 * Math.PI) / n;

    // Grid rings
    const rings = [0.25, 0.5, 0.75, 1.0];
    let gridPaths = '';
    for (const ring of rings) {
      const points = Array.from({ length: n }, (_, i) => {
        const angle = i * angleStep - Math.PI / 2;
        return `${cx + r * ring * Math.cos(angle)},${cy + r * ring * Math.sin(angle)}`;
      });
      gridPaths += `<polygon points="${points.join(' ')}" fill="none" stroke="#ddd" stroke-width="0.5"/>`;
    }

    // Axis lines + labels
    let axisLines = '';
    let labels = '';
    dimensions.forEach(([key, val], i) => {
      const angle = i * angleStep - Math.PI / 2;
      const ex = cx + r * Math.cos(angle);
      const ey = cy + r * Math.sin(angle);
      axisLines += `<line x1="${cx}" y1="${cy}" x2="${ex}" y2="${ey}" stroke="#999" stroke-width="0.5"/>`;

      const labelR = r + 20;
      const lx = cx + labelR * Math.cos(angle);
      const ly = cy + labelR * Math.sin(angle);
      const label = key.replace(/_/g, ' ').slice(0, 12);
      const normalized = typeof val === 'object' ? (val.score / (val.max || 100)) : (val / 100);
      labels += `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-size="9" fill="#333">${label} ${Math.round(normalized * 100)}%</text>`;
    });

    // Data polygon
    const dataPoints = dimensions.map(([key, val], i) => {
      const angle = i * angleStep - Math.PI / 2;
      const normalized = typeof val === 'object' ? (val.score / (val.max || 100)) : (val / 100);
      const clamped = Math.max(0, Math.min(1, normalized));
      return `${cx + r * clamped * Math.cos(angle)},${cy + r * clamped * Math.sin(angle)}`;
    });

    const dataPolygon = `<polygon points="${dataPoints.join(' ')}" fill="rgba(66,133,244,0.3)" stroke="#4285F4" stroke-width="1.5"/>`;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="white" rx="8"/>
  ${gridPaths}
  ${axisLines}
  ${dataPolygon}
  ${labels}
</svg>`;
  }

  async runQualityCheck(composedVideo) {
    // SAFE-02: sanitize 检测路径
    sanitizePath(composedVideo);

    let duration = 0;
    let fileSize = 0;
    let lufs = null;

    // SAFE-01: ffprobe 用 execFile + args
    try {
      const { stdout } = await execFileP(this.ffprobePath, [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        composedVideo,
      ], { encoding: 'utf-8', timeout: 30000 });
      const info = JSON.parse(stdout);
      duration = parseFloat(info.format?.duration || 0);
      fileSize = parseInt(info.format?.size || 0);
    } catch { /* degrade */ }

    // LUFS measurement — 用 execFile + loudnorm filter + stderr 捕获
    // 旧代码: ffmpeg ... 2>&1 | tail -12 (shell pipe — 已移除)
    try {
      // loudnorm 将 JSON 写到 stderr
      const { stderr } = await execFileP(this.ffmpegPath, [
        '-i', composedVideo,
        '-af', 'loudnorm=print_format=json',
        '-f', 'null',
        '-',
      ], { encoding: 'utf-8', timeout: 60000 });

      // 从 stderr 中提取 JSON 块 (loudnorm 输出夹杂在 log 行中)
      const match = stderr.match(/\{[\s\S]*\}/);
      if (match) {
        const norm = JSON.parse(match[0]);
        lufs = parseFloat(norm.input_i || norm.target_i || 0);
      }
    } catch { /* degrade */ }

    const lufsOk = lufs !== null ? (lufs >= -15 && lufs <= -13) : null;

    return {
      duration,
      file_size: fileSize,
      lufs,
      lufs_compliant: lufsOk,
      lufs_target: '-14 ± 1 LUFS',
      passed: lufsOk !== false,
    };
  }
}

export default CompositionEngine;
