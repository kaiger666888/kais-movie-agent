/**
 * Phase 17 E2E-01..E2E-04: Degraded-mode end-to-end pipeline test
 *
 * Runs the full 20-phase Pipeline.run() with all external services pointing at
 * 127.0.0.1:0 (immediate ECONNREFUSED). Verifies the pipeline completes all
 * 20 phases without a fatal exit, produces the three critical output artifacts
 * (consistency-pass.json, cost-report.json, quality-report.json), persists
 * correct state, and is idempotent on re-run.
 *
 * Success criteria (E2E-01..E2E-04):
 *   - success === true
 *   - episode matches constructor arg
 *   - 20 phases reach a done status (completed | approved | awaiting_review)
 *   - consistency-pass.json / cost-report.json / quality-report.json exist
 *     (each may carry _stub:true or _reason — degraded mode is permissive)
 *   - total run duration < 60s (soft limit)
 *   - re-running pipeline.run() on the same workdir is idempotent (all phases skip)
 *
 * Run: node --test test/e2e/pipeline-degraded-e2e.test.mjs
 *
 * Zero npm deps — uses only Node built-ins.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Pipeline, createRequirementTemplate } from '../../lib/pipeline.js';

// ─── Constants ──────────────────────────────────────────────────────────

// 60s soft ceiling — degraded mode should finish in well under 10s in practice.
const E2E_TIMEOUT_MS = 60_000;
// 20 phases (V6 pipeline definition).
const EXPECTED_PHASE_COUNT = 20;
// Phases with a `review` gate get routed to fail-open AUTO when the review
// platform is unreachable. Their state status is awaiting_review, not
// completed — but they are still "done" from the pipeline's perspective.
const DONE_STATUSES = new Set(['completed', 'approved', 'awaiting_review']);

// ─── Test suite ─────────────────────────────────────────────────────────

describe('E2E: pipeline degraded mode (all 20 phases)', () => {
  let workdir;
  let pipelineConfig;

  before(() => {
    workdir = mkdtempSync(join(tmpdir(), 'e2e-degraded-'));
    // Minimal valid requirement: 1 character, 60s, simple genre.
    // All external services point at 127.0.0.1:0 → immediate ECONNREFUSED.
    pipelineConfig = {
      ...createRequirementTemplate({
        title: 'E2E Degraded',
        genre: '科幻',
        theme: '测试',
        characters: [{ name: '主角', description: '测试角色' }],
      }),
      goldTeam: { baseUrl: 'http://127.0.0.1:0' },
      hermes: { baseUrl: 'http://127.0.0.1:0' },
      jimeng: { apiKey: 'invalid-degraded' },
      reviewPlatform: { baseUrl: 'http://127.0.0.1:0', timeout: 500 },
      // Phase 17 E2E-01: degraded mode bypass — quality gate cannot score
      // meaningfully when LLM/judges are unreachable. Allow the pipeline to
      // pass through to delivery and emit stubbed reports.
      degradedMode: true,
      qualityGate: { bypass: true },
    };
  });

  after(() => {
    if (workdir) rmSync(workdir, { recursive: true, force: true });
  });

  // ─── E2E-01 + E2E-02: full run, no fatal exit ─────────────────────────

  it('runs all 20 phases without fatal exit (success=true)', { timeout: E2E_TIMEOUT_MS }, async () => {
    const pipeline = new Pipeline({
      workdir,
      episode: 'E2E-TEST',
      config: pipelineConfig,
    });

    const result = await pipeline.run();

    assert.equal(result.success, true,
      `pipeline.run() should succeed in degraded mode (errors: ${
        JSON.stringify(Object.entries(result.phases)
          .filter(([, r]) => r.error)
          .map(([k, r]) => `${k}: ${r.error}`))
      })`);
    assert.equal(result.episode, 'E2E-TEST');
    assert.equal(Object.keys(result.phases).length, EXPECTED_PHASE_COUNT,
      `expected ${EXPECTED_PHASE_COUNT} phase entries in result`);
  });

  // ─── E2E-02 partial: state file reflects done-status for all 20 phases ─

  it('state file marks all 20 phases completed/approved/awaiting_review', () => {
    const statePath = join(workdir, '.pipeline-state.json');
    assert.ok(existsSync(statePath), '.pipeline-state.json should exist');

    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    const phaseEntries = Object.entries(state.phases || {});
    assert.equal(phaseEntries.length, EXPECTED_PHASE_COUNT,
      `state.phases should have ${EXPECTED_PHASE_COUNT} entries (got ${phaseEntries.length})`);

    const notDone = phaseEntries.filter(([, p]) => !DONE_STATUSES.has(p.status));
    assert.deepEqual(notDone.map(([k]) => k), [],
      `phases not in done status: ${notDone.map(([k, p]) => `${k}=${p.status}`).join(', ')}`);
  });

  // ─── E2E-02 partial: critical output files exist (degraded-permissive) ─

  it('produces consistency-pass.json / cost-report.json / quality-report.json', () => {
    const criticalFiles = [
      'consistency-pass.json',
      'cost-report.json',
      'quality-report.json',
    ];
    for (const f of criticalFiles) {
      const path = join(workdir, f);
      assert.ok(existsSync(path),
        `${f} should exist in degraded mode (workdir: ${workdir})`);

      // File should be valid JSON and non-empty.
      const raw = readFileSync(path, 'utf-8');
      const parsed = JSON.parse(raw);
      assert.ok(Object.keys(parsed).length > 0,
        `${f} should be non-empty JSON (got: ${raw.slice(0, 80)})`);
    }
  });

  // ─── E2E-02 partial: consistency-pass / cost-report content shape ──────

  it('consistency-pass.json is non-silent-pass (carries _reason or audit fields)', () => {
    const path = join(workdir, 'consistency-pass.json');
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));

    // Degraded mode with no visuals → should carry _reason: 'no_visuals_yet'
    // OR if Phase 12 auditor ran (with stub LLM), audit fields. Either is valid.
    const hasReasonField = typeof parsed._reason === 'string';
    const hasAuditFields = parsed.passed !== undefined
      || parsed.retry_shots !== undefined
      || parsed._phase === 'consistency-guard';
    assert.ok(hasReasonField || hasAuditFields,
      `consistency-pass.json should carry _reason or audit fields (got keys: ${Object.keys(parsed).join(',')})`);
  });

  it('cost-report.json has episode + by_phase + total_gpu_sec shape', () => {
    const path = join(workdir, 'cost-report.json');
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));

    assert.ok(parsed.episode,
      `cost-report.json should have episode field (got: ${JSON.stringify(parsed).slice(0, 100)})`);
    assert.ok(parsed.by_phase,
      'cost-report.json should have by_phase aggregation');
    assert.ok(typeof parsed.total_gpu_sec === 'number',
      `cost-report.json.total_gpu_sec should be a number (got: ${typeof parsed.total_gpu_sec})`);
  });

  // ─── E2E-04: idempotency — re-running on same workdir skips all phases ─

  it('re-running pipeline.run() on same workdir is idempotent (all 20 skipped)', { timeout: E2E_TIMEOUT_MS }, async () => {
    const pipeline = new Pipeline({
      workdir,
      episode: 'E2E-TEST',
      config: pipelineConfig,
    });

    const rerunStart = Date.now();
    const result = await pipeline.run();
    const rerunDuration = Date.now() - rerunStart;

    assert.equal(result.success, true, 'idempotent re-run should still return success=true');
    assert.equal(Object.keys(result.phases).length, EXPECTED_PHASE_COUNT);

    const skipped = Object.values(result.phases).filter(r => r.skipped);
    assert.equal(skipped.length, EXPECTED_PHASE_COUNT,
      `all ${EXPECTED_PHASE_COUNT} phases should be skipped on re-run (got ${skipped.length})`);

    // Idempotent re-run should be near-instant (< 5s) since no handler bodies execute.
    assert.ok(rerunDuration < 5000,
      `idempotent re-run should complete in <5s (got ${rerunDuration}ms)`);
  });

  // ─── Performance guard: first run well under 60s soft ceiling ──────────

  it('first-run duration was captured (this test guards regressions via the timeout on test 1)', () => {
    // The { timeout: E2E_TIMEOUT_MS } on the first test enforces the 60s ceiling.
    // If we got here, the first test passed within the budget. We additionally
    // sanity-check that the state file has a completedAt timestamp from run 1.
    const state = JSON.parse(readFileSync(join(workdir, '.pipeline-state.json'), 'utf-8'));
    assert.ok(state.completedAt, 'state should have completedAt after pipeline.run()');
    assert.ok(state.startedAt, 'state should have startedAt');
  });
});
