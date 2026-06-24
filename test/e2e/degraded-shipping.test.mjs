/**
 * Phase 30-01: Degraded-mode end-to-end shipping test (SC#1 + SC#3)
 *
 * Verifies the v4.0 pipeline, in degraded mode, flows through all 20 stages
 * including composition (PIPE-COMPOSE-01) and delivery (PIPE-COMPOSE-02) and
 * produces the shippable master.mp4 placeholder. Also asserts the operator
 * visibility marker _composition.delivered_mastermp4 in quality-report.json.
 *
 * Success criteria:
 *   - SC#1: degraded E2E produces master.mp4 (0-byte placeholder acceptable)
 *   - SC#3: test baseline grows (508 -> 509+), no regression
 *
 * Hermetic: runs in fs.mkdtempSync() workdir; no writes to repo output/.
 *
 * Run: node --test test/e2e/degraded-shipping.test.mjs
 *
 * Deviation note (Rule 3 — blocking issue):
 *   The plan's interface contract specified `bin/pipeline.js run --episode X
 *   --to delivery` with DEGRADED=1 env as a subprocess. The actual CLI does
 *   NOT support --to, and degraded mode is config-object-driven (not env).
 *   Without degradedMode:true in the Pipeline config, composition's quality
 *   gate throws on the guaranteed-fail degraded score and aborts the run
 *   before delivery. The CLI exposes no config-injection flag, so a pure
 *   subprocess invocation cannot reach delivery in degraded mode without an
 *   architectural CLI change (Rule 4 — out of scope for a verification-only
 *   phase). This test therefore constructs Pipeline directly with the
 *   established v2.0 degraded config pattern (mirrors the sibling
 *   pipeline-degraded-e2e.test.mjs), exercising the real composition +
 *   delivery handler bodies in lib/phases/index.js. SC#1 is still verified
 *   end-to-end: composition writes master.mp4, delivery reads it and stamps
 *   the _composition.delivered_mastermp4 marker.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Pipeline, createRequirementTemplate } from '../../lib/pipeline.js';

// ─── Constants ──────────────────────────────────────────────────────────

// 120s ceiling — degraded mode finishes in well under 10s in practice.
const E2E_TIMEOUT_MS = 120_000;
// Unique smoke episode id — avoids colliding with real operator episodes.
const SMOKE_EPISODE = 'EP30-E2E-SMOKE';

// ─── Test suite ─────────────────────────────────────────────────────────

describe('Phase 30 SC#1: degraded E2E shipping produces master.mp4', () => {
  let workdir;
  let pipelineConfig;

  before(() => {
    workdir = mkdtempSync(join(tmpdir(), 'kmai-e2e-30-'));
    // Minimal valid requirement + degraded-mode config (v2.0 Phase 17 pattern).
    // All external services point at 127.0.0.1:0 -> immediate ECONNREFUSED ->
    // handlers fall back to degraded paths. qualityGate.bypass unblocks the
    // composition hard-fail gate so the run reaches delivery.
    pipelineConfig = {
      ...createRequirementTemplate({
        title: 'Phase 30 E2E Smoke',
        genre: '科幻',
        theme: '验收',
        characters: [{ name: '主角', description: '测试角色' }],
      }),
      goldTeam: { baseUrl: 'http://127.0.0.1:0' },
      hermes: { baseUrl: 'http://127.0.0.1:0' },
      jimeng: { apiKey: 'invalid-degraded' },
      reviewPlatform: { baseUrl: 'http://127.0.0.1:0', timeout: 500 },
      degradedMode: true,
      qualityGate: { bypass: true },
    };
  });

  after(() => {
    // T-30-01 mitigation: guaranteed temp workdir cleanup.
    if (workdir) rmSync(workdir, { recursive: true, force: true });
  });

  // ─── Test 1: happy path — pipeline completes & produces master.mp4 ────

  it('runs all 20 stages in degraded mode and produces master.mp4', { timeout: E2E_TIMEOUT_MS }, async () => {
    const pipeline = new Pipeline({
      workdir,
      episode: SMOKE_EPISODE,
      config: pipelineConfig,
    });

    const result = await pipeline.run();

    // Assertion 1: pipeline completed all 20 stages without fatal exit.
    assert.equal(result.success, true,
      `pipeline.run() should succeed in degraded mode (errors: ${
        JSON.stringify(Object.entries(result.phases || {})
          .filter(([, r]) => r.error)
          .map(([k, r]) => `${k}: ${r.error}`))
      })`);

    // Assertion 2 (strict): master.mp4 exists at top of workdir
    // (composition writes join(pipeline.workdir, 'master.mp4')).
    const masterPath = join(workdir, 'master.mp4');
    assert.ok(existsSync(masterPath),
      `master.mp4 should exist at ${masterPath} after degraded E2E run`);

    // Assertion 3 (soft): web-preview.mp4 — degrade-tolerant per PIPE-COMPOSE-02.
    // Absent is non-fatal; log warn only.
    const webPreviewPath = join(workdir, 'web-preview.mp4');
    if (!existsSync(webPreviewPath)) {
      console.warn('[degraded-shipping] web-preview.mp4 absent (degrade-tolerant per PIPE-COMPOSE-02)');
    }
  });

  // ─── Test 2: no repo pollution — smoke episode absent from repo tree ──

  it('does not pollute the repo working tree (smoke episode dir absent)', () => {
    // The temp workdir is isolated; this test additionally guards against any
    // accidental write to the repo's output/ tree by asserting the unique
    // smoke episode id does NOT appear under the repo output/ dir.
    const repoOutputSmoke = join(process.cwd(), 'output', SMOKE_EPISODE);
    assert.equal(existsSync(repoOutputSmoke), false,
      `smoke episode must not leak into repo output/ (${repoOutputSmoke})`);
  });

  // ─── Test 3: degraded marker — _composition.delivered_mastermp4 truthy ─

  it('quality-report.json carries _composition.delivered_mastermp4 === true', () => {
    const qreportPath = join(workdir, 'quality-report.json');
    assert.ok(existsSync(qreportPath),
      `quality-report.json should exist at ${qreportPath}`);

    const qreport = JSON.parse(readFileSync(qreportPath, 'utf-8'));

    // Marker is top-level _composition.delivered_mastermp4 (Phase 29-02).
    assert.ok(qreport && typeof qreport === 'object',
      `quality-report.json should parse to an object`);
    assert.ok(qreport._composition && typeof qreport._composition === 'object',
      `quality-report.json should have _composition object (got keys: ${
        Object.keys(qreport).join(',')
      })`);
    assert.equal(qreport._composition.delivered_mastermp4, true,
      `_composition.delivered_mastermp4 should be true when master.mp4 is present (got: ${
        JSON.stringify(qreport._composition)
      })`);
  });
});
