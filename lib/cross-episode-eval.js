/**
 * cross-episode-eval.js — Phase 24 B2-05 threshold calibration framework
 *
 * Loads a pairs.json evaluation set, computes per-pair DINOv2/pHash similarity
 * (via injected fingerprint provider), and produces a calibration report
 * with precision/recall/F1 at configurable thresholds.
 *
 * Operator workflow:
 *   1. Add 50 same-char-diff-episode (expected_label: match) + 50 same-actor-
 *      diff-char / diff-actor (expected_label: no_match) pairs to pairs.json
 *   2. Run: node test/cross-episode-eval/run-calibration.js
 *   3. Inspect report; tighten dinov2Threshold / phashThreshold in
 *      CharacterAssetManager defaults if F1 < 0.90
 *
 * Zero npm deps. Pure JS.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { hammingDistance, pHashSimilarity } from './perceptual-hash.js';

/**
 * Load pairs.json. Throws on missing required fields.
 *
 * @param {string} path
 * @returns {Promise<object>} parsed pairs set
 */
export async function loadPairs(path) {
  const raw = await readFile(path, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.pairs)) {
    throw new Error('pairs.json: pairs must be an array');
  }
  for (const p of parsed.pairs) {
    if (!p.pair_id || !p.category || !p.expected_label || !p.image_a?.path || !p.image_b?.path) {
      throw new Error(`pairs.json: invalid entry ${JSON.stringify(p).slice(0, 200)}`);
    }
    if (!['match', 'no_match'].includes(p.expected_label)) {
      throw new Error(`pairs.json: ${p.pair_id} invalid expected_label '${p.expected_label}'`);
    }
  }
  return parsed;
}

/**
 * Compute similarity for a single pair using the supplied fingerprintFn.
 *
 * @param {object} pair — entry from pairs.json
 * @param {function(string): Promise<object>} fingerprintFn
 *        Given an image path, returns { type, vector|hash, source_image }.
 *        Typically wraps CharacterAssetManager._computeDinoFingerprint /
 *        _computeCostumeFingerprint.
 * @returns {Promise<object>} { pair_id, similarity, type, error? }
 */
export async function scorePair(pair, fingerprintFn) {
  try {
    const fpA = await fingerprintFn(pair.image_a.path);
    const fpB = await fingerprintFn(pair.image_b.path);

    if (!fpA || !fpB) {
      return { pair_id: pair.pair_id, similarity: null, type: 'no_fingerprint', error: 'fingerprint unavailable' };
    }

    if (fpA.type === 'dinov2' && fpB.type === 'dinov2') {
      const sim = _cosine(fpA.vector, fpB.vector);
      return { pair_id: pair.pair_id, similarity: sim, type: 'dinov2' };
    }

    if (fpA.type === 'phash' && fpB.type === 'phash') {
      const sim = pHashSimilarity(fpA.hash, fpB.hash);
      return { pair_id: pair.pair_id, similarity: sim, type: 'phash' };
    }

    return {
      pair_id: pair.pair_id,
      similarity: null,
      type: 'mixed',
      error: `incompatible fingerprint types ${fpA.type} vs ${fpB.type}`,
    };
  } catch (err) {
    return { pair_id: pair.pair_id, similarity: null, type: 'error', error: err.message };
  }
}

/**
 * Sweep a list of thresholds and compute precision/recall/F1 for each.
 *
 * @param {Array<object>} scored — output of scorePair over the full set
 * @param {Array<object>} pairs — original pairs (for expected_label lookup)
 * @param {number[]} [thresholds] — defaults to 0.80..0.99 step 0.01
 * @returns {Array<object>} [{ threshold, tp, fp, tn, fn, precision, recall, f1 }]
 */
export function sweepThresholds(scored, pairs, thresholds) {
  const thrList = thresholds || _defaultThresholds();
  const labelById = new Map(pairs.map(p => [p.pair_id, p.expected_label]));

  return thrList.map((thr) => {
    let tp = 0, fp = 0, tn = 0, fn = 0;
    for (const s of scored) {
      const expected = labelById.get(s.pair_id);
      if (expected === undefined) continue;
      if (s.similarity === null) {
        // Can't score — skip (don't bias the count)
        continue;
      }
      const predicted = s.similarity >= thr ? 'match' : 'no_match';
      if (expected === 'match' && predicted === 'match') tp++;
      else if (expected === 'no_match' && predicted === 'match') fp++;
      else if (expected === 'no_match' && predicted === 'no_match') tn++;
      else if (expected === 'match' && predicted === 'no_match') fn++;
    }
    const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
    const recall = (tp + fn) > 0 ? tp / (tp + fn) : 0;
    const f1 = (precision + recall) > 0 ? 2 * precision * recall / (precision + recall) : 0;
    return { threshold: thr, tp, fp, tn, fn, precision, recall, f1 };
  });
}

/**
 * Find the threshold with the best F1 score.
 * Ties broken by higher precision.
 *
 * @param {Array<object>} sweep — output of sweepThresholds
 * @returns {object} { threshold, f1, precision, recall }
 */
export function bestThreshold(sweep) {
  if (!sweep.length) return null;
  return sweep.reduce((best, cur) => {
    if (cur.f1 > best.f1) return cur;
    if (cur.f1 === best.f1 && cur.precision > best.precision) return cur;
    return best;
  });
}

/**
 * Build a calibration report and optionally write to disk.
 *
 * @param {object} pairSet — parsed pairs.json
 * @param {Array<object>} scored — per-pair similarity
 * @param {Array<object>} sweep — threshold sweep
 * @param {object} [opts] — { outputPath }
 * @returns {Promise<object>} report (also written to outputPath if provided)
 */
export async function buildCalibrationReport(pairSet, scored, sweep, opts = {}) {
  const best = bestThreshold(sweep);
  const report = {
    generated_at: new Date().toISOString(),
    pair_count: pairSet.pairs.length,
    match_count: pairSet.pairs.filter(p => p.expected_label === 'match').length,
    no_match_count: pairSet.pairs.filter(p => p.expected_label === 'no_match').length,
    scored_count: scored.filter(s => s.similarity !== null).length,
    unscored_count: scored.filter(s => s.similarity === null).length,
    best_threshold: best,
    sweep,
    notes: pairSet.notes || '',
    operator_action_required: pairSet.pairs.length < 100
      ? `Only ${pairSet.pairs.length}/100 pairs annotated — operator must add real pairs before calibration is reportable`
      : 'Calibration ready',
  };

  if (opts.outputPath) {
    await writeFile(opts.outputPath, JSON.stringify(report, null, 2), 'utf-8');
  }
  return report;
}

// ─── internal helpers ─────────────────────────────────────────────────

function _defaultThresholds() {
  const arr = [];
  for (let t = 0.80; t <= 0.995; t += 0.01) {
    arr.push(Number(t.toFixed(3)));
  }
  return arr;
}

function _cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export default {
  loadPairs,
  scorePair,
  sweepThresholds,
  bestThreshold,
  buildCalibrationReport,
};
