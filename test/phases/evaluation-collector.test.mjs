/**
 * Phase 16 PERF-03: EvaluationCollector.aggregateForEpisode 单元测试
 *
 * 覆盖:
 *   1. 空记录: 返回合法结构,success_rate='0.0%'
 *   2. 混合成功/失败: 聚合 by_phase / by_task_type,success_rate 计算
 *   3. retry waste: retry_count > 0 累计 total_retry_waste_sec
 *   4. 幂等: 多次调用产出相同结果
 *   5. cost-report.json 落盘
 *   6. episodeId 在报告中回显
 *
 * Run: node --test test/phases/evaluation-collector.test.mjs
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { EvaluationCollector } from '../../lib/evaluation-collector.js';

// 工厂: 构造测试用 record
const makeRecord = (overrides = {}) => ({
  task_id: `task-${Math.random().toString(36).slice(2, 8)}`,
  phase: 'cloud-production',
  task_type: 'video_final',
  gpu_time_sec: 60,
  peak_vram_gb: 4,
  success: true,
  retry_count: 0,
  oom_risk: false,
  ...overrides,
});

describe('EvaluationCollector.aggregateForEpisode (Phase 16 PERF-03)', () => {
  let tmpDir;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'phase16-cost-'));
  });

  after(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  // ═══════════════════════════════════════════════════════════════
  // 1. 空记录
  // ═══════════════════════════════════════════════════════════════
  it('空记录时返回合法结构 + success_rate=0.0%', async () => {
    const collector = new EvaluationCollector(tmpDir, { episodeId: 'EMPTY-EP' });
    const report = await collector.aggregateForEpisode();

    assert.strictEqual(report.episode, 'EMPTY-EP');
    assert.strictEqual(report.total_records, 0);
    assert.strictEqual(report.total_gpu_sec, 0);
    assert.strictEqual(report.total_gpu_minutes, 0);
    assert.strictEqual(report.total_retry_waste_sec, 0);
    assert.strictEqual(report.summary.success_rate, '0.0%');
    assert.strictEqual(report.summary.failed_count, 0);
    assert.deepEqual(report.by_phase, {});
    assert.deepEqual(report.by_task_type, {});
    assert.deepEqual(report.failed_tasks, []);
  });

  // ═══════════════════════════════════════════════════════════════
  // 2. 混合成功/失败: 聚合正确
  // ═══════════════════════════════════════════════════════════════
  it('混合成功/失败: by_phase / by_task_type / success_rate 聚合正确', async () => {
    // 用全新 workdir 隔离
    const dir = await mkdtemp(join(tmpdir(), 'phase16-mix-'));
    try {
      const collector = new EvaluationCollector(dir, { episodeId: 'MIX-EP' });
      await collector.recordBatch([
        makeRecord({ phase: 'cloud-production', task_type: 'video_final', gpu_time_sec: 100, success: true }),
        makeRecord({ phase: 'cloud-production', task_type: 'video_final', gpu_time_sec: 200, success: false }),
        makeRecord({ phase: 'ai-preview', task_type: 'preview_render', gpu_time_sec: 50, success: true }),
      ]);

      const report = await collector.aggregateForEpisode();

      assert.strictEqual(report.total_records, 3);
      // total = 100 + 200 + 50 = 350
      assert.strictEqual(report.total_gpu_sec, 350);
      assert.strictEqual(report.total_gpu_minutes, 5.8);  // 350/60 = 5.833... → 5.8
      assert.strictEqual(report.summary.success_rate, '66.7%');  // 2/3 = 66.666%
      assert.strictEqual(report.summary.failed_count, 1);

      // by_phase['cloud-production'] = {count:2, gpu_sec:300, failed:1}
      const cp = report.by_phase['cloud-production'];
      assert.strictEqual(cp.count, 2);
      assert.strictEqual(cp.gpu_sec, 300);
      assert.strictEqual(cp.failed, 1);

      // by_phase['ai-preview'] = {count:1, gpu_sec:50, failed:0}
      const ap = report.by_phase['ai-preview'];
      assert.strictEqual(ap.count, 1);
      assert.strictEqual(ap.gpu_sec, 50);
      assert.strictEqual(ap.failed, 0);

      // by_task_type
      assert.strictEqual(report.by_task_type['video_final'].count, 2);
      assert.strictEqual(report.by_task_type['video_final'].gpu_sec, 300);
      assert.strictEqual(report.by_task_type['preview_render'].count, 1);

      // failed_tasks 应该只有 1 条
      assert.strictEqual(report.failed_tasks.length, 1);
      assert.strictEqual(report.failed_tasks[0].gpu_time_sec, 200);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 3. Retry waste 计算
  // ═══════════════════════════════════════════════════════════════
  it('retry_count > 0 时累计 total_retry_waste_sec', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'phase16-retry-'));
    try {
      const collector = new EvaluationCollector(dir);
      await collector.recordBatch([
        makeRecord({ gpu_time_sec: 100, retry_count: 0, success: true }),   // 0 waste
        makeRecord({ gpu_time_sec: 80, retry_count: 2, success: true }),    // 80×2 = 160 waste
        makeRecord({ gpu_time_sec: 50, retry_count: 1, success: true }),    // 50×1 = 50 waste
      ]);

      const report = await collector.aggregateForEpisode();

      // total_retry_waste_sec = 0 + 160 + 50 = 210
      assert.strictEqual(report.total_retry_waste_sec, 210);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 4. 幂等性: 重复调用产出相同结果
  // ═══════════════════════════════════════════════════════════════
  it('重复调用产出相同数值 (幂等)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'phase16-idem-'));
    try {
      const collector = new EvaluationCollector(dir);
      await collector.recordBatch([
        makeRecord({ gpu_time_sec: 100, success: true }),
        makeRecord({ gpu_time_sec: 50, success: false }),
      ]);

      const r1 = await collector.aggregateForEpisode();
      const r2 = await collector.aggregateForEpisode();

      // 核心字段必须相同
      assert.strictEqual(r2.total_records, r1.total_records);
      assert.strictEqual(r2.total_gpu_sec, r1.total_gpu_sec);
      assert.strictEqual(r2.summary.success_rate, r1.summary.success_rate);
      assert.strictEqual(r2.summary.failed_count, r1.summary.failed_count);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 5. cost-report.json 落盘
  // ═══════════════════════════════════════════════════════════════
  it('写出 cost-report.json 到 workdir 根目录', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'phase16-write-'));
    try {
      const collector = new EvaluationCollector(dir, { episodeId: 'WRITE-EP' });
      await collector.recordBatch([
        makeRecord({ gpu_time_sec: 100, success: true }),
      ]);
      await collector.aggregateForEpisode();

      const reportPath = join(dir, 'cost-report.json');
      assert.ok(existsSync(reportPath), 'cost-report.json 未落盘');

      const raw = await readFile(reportPath, 'utf-8');
      const parsed = JSON.parse(raw);
      assert.strictEqual(parsed.episode, 'WRITE-EP');
      assert.strictEqual(parsed.total_records, 1);
      assert.ok(parsed.generated_at, 'generated_at 必须存在');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 6. 向后兼容: 不传 opts 也工作
  // ═══════════════════════════════════════════════════════════════
  it('构造函数不传 opts 时 episode=null (向后兼容)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'phase16-compat-'));
    try {
      // 旧调用方式
      const collector = new EvaluationCollector(dir);
      const report = await collector.aggregateForEpisode();
      assert.strictEqual(report.episode, null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
