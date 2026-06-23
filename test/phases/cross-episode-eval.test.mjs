/**
 * Phase 24 B2-05: cross-episode eval framework tests
 *
 * Coverage:
 *   - loadPairs: parses placeholder pairs.json, rejects invalid entries
 *   - scorePair: returns similarity for dinov2 / phash / mixed / error
 *   - sweepThresholds: precision/recall/F1 at each threshold
 *   - bestThreshold: max-F1 selection
 *   - buildCalibrationReport: structure + operator_action_required flag
 *
 * Run: node --test test/phases/cross-episode-eval.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  loadPairs,
  scorePair,
  sweepThresholds,
  bestThreshold,
  buildCalibrationReport,
} from '../../lib/cross-episode-eval.js';

// ---------- loadPairs ----------

describe('Phase 24 B2-05: loadPairs', () => {
  it('loads the placeholder pairs.json without error', async () => {
    const pairSet = await loadPairs(join(process.cwd(), 'test/cross-episode-eval/pairs.json'));
    assert.ok(pairSet.pairs.length >= 5);
    assert.ok(pairSet.version >= 1);
    // All entries have required fields
    for (const p of pairSet.pairs) {
      assert.ok(p.pair_id);
      assert.ok(p.category);
      assert.ok(['match', 'no_match'].includes(p.expected_label));
      assert.ok(p.image_a.path);
      assert.ok(p.image_b.path);
    }
  });

  it('rejects pairs missing required fields', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'p24-eval-'));
    try {
      const badPath = join(tmp, 'bad.json');
      await writeFile(badPath, JSON.stringify({
        version: 1, generated_at: '2026-06-23T00:00:00Z',
        pairs: [{ pair_id: 'x', category: 'diff_actor', /* missing expected_label */ image_a: { path: '/a' }, image_b: { path: '/b' } }],
      }));
      await assert.rejects(() => loadPairs(badPath), /invalid entry/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('rejects invalid expected_label', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'p24-eval-'));
    try {
      const badPath = join(tmp, 'bad.json');
      await writeFile(badPath, JSON.stringify({
        version: 1, generated_at: '2026-06-23T00:00:00Z',
        pairs: [{ pair_id: 'x', category: 'diff_actor', expected_label: 'invalid', image_a: { path: '/a' }, image_b: { path: '/b' } }],
      }));
      await assert.rejects(() => loadPairs(badPath), /invalid expected_label/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ---------- scorePair ----------

describe('Phase 24 B2-05: scorePair', () => {
  it('dinov2 vs dinov2 → cosine similarity', async () => {
    const fpFn = async (path) => ({ type: 'dinov2', vector: path.includes('a') ? [1, 0, 0] : [0.9, 0.4, 0], source_image: path });
    const s = await scorePair({
      pair_id: 'p1', expected_label: 'match',
      image_a: { path: '/a.png' }, image_b: { path: '/b.png' },
    }, fpFn);
    assert.strictEqual(s.type, 'dinov2');
    assert.ok(s.similarity > 0 && s.similarity <= 1);
  });

  it('phash vs phash → similarity in [0,1]', async () => {
    const fpFn = async () => ({ type: 'phash', hash: '0000000000000000', source_image: '/x' });
    const s = await scorePair({
      pair_id: 'p1', expected_label: 'match',
      image_a: { path: '/a' }, image_b: { path: '/b' },
    }, fpFn);
    assert.strictEqual(s.type, 'phash');
    assert.strictEqual(s.similarity, 1);
  });

  it('mixed types → similarity null, type mixed', async () => {
    const fpFn = async (path) => path.includes('a')
      ? { type: 'dinov2', vector: [1, 0], source_image: path }
      : { type: 'phash', hash: 'aabb', source_image: path };
    const s = await scorePair({
      pair_id: 'p1', expected_label: 'match',
      image_a: { path: '/a' }, image_b: { path: '/b' },
    }, fpFn);
    assert.strictEqual(s.type, 'mixed');
    assert.strictEqual(s.similarity, null);
  });

  it('fingerprintFn throws → returns error envelope', async () => {
    const fpFn = async () => { throw new Error('gt unavailable'); };
    const s = await scorePair({
      pair_id: 'p1', expected_label: 'match',
      image_a: { path: '/a' }, image_b: { path: '/b' },
    }, fpFn);
    assert.strictEqual(s.type, 'error');
    assert.strictEqual(s.similarity, null);
    assert.match(s.error, /gt unavailable/);
  });
});

// ---------- sweepThresholds + bestThreshold ----------

describe('Phase 24 B2-05: sweepThresholds + bestThreshold', () => {
  const pairs = [
    { pair_id: 'm1', expected_label: 'match' },
    { pair_id: 'm2', expected_label: 'match' },
    { pair_id: 'n1', expected_label: 'no_match' },
    { pair_id: 'n2', expected_label: 'no_match' },
  ];
  const scored = [
    { pair_id: 'm1', similarity: 0.97 },
    { pair_id: 'm2', similarity: 0.95 },
    { pair_id: 'n1', similarity: 0.60 },
    { pair_id: 'n2', similarity: 0.80 },
  ];

  it('sweeps thresholds and computes precision/recall/F1', () => {
    const sweep = sweepThresholds(scored, pairs, [0.85, 0.90, 0.95]);
    assert.strictEqual(sweep.length, 3);
    // At thr=0.85: m1, m2 → match (tp=2); n2 (0.80) → no_match; n1 → no_match; perfect
    const at85 = sweep.find(s => s.threshold === 0.85);
    assert.strictEqual(at85.tp, 2);
    assert.strictEqual(at85.fp, 0);
    assert.strictEqual(at85.fn, 0);
    assert.strictEqual(at85.precision, 1);
    assert.strictEqual(at85.recall, 1);
    assert.strictEqual(at85.f1, 1);

    // At thr=0.95: m1 (0.97) match, m2 (0.95) match (>=), n2 (0.80) no
    const at95 = sweep.find(s => s.threshold === 0.95);
    assert.strictEqual(at95.tp, 2);
    assert.strictEqual(at95.fn, 0);
  });

  it('skips null-similarity entries', () => {
    const scoredWithNull = [...scored, { pair_id: 'm3', similarity: null }];
    const pairsWithExtra = [...pairs, { pair_id: 'm3', expected_label: 'match' }];
    const sweep = sweepThresholds(scoredWithNull, pairsWithExtra, [0.85]);
    const at85 = sweep[0];
    // m3 skipped — counts same as the 4-pair case
    assert.strictEqual(at85.tp, 2);
  });

  it('bestThreshold picks max F1, ties broken by precision', () => {
    const sweep = sweepThresholds(scored, pairs, [0.5, 0.85, 0.99]);
    const best = bestThreshold(sweep);
    assert.ok(best);
    assert.strictEqual(best.threshold, 0.85);  // all thresholds give F1=1 here; pick lowest with equal precision=1
    // Actually with all F1=1 and all precision=1, reduce keeps first match — 0.5
    // Adjust expectation to either of the perfect ones
    assert.strictEqual(best.f1, 1);
  });
});

// ---------- buildCalibrationReport ----------

describe('Phase 24 B2-05: buildCalibrationReport', () => {
  it('sets operator_action_required when pair count < 100', async () => {
    const pairSet = {
      pairs: [{ pair_id: 'x', expected_label: 'match' }, { pair_id: 'y', expected_label: 'no_match' }],
      notes: 'placeholder',
    };
    const scored = [{ pair_id: 'x', similarity: 0.9 }, { pair_id: 'y', similarity: 0.5 }];
    const sweep = sweepThresholds(scored, pairSet.pairs);
    const report = await buildCalibrationReport(pairSet, scored, sweep);
    assert.match(report.operator_action_required, /operator must add real pairs/);
    assert.strictEqual(report.pair_count, 2);
    assert.strictEqual(report.match_count, 1);
    assert.strictEqual(report.no_match_count, 1);
  });

  it('writes report to disk when outputPath provided', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'p24-rep-'));
    try {
      const pairSet = {
        pairs: Array.from({ length: 100 }, (_, i) => ({
          pair_id: `p${i}`,
          expected_label: i < 50 ? 'match' : 'no_match',
        })),
      };
      const scored = pairSet.pairs.map((p, i) => ({
        pair_id: p.pair_id,
        similarity: p.expected_label === 'match' ? 0.95 : 0.5,
      }));
      const sweep = sweepThresholds(scored, pairSet.pairs);
      const outPath = join(tmp, 'report.json');
      const report = await buildCalibrationReport(pairSet, scored, sweep, { outputPath: outPath });

      assert.strictEqual(report.operator_action_required, 'Calibration ready');
      const { readFile } = await import('node:fs/promises');
      const raw = await readFile(outPath, 'utf-8');
      const parsed = JSON.parse(raw);
      assert.strictEqual(parsed.pair_count, 100);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
