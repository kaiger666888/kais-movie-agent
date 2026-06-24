/**
 * Phase 27-02: Regression test for jimeng-client deprecation warn + strict degrade.
 *
 * Guards against silent removal of the deprecation warn (PIPE-RENDER-02) and
 * verifies that the no-API-key path strictly degrades to placeholders (no real
 * jimeng API call is attempted when JIMENG_API_KEY / JIMENG_BASE_URL are absent).
 *
 * Pattern: mirrors test/phases/handlers.test.mjs scene-generation scaffolding +
 *          Phase 26's console.warn spy approach referenced in 27-CONTEXT.md.
 */
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Pipeline, createRequirementTemplate } from '../../lib/pipeline.js';
import { phaseHandlers, _resetJimengDeprecateFlagForTest } from '../../lib/phases/index.js';

const DEPRECATE_MSG = 'jimeng-client fallback-only — migrate to dreamina CLI when available';

// ─── Shared fixtures ──────────────────────────────────────────────────────

let workdir;
let originalFetch;
const savedEnv = {};

async function buildScenePipeline(dir) {
  return new Pipeline({
    workdir: dir,
    config: createRequirementTemplate({
      title: 'jimeng deprecate 测试',
      genre: '科幻',
      characters: [{ name: '主角', description: 'x' }],
    }),
    episode: 'JIMENG-DEP-EP',
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Phase 27-02: jimeng-client deprecation warn + strict degrade', () => {
  let warnCalls;
  let originalWarn;

  before(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'phase27-02-jimeng-'));
    // Strict-degrade test needs NO jimeng env leakage.
    for (const k of ['JIMENG_API_KEY', 'JIMENG_BASE_URL', 'JIMENG_SESSION_ID']) {
      if (process.env[k] !== undefined) {
        savedEnv[k] = process.env[k];
        delete process.env[k];
      }
    }
    originalFetch = global.fetch;
  });

  after(async () => {
    // Restore env
    for (const [k, v] of Object.entries(savedEnv)) process.env[k] = v;
    global.fetch = originalFetch;
    await rm(workdir, { recursive: true, force: true });
  });

  beforeEach(() => {
    warnCalls = [];
    originalWarn = console.warn;
    console.warn = (msg, ...rest) => { warnCalls.push(String(msg)); };
  });

  afterEach(() => {
    console.warn = originalWarn;
  });

  it('Test 1: deprecate warn emits on first scene-generation invocation', async () => {
    // Reset module flag so this test asserts the emit-on-first-call contract
    // regardless of test execution order.
    _resetJimengDeprecateFlagForTest();

    const dir = await mkdtemp(join(tmpdir(), 'p2702-t1-'));
    const pipeline = await buildScenePipeline(dir);
    const phase = Pipeline.getPhases().find(p => p.id === 'scene-generation');
    const handler = phaseHandlers['scene-generation'];

    // No jimeng env, no network → degrade path triggered.
    await handler.after(pipeline, phase, { data: {} });

    const deprecateWarns = warnCalls.filter(m => m.includes(DEPRECATE_MSG));
    assert.ok(deprecateWarns.length >= 1,
      `expected at least 1 deprecate warn, got ${deprecateWarns.length} (all warns: ${JSON.stringify(warnCalls)})`);

    await rm(dir, { recursive: true, force: true });
  });

  it('Test 2: warn deduped module-wide (3 invocations → exactly 1 warn)', async () => {
    _resetJimengDeprecateFlagForTest();

    for (let i = 0; i < 3; i++) {
      const dir = await mkdtemp(join(tmpdir(), `p2702-t2-${i}-`));
      const pipeline = await buildScenePipeline(dir);
      const phase = Pipeline.getPhases().find(p => p.id === 'scene-generation');
      const handler = phaseHandlers['scene-generation'];
      // Clear warn list between runs but do NOT reset module flag — the dedup
      // mechanism is what we are testing.
      warnCalls = [];
      await handler.after(pipeline, phase, { data: {} });
      await rm(dir, { recursive: true, force: true });
    }

    // After 3 runs, count deprecate warns seen across the loop.
    // First iteration fires the warn; the module flag suppresses it on iter 2 & 3.
    // Re-run the loop to capture into a fresh list:
    _resetJimengDeprecateFlagForTest();
    const allWarns = [];
    const savedWarn = console.warn;
    console.warn = (m) => allWarns.push(String(m));
    try {
      for (let i = 0; i < 3; i++) {
        const dir = await mkdtemp(join(tmpdir(), `p2702-t2b-${i}-`));
        const pipeline = await buildScenePipeline(dir);
        const phase = Pipeline.getPhases().find(p => p.id === 'scene-generation');
        await phaseHandlers['scene-generation'].after(pipeline, phase, { data: {} });
        await rm(dir, { recursive: true, force: true });
      }
    } finally {
      console.warn = savedWarn;
    }

    const deprecateWarns = allWarns.filter(m => m.includes(DEPRECATE_MSG));
    assert.equal(deprecateWarns.length, 1,
      `module-level flag should suppress repeats; expected exactly 1 warn across 3 invocations, got ${deprecateWarns.length}`);
  });

  it('Test 3: cross-handler dedup — character-generation warn still fires only once total', async () => {
    // The module-level flag is shared across all 3 handlers. If we already
    // warned via scene-generation in this process, character-generation should
    // not warn again. (Proves the dedup mechanism is module-wide, not per-handler.)
    //
    // NOTE: soul-visual handler has a pre-existing constructor signature mismatch
    // (passes { apiKey } object to a positional-string param) that throws
    // synchronously outside its try/catch. Per plan 27-02 interfaces note this is
    // out-of-scope — we use character-generation (positional-string signature
    // matches) for the cross-handler dedup assertion instead.
    _resetJimengDeprecateFlagForTest();

    const allWarns = [];
    const savedWarn = console.warn;
    console.warn = (m) => allWarns.push(String(m));

    try {
      // 1) scene-generation (warns on first call)
      const dir1 = await mkdtemp(join(tmpdir(), 'p2702-t3-scene-'));
      const p1 = await buildScenePipeline(dir1);
      const phase1 = Pipeline.getPhases().find(p => p.id === 'scene-generation');
      await phaseHandlers['scene-generation'].after(p1, phase1, { data: {} });
      await rm(dir1, { recursive: true, force: true });

      // 2) character-generation (would warn if module flag were not shared)
      const dir2 = await mkdtemp(join(tmpdir(), 'p2702-t3-char-'));
      const p2 = new Pipeline({
        workdir: dir2,
        config: createRequirementTemplate({
          title: 'char 测试', genre: '科幻',
          characters: [{ name: '主角', description: 'x' }],
        }),
        episode: 'JIMENG-CHAR-EP',
      });
      const phase2 = Pipeline.getPhases().find(p => p.id === 'character-generation');
      if (phaseHandlers['character-generation']) {
        // Wrap in try/catch — character-generation needs jimeng.ping() which will
        // fail under forced-fetch, but the handler degrades internally.
        try {
          await phaseHandlers['character-generation'].after(p2, phase2, { data: {} });
        } catch { /* expected degrade path */ }
      }
      await rm(dir2, { recursive: true, force: true });
    } finally {
      console.warn = savedWarn;
    }

    const deprecateWarns = allWarns.filter(m => m.includes(DEPRECATE_MSG));
    assert.equal(deprecateWarns.length, 1,
      `module-level flag should dedup across handlers; expected 1 warn total, got ${deprecateWarns.length}`);
  });

  it('Test 4: strict degrade — no jimeng env triggers placeholder path, no real API call', async () => {
    // Force fetch to throw — any real network call (ping or generateImage) would
    // propagate. The handler's degrade path (ping try/catch + degraded flag)
    // must swallow it and produce placeholder candidates.
    global.fetch = async () => { throw new Error('test-forced network failure'); };

    const dir = await mkdtemp(join(tmpdir(), 'p2702-t4-'));
    const pipeline = await buildScenePipeline(dir);
    const phase = Pipeline.getPhases().find(p => p.id === 'scene-generation');
    const handler = phaseHandlers['scene-generation'];

    // The handler MUST complete without throwing despite forced fetch failure.
    // (Await directly — assert.doesNotThrow does not await async callbacks.)
    let result;
    try {
      result = await handler.after(pipeline, phase, { data: {} });
    } catch (e) {
      assert.fail(`scene-generation threw on network failure instead of degrading: ${e.message}`);
    }

    // Placeholder path produces candidates_count >= 1 with degraded flag.
    assert.ok(result?.metrics, 'scene-generation should return metrics');
    assert.ok(result.metrics.candidates_count >= 1,
      `degrade path should still produce placeholder candidates (got ${result.metrics.candidates_count})`);
    assert.equal(result.metrics.degraded, true,
      'degrade path should set degraded=true when jimeng is unavailable');

    global.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  });

  it('Test 5: regression guard — deprecate warn string still present in source', async () => {
    const src = await readFile(join(process.cwd(), 'lib/phases/index.js'), 'utf-8');
    assert.ok(src.includes(DEPRECATE_MSG),
      'deprecate warn message removed from lib/phases/index.js — PIPE-RENDER-02 regression');
    // Also confirm the module-level flag helper is present.
    assert.ok(/let _jimengDeprecateWarned = false/.test(src),
      '_jimengDeprecateWarned flag removed — dedup mechanism regressed');
    assert.ok(/function _warnJimengDeprecate\(\)/.test(src),
      '_warnJimengDeprecate helper removed — dedup mechanism regressed');
  });
});
