/**
 * Phase 29-03 PIPE-GUARD-01 regression test:
 * consistency-guard MUST block the pipeline when its audit fails — no more
 * silent warn-and-continue. On fail it MUST:
 *   1. throw an Error (propagates to Pipeline.run → marks episode failed)
 *   2. write consistency-blocked.json with `_consistencyBlocked: true`
 *   3. log via console.error (not console.warn) for operator visibility
 *
 * Background (the audit finding this guards against):
 *   - composition is now a real output-producing phase (Plan 29-01), so the
 *     old comment "让质量门控在 composition 阶段统一判定" is obsolete —
 *     consistency-guard IS the quality gate and must block on fail.
 *   - Previously the fail path was a no-op console.warn (line 3050-3053),
 *     letting failed audits silently continue to composition + delivery.
 *
 * Fail-path forcing strategy:
 *   auditContinuity's internal LLM calls (_llmStructuralAudit, _llmIdentityScore)
 *   all catch errors and return null scores — and null-scored dimensions are
 *   treated as "not evaluated" (not failure). So in a bare test env without API
 *   keys, auditContinuity returns passed=true (nothing was scored). To force a
 *   real passed=false, we mock global.fetch so callLLMJson receives a response
 *   where axis_compliance (threshold 1.0) scores 0.1 — below threshold → fail.
 *
 * This test will fail if:
 *   - consistency-guard swallows an audit failure (does not throw)
 *   - consistency-blocked.json is missing or lacks `_consistencyBlocked: true`
 *   - the fail message is logged via console.warn instead of console.error
 *   - the pass path (no visuals) throws or writes a block marker
 *
 * Run: node --test test/phases/consistency-guard-blocking.test.mjs
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Pipeline } from '../../lib/pipeline.js';
import { phaseHandlers } from '../../lib/phases/index.js';

let workdir;

before(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'consistency-guard-blocking-'));
});

after(async () => {
  await rm(workdir, { recursive: true, force: true });
});

const guardPhase = { id: 'consistency-guard', stageOrder: 15, name: '一致性守卫' };

// ─── fetch mock helpers (pattern from continuity-auditor-multimodal.test.mjs) ─

/**
 * Mock global.fetch to return an OpenAI-style chat completion whose content
 * is a JSON string. callLLMJson in this codebase POSTs to an OpenAI-compatible
 * endpoint and parses choices[0].message.content as JSON.
 *
 * The returned scores force auditContinuity to fail: axis_compliance has
 * threshold 1.0 (strictest dimension), so any score < 1.0 makes allPassed=false.
 */
function mockFetchFailingAudit() {
  const original = global.fetch;
  // NOTE: callLLMJson parses content via `content.match(/\[[\s\S]*\]/) || content.match(/\{[\s\S]*\}/)`.
  // The array regex is tried FIRST and is greedy — if the JSON contains any `[...]`,
  // it extracts the array instead of the object. So we return ONLY a scores object
  // with no array fields, ensuring the object regex matches the full payload.
  // (_llmStructuralAudit tolerates missing findings: `result?.findings || []`.)
  const mockBody = {
    choices: [{
      message: {
        content: JSON.stringify({
          scores: {
            axis_compliance: 0.1,     // threshold 1.0 → FAIL
            wardrobe_drift: 5,        // threshold 0 (0 violations) → FAIL
            spatial_consistency: 0.2, // threshold 0.8 → FAIL
            plot_continuity: 0.1,     // threshold 0.8 → FAIL
          },
        }),
      },
    }],
  };
  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(mockBody),
    json: async () => mockBody,
  });
  return () => { global.fetch = original; };
}

// ─── handler runner ─────────────────────────────────────────────────────────

/**
 * Run consistency-guard handler in a workdir.
 * - forceFail=true: pre-write spatio-temporal-script with shots (so visuals are
 *   non-empty → handler calls auditContinuity) AND mock fetch so the LLM-based
 *   audit returns below-threshold scores → passed=false → blocking path fires.
 * - forceFail=false: bare workdir, no visuals → handler short-circuits to pass.
 */
