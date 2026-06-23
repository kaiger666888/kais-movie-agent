/**
 * Phase 19 D1-03: Golden Set Baseline Runner 单元测试
 *
 * 覆盖:
 *   1. listPairs 读取 pairs/ 目录的所有 JSON
 *   2. scorePair mock 模式 (图片占位时返回 ground-truth 中点 + noise)
 *   3. stats 计算 mean/std/min/max
 *   4. recommendThreshold: same/diff 中点
 *   5. baseline-runner 完整流程 (mock 模式,生成 baseline-report.json)
 *
 * Run: node --test test/phases/golden-set-baseline.test.mjs
 *
 * 零 npm 依赖 — 仅 node:test / node:assert。
 */
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  listPairs,
  scorePair,
  stats,
  recommendThreshold,
} from '../../test/golden-set/baseline-runner.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAIRS_DIR = join(__dirname, '..', 'golden-set', 'pairs');

// ─── describe 1: listPairs ───────────────────────────────

describe('D1-03 listPairs: 读取 pairs/ 目录', () => {
  it('至少能找到 5 个 placeholder pair', async () => {
    const pairs = await listPairs();
    assert.ok(pairs.length >= 5, `应有 ≥5 个 placeholder pair,实际 ${pairs.length}`);
  });

  it('每个 pair 含 id / anchor_image / generated_image / ground_truth', async () => {
    const pairs = await listPairs();
    for (const p of pairs) {
      assert.ok(p.id, 'pair.id 缺失');
      assert.ok(p.anchor_image, `${p.id}: anchor_image 缺失`);
      assert.ok(p.generated_image, `${p.id}: generated_image 缺失`);
      assert.ok(p.ground_truth, `${p.id}: ground_truth 缺失`);
      assert.ok(Array.isArray(p.ground_truth.expected_score_range),
        `${p.id}: expected_score_range 必须是数组`);
    }
  });

  it('pair id 排序正确', async () => {
    const pairs = await listPairs();
    const ids = pairs.map(p => p.id);
    const sorted = [...ids].sort();
    assert.deepStrictEqual(ids, sorted);
  });

  it('包含 placeholder 标记(框架未填满)', async () => {
    const pairs = await listPairs();
    const placeholders = pairs.filter(p => p._placeholder);
    assert.ok(placeholders.length >= 5,
      `至少 5 个 placeholder(当前 operator 未补全真实图片),实际 ${placeholders.length}`);
  });
});

// ─── describe 2: scorePair mock 模式 ─────────────────────

describe('D1-03 scorePair: mock 模式 (图片占位 → 假评分)', () => {
  it('图片不存在 + 无 API key → mock 模式', async () => {
    const pair = {
      id: 'test-mock-1',
      anchor_image: 'nonexistent-anchor.png',
      generated_image: 'nonexistent-gen.png',
      ground_truth: { expected_score_range: [0.8, 0.9], same_identity: true },
    };
    const prev = process.env.ZHIPU_API_KEY;
    delete process.env.ZHIPU_API_KEY;
    try {
      const r = await scorePair(pair, { mockMode: false });
      assert.strictEqual(r.mock, true);
      assert.strictEqual(r.same_identity, true);
      assert.ok(r.score >= 0.8 && r.score <= 0.9,
        `mock score 应在 ground-truth 区间内(±noise),实际 ${r.score}`);
      assert.ok(r.details.includes('mock'));
    } finally {
      if (prev) process.env.ZHIPU_API_KEY = prev;
    }
  });

  it('mock score 落在 expected_range 附近(noise ≤ 30% 区间宽度)', async () => {
    const pair = {
      id: 'test-mock-2',
      anchor_image: 'x.png',
      generated_image: 'y.png',
      ground_truth: { expected_score_range: [0.6, 0.7], same_identity: true },
    };
    const prev = process.env.ZHIPU_API_KEY;
    delete process.env.ZHIPU_API_KEY;
    try {
      // 跑 20 次验证 noise 边界
      for (let i = 0; i < 20; i++) {
        const r = await scorePair(pair, { mockMode: false });
        // noise 最大 ±30% × range_width = ±0.03;中点 0.65 → 0.62-0.68
        assert.ok(r.score >= 0.55 && r.score <= 0.75,
          `mock score ${r.score} 超出 [0.55, 0.75] 边界`);
      }
    } finally {
      if (prev) process.env.ZHIPU_API_KEY = prev;
    }
  });
});

