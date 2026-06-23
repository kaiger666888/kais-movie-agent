/**
 * Phase 15 PERF-01: ShotParallelScheduler 单元测试
 *
 * 覆盖:
 *   1. Concurrency: 4 workers, 10 tasks → ~3 batches (时间断言)
 *   2. Error isolation: 一个 shot 失败不阻塞其他
 *   3. Empty shots array: 立即返回
 *   4. Parallelism > shots: 不 overspawn workers
 *   5. 顺序对齐: results[i] 对应 shots[i]
 *
 * Run: node --test test/phases/shot-parallel-scheduler.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

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
});
