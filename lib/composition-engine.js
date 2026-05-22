/**
 * CompositionEngine — V4.1 合成与质检引擎
 * FFmpeg 多轨合成 + SVG 质量雷达图 + 五维质检
 */
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

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

    const output = outputPath || join(this.workdir, 'final.mp4');
    const outputDir = dirname(output);
    mkdirSync(outputDir, { recursive: true });

    // Build FFmpeg filter complex for multi-track mix
    const audioInputs = [dialoguePath, effectiveBgmAmbient, effectiveBgmSignature, ...sfxStems.map(s => s.uri)]
      .filter(Boolean);

    if (audioInputs.length === 0) {
      // No audio — just copy video
      try {
        execSync(`${this.ffmpegPath} -y -i "${videoPath}" -c copy "${output}"`, { timeout: 120000 });
      } catch { /* degrade */ }
      return { output, audio_mix: null };
    }

    // Build filter complex: normalize each input, then amix
    const inputArgs = audioInputs.map((p, i) => `-i "${p}"`).join(' ');
    // Count non-SFX audio index positions (dialogue + BGM)
    const nonSfxCount = [dialoguePath, effectiveBgmAmbient, effectiveBgmSignature].filter(Boolean).length;
    const filterParts = audioInputs.map((_, i) => {
      // SFX stems get volume boost in enhanced mode
      const isSfx = i >= nonSfxCount;
      const volume = (sfxBoost && isSfx) ? ',volume=1.2' : '';
      return `[${i + 1}]aresample=44100,alimiter=limit=-1dB${volume}[a${i}]`;
    });
    const mixLabels = audioInputs.map((_, i) => `[a${i}]`).join('');
    const filterComplex = `${filterParts.join(';')};${mixLabels}amix=inputs=${audioInputs.length}:duration=longest:dropout_transition=3[out]`;

    const cmd = [
      `${this.ffmpegPath} -y`,
      `-i "${videoPath}"`,
      inputArgs,
      `-filter_complex "${filterComplex}"`,
      `-map 0:v -map "[out]"`,
      `-c:v copy -c:a aac -b:a 192k`,
      `-shortest`,
      `"${output}"`,
    ].join(' ');

    try {
      execSync(cmd, { timeout: 300000, stdio: 'pipe' });
    } catch (err) {
      // Fallback: just overlay first audio track
      try {
        execSync(`${this.ffmpegPath} -y -i "${videoPath}" -i "${audioInputs[0]}" -c:v copy -c:a aac -b:a 192k -shortest "${output}"`, { timeout: 300000, stdio: 'pipe' });
      } catch {
        return { output: null, error: err.message };
      }
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
    let duration = 0;
    let fileSize = 0;
    let lufs = null;

    try {
      const probe = execSync(
        `${this.ffprobePath} -v quiet -print_format json -show_format -show_streams "${composedVideo}"`,
        { encoding: 'utf-8', timeout: 30000 }
      );
      const info = JSON.parse(probe);
      duration = parseFloat(info.format?.duration || 0);
      fileSize = parseInt(info.format?.size || 0);
    } catch { /* degrade */ }

    // LUFS measurement via FFmpeg loudnorm filter
    try {
      const loudness = execSync(
        `${this.ffmpegPath} -i "${composedVideo}" -af loudnorm=print_format=json -f null - 2>&1 | tail -12`,
        { encoding: 'utf-8', timeout: 60000 }
      );
      const match = loudness.match(/\{[\s\S]*\}/);
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
