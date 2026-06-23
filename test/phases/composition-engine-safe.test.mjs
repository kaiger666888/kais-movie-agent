/**
 * Phase 15 SAFE-01 / SAFE-02 / SAFE-03: CompositionEngine 安全重写测试
 *
 * 覆盖:
 *   - sanitizePath() 拒绝 shell 元字符
 *   - execFile 调用验证 (替代 execSync 字符串)
 *   - 单一降级 (无 audio → 视频直拷)
 *   - 失败 fallback 不再二次字符串拼接
 *
 * Run: node --test test/phases/composition-engine-safe.test.mjs
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { CompositionEngine, sanitizePath } from '../../lib/composition-engine.js';

// 检测 ffmpeg/ffprobe 是否可用 (CI 环境可能无)
async function ffmpegAvailable() {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileP = promisify(execFile);
  try {
    await execFileP('ffmpeg', ['-version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

describe('sanitizePath (SAFE-02)', () => {

  it('接受正常路径 (绝对路径 + 中文 + 空格)', () => {
    assert.strictEqual(sanitizePath('/tmp/测试 视频文件.mp4'), '/tmp/测试 视频文件.mp4');
    assert.strictEqual(sanitizePath('/data/output/my video [final].mp4'), '/data/output/my video [final].mp4');
  });

  it('拒绝含双引号的路径', () => {
    assert.throws(
      () => sanitizePath('/tmp/file"name.mp4'),
      /forbidden character/,
    );
  });

  it('拒绝含反引号的路径', () => {
    assert.throws(
      () => sanitizePath('/tmp/file`name.mp4'),
      /forbidden character/,
    );
  });

  it('拒绝含美元符的路径 (防 $(cmd) 注入)', () => {
    assert.throws(
      () => sanitizePath('/tmp/$(whoami).mp4'),
      /forbidden character/,
    );
  });

  it('拒绝含分号的路径 (防 ; 分隔命令)', () => {
    assert.throws(
      () => sanitizePath('/tmp/a;rm -rf /'),
      /forbidden character/,
    );
  });

  it('拒绝含管道符的路径 (防 | 命令管道)', () => {
    assert.throws(
      () => sanitizePath('/tmp/a|cat /etc/passwd'),
      /forbidden character/,
    );
  });

  it('拒绝含换行符的路径 (防 \\n 命令注入)', () => {
    assert.throws(
      () => sanitizePath('/tmp/a\nrm -rf /'),
      /forbidden character/,
    );
  });

  it('拒绝含 \\r 的路径', () => {
    assert.throws(
      () => sanitizePath('/tmp/a\rmalicious'),
      /forbidden character/,
    );
  });

  it('拒绝 null/undefined/空字符串/非字符串', () => {
    assert.throws(() => sanitizePath(null), /Invalid path/);
    assert.throws(() => sanitizePath(undefined), /Invalid path/);
    assert.throws(() => sanitizePath(''), /Invalid path/);
    assert.throws(() => sanitizePath(123), /Invalid path/);
    assert.throws(() => sanitizePath({}), /Invalid path/);
  });
});

describe('CompositionEngine execFile 重写 (SAFE-01)', () => {
  let tmpDir;
  let hasFfmpeg;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'p15-composition-'));
    hasFfmpeg = await ffmpegAvailable();
  });

  after(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('compose() 拒绝含 shell 元字符的 videoPath (在调用 ffmpeg 前)', async () => {
    const engine = new CompositionEngine({ workdir: tmpDir });
    await assert.rejects(
      () => engine.compose({ videoPath: '/tmp/$(whoami).mp4', outputPath: '/tmp/out.mp4' }),
      /forbidden character/,
    );
  });

  it('compose() 拒绝含 shell 元字符的 outputPath', async () => {
    const engine = new CompositionEngine({ workdir: tmpDir });
    await assert.rejects(
      () => engine.compose({ videoPath: '/tmp/in.mp4', outputPath: '/tmp/out;rm.mp4' }),
      /forbidden character/,
    );
  });

  it('compose() 拒绝含元字符的 dialoguePath', async () => {
    const engine = new CompositionEngine({ workdir: tmpDir });
    await assert.rejects(
      () => engine.compose({
        videoPath: '/tmp/in.mp4',
        outputPath: '/tmp/out.mp4',
        dialoguePath: '/tmp/dialogue`injection.wav',
      }),
      /forbidden character/,
    );
  });

  it('compose() 无 audio + 无 videoPath 时返回 error (不调 ffmpeg)', async () => {
    const engine = new CompositionEngine({ workdir: tmpDir });
    const result = await engine.compose({
      videoPath: null,
      outputPath: join(tmpDir, 'out.mp4'),
    });
    assert.strictEqual(result.output, null);
    assert.match(result.error, /videoPath required/);
  });

  it('compose() 不再含 execSync 调用或 import — 模块代码使用 execFile', async () => {
    // 静态验证: CompositionEngine 源码不应再 import 或调用 execSync
    // (注释中提到 execSync 是允许的,只要没有实际 import 或调用)
    const src = await import('node:fs/promises').then(({ readFile }) =>
      readFile(new URL('../../lib/composition-engine.js', import.meta.url), 'utf-8'),
    );
    // 移除注释块后再检查 (/* ... */ 和 // ...)
    const noBlockComments = src.replace(/\/\*[\s\S]*?\*\//g, '');
    const noLineComments = noBlockComments.replace(/\/\/.*$/gm, '');
    assert.ok(
      !noLineComments.includes('execSync'),
      'CompositionEngine 源码 (代码部分, 不含注释) 仍含 execSync — 应已全部替换为 execFile',
    );
    assert.ok(
      noLineComments.includes('execFile'),
      'CompositionEngine 源码应使用 execFile',
    );
    assert.ok(
      !noLineComments.includes('| tail -12'),
      'CompositionEngine 源码不应再含 shell pipe "tail -12" (loudnorm)',
    );
  });

  it('runQualityCheck() 拒绝含元字符的视频路径', async () => {
    const engine = new CompositionEngine({ workdir: tmpDir });
    await assert.rejects(
      () => engine.runQualityCheck('/tmp/$(whoami).mp4'),
      /forbidden character/,
    );
  });

  // 以下测试需要真实 ffmpeg — CI 无则在测试内部 skip
  it('compose() 单一降级路径: 无 audio → 视频直拷 (需 ffmpeg)', async () => {
    if (!hasFfmpeg) {
      console.log('# SKIP — ffmpeg not available');
      return;
    }
    // 极简 1s mp4 (lavfi testsrc)
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileP = promisify(execFile);

    const inputVideo = join(tmpDir, 'src.mp4');
    const outputVideo = join(tmpDir, 'out.mp4');

    // 生成 1s 静音 mp4
    await execFileP('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x120:rate=15',
      '-c:v', 'libx264', inputVideo,
    ], { timeout: 30000 });

    const engine = new CompositionEngine({ workdir: tmpDir });
    const result = await engine.compose({
      videoPath: inputVideo,
      outputPath: outputVideo,
      // 不传 dialoguePath / bgm → audioInputs = [] → 走视频直拷降级
    });

    assert.strictEqual(result.output, outputVideo);
    assert.strictEqual(result.audio_mix, null);
  });

  it('compose() 多轨混音路径成功 (需 ffmpeg)', async () => {
    if (!hasFfmpeg) {
      console.log('# SKIP — ffmpeg not available');
      return;
    }
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileP = promisify(execFile);

    const inputVideo = join(tmpDir, 'src2.mp4');
    const dialogue = join(tmpDir, 'dialogue.wav');
    const outputVideo = join(tmpDir, 'mixed.mp4');

    await execFileP('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x120:rate=15',
      '-c:v', 'libx264', inputVideo,
    ], { timeout: 30000 });
    await execFileP('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
      dialogue,
    ], { timeout: 30000 });

    const engine = new CompositionEngine({ workdir: tmpDir });
    const result = await engine.compose({
      videoPath: inputVideo,
      dialoguePath: dialogue,
      outputPath: outputVideo,
    });

    assert.strictEqual(result.output, outputVideo);
    assert.strictEqual(result.audio_tracks, 1);
  });

  it('compose() ffmpeg 失败时不二次字符串拼接降级 (单一错误返回)', async () => {
    const engine = new CompositionEngine({
      workdir: tmpDir,
      config: { ffmpegPath: '/nonexistent/ffmpeg' }, // 强制失败
    });

    const result = await engine.compose({
      videoPath: '/tmp/nonexistent-input.mp4',
      dialoguePath: '/tmp/nonexistent-dialogue.wav',
      outputPath: join(tmpDir, 'should-not-exist.mp4'),
    });

    // 失败 → 返回 error,不再尝试字符串拼接降级
    assert.strictEqual(result.output, null);
    assert.ok(result.error, '失败时应有 error 字段');
  });
});