async function runGuard(dir, { forceFail = false } = {}) {
  let restoreFetch = null;
  if (forceFail) {
    // AssetBus reads 'spatio-temporal-script' from
    // {workdir}/.pipeline-assets/spatio-temporal-script.json.
    const assetsDir = join(dir, '.pipeline-assets');
    await mkdir(assetsDir, { recursive: true });
    const sts = {
      shots: [
        { id: 'shot-001', image_path: '/nonexistent/shot-001.png', scene_id: 'scene-A' },
        { id: 'shot-002', image_path: '/nonexistent/shot-002.png', scene_id: 'scene-B' },
      ],
    };
    await writeFile(join(assetsDir, 'spatio-temporal-script.json'), JSON.stringify(sts));
    // Mock fetch so callLLMJson (used by _llmStructuralAudit inside auditContinuity)
    // returns below-threshold scores. Without this, auditContinuity returns all-null
    // scores → passed=true (unscored dims don't count as failure).
    restoreFetch = mockFetchFailingAudit();
  }
  try {
    const pipeline = new Pipeline({ workdir: dir, config: { degradedMode: true } });
    return await phaseHandlers['consistency-guard'].after(pipeline, guardPhase, {});
  } finally {
    if (restoreFetch) restoreFetch();
  }
}

describe('consistency-guard blocking fail path (PIPE-GUARD-01)', () => {

  it('Test 1: audit fail (passed=false) → handler THROWS an error containing "consistency" or "一致性"', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cguard-fail-throw-'));
    try {
      await assert.rejects(
        () => runGuard(dir, { forceFail: true }),
        (err) => {
          // The thrown error must mention consistency so operators can grep it.
          const msg = String(err.message || err);
          assert.ok(
            /consistency|一致性/i.test(msg),
            `thrown error message must mention consistency/一致性, got: ${msg}`,
          );
          return true;
        },
        'consistency-guard MUST throw when audit fails (no more silent warn-and-continue)',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('Test 2: audit fail → consistency-blocked.json exists with _consistencyBlocked: true', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cguard-fail-marker-'));
    try {
      await assert.rejects(() => runGuard(dir, { forceFail: true }));

      const blockedPath = join(dir, 'consistency-blocked.json');
      assert.ok(existsSync(blockedPath),
        'consistency-blocked.json MUST be written on audit fail');

      const blocked = JSON.parse(await readFile(blockedPath, 'utf8'));
      assert.equal(blocked._consistencyBlocked, true,
        '_consistencyBlocked MUST be true in consistency-blocked.json');
      assert.equal(blocked._phase, 'consistency-guard',
        '_phase MUST identify consistency-guard as the blocker');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('Test 3: audit fail → console.error invoked (NOT console.warn) for the fail message', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cguard-fail-stderr-'));
    // Capture console.error and console.warn to verify the fail path uses error.
    const originalError = console.error;
    const originalWarn = console.warn;
    const errorCalls = [];
    const warnCalls = [];
    console.error = (...args) => { errorCalls.push(args.map(String).join(' ')); };
    console.warn = (...args) => { warnCalls.push(args.map(String).join(' ')); };
    try {
      await assert.rejects(() => runGuard(dir, { forceFail: true }));

      const failErrorCall = errorCalls.find(c => /consistency-guard|审计未通过/i.test(c));
      assert.ok(failErrorCall,
        'console.error MUST be called with a consistency-guard fail message');

      // The BLOCKING fail message must NOT appear in console.warn.
      const failWarnCall = warnCalls.find(c => /审计未通过.*BLOCKING|BLOCKING.*审计未通过/i.test(c));
      assert.ok(!failWarnCall,
        'the BLOCKING fail message MUST NOT use console.warn (operator visibility)');
    } finally {
      console.error = originalError;
      console.warn = originalWarn;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('Test 4: audit pass (no visuals) → handler returns without throwing, no consistency-blocked.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cguard-pass-'));
    try {
      // Bare workdir: no spatio-temporal-script → no visuals → handler short-circuits
      // to passed=true at line 3018. This MUST NOT throw and MUST NOT write a marker.
      const result = await runGuard(dir, { forceFail: false });

      assert.ok(result,
        'consistency-guard pass path MUST return a result (not throw)');

      assert.ok(!existsSync(join(dir, 'consistency-blocked.json')),
        'consistency-blocked.json MUST NOT exist when audit passes');

      // consistency-pass.json is still written on both paths (forensics).
      assert.ok(existsSync(join(dir, 'consistency-pass.json')),
        'consistency-pass.json MUST be written on the pass path');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
