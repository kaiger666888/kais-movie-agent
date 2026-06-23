/**
 * Phase 25: FineTuneETL — submitTrainingJob + runGoldenRegression tests (Commit 2)
 *
 * 覆盖 CONTEXT.md:
 *   B6-02: submitTrainingJob (via gold-team submitTask with task_type='lora_training')
 *   B6-05: golden-set regression baseline + pre/post training diff
 *
 * Run: node --test test/phases/finetune-etl-submit-regression.test.mjs
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { AssetBus } from '../../lib/asset-bus.js';
import { FineTuneETL } from '../../lib/finetune-etl.js';

// ─── Test helpers ────────────────────────────────────────────────────────

function makeWorkdir() {
  return mkdtemp(join(tmpdir(), 'finetune-etl-submit-'));
}

/**
 * Mock GoldTeamClient — records submitTask calls, returns deterministic taskId.
 */
function makeMockGtClient(opts = {}) {
  const calls = [];
  return {
    calls,
    async submitTask({ taskType, params, description, ...rest }) {
      calls.push({ taskType, params, description, rest });
      if (opts.throw) throw new Error(opts.throw);
      return {
        taskId: opts.taskId || `mock-task-${calls.length}`,
        state: 'queued',
        createdAt: new Date().toISOString(),
      };
    },
  };
}

async function setupPipeline(workdir, opts = {}) {
  const assetBus = new AssetBus(workdir);
  const gtClient = opts.goldTeamClient || makeMockGtClient();
  if (opts.failedShots) {
    await assetBus.write('failed-shots', { failures: opts.failedShots, version: 1 });
  }
  const etl = new FineTuneETL({
    assetBus,
    workdir,
    goldTeamClient: gtClient,
    embeddingFn: async () => [0, 0, 0],
    goldenSetDir: opts.goldenSetDir,
  });
  return { assetBus, etl, gtClient };
}

async function approveSample(etl, sampleId, override = {}) {
  return etl.approveSample(sampleId, {
    copyright_status: 'original',
    pii_scrubbed: true,
    label_correct: true,
    approved_for_training: true,
    reviewer: 'tester',
    ...override,
  });
}

// ─── submitTrainingJob (B6-02) ───────────────────────────────────────────

