/**
 * ShotParallelScheduler — 镜头级并行调度器 (Phase 15 PERF-01 / PERF-02)
 *
 * 工业化能力:
 *   - 真正的 Promise.all 并发 (config.parallel_shots: 4)
 *   - 错误隔离: 单个 shot 失败不阻塞其他 shot
 *   - backpressure: worker 池模型,不会一次性 spawn 全部任务
 *
 * 用法:
 *   const scheduler = new ShotParallelScheduler({ parallelism: 4, pipeline });
 *   const results = await scheduler.runAll(shots, async (shot) => {
 *     return await generateShot(shot);
 *   });
 *   // results[i] 对应 shots[i],保证顺序对齐
 *   // 失败的 shot 在 results[i] 中为 { shot_id, error }
 */
'use strict';

export class ShotParallelScheduler {
  /**
   * @param {object} opts
   * @param {number} [opts.parallelism=4] - 最大并发 worker 数
   * @param {object} [opts.pipeline] - 可选 Pipeline 引用 (供 handler 注入日志/traceId)
   * @param {object} [opts.logger] - 可选 logger (默认 console)
   */
  constructor({ parallelism = 4, pipeline = null, logger = console } = {}) {
    if (!Number.isInteger(parallelism) || parallelism < 1) {
      throw new Error(`ShotParallelScheduler: parallelism must be a positive integer (got ${parallelism})`);
    }
    this.parallelism = parallelism;
    this.pipeline = pipeline;
    this.logger = logger;
  }

  /**
   * 并行执行 shot-level 任务,等所有完成才返回。
   *
   * @param {Array<object>} shots - 待执行的 shot 列表
   * @param {(shot, index) => Promise<Result>} taskFn - 单 shot 执行函数
   * @returns {Promise<Array<Result>>} 与 shots 等长、按索引对齐的结果数组
   *
   * 错误隔离契约:
   *   - taskFn throw 时,该 shot 的结果变为 { shot_id, error }
   *   - 其他 shot 不受影响
   *   - runAll 本身永不 reject (除非 shots 非 array)
   */
  async runAll(shots, taskFn) {
    if (!Array.isArray(shots)) {
      throw new TypeError(`ShotParallelScheduler.runAll: shots must be an array (got ${typeof shots})`);
    }
    if (typeof taskFn !== 'function') {
      throw new TypeError(`ShotParallelScheduler.runAll: taskFn must be a function`);
    }

    // 空数组直接返回,不 spawn 任何 worker
    if (shots.length === 0) {
      return [];
    }

    const results = new Array(shots.length);
    let nextIndex = 0;

    // Worker 池: 每个 worker 从共享游标取任务,直到游标越界
    // 并发度 = min(parallelism, shots.length),不会 overspawn
    const workerCount = Math.min(this.parallelism, shots.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (true) {
        const i = nextIndex++;
        if (i >= shots.length) break;
        const shot = shots[i];
        try {
          results[i] = await taskFn(shot, i);
        } catch (err) {
          // 错误隔离: 记录失败但不中断其他 worker
          results[i] = {
            shot_id: shot?.id ?? shot?.shot_id ?? `index-${i}`,
            error: err?.message ?? String(err),
            _failed: true,
          };
          try {
            this.logger.warn?.(
              `[ShotParallelScheduler] shot ${results[i].shot_id} failed: ${results[i].error}`,
            );
          } catch { /* logger broken — swallow */ }
        }
      }
    });

    await Promise.all(workers);
    return results;
  }

  /**
   * 过滤出失败的结果 (供 Phase 16 重试预算使用)
   * @param {Array<Result>} results - runAll 的返回值
   * @returns {Array<Result>} 仅包含失败 shot 的结果
   */
  static collectFailures(results) {
    if (!Array.isArray(results)) return [];
    return results.filter(r => r && r._failed === true);
  }
}

export default ShotParallelScheduler;
