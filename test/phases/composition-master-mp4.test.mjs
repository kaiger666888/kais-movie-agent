/**
 * Phase 29-01 PIPE-COMPOSE-01 regression test:
 * composition handler MUST output master.mp4 + web-preview.mp4 (not final.mp4)
 * and MUST touch 0-byte placeholders when compose fails/degrades.
 *
 * Background (the audit finding this guards against):
 *   - PHASES declares composition outputFiles: ['master.mp4', 'web-preview.mp4']
 *     but the handler wrote `final.mp4`. Delivery looks for master.mp4 → silent miss.
 *   - Degraded mode (FFmpeg unavailable/fails) left no master.mp4 behind, so delivery
 *     could not find any file even as a placeholder.
 *
 * This test will fail if:
 *   - composition handler writes final.mp4 instead of master.mp4
 *   - composition handler omits web-preview.mp4 on the success path
 *   - composition handler fails to touch 0-byte master.mp4 + web-preview.mp4
 *     placeholders when compose does not produce an output
 *
 * Run: node --test test/phases/composition-master-mp4.test.mjs
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { Pipeline } from '../../lib/pipeline.js';
import { phaseHandlers } from '../../lib/phases/index.js';

const execFileP = promisify(execFile);

// Best-effort ffmpeg availability probe (skip success-path tests if absent).
const ffmpegOk = await new Promise((resolve) => {
  execFile('ffmpeg', ['-version'], (err) => resolve(!err));
}).catch(() => false);

let workdir;
let assetsDir;

// Create a 1-second silent mp4 via ffmpeg for use as the "rendered video" input.
async function makeTinyMp4(path) {
  await execFileP('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path,
  ]);
}

before(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'composition-master-mp4-'));
  assetsDir = join(workdir, 'assets');
  await mkdir(assetsDir, { recursive: true });
});

after(async () => {
  await rm(workdir, { recursive: true, force: true });
});

// Helper: build a Pipeline wired for degradedMode (so the quality gate does not throw)
function makePipeline() {
  const pipeline = new Pipeline({ workdir, config: { degradedMode: true } });
  return pipeline;
}

const compositionPhase = { id: 'composition', stageOrder: 18, name: '剪辑合成' };

describe('composition handler master.mp4 + web-preview.mp4 (PIPE-COMPOSE-01)', () => {

  it('Test 1: writes master.mp4 (not final.mp4) on the success path', { skip: !ffmpegOk }, async () => {
    // Fresh subdir so this test's files don't collide with siblings.
    const dir = await mkdtemp(join(tmpdir(), 'comp-master-success-'));
    try {
      const videoFile = join(dir, 'input.mp4');
      await makeTinyMp4(videoFile);
      await writeFile(join(dir, 'video_tasks.json'), JSON.stringify({ tasks: [] }));

      const pipeline = new Pipeline({ workdir: dir, config: { degradedMode: true } });
      await phaseHandlers.composition.after(pipeline, compositionPhase, { videoPath: videoFile });

      assert.ok(existsSync(join(dir, 'master.mp4')), 'master.mp4 MUST exist after successful compose');
      assert.ok(!existsSync(join(dir, 'final.mp4')), 'final.mp4 MUST NOT be written');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('Test 2: writes web-preview.mp4 on the success path', { skip: !ffmpegOk }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'comp-webpreview-success-'));
    try {
      const videoFile = join(dir, 'input.mp4');
      await makeTinyMp4(videoFile);
      await writeFile(join(dir, 'video_tasks.json'), JSON.stringify({ tasks: [] }));

      const pipeline = new Pipeline({ workdir: dir, config: { degradedMode: true } });
      await phaseHandlers.composition.after(pipeline, compositionPhase, { videoPath: videoFile });

      assert.ok(existsSync(join(dir, 'web-preview.mp4')), 'web-preview.mp4 MUST exist after successful compose');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('Test 3: touches 0-byte master.mp4 + web-preview.mp4 placeholders when compose produces no output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'comp-degraded-placeholder-'));
    try {
      // Point videoPath at a non-existent file — ffmpeg will fail to open input,
      // compose() returns { output: null, error }, no real mp4 produced.
      const pipeline = new Pipeline({ workdir: dir, config: { degradedMode: true } });
      await phaseHandlers.composition.after(pipeline, compositionPhase, {
        videoPath: join(dir, 'does-not-exist.mp4'),
      });

      assert.ok(existsSync(join(dir, 'master.mp4')), 'degraded path MUST touch master.mp4 placeholder');
      assert.ok(existsSync(join(dir, 'web-preview.mp4')), 'degraded path MUST touch web-preview.mp4 placeholder');

      const masterStat = await stat(join(dir, 'master.mp4'));
      const previewStat = await stat(join(dir, 'web-preview.mp4'));
      assert.equal(masterStat.size, 0, 'degraded master.mp4 placeholder MUST be 0 bytes');
      assert.equal(previewStat.size, 0, 'degraded web-preview.mp4 placeholder MUST be 0 bytes');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('Test 4: final.mp4 is never written under any path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'comp-no-final-regression-'));
    try {
      const pipeline = new Pipeline({ workdir: dir, config: { degradedMode: true } });
      await phaseHandlers.composition.after(pipeline, compositionPhase, {
        videoPath: join(dir, 'does-not-exist.mp4'),
      });

      assert.ok(!existsSync(join(dir, 'final.mp4')), 'final.mp4 MUST NEVER be written by composition handler');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