describe('FineTuneETL.submitTrainingJob (B6-02)', () => {
  // Each test uses its own fresh workdir to avoid finetune-dataset slot state leaking

  it('throws when goldTeamClient not configured', async () => {
    const workdir = await makeWorkdir();
    try {
      const { etl } = await setupPipeline(workdir, { goldTeamClient: null });
      await etl.assetBus.write('failed-shots', {
        failures: [{ shot_id: 's1', error: 'e', prompt: 'p', timestamp: '2026-06-01T00:00:00Z' }],
        version: 1,
      });
      await etl.generateManifest();
      await approveSample(etl, 's-s1');

      // rebuild etl without goldTeamClient
      const etl2 = new FineTuneETL({
        assetBus: etl.assetBus,
        workdir,
        goldTeamClient: null,
      });
      await assert.rejects(
        () => etl2.submitTrainingJob(),
        /goldTeamClient \(not configured\)/,
      );
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it('throws when no approved samples in finetune-dataset slot', async () => {
    const workdir = await makeWorkdir();
    try {
      const gtClient = makeMockGtClient();
      const { etl } = await setupPipeline(workdir, { goldTeamClient: gtClient });
      // Don't seed any failed shots or approvals
      await assert.rejects(
        () => etl.submitTrainingJob(),
        /No approved samples — nothing to train/,
      );
      // gold-team should NOT have been called
      assert.equal(gtClient.calls.length, 0);
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it('submits lora_training task with manifest path + sample count', async () => {
    const workdir = await makeWorkdir();
    try {
      const gtClient = makeMockGtClient();
      const { etl } = await setupPipeline(workdir, { goldTeamClient: gtClient });

      // Seed + approve 3 samples
      await etl.assetBus.write('failed-shots', {
        failures: [
          { shot_id: 'a1', error: 'e', prompt: 'p1', timestamp: '2026-06-01T00:00:00Z' },
          { shot_id: 'a2', error: 'e', prompt: 'p2', timestamp: '2026-06-01T00:00:00Z' },
          { shot_id: 'a3', error: 'e', prompt: 'p3', timestamp: '2026-06-01T00:00:00Z' },
        ],
        version: 1,
      });
      await etl.generateManifest();
      await approveSample(etl, 's-a1');
      await approveSample(etl, 's-a2');
      await approveSample(etl, 's-a3');

      const result = await etl.submitTrainingJob({ base_model: 'flux-dev', hyperparams: { lora_rank: 16 } });
      assert.ok(result.task_id);
      assert.equal(result.sample_count, 3);
      assert.match(result.manifest_path, /finetune-dataset\.jsonl$/);

      // Verify gold-team call shape
      assert.equal(gtClient.calls.length, 1);
      const call = gtClient.calls[0];
      assert.equal(call.taskType, 'lora_training');
      assert.equal(call.params.base_model, 'flux-dev');
      assert.equal(call.params.sample_count, 3);
      assert.equal(call.params.lora_rank, 16);
      assert.match(call.params.dataset_path, /finetune-dataset\.jsonl$/);
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it('defaults base_model to flux-dev when not specified', async () => {
    const workdir = await makeWorkdir();
    try {
      const gtClient = makeMockGtClient();
      const { etl } = await setupPipeline(workdir, { goldTeamClient: gtClient });
      await etl.assetBus.write('failed-shots', {
        failures: [{ shot_id: 'b1', error: 'e', prompt: 'p', timestamp: '2026-06-01T00:00:00Z' }],
        version: 1,
      });
      await etl.generateManifest();
      await approveSample(etl, 's-b1');

      await etl.submitTrainingJob();
      const call = gtClient.calls[0];
      assert.equal(call.params.base_model, 'flux-dev');
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it('propagates gold-team errors', async () => {
    const workdir = await makeWorkdir();
    try {
      const gtClient = makeMockGtClient({ throw: 'GPU cluster offline' });
      const { etl } = await setupPipeline(workdir, { goldTeamClient: gtClient });
      await etl.assetBus.write('failed-shots', {
        failures: [{ shot_id: 'c1', error: 'e', prompt: 'p', timestamp: '2026-06-01T00:00:00Z' }],
        version: 1,
      });
      await etl.generateManifest();
      await approveSample(etl, 's-c1');

      await assert.rejects(
        () => etl.submitTrainingJob(),
        /GPU cluster offline/,
      );
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });
});

// ─── runGoldenRegression (B6-05) ─────────────────────────────────────────

describe('FineTuneETL.runGoldenRegression (B6-05)', () => {
  let workdir;
  let goldenDir;

  before(async () => {
    workdir = await makeWorkdir();
    goldenDir = await mkdtemp(join(tmpdir(), 'golden-set-test-'));
    // Write a test baseline with 5 prompts (real impl targets 50-100)
    await writeFile(
      join(goldenDir, 'regression-baseline.json'),
      JSON.stringify({
        _schema_version: 1,
        baseline_model: 'flux-dev-base-v1',
        prompts: [
          { prompt_id: 'p-001', prompt: 'a', score: 0.9 },
          { prompt_id: 'p-002', prompt: 'b', score: 0.85 },
          { prompt_id: 'p-003', prompt: 'c', score: 0.88 },
          { prompt_id: 'p-004', prompt: 'd', score: 0.92 },
          { prompt_id: 'p-005', prompt: 'e', score: 0.80 },
        ],
      }),
    );
  });
  after(async () => {
    await rm(workdir, { recursive: true, force: true });
    await rm(goldenDir, { recursive: true, force: true });
  });

  it('loads baseline and returns passed=true when no regressions', async () => {
    const { etl } = await setupPipeline(workdir, { goldenSetDir: goldenDir });
    const result = await etl.runGoldenRegression('pre-hash', 'post-hash', {
      postTrainingScores: {
        'p-001': 0.91, // +0.01 — OK
        'p-002': 0.86, // +0.01 — OK
        'p-003': 0.87, // -0.01 — OK (< 5%)
        'p-004': 0.93,
        'p-005': 0.81,
      },
    });
    assert.equal(result.passed, true);
    assert.equal(result.regressions.length, 0);
    assert.equal(result.baseline_count, 5);
    assert.equal(result.pre_training_hash, 'pre-hash');
    assert.equal(result.post_training_hash, 'post-hash');
    assert.equal(result.threshold_pct, 5);
  });

  it('flags regressions > 5% as minor severity', async () => {
    const { etl } = await setupPipeline(workdir, { goldenSetDir: goldenDir });
    const result = await etl.runGoldenRegression('pre', 'post', {
      postTrainingScores: {
        'p-001': 0.84, // 0.9 → 0.84, -6.7% → minor regression
        'p-002': 0.85,
        'p-003': 0.88,
        'p-004': 0.92,
        'p-005': 0.80,
      },
    });
    assert.equal(result.passed, false);
    assert.ok(result.regressions.length >= 1);
    const r1 = result.regressions.find(r => r.prompt_id === 'p-001');
    assert.ok(r1);
    assert.equal(r1.severity, 'minor');
    assert.ok(r1.delta_pct > 5);
  });

  it('flags regressions > 15% as severe severity', async () => {
    const { etl } = await setupPipeline(workdir, { goldenSetDir: goldenDir });
    const result = await etl.runGoldenRegression('pre', 'post', {
      postTrainingScores: {
        'p-001': 0.70, // 0.9 → 0.7, -22.2% → severe
        'p-002': 0.85,
        'p-003': 0.88,
        'p-004': 0.92,
        'p-005': 0.80,
      },
    });
    const severe = result.regressions.find(r => r.severity === 'severe');
    assert.ok(severe, `expected severe regression, got: ${JSON.stringify(result.regressions)}`);
    assert.ok(severe.delta_pct > 15);
  });

  it('flags regressions 10-15% as moderate severity', async () => {
    const { etl } = await setupPipeline(workdir, { goldenSetDir: goldenDir });
    const result = await etl.runGoldenRegression('pre', 'post', {
      postTrainingScores: {
        'p-001': 0.79, // 0.9 → 0.79, -12.2% → moderate
        'p-002': 0.85,
        'p-003': 0.88,
        'p-004': 0.92,
        'p-005': 0.80,
      },
    });
    const mod = result.regressions.find(r => r.severity === 'moderate');
    assert.ok(mod);
  });

  it('does NOT flag improvements as regressions', async () => {
    const { etl } = await setupPipeline(workdir, { goldenSetDir: goldenDir });
    const result = await etl.runGoldenRegression('pre', 'post', {
      postTrainingScores: {
        'p-001': 0.99, // +0.09 — improvement, not regression
        'p-002': 0.95, // +0.10
        'p-003': 0.88,
        'p-004': 0.92,
        'p-005': 0.80,
      },
    });
    assert.equal(result.passed, true);
    assert.equal(result.regressions.length, 0);
  });

  it('throws when baseline file missing', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'empty-golden-'));
    try {
      const { etl } = await setupPipeline(workdir, { goldenSetDir: emptyDir });
      await assert.rejects(
        () => etl.runGoldenRegression('a', 'b'),
        /Cannot load golden-set regression baseline/,
      );
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it('throws when baseline has empty prompts array', async () => {
    const emptyBaselineDir = await mkdtemp(join(tmpdir(), 'empty-baseline-'));
    try {
      await writeFile(
        join(emptyBaselineDir, 'regression-baseline.json'),
        JSON.stringify({ prompts: [] }),
      );
      const { etl } = await setupPipeline(workdir, { goldenSetDir: emptyBaselineDir });
      await assert.rejects(
        () => etl.runGoldenRegression('a', 'b'),
        /no prompts/,
      );
    } finally {
      await rm(emptyBaselineDir, { recursive: true, force: true });
    }
  });

  it('handles missing postTrainingScores gracefully', async () => {
    const { etl } = await setupPipeline(workdir, { goldenSetDir: goldenDir });
    const result = await etl.runGoldenRegression('pre', 'post', {});
    // No scores → no comparisons → passed=true (vacuously)
    assert.equal(result.passed, true);
    assert.equal(result.regressions.length, 0);
  });
});

// ─── regression-baseline.json framework structure (B6-05) ────────────────

describe('regression-baseline.json framework (50-100 prompts)', () => {
  it('contains 50-100 prompts in committed baseline file', async () => {
    // Read the actual committed baseline
    const baselinePath = join(process.cwd(), 'test', 'golden-set', 'regression-baseline.json');
    const data = JSON.parse(await readFile(baselinePath, 'utf-8'));
    assert.ok(Array.isArray(data.prompts), 'prompts should be array');
    assert.ok(
      data.prompts.length >= 50 && data.prompts.length <= 100,
      `expected 50-100 prompts, got ${data.prompts.length}`,
    );
    // Each prompt has required fields
    for (const p of data.prompts) {
      assert.ok(p.prompt_id, `prompt missing prompt_id: ${JSON.stringify(p)}`);
      assert.ok(typeof p.prompt === 'string', `prompt ${p.prompt_id} missing prompt string`);
      assert.ok(typeof p.score === 'number', `prompt ${p.prompt_id} missing numeric score`);
    }
  });
});
