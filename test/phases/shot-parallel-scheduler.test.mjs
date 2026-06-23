/**
 * Phase 15 PERF-01 / Phase 16 PERF-04: ShotParallelScheduler 单元测试
 *
 * 覆盖:
 *   1. Concurrency: 4 workers, 10 tasks → ~3 batches (时间断言)
 *   2. Error isolation: 一个 shot 失败不阻塞其他
 *   3. Empty shots array: 立即返回
 *   4. Parallelism > shots: 不 overspawn workers
 *   5. 顺序对齐: results[i] 对应 shots[i]
 *   6. Phase 16 runWithRetry: 首次成功 / 重试成功 / 永久失败 / 部分批量重试
 *
 * Run: node --test test/phases/shot-parallel-scheduler.test.mjs
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { ShotParallelScheduler } from '../../lib/shot-parallel-scheduler.js';

// 测试用的 mock shot
const makeShots = (n) => Array.from({ length: n }, (_, i) => ({
  id: `shot-${String(i + 1).padStart(3, '0')}`,
  description: `测试 shot ${i + 1}`,
}));

// 模拟延迟的 shot 任务
const makeSlowTask = (delayMs) => async (shot) => {
  await new Promise(r => setTimeout(r, delayMs));
  return { shot_id: shot.id, status: 'completed' };
};

describe('ShotParallelScheduler', () => {

  // ═══════════════════════════════════════════════════════════════
  // 1. Concurrency: 4 workers, 10 tasks → ~3 batches
  // ═══════════════════════════════════════════════════════════════
  it('4 workers 跑 10 个 100ms 任务,总时长应接近 3 批次 (~250-400ms) 而非串行 (~1000ms)', async () => {
    const scheduler = new ShotParallelScheduler({ parallelism: 4 });
    const shots = makeShots(10);

    const start = Date.now();
    const results = await scheduler.runAll(shots, makeSlowTask(100));
    const elapsed = Date.now() - start;

    assert.strictEqual(results.length, 10);
    // 10 任务 / 4 并发 = ceil(10/4) = 3 批次
    // 每批 100ms → ~300ms。容忍调度抖动:200-600ms
    // 严格小于串行 (1000ms) 才证明真并行
    assert.ok(
      elapsed < 800,
      `并行执行时间 ${elapsed}ms 应明显小于串行 1000ms (证明并发)`,
    );
    assert.ok(
      elapsed >= 200,
      `并行执行时间 ${elapsed}ms 不应快于 3 批次最小值 ~200ms (证明并发度=4)`,
    );
  });

  // ═══════════════════════════════════════════════════════════════
  // 2. Error isolation: 一个 shot 失败不阻塞其他
  // ═══════════════════════════════════════════════════════════════
  it('一个 shot 失败不阻塞其他 shot,失败结果含 _failed + error', async () => {
    const scheduler = new ShotParallelScheduler({ parallelism: 4 });
    const shots = makeShots(6);

    const results = await scheduler.runAll(shots, async (shot) => {
      if (shot.id === 'shot-003') {
        throw new Error('模拟 GPU OOM');
      }
      await new Promise(r => setTimeout(r, 20));
      return { shot_id: shot.id, status: 'completed' };
    });

    assert.strictEqual(results.length, 6);

    // shot-003 失败
    const failed = results.find(r => r.shot_id === 'shot-003');
    assert.ok(failed, 'shot-003 结果应存在');
    assert.strictEqual(failed._failed, true);
    assert.match(failed.error, /模拟 GPU OOM/);

    // 其他 5 个全部成功
    const completed = results.filter(r => r.status === 'completed');
    assert.strictEqual(completed.length, 5, '其他 5 个 shot 应正常完成');

    // 结果顺序对齐: results[2] 必须是 shot-003 (失败)
    assert.strictEqual(results[2].shot_id, 'shot-003');
    assert.strictEqual(results[0].shot_id, 'shot-001');
    assert.strictEqual(results[5].shot_id, 'shot-006');
  });

  // ═══════════════════════════════════════════════════════════════
  // 3. Empty shots array: returns immediately
  // ═══════════════════════════════════════════════════════════════
  it('空 shots 数组立即返回空结果数组,不 spawn worker', async () => {
    const scheduler = new ShotParallelScheduler({ parallelism: 4 });
    let taskCalled = false;

    const start = Date.now();
    const results = await scheduler.runAll([], async () => {
      taskCalled = true;
      return { ok: true };
    });
    const elapsed = Date.now() - start;

    assert.deepEqual(results, []);
    assert.strictEqual(taskCalled, false, 'taskFn 不应被调用');
    assert.ok(elapsed < 50, `空数组应在 50ms 内返回 (实际 ${elapsed}ms)`);
  });

  // ═══════════════════════════════════════════════════════════════
  // 4. Parallelism > shots: doesn't overspawn workers
  // ═══════════════════════════════════════════════════════════════
  it('parallelism(8) > shots(3) 时,只 spawn 3 个 worker,无 overspawn', async () => {
    const scheduler = new ShotParallelScheduler({ parallelism: 8 });
    const shots = makeShots(3);

    // 跟踪同时运行的 task 数量
    let currentRunning = 0;
    let maxRunning = 0;

    const results = await scheduler.runAll(shots, async (shot) => {
      currentRunning++;
      maxRunning = Math.max(maxRunning, currentRunning);
      await new Promise(r => setTimeout(r, 50));
      currentRunning--;
      return { shot_id: shot.id, status: 'completed' };
    });

    assert.strictEqual(results.length, 3);
    assert.ok(
      maxRunning <= 3,
      `并发同时运行数 ${maxRunning} 不应超过 shots 数量 3 (证明无 overspawn)`,
    );
    assert.strictEqual(maxRunning, 3, '3 个 shot 应同时运行');
  });

  // ═══════════════════════════════════════════════════════════════
  // 5. 顺序对齐: results[i] 对应 shots[i]
  // ═══════════════════════════════════════════════════════════════
  it('results 数组与 shots 数组按索引严格对齐', async () => {
    const scheduler = new ShotParallelScheduler({ parallelism: 4 });
    const shots = makeShots(8);

    const results = await scheduler.runAll(shots, async (shot, index) => {
      // 故意乱序返回: 索引大的先 resolve
      const delay = (8 - index) * 10;
      await new Promise(r => setTimeout(r, delay));
      return { shot_id: shot.id, index_at_call: index };
    });

    assert.strictEqual(results.length, shots.length);
    for (let i = 0; i < shots.length; i++) {
      assert.strictEqual(results[i].shot_id, shots[i].id, `results[${i}] 对应错乱`);
      assert.strictEqual(results[i].index_at_call, i, `index ${i} 调用参数错误`);
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 6. 构造参数校验
  // ═══════════════════════════════════════════════════════════════
  it('parallelism 为 0 或负数时构造抛错', () => {
    assert.throws(() => new ShotParallelScheduler({ parallelism: 0 }), /positive integer/);
    assert.throws(() => new ShotParallelScheduler({ parallelism: -1 }), /positive integer/);
    assert.throws(() => new ShotParallelScheduler({ parallelism: 2.5 }), /positive integer/);
  });

  it('runAll 入参校验: shots 必须 array, taskFn 必须 function', async () => {
    const scheduler = new ShotParallelScheduler({ parallelism: 2 });
    await assert.rejects(() => scheduler.runAll(null, () => {}), /must be an array/);
    await assert.rejects(() => scheduler.runAll([], 'not a fn'), /must be a function/);
  });

  // ═══════════════════════════════════════════════════════════════
  // 7. collectFailures 静态工具
  // ═══════════════════════════════════════════════════════════════
  it('collectFailures 正确过滤失败 shot', () => {
    const results = [
      { shot_id: 's1', status: 'completed' },
      { shot_id: 's2', _failed: true, error: 'boom' },
      { shot_id: 's3', status: 'completed' },
      { shot_id: 's4', _failed: true, error: 'timeout' },
    ];
    const failures = ShotParallelScheduler.collectFailures(results);
    assert.strictEqual(failures.length, 2);
    assert.deepEqual(failures.map(f => f.shot_id), ['s2', 's4']);
  });

  it('collectPermanentFailures 正确过滤 permanent_failure (Phase 16)', () => {
    const results = [
      { shot_id: 's1', status: 'completed' },
      { shot_id: 's2', _failed: true, permanent_failure: true, error: 'boom' },
      { shot_id: 's3', _failed: true, retrying: true },  // 重试中,不算永久失败
      { shot_id: 's4', _failed: true, permanent_failure: true, error: 'timeout' },
    ];
    const permanent = ShotParallelScheduler.collectPermanentFailures(results);
    assert.strictEqual(permanent.length, 2);
    assert.deepEqual(permanent.map(f => f.shot_id), ['s2', 's4']);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Phase 16 PERF-04: runWithRetry 单元测试
// ═══════════════════════════════════════════════════════════════════

describe('ShotParallelScheduler.runWithRetry (Phase 16 PERF-04)', () => {
  let tmpDir;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'phase16-retry-'));
  });

  after(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  // 用全新 workdir 隔离每次测试 (避免 failed_shots.json 互相污染)
  async function freshScheduler() {
    const dir = await mkdtemp(join(tmpdir(), 'phase16-retry-fresh-'));
    const fakePipeline = { workdir: dir, episode: 'TEST-EP' };
    return {
      dir,
      scheduler: new ShotParallelScheduler({ parallelism: 4, pipeline: fakePipeline }),
      cleanup: () => rm(dir, { recursive: true, force: true }),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 1. 全部首次成功 — 不重试
  // ═══════════════════════════════════════════════════════════════
  it('全部 shot 首次成功时只跑 1 轮,无重试', async () => {
    const { scheduler, cleanup } = await freshScheduler();
    try {
      const shots = makeShots(3);
      const callCounts = new Map();
      const results = await scheduler.runWithRetry(shots, async (shot) => {
        callCounts.set(shot.id, (callCounts.get(shot.id) || 0) + 1);
        return { shot_id: shot.id, video_path: `/out/${shot.id}.mp4`, status: 'completed' };
      }, { maxRetries: 3 });

      assert.strictEqual(results.length, 3);
      // 每个 shot 只被调用 1 次
      for (const shot of shots) {
        assert.strictEqual(callCounts.get(shot.id), 1, `${shot.id} 应只被调用 1 次`);
      }
      // 所有结果无 retrying / permanent_failure
      for (const r of results) {
        assert.ok(!r.retrying, '不应标记 retrying');
        assert.ok(!r.permanent_failure, '不应标记 permanent_failure');
        assert.ok(r.video_path, '应有 video_path');
      }
    } finally {
      await cleanup();
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 2. 第 2 次尝试成功 — retry 成功
  // ═══════════════════════════════════════════════════════════════
  it('首次失败,第 2 次成功时 shot 被 retry 后通过', async () => {
    const { scheduler, cleanup } = await freshScheduler();
    try {
      const shots = [{ id: 'flaky-001' }];
      const callCounts = new Map();
      const results = await scheduler.runWithRetry(shots, async (shot) => {
        const n = (callCounts.get(shot.id) || 0) + 1;
        callCounts.set(shot.id, n);
        if (n === 1) throw new Error('首次失败 (模拟瞬时 OOM)');
        return { shot_id: shot.id, video_path: `/out/${shot.id}.mp4`, status: 'completed' };
      }, { maxRetries: 3 });

      assert.strictEqual(callCounts.get('flaky-001'), 2);
      assert.strictEqual(results[0].shot_id, 'flaky-001');
      assert.ok(results[0].video_path, '最终应有 video_path');
      assert.ok(!results[0].permanent_failure, '不应永久失败');
    } finally {
      await cleanup();
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 3. 超过 maxRetries 仍失败 → permanent_failure + failed_shots.json
  // ═══════════════════════════════════════════════════════════════
  it('maxRetries=3 时连续失败 3 次后标记 permanent_failure', async () => {
    const { scheduler, dir, cleanup } = await freshScheduler();
    try {
      const shots = [{ id: 'doomed-001' }];
      const callCounts = new Map();
      const results = await scheduler.runWithRetry(shots, async (shot) => {
        const n = (callCounts.get(shot.id) || 0) + 1;
        callCounts.set(shot.id, n);
        throw new Error(`always fails (attempt ${n})`);
      }, { maxRetries: 3 });

      // 应该被调用 3 次 (maxRetries=3)
      assert.strictEqual(callCounts.get('doomed-001'), 3);
      assert.strictEqual(results[0].permanent_failure, true);
      assert.strictEqual(results[0].retry_count, 3);
      assert.ok(results[0]._failed);
      assert.match(results[0].error, /always fails/);

      // failed_shots.json 应落盘
      const failedPath = join(dir, 'failed_shots.json');
      assert.ok(existsSync(failedPath), 'failed_shots.json 未落盘');
      const raw = await readFile(failedPath, 'utf-8');
      const parsed = JSON.parse(raw);
      assert.strictEqual(parsed.count, 1);
      assert.strictEqual(parsed.failures[0].shot_id, 'doomed-001');
      assert.strictEqual(parsed.failures[0].retry_count, 3);
    } finally {
      await cleanup();
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 4. 部分批量重试 — 3 个中 1 个永久失败,2 个最终成功
  // ═══════════════════════════════════════════════════════════════
  it('混合 batch: 部分 shot 最终成功,1 个永久失败', async () => {
    const { scheduler, dir, cleanup } = await freshScheduler();
    try {
      const shots = [
        { id: 'good-001' },   // 首次就成功
        { id: 'flaky-002' },  // 第 2 次成功
        { id: 'doomed-003' }, // 永久失败
      ];
      const callCounts = new Map();
      const results = await scheduler.runWithRetry(shots, async (shot) => {
        const n = (callCounts.get(shot.id) || 0) + 1;
        callCounts.set(shot.id, n);
        if (shot.id === 'good-001') {
          return { shot_id: shot.id, video_path: '/out/g1.mp4' };
        }
        if (shot.id === 'flaky-002') {
          if (n === 1) throw new Error('first fail');
          return { shot_id: shot.id, video_path: '/out/f2.mp4' };
        }
        // doomed-003
        throw new Error('always fails');
      }, { maxRetries: 3 });

      // 调用次数: good=1, flaky=2, doomed=3
      assert.strictEqual(callCounts.get('good-001'), 1);
      assert.strictEqual(callCounts.get('flaky-002'), 2);
      assert.strictEqual(callCounts.get('doomed-003'), 3);

      // 结果按索引对齐
      assert.strictEqual(results[0].shot_id, 'good-001');
      assert.ok(results[0].video_path);
      assert.strictEqual(results[1].shot_id, 'flaky-002');
      assert.ok(results[1].video_path);
      assert.strictEqual(results[2].shot_id, 'doomed-003');
      assert.strictEqual(results[2].permanent_failure, true);

      // failed_shots.json 只含 1 条
      const raw = await readFile(join(dir, 'failed_shots.json'), 'utf-8');
      const parsed = JSON.parse(raw);
      assert.strictEqual(parsed.count, 1);
      assert.strictEqual(parsed.failures[0].shot_id, 'doomed-003');
    } finally {
      await cleanup();
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 5. 空 shots 数组立即返回
  // ═══════════════════════════════════════════════════════════════
  it('空 shots 数组立即返回空结果,不 spawn worker', async () => {
    const { scheduler, cleanup } = await freshScheduler();
    try {
      let taskCalled = false;
      const results = await scheduler.runWithRetry([], async () => {
        taskCalled = true;
        return { video_path: '/x' };
      }, { maxRetries: 3 });
      assert.deepEqual(results, []);
      assert.strictEqual(taskCalled, false);
    } finally {
      await cleanup();
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 6. 入参校验
  // ═══════════════════════════════════════════════════════════════
  it('runWithRetry 入参校验: shots 必须 array, taskFn 必须 function', async () => {
    const { scheduler, cleanup } = await freshScheduler();
    try {
      await assert.rejects(() => scheduler.runWithRetry(null, () => {}), /must be an array/);
      await assert.rejects(() => scheduler.runWithRetry([], 'not a fn'), /must be a function/);
    } finally {
      await cleanup();
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 7. maxRetries 默认值为 3
  // ═══════════════════════════════════════════════════════════════
  it('maxRetries 不传时默认 3 次', async () => {
    const { scheduler, cleanup } = await freshScheduler();
    try {
      const callCounts = new Map();
      const shots = [{ id: 'doomed-default' }];
      const results = await scheduler.runWithRetry(shots, async (shot) => {
        const n = (callCounts.get(shot.id) || 0) + 1;
        callCounts.set(shot.id, n);
        throw new Error('always');
      });
      assert.strictEqual(callCounts.get('doomed-default'), 3, '默认应重试 3 次');
      assert.strictEqual(results[0].permanent_failure, true);
    } finally {
      await cleanup();
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 8. 成功后不再重试其他 shot (索引对齐)
  // ═══════════════════════════════════════════════════════════════
  it('results 数组严格按原 shots 索引对齐 (含 retry 场景)', async () => {
    const { scheduler, cleanup } = await freshScheduler();
    try {
      const shots = [
        { id: 'a-001' },
        { id: 'b-002' },
        { id: 'c-003' },
        { id: 'd-004' },
      ];
      const callCounts = new Map();
      const results = await scheduler.runWithRetry(shots, async (shot) => {
        const n = (callCounts.get(shot.id) || 0) + 1;
        callCounts.set(shot.id, n);
        // b-002 首次失败,第 2 次成功
        if (shot.id === 'b-002' && n === 1) throw new Error('first fail');
        return { shot_id: shot.id, video_path: `/out/${shot.id}.mp4` };
      }, { maxRetries: 3 });

      assert.strictEqual(results.length, 4);
      assert.strictEqual(results[0].shot_id, 'a-001');
      assert.strictEqual(results[1].shot_id, 'b-002');
      assert.strictEqual(results[2].shot_id, 'c-003');
      assert.strictEqual(results[3].shot_id, 'd-004');
      // 全部最终成功
      for (const r of results) {
        assert.ok(r.video_path, `${r.shot_id} 缺 video_path`);
        assert.ok(!r.permanent_failure, `${r.shot_id} 不应永久失败`);
      }
    } finally {
      await cleanup();
    }
  });
});
