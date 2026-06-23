#!/usr/bin/env node
/**
 * baseline-runner.mjs — Phase 19 D1-03 Golden Set Baseline Runner
 *
 * 跑 50 对 (anchor + generated) 样本集,用 ZHIPU_VISION_MODEL 评分,输出 baseline report。
 *
 * 用法:
 *   node test/golden-set/baseline-runner.mjs [--tag <model-tag>] [--limit <N>]
 *
 * 输出:
 *   - test/golden-set/baseline-report.json (覆盖,当前 baseline)
 *   - test/golden-set/baseline-history.jsonl (append,历史快照)
 *   - stdout (人类可读摘要)
 *
 * 设计:
 *   - 零 npm 依赖(仅 node:* + 内部 lib/)
 *   - API key 缺失 → 自动用 mock 评分(占位数据),报告标记 _mock: true
 *   - 失败的 pair 不阻塞整体运行(降级记录)
 *   - 单次 pair 调用 ≤ 30s 超时,总耗时报告记录
 */
import { readFile, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { auditImageVsL1 } from '../../lib/continuity-auditor.js';
import { getDefaultVisionModel } from '../../lib/hermes-adapter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAIRS_DIR = join(__dirname, 'pairs');
const REPORT_PATH = join(__dirname, 'baseline-report.json');
const HISTORY_PATH = join(__dirname, 'baseline-history.jsonl');

// ─── CLI args ────────────────────────────────────────────

function parseArgs(argv) {
  const args = { tag: null, limit: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tag') args.tag = argv[++i];
    else if (a === '--limit') args.limit = parseInt(argv[++i], 10);
    else if (a === '--help' || a === '-h') {
      console.log('Usage: baseline-runner.mjs [--tag <tag>] [--limit <n>]');
      process.exit(0);
    }
  }
  return args;
}

// ─── pair discovery ─────────────────────────────────────

async function listPairs() {
  // 读 pairs/ 目录下的 *.json 文件,按 id 排序
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(PAIRS_DIR);
  const pairFiles = files.filter(f => f.match(/^pair-\d+\.json$/)).sort();
  const pairs = [];
  for (const f of pairFiles) {
    try {
      const raw = await readFile(join(PAIRS_DIR, f), 'utf-8');
      pairs.push(JSON.parse(raw));
    } catch (err) {
      console.warn(`[baseline-runner] 跳过 ${f}: ${err.message}`);
    }
  }
  return pairs;
}

// ─── file exists check ──────────────────────────────────

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

// ─── mock scorer (when no API key / image missing) ──────

function mockScore(pair) {
  const [lo, hi] = pair.ground_truth?.expected_score_range || [0.5, 0.8];
  const mid = (lo + hi) / 2;
  // 加少量 noise 让 std 非 0
  const noise = (Math.random() - 0.5) * (hi - lo) * 0.3;
  return Math.max(0, Math.min(1, mid + noise));
}

// ─── per-pair scoring ───────────────────────────────────

async function scorePair(pair, opts) {
  const anchorPath = join(PAIRS_DIR, pair.anchor_image);
  const generatedPath = join(PAIRS_DIR, pair.generated_image);
  const anchorExists = await exists(anchorPath);
  const generatedExists = await exists(generatedPath);
  const hasApiKey = !!process.env.ZHIPU_API_KEY;

  // Mock 模式: 图片占位 / API key 缺失
  if (!anchorExists || !generatedExists || !hasApiKey || opts.mockMode) {
    return {
      id: pair.id,
      score: mockScore(pair),
      details: `mock(占位): ${!anchorExists ? 'anchor缺' : ''}${!generatedExists ? 'gen缺' : ''}${!hasApiKey ? 'API_KEY缺' : ''}`.trim(),
      mock: true,
      expected_range: pair.ground_truth?.expected_score_range,
      same_identity: pair.ground_truth?.same_identity,
    };
  }

  // 真实 API 调用
  const t0 = Date.now();
  try {
    const result = await auditImageVsL1(generatedPath, [anchorPath]);
    return {
      id: pair.id,
      score: result.score,
      details: result.details,
      duration_ms: Date.now() - t0,
      mock: false,
      expected_range: pair.ground_truth?.expected_score_range,
      same_identity: pair.ground_truth?.same_identity,
    };
  } catch (err) {
    return {
      id: pair.id,
      score: null,
      details: `error: ${err.message}`,
      duration_ms: Date.now() - t0,
      mock: false,
      error: true,
      expected_range: pair.ground_truth?.expected_score_range,
      same_identity: pair.ground_truth?.same_identity,
    };
  }
}

// ─── statistics ─────────────────────────────────────────

function stats(values) {
  const valid = values.filter(v => typeof v === 'number' && !isNaN(v));
  if (!valid.length) return { mean: null, std: null, min: null, max: null, n: 0 };
  const mean = valid.reduce((s, v) => s + v, 0) / valid.length;
  const variance = valid.reduce((s, v) => s + (v - mean) ** 2, 0) / valid.length;
  return {
    mean: Math.round(mean * 1000) / 1000,
    std: Math.round(Math.sqrt(variance) * 1000) / 1000,
    min: Math.min(...valid),
    max: Math.max(...valid),
    n: valid.length,
  };
}

/**
 * 基于分数 std + 与 ground-truth 区间的偏差,推荐阈值。
 * 简化策略: same_identity 样本 5% 分位 + 不同身份 95% 分位的中点。
 */
function recommendThreshold(results) {
  const same = results.filter(r => r.same_identity && typeof r.score === 'number').map(r => r.score);
  const diff = results.filter(r => !r.same_identity && typeof r.score === 'number').map(r => r.score);
  if (!same.length || !diff.length) return null;
  same.sort((a, b) => a - b);
  diff.sort((a, b) => a - b);
  const p5Same = same[Math.floor(same.length * 0.05)];
  const p95Diff = diff[Math.floor(diff.length * 0.95)];
  return Math.round(((p5Same + p95Diff) / 2) * 1000) / 1000;
}

// ─── main ───────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  const modelTag = args.tag || getDefaultVisionModel();
  const modelVersion = getDefaultVisionModel();

  console.log(`[baseline-runner] model=${modelVersion} tag=${modelTag}`);

  let pairs = await listPairs();
  if (args.limit) pairs = pairs.slice(0, args.limit);
  console.log(`[baseline-runner] ${pairs.length} 对样本`);

  const runStartedAt = new Date().toISOString();
  const t0 = Date.now();
  const results = [];
  for (const pair of pairs) {
    const r = await scorePair(pair, { mockMode: false });
    results.push(r);
    console.log(`  ${r.id}: score=${r.score} mock=${r.mock} ${r.duration_ms ? `${r.duration_ms}ms` : ''}`);
  }
  const totalDurationMs = Date.now() - t0;

  const scores = results.map(r => r.score);
  const validScores = scores.filter(s => typeof s === 'number');
  const mockCount = results.filter(r => r.mock).length;
  const errorCount = results.filter(r => r.error).length;

  const report = {
    _schema_version: 1,
    _purpose: 'Phase 19 D1-03 golden set baseline',
    model_version: modelVersion,
    tag: modelTag,
    run_at: runStartedAt,
    total_duration_ms: totalDurationMs,
    samples: results.length,
    valid_scores: validScores.length,
    mock_count: mockCount,
    error_count: errorCount,
    _mock: mockCount > 0 || errorCount > 0,  // 报告整体标记
    score_distribution: stats(validScores),
    same_identity_distribution: stats(
      results.filter(r => r.same_identity).map(r => r.score).filter(s => typeof s === 'number'),
    ),
    diff_identity_distribution: stats(
      results.filter(r => !r.same_identity).map(r => r.score).filter(s => typeof s === 'number'),
    ),
    threshold_recommendation: recommendThreshold(results),
    pairs: results,
  };

  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\n[baseline-runner] report → ${REPORT_PATH}`);

  // append to history
  const historyLine = JSON.stringify({
    run_at: runStartedAt,
    model_version: modelVersion,
    tag: modelTag,
    samples: results.length,
    mean: report.score_distribution.mean,
    std: report.score_distribution.std,
    mock: report._mock,
  }) + '\n';
  try {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(HISTORY_PATH, historyLine);
  } catch (err) {
    console.warn(`[baseline-runner] 历史记录写入失败: ${err.message}`);
  }

  // stdout summary
  console.log('\n──────── Baseline Summary ────────');
  console.log(`Model:      ${modelVersion} (tag: ${modelTag})`);
  console.log(`Samples:    ${report.samples} (valid ${report.valid_scores}, mock ${mockCount}, error ${errorCount})`);
  console.log(`Mean/Std:   ${report.score_distribution.mean} ± ${report.score_distribution.std}`);
  console.log(`Min/Max:    ${report.score_distribution.min} / ${report.score_distribution.max}`);
  console.log(`Duration:   ${totalDurationMs}ms total (${Math.round(totalDurationMs / Math.max(1, report.samples))}ms/pair)`);
  if (report.threshold_recommendation !== null) {
    console.log(`Recommended threshold: ${report.threshold_recommendation}`);
  }
  if (report._mock) {
    console.log('\n⚠️  This is a MOCK run (missing images or API key). Replace placeholder pairs + set ZHIPU_API_KEY for real baseline.');
  }
}

// run if invoked directly
const isMain = process.argv[1] && process.argv[1].endsWith('baseline-runner.mjs');
if (isMain) {
  main().catch(err => {
    console.error(`[baseline-runner] FATAL: ${err.message}`);
    process.exit(1);
  });
}

export { listPairs, scorePair, stats, recommendThreshold };
