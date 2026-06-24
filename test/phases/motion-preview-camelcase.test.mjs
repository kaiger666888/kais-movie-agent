/**
 * Phase 27-01 PIPE-RENDER-01 regression test:
 * motion-preview handler MUST call GoldTeamClient.submitTask with camelCase args.
 *
 * Background (the bug this guards against):
 *   - Pre-fix code passed `task_type: 'blender_render'` (snake_case) but
 *     GoldTeamClient.submitTask destructures `{ taskType }` (camelCase).
 *     Result: undefined taskType → request body missing task_type → silent failure.
 *   - Pre-fix code also read `task.task_id` but submitTask returns `{ taskId }`.
 *     Result: recorded taskId was always undefined.
 *
 * This test will fail if either field-case regression is reintroduced.
 *
 * Run: node --test test/phases/motion-preview-camelcase.test.mjs
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Pipeline } from '../../lib/pipeline.js';
import { phaseHandlers } from '../../lib/phases/index.js';
import { GoldTeamClient } from '../../lib/gold-team-client.js';

// Capture every submitTask invocation across tests.
const calls = [];

// Save the original method once at module load so we can restore it in `after`.
const ORIGINAL_SUBMIT = GoldTeamClient.prototype.submitTask;

// Helper to (re)install a submitTask spy/implementation for the next test.
function installSubmitSpy(impl) {
  calls.length = 0;
  GoldTeamClient.prototype.submitTask = function (args) {
    calls.push(args);
    return impl ? impl(args) : Promise.resolve({
      taskId: 'gt-task-123',
      state: 'pending',
      createdAt: '2026-06-24T00:00:00Z',
    });
  };
}

let workdir;
let stsDir;

before(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'motion-preview-camel-'));
  // AssetBus reads/writes under <workdir>/assets — pre-create so write succeeds.
  stsDir = join(workdir, 'assets');
  await mkdir(stsDir, { recursive: true });
});

after(async () => {
  // Restore the prototype so other test files using GoldTeamClient are unaffected.
  GoldTeamClient.prototype.submitTask = ORIGINAL_SUBMIT;
  await rm(workdir, { recursive: true, force: true });
});

function buildPipeline() {
  return new Pipeline({
    workdir,
    episode: 'EP-TEST',
    config: {
      // goldTeam.baseUrl gates entry into the Blender submitTask block.
      goldTeam: { baseUrl: 'http://mock-gt', apiKey: 'k', callbackBaseUrl: 'http://cb' },
    },
  });
}

async function writeStsScript(shots) {
  // AssetBus.write wraps with envelope; we mirror that by writing the JSON payload
  // through the same handler path the production code uses (bus.write). For the
  // test we write the raw JSON file the schema expects so bus.read returns it.
  // The 'spatio-temporal-script' slot maps to a specific file; we use AssetBus
  // via the handler's own writes? Simpler: import AssetBus and write through it.
  const { AssetBus } = await import('../../lib/asset-bus.js');
  const bus = new AssetBus(workdir);
  await bus.write('spatio-temporal-script', { shots });
}

describe('Phase 27-01: motion-preview submitTask camelCase', () => {

  it('Test 1 — submitTask is called with taskType (camelCase), not task_type', async () => {
    installSubmitSpy();
    await writeStsScript([
      { id: 'shot-1', camera_path: '/cam', scene_3d_path: '/scene', description: 'd' },
    ]);
    const pipeline = buildPipeline();
    const phaseConfig = { data: {}, reviewCandidates: [] };

    await phaseHandlers['motion-preview'].after(pipeline, 'motion-preview', phaseConfig);

    assert.ok(calls.length >= 1, 'submitTask should be called at least once');
    assert.equal(
      calls[0].taskType, 'blender_render',
      'submitTask MUST be called with taskType (camelCase); snake_case task_type yields undefined in submitTask destructure'
    );
  });

  it('Test 2 — recorded taskId in the bus equals the camelCase taskId returned by submitTask', async () => {
    installSubmitSpy(() => Promise.resolve({
      taskId: 'gt-task-123',
      state: 'pending',
      createdAt: '2026-06-24T00:00:00Z',
    }));
    await writeStsScript([
      { id: 'shot-1', camera_path: '/cam', scene_3d_path: '/scene', description: 'd' },
    ]);
    const pipeline = buildPipeline();
    const phaseConfig = { data: {}, reviewCandidates: [] };

    await phaseHandlers['motion-preview'].after(pipeline, 'motion-preview', phaseConfig);

    // Read back what the handler wrote.
    const { AssetBus } = await import('../../lib/asset-bus.js');
    const bus = new AssetBus(workdir);
    const record = await bus.read('motion-preview');
    assert.ok(record, 'motion-preview bus record must exist');
    assert.ok(Array.isArray(record.camera_paths), 'camera_paths must be an array');
    assert.ok(record.camera_paths.length >= 1, 'camera_paths should have at least one entry');
    assert.equal(
      record.camera_paths[0].taskId, 'gt-task-123',
      'recorded taskId must equal submitTask return value task.taskId (camelCase) — proves task.task_id was NOT read'
    );
  });

  it('Test 3 — regression guard: submitTask args MUST NOT carry snake_case task_type property', async () => {
    installSubmitSpy();
    await writeStsScript([
      { id: 'shot-1', camera_path: '/cam', scene_3d_path: '/scene', description: 'd' },
    ]);
    const pipeline = buildPipeline();
    const phaseConfig = { data: {}, reviewCandidates: [] };

    await phaseHandlers['motion-preview'].after(pipeline, 'motion-preview', phaseConfig);

    assert.ok(calls.length >= 1, 'submitTask should be called');
    assert.equal(
      calls[0].task_type, undefined,
      'snake_case task_type property MUST be absent — if present, the field-case bug has regressed'
    );
  });

  it('Test 4 — degrade path preserved: submitTask rejection fires [motion-preview] Blender降级 warn + empty camera_paths', async () => {
    installSubmitSpy(() => Promise.reject(new Error('gt down')));

    // Spy on console.warn
    const originalWarn = console.warn;
    const warns = [];
    console.warn = (msg, ...rest) => { warns.push(String(msg)); originalWarn(msg, ...rest); };

    try {
      await writeStsScript([
        { id: 'shot-1', camera_path: '/cam', scene_3d_path: '/scene', description: 'd' },
      ]);
      const pipeline = buildPipeline();
      const phaseConfig = { data: {}, reviewCandidates: [] };

      await phaseHandlers['motion-preview'].after(pipeline, 'motion-preview', phaseConfig);

      const degraded = warns.find(w => w.includes('[motion-preview] Blender降级'));
      assert.ok(degraded, 'degrade warn "[motion-preview] Blender降级" must fire when submitTask rejects');

      const { AssetBus } = await import('../../lib/asset-bus.js');
      const bus = new AssetBus(workdir);
      const record = await bus.read('motion-preview');
      assert.ok(Array.isArray(record.camera_paths), 'camera_paths must still be an array on degrade');
      assert.equal(
        record.camera_paths.length, 0,
        'camera_paths must be empty when submitTask rejects (degrade path preserved per D-PIPE-RENDER-01)'
      );
    } finally {
      console.warn = originalWarn;
    }
  });

});
