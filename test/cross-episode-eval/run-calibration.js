#!/usr/bin/env node
/**
 * Phase 24 B2-05: Cross-episode eval calibration runner
 *
 * Loads pairs.json, computes per-pair similarity (via injected fingerprintFn),
 * sweeps thresholds, and writes calibration report to disk.
 *
 * Usage:
 *   node test/cross-episode-eval/run-calibration.js [--pairs=path] [--out=path]
 *
 * Default paths:
 *   --pairs: test/cross-episode-eval/pairs.json (5 placeholder pairs)
 *   --out:   test/cross-episode-eval/calibration-report.json
 *
 * NOTE: With the placeholder set, this produces a framework-validation report
 * only. Operator must replace pairs.json with 50+50 real annotated pairs
 * before calibration is actionable.
 */
import { argv } from 'node:process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPairs, scorePair, sweepThresholds, buildCalibrationReport }
  from '../../lib/cross-episode-eval.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function arg(name) {
  const flag = argv.find(a => a.startsWith(`--${name}=`));
  return flag ? flag.slice(name.length + 3) : null;
}

async function mockFingerprint(imagePath) {
  // Placeholder: returns deterministic per-path phash-like signal
  // Operator replaces this with real gold-team DINOv2 / pHash provider.
  const seed = imagePath.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const hash = (seed & 0xffff).toString(16).padStart(4, '0').repeat(4);
  return { type: 'phash', hash, source_image: imagePath };
}

async function main() {
  const pairsPath = arg('pairs') || join(__dirname, 'pairs.json');
  const outPath = arg('out') || join(__dirname, 'calibration-report.json');

  console.log(`[cross-episode-eval] loading ${pairsPath}`);
  const pairSet = await loadPairs(pairsPath);
  console.log(`[cross-episode-eval] ${pairSet.pairs.length} pairs loaded`);

  const scored = [];
  for (const pair of pairSet.pairs) {
    const s = await scorePair(pair, mockFingerprint);
    scored.push(s);
    console.log(`  ${pair.pair_id}: sim=${s.similarity} type=${s.type}${s.error ? ` err=${s.error}` : ''}`);
  }

  const sweep = sweepThresholds(scored, pairSet.pairs);
  const report = await buildCalibrationReport(pairSet, scored, sweep, { outputPath: outPath });
  console.log(`[cross-episode-eval] report written to ${outPath}`);
  console.log(`[cross-episode-eval] best_threshold: ${JSON.stringify(report.best_threshold)}`);
  console.log(`[cross-episode-eval] ${report.operator_action_required}`);
}

main().catch((err) => {
  console.error('[cross-episode-eval] FATAL:', err);
  process.exit(1);
});