// ─── describe 3: stats 计算 ──────────────────────────────

describe('D1-03 stats: mean / std / min / max', () => {
  it('空数组 → null 字段', () => {
    const s = stats([]);
    assert.strictEqual(s.mean, null);
    assert.strictEqual(s.n, 0);
  });

  it('单点 → std=0', () => {
    const s = stats([0.85]);
    assert.strictEqual(s.mean, 0.85);
    assert.strictEqual(s.std, 0);
    assert.strictEqual(s.n, 1);
  });

  it('多点 → 正确 mean / std', () => {
    const s = stats([0.8, 0.9, 0.7, 0.85]);
    // mean = 0.8125 → round to 3 digits = 0.813 (实际 round(0.8125 * 1000) / 1000)
    assert.ok(Math.abs(s.mean - 0.8125) < 0.001, `mean 应近 0.8125,实际 ${s.mean}`);
    assert.strictEqual(s.n, 4);
    assert.ok(s.std > 0 && s.std < 0.1, `std 应在 (0, 0.1),实际 ${s.std}`);
  });

  it('过滤 NaN / null', () => {
    const s = stats([0.8, null, NaN, 0.9]);
    assert.strictEqual(s.n, 2);
    assert.strictEqual(s.mean, 0.85);
  });
});

// ─── describe 4: recommendThreshold ──────────────────────

describe('D1-03 recommendThreshold: same/diff 中点', () => {
  it('同/异身份明确分离 → 阈值在两者之间', () => {
    const results = [
      { id: '1', score: 0.9, same_identity: true },
      { id: '2', score: 0.88, same_identity: true },
      { id: '3', score: 0.85, same_identity: true },
      { id: '4', score: 0.3, same_identity: false },
      { id: '5', score: 0.25, same_identity: false },
    ];
    const t = recommendThreshold(results);
    // p5Same ≈ 0.85, p95Diff ≈ 0.3 → 中点 0.575
    assert.ok(t > 0.4 && t < 0.7, `阈值应在 0.4-0.7,实际 ${t}`);
  });

  it('缺 same 或 diff → null', () => {
    assert.strictEqual(recommendThreshold([
      { score: 0.9, same_identity: true },
    ]), null);
    assert.strictEqual(recommendThreshold([
      { score: 0.3, same_identity: false },
    ]), null);
  });
});

// ─── describe 5: 端到端 mock run ─────────────────────────

describe('D1-03 端到端 mock run: baseline-report.json 生成', () => {
  it('跑 baseline-runner CLI (无 API key) → 生成 report', async () => {
    const { spawnSync } = await import('node:child_process');
    const prev = process.env.ZHIPU_API_KEY;
    delete process.env.ZHIPU_API_KEY;
    try {
      const r = spawnSync('node', [
        'test/golden-set/baseline-runner.mjs',
        '--tag', 'unit-test-mock',
        '--limit', '5',
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 30000,
      });
      const out = r.stdout || '';
      const err = r.stderr || '';
      assert.strictEqual(r.status, 0,
        `baseline-runner 退出码 ${r.status}\nstdout: ${out}\nstderr: ${err}`);
      // 验证 report 文件被创建
      const reportRaw = await readFile('test/golden-set/baseline-report.json', 'utf-8');
      const report = JSON.parse(reportRaw);
      assert.strictEqual(report.tag, 'unit-test-mock');
      assert.strictEqual(report._mock, true, '无 API key 必须 _mock=true');
      assert.ok(report.samples === 5);
      assert.ok(Array.isArray(report.pairs));
      assert.strictEqual(report.pairs.length, 5);
      // score_distribution 字段存在
      assert.ok(report.score_distribution.mean !== null);
    } finally {
      if (prev) process.env.ZHIPU_API_KEY = prev;
    }
  });
});
