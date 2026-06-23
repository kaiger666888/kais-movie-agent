/**
 * ShotParallelScheduler — 镜头级并行调度器 (Phase 15 PERF-01 / PERF-02 + Phase 16 PERF-04)
 *
 * 工业化能力:
 *   - 真正的 Promise.all 并发 (config.parallel_shots: 4)
 *   - 错误隔离: 单个 shot 失败不阻塞其他 shot
 *   - backpressure: worker 池模型,不会一次性 spawn 全部任务
 *   - Phase 16: 镜头级失败重试预算 (runWithRetry)
 *
 * 用法:
 *   const scheduler = new ShotParallelScheduler({ parallelism: 4, pipeline });
 *   const results = await scheduler.runAll(shots, async (shot) => {
 *     return await generateShot(shot);
 *   });
 *   // results[i] 对应 shots[i],保证顺序对齐
 *   // 失败的 shot 在 results[i] 中为 { shot_id, error }
 *
 *   // Phase 16: 自动重试
 *   const retried = await scheduler.runWithRetry(shots, taskFn, { maxRetries: 3 });
 *   // 失败到 maxRetries 后该 shot 被标记 permanent_failure
 */
'use strict';

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export class ShotParallelScheduler {
  /**
   * @param {object} opts
   * @param {number} [opts.parallelism=4] - 最大并发 worker 数
   * @param {object} [opts.pipeline] - 可选 Pipeline 引用 (供 handler 注入日志/traceId / workdir)
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

  // ─── Phase 16 PERF-04: 镜头级失败重试预算 ───────────────────────

  /**
   * 并行执行 shot-level 任务,失败自动重试到 maxRetries 次。
   *
   * 行为契约 (Phase 16 CONTEXT.md):
   *   - 第 1 轮: 全量 shots 跑 runAll,失败的收集到下一轮
   *   - 第 2..N 轮: 只重跑上一轮失败的 shots
   *   - 单个 shot 重试次数达到 maxRetries 仍未通过 → 标记 permanent_failure
   *   - 所有 permanent_failure 写入 {workdir}/failed_shots.json 供人工介入
   *   - 成功 shot 的结果与 runAll 完全一致 (按 shots 索引对齐)
   *
   * 失败判定 (任一即可):
   *   1. taskFn throw → runAll 返回 { _failed: true, error }
   *   2. taskFn 返回 falsy video_path 或 error 字段 (Seedance 契约)
   *
   * Phase 21 B5-03: BlacklistEngine 集成
   *   - options.blacklist 传入时,第 1 轮开始前对每个 shot 调用 blacklist.check()
   *   - 命中 'hit' → 直接标记 { status: 'blacklisted' }(永不重试,不计失败)
   *   - 命中 'disabled' / 'degraded' / 'miss' → 正常进入重试流程
   *   - 被黑名单跳过的 shot 永不进入 taskFn
   *
   * @param {Array<object>} shots - 待执行的 shot 列表
   * @param {(shot, index) => Promise<Result>} taskFn - 单 shot 执行函数
   * @param {object} [options]
   * @param {number} [options.maxRetries=3] - 每个 shot 的最大重试次数 (含首次)
   * @param {object} [options.blacklist] - BlacklistEngine 实例(可选)
   * @returns {Promise<Array<Result>>} 与 shots 等长、按索引对齐的结果数组
   */
  async runWithRetry(shots, taskFn, options = {}) {
    if (!Array.isArray(shots)) {
      throw new TypeError(`ShotParallelScheduler.runWithRetry: shots must be an array (got ${typeof shots})`);
    }
    if (typeof taskFn !== 'function') {
      throw new TypeError(`ShotParallelScheduler.runWithRetry: taskFn must be a function`);
    }

    const maxRetries = Math.max(1, Number(options.maxRetries) || 3);
    const blacklist = options.blacklist || null;

    // 空数组直接返回
    if (shots.length === 0) {
      return [];
    }

    // 原始 shot → 在 shots 中的索引 (用于结果对齐)
    // 使用 stable string key (shot.id 优先,fallback 到 shot_id,再 fallback 到 index)
    const indexById = new Map();
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      const key = s?.id ?? s?.shot_id ?? `index-${i}`;
      indexById.set(key, i);
    }

    // 结果容器: 按原 shots 索引对齐
    const results = new Array(shots.length);
    const retryCounts = new Map();  // shot_id → 已尝试次数
    const permanentFailures = [];   // 永久失败,待写入 failed_shots.json

    // ─── Phase 21 B5-03: 黑名单前置过滤(第 1 轮前一次性过滤) ───
    let initialShots = shots.slice();
    if (blacklist) {
      const filteredShots = [];
      for (const shot of initialShots) {
        const key = shot?.id ?? shot?.shot_id ?? `index-${shots.indexOf(shot)}`;
        const idx = indexById.get(key);
        try {
          const status = await blacklist.check({
            prompt: shot?.description || shot?.prompt,
            imagePath: shot?.referenceImage || shot?.scene_frame_path,
          });
          if (status === 'hit') {
            // 黑名单命中: 标记跳过,不进入 taskFn,不计为失败
            results[idx] = {
              shot_id: key,
              status: 'blacklisted',
              reason: 'blacklist hit',
              blacklist_skipped: true,
            };
            try {
              this.logger.info?.(
                `[ShotParallelScheduler] shot ${key} 跳过: blacklist hit`,
              );
            } catch { /* logger broken — swallow */ }
            continue;  // 不加入 filteredShots
          }
        } catch (err) {
          // blacklist.check() 异常(理论上不会,但防御性)→ 视为 miss 继续
          try {
            this.logger.warn?.(
              `[ShotParallelScheduler] blacklist.check() 异常: ${err.message} — 视为 miss 继续`,
            );
          } catch { /* swallow */ }
        }
        filteredShots.push(shot);
      }
      initialShots = filteredShots;
    }

    let currentShots = initialShots;
    let attempt = 0;

    while (currentShots.length > 0 && attempt < maxRetries) {
      attempt++;
      const attemptResults = await this.runAll(currentShots, taskFn);

      const nextRetryShots = [];
      for (let i = 0; i < currentShots.length; i++) {
        const shot = currentShots[i];
        const result = attemptResults[i];
        const key = shot?.id ?? shot?.shot_id ?? `index-${shots.indexOf(shot)}`;
        const idx = indexById.get(key);
        const retry = (retryCounts.get(key) || 0) + 1;
        retryCounts.set(key, retry);

        // 判定是否成功
        const isSuccess = result && !result._failed && !result.error
          && (result.video_path !== undefined ? !!result.video_path : true);

        if (isSuccess) {
          results[idx] = result;
        } else {
          // 失败: 看是否还能再试
          if (retry >= maxRetries) {
            // 永久失败
            const failureEntry = {
              shot_id: key,
              error: result?.error ?? 'unknown',
              retry_count: retry,
              last_attempt_at: new Date().toISOString(),
              ...(result?.task_id ? { task_id: result.task_id } : {}),
            };
            results[idx] = {
              ...(result || {}),
              shot_id: key,
              permanent_failure: true,
              retry_count: retry,
              _failed: true,
            };
            permanentFailures.push(failureEntry);
            try {
              this.logger.warn?.(
                `[ShotParallelScheduler] shot ${key} permanent_failure after ${retry} attempts: ${failureEntry.error}`,
              );
            } catch { /* logger broken — swallow */ }
          } else {
            // 还有重试预算,放回下一轮
            nextRetryShots.push(shot);
            // 占位: 标记 retrying (会被下次成功覆盖,或最终成为 permanent_failure)
            results[idx] = {
              ...(result || {}),
              shot_id: key,
              retrying: true,
              retry_count: retry,
              _failed: true,
            };
          }
        }
      }

      currentShots = nextRetryShots;
    }

    // 写 failed_shots.json (如果有永久失败)
    if (permanentFailures.length > 0) {
      await this._writeFailedShots(permanentFailures);
    }

    return results;
  }

  /**
   * 写 failed_shots.json 到 workdir (供人工介入 / v3.0 bad case 库)
   * @param {Array<object>} failures - 永久失败的 shot 详情
   */
  async _writeFailedShots(failures) {
    const workdir = this.pipeline?.workdir;
    if (!workdir) {
      // 无 workdir 时降级为 logger.warn,不写文件
      try {
        this.logger.warn?.(
          `[ShotParallelScheduler] ${failures.length} permanent failures (no workdir, skipping failed_shots.json write)`,
        );
      } catch { /* swallow */ }
      return;
    }

    const payload = {
      _generatedAt: new Date().toISOString(),
      _phase: 'cloud-production',
      count: failures.length,
      failures,
    };
    try {
      await writeFile(join(workdir, 'failed_shots.json'),
        JSON.stringify(payload, null, 2), 'utf-8');
    } catch (err) {
      try {
        this.logger.warn?.(
          `[ShotParallelScheduler] failed_shots.json 写入失败: ${err.message}`,
        );
      } catch { /* swallow */ }
    }
  }

  /**
   * 过滤出失败的结果 (供 Phase 16 重试预算使用)
   * @param {Array<Result>} results - runAll / runWithRetry 的返回值
   * @returns {Array<Result>} 仅包含失败 shot 的结果
   */
  static collectFailures(results) {
    if (!Array.isArray(results)) return [];
    return results.filter(r => r && r._failed === true);
  }

  /**
   * 过滤出永久失败的结果 (Phase 16)
   * @param {Array<Result>} results - runWithRetry 的返回值
   * @returns {Array<Result>} 仅含 permanent_failure: true 的结果
   */
  static collectPermanentFailures(results) {
    if (!Array.isArray(results)) return [];
    return results.filter(r => r && r.permanent_failure === true);
  }

  /**
   * 过滤出被黑名单跳过的结果 (Phase 21 B5-03)
   * @param {Array<Result>} results - runWithRetry 的返回值
   * @returns {Array<Result>} 仅含 blacklist_skipped: true 的结果
   */
  static collectBlacklisted(results) {
    if (!Array.isArray(results)) return [];
    return results.filter(r => r && r.blacklist_skipped === true);
  }
}

export default ShotParallelScheduler;
