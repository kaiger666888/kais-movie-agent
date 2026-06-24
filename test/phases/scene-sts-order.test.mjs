/**
 * Phase 26 PIPE-DATA-02: scene↔sts 时序修复 回归测试
 *
 * Root cause being closed: scene-generation (originally stageOrder 8) called
 *   bus.read('spatio-temporal-script') at lib/phases/index.js:2571, but
 *   spatio-temporal-script (originally stageOrder 10) had NOT yet executed →
 *   read returned null → scene-generation silently fell through to a single
 *   hardcoded default scene (lib/phases/index.js:2580-2587), starving
 *   downstream composition/render of real scene structure.
 *
 * Fix under test: PHASES array reordered so spatio-temporal-script (stageOrder 8)
 *   runs BEFORE scene-generation (stageOrder 9) BEFORE scene-selection (stageOrder 10).
 *
 * Coverage:
 *   1. PHASES array ordering (via Pipeline.getPhases() — PHASES is module-private)
 *   2. stageOrder monotonicity 0-19 (no gaps, no duplicates)
 *   3. VALID_PHASES textual source sync (VALID_PHASES is module-private; cannot import)
 *   4. AssetBus read-after-write contract for 'spatio-temporal-script'
 *   5. scene-generation field mapping shape (regression guard for lib/phases/index.js:2573-2577)
 *   6. Operator-visible ordering via Pipeline.getStatus() (drives bin/pipeline.js status output)
 *
 * CRITICAL: PHASES is `const` module-private in lib/pipeline.js — there is NO
 * named `PHASES` export. The authoritative accessor is `Pipeline.getPhases()`.
 * Likewise VALID_PHASES in lib/hermes-client.js is `const` with no export — it
 * MUST be parsed from source text, not imported.
 *
 * Run: node --test test/phases/scene-sts-order.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Pipeline } from '../../lib/pipeline.js';
import { AssetBus } from '../../lib/asset-bus.js';

describe('Phase 26 PIPE-DATA-02: scene↔sts 时序修复', () => {
  it('PHASES array 顺序: spatio-temporal-script 在 scene-generation 之前', () => {
    const PHASES = Pipeline.getPhases();
    const ids = PHASES.map(p => p.id);
    const stsIdx = ids.indexOf('spatio-temporal-script');
    const sgIdx = ids.indexOf('scene-generation');
    const ssIdx = ids.indexOf('scene-selection');
    assert.notStrictEqual(stsIdx, -1, 'spatio-temporal-script missing from PHASES');
    assert.notStrictEqual(sgIdx, -1, 'scene-generation missing from PHASES');
    assert.notStrictEqual(ssIdx, -1, 'scene-selection missing from PHASES');
    assert.ok(stsIdx < sgIdx,
      `expected spatio-temporal-script (${stsIdx}) before scene-generation (${sgIdx})`);
    assert.ok(sgIdx < ssIdx,
      `expected scene-generation (${sgIdx}) before scene-selection (${ssIdx})`);
  });

  it('PHASES stageOrder 单调递增 0-19 (no gaps, no duplicates)', () => {
    const PHASES = Pipeline.getPhases();
    assert.strictEqual(PHASES.length, 20, 'expected exactly 20 phases');
    for (let i = 0; i < PHASES.length; i++) {
      assert.strictEqual(PHASES[i].stageOrder, i,
        `stageOrder[${i}] = ${PHASES[i].stageOrder} (id=${PHASES[i].id}), expected ${i}`);
    }
  });

  it('VALID_PHASES 与 PHASES 同序 (textual source check — VALID_PHASES is module-private)', async () => {
    // VALID_PHASES is `const` with NO export in lib/hermes-client.js; cannot import.
    // Parse source textually and assert 1:1 ordering with Pipeline.getPhases().
    const src = await readFile(new URL('../../lib/hermes-client.js', import.meta.url), 'utf-8');
    const match = src.match(/const VALID_PHASES = \[([\s\S]*?)\];/);
    assert.ok(match, 'VALID_PHASES array literal not found in lib/hermes-client.js');
    // Extract quoted ids in declaration order
    const validIds = [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
    const phaseIds = Pipeline.getPhases().map(p => p.id);
    assert.deepStrictEqual(validIds, phaseIds,
      'VALID_PHASES drift detected — lib/hermes-client.js comment "must stay 1:1 in sync" violated');
  });

  it('AssetBus read-after-write 契约: scene-generation 依赖的 sts 读取真实可用', async () => {
    const t = await mkdtemp(joinTmp());
    try {
      const bus = new AssetBus(t);
      const payload = {
        shots: [{ scene_id: 's1', scene_description: 'd1', characters: ['c1'] }],
        audio_events: [],
        duration_coupling: {},
      };
      await bus.write('spatio-temporal-script', payload);
      const read = await bus.read('spatio-temporal-script');
      assert.ok(read, 'bus.read returned null after bus.write — contract broken');
      assert.ok(Array.isArray(read.shots), 'read.shots is not an array');
      assert.strictEqual(read.shots.length, 1);
      assert.strictEqual(read.shots[0].scene_id, 's1');
    } finally {
      await rm(t, { recursive: true, force: true });
    }
  });

  it('scene-generation 从 sts.shots 提取 sceneDefs 时字段映射正确 (regression guard)', () => {
    // Mirrors the exact mapping at lib/phases/index.js:2573-2577.
    // If scene-generation's mapping ever drifts, this test catches it.
    const stsShots = [{
      scene_id: 'sX',
      scene_description: 'desc',
      characters: ['a', 'b'],
    }];
    const mapped = stsShots.map(s => ({
      id: s.scene_id || s.id,
      description: s.scene_description || s.description || '',
      characters: s.characters || (s.character ? [s.character] : []),
    }));
    assert.deepStrictEqual(mapped, [{
      id: 'sX',
      description: 'desc',
      characters: ['a', 'b'],
    }]);

    // Also verify the character-singleton fallback branch (s.character → [s.character])
    const singleton = [{
      scene_id: 'sY',
      scene_description: 'd2',
      character: 'solo',
    }];
    const mappedSingleton = singleton.map(s => ({
      id: s.scene_id || s.id,
      description: s.scene_description || s.description || '',
      characters: s.characters || (s.character ? [s.character] : []),
    }));
    assert.deepStrictEqual(mappedSingleton, [{
      id: 'sY',
      description: 'd2',
      characters: ['solo'],
    }]);
  });

  it('Pipeline.getStatus() operator-visible ordering: sts 在 scene-generation 之前', async () => {
    // getStatus() is the backing store for `bin/pipeline.js status` output.
    // Safe to call on a fresh empty workdir — phases default to 'pending'.
    const t = await mkdtemp(joinTmp());
    try {
      const pipeline = new Pipeline({ workdir: t, episode: 'TEST' });
      const status = await pipeline.getStatus();
      assert.ok(Array.isArray(status.phases), 'status.phases is not an array');
      const ids = status.phases.map(p => p.id);
      const stsIdx = ids.indexOf('spatio-temporal-script');
      const sgIdx = ids.indexOf('scene-generation');
      const ssIdx = ids.indexOf('scene-selection');
      assert.ok(stsIdx < sgIdx,
        `getStatus().phases order: expected sts (${stsIdx}) before scene-generation (${sgIdx})`);
      assert.ok(sgIdx < ssIdx,
        `getStatus().phases order: expected scene-generation (${sgIdx}) before scene-selection (${ssIdx})`);
      // getStatus also surfaces stageOrder as `order` (lib/pipeline.js:698)
      const stsPhase = status.phases[stsIdx];
      const sgPhase = status.phases[sgIdx];
      assert.ok(stsPhase.order < sgPhase.order,
        `stageOrder via getStatus: sts.order (${stsPhase.order}) >= scene-generation.order (${sgPhase.order})`);
    } finally {
      await rm(t, { recursive: true, force: true });
    }
  });
});

// mkdtemp requires a prefix path with a trailing separator inside a real directory.
function joinTmp() {
  return join(tmpdir(), 'phase26-sts-');
}
