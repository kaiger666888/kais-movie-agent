/**
 * EvaluationCollector — GPU 任务评估数据采集器
 *
 * GPU 任务完成后自动采集评估数据（耗时、显存、质量评分等），
 * 为 Hermes 经验学习提供结构化数据基础。
 *
 * 存储: {workdir}/.pipeline-assets/evaluations.json
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const ASSETS_DIR = '.pipeline-assets';
const EVAL_FILE = 'evaluations.json';

/**
 * 评估记录数据模型
 * @typedef {Object} Evaluation
 * @property {string} task_id       - 任务唯一 ID
 * @property {string} phase         - 所属阶段 (e.g. "p4_layout", "p5_render")
 * @property {string} task_type     - 任务类型 (e.g. "tts_generation", "blender_render")
 * @property {string} timestamp     - ISO 8601 时间戳
 * @property {number} gpu_time_sec  - GPU 耗时（秒）
 * @property {number} peak_vram_gb  - 峰值显存占用 (GB)
 * @property {boolean} success      - 是否成功
 * @property {number} retry_count   - 重试次数
 * @property {boolean} oom_risk     - 是否接近 OOM
 * @property {number} [ai_quality_score]    - AI 质量评分 0-100
 * @property {number} [human_cinematic]     - 人工评分: 电影感 0-10
 * @property {number} [human_motion]        - 人工评分: 运动流畅度 0-10
 * @property {number} [human_consistency]   - 人工评分: 一致性 0-10
 * @property {string} [hermes_decision_id]  - Hermes 决策 ID
 * @property {number} [hermes_confidence]   - Hermes 决策置信度 0-1
 * @property {object} [parameters_used]     - 使用的参数
 * @property {string} [output_path]         - 产出文件路径
 * @property {string} [thumbnail_path]      - 缩略图路径
 */

export class EvaluationCollector {
  /**
   * @param {string} workdir - 项目工作目录
   * @param {object} [opts]
   * @param {string} [opts.episodeId] - 可选 episode ID,写入 cost-report.json
   */
  constructor(workdir, opts = {}) {
    this._workdir = workdir;
    this._episodeId = opts.episodeId || null;
    this._evalPath = join(workdir, ASSETS_DIR, EVAL_FILE);
  }

  // ─── 存储 ──────────────────────────────────────────

  /** 确保存储目录存在 */
  async _ensureDir() {
    const dir = join(this._workdir, ASSETS_DIR);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
   }

  /** 读取全部评估记录 */
  async _readAll() {
    try {
      const raw = await readFile(this._evalPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  /** 写回全部评估记录 */
  async _writeAll(records) {
    await this._ensureDir();
    await writeFile(this._evalPath, JSON.stringify(records, null, 2), 'utf-8');
  }

  // ─── 核心方法 ──────────────────────────────────────

  /**
   * 记录单次评估
   * @param {Evaluation} evaluation
   * @returns {Promise<Evaluation>} 带 timestamp 的记录
   */
  async record(evaluation) {
    const record = {
      ...evaluation,
      timestamp: evaluation.timestamp || new Date().toISOString(),
    };
    const records = await this._readAll();
    records.push(record);
    await this._writeAll(records);
    return record;
  }

  /**
   * 批量记录评估
   * @param {Evaluation[]} evaluations
   * @returns {Promise<Evaluation[]>}
   */
  async recordBatch(evaluations) {
    const stamped = evaluations.map((e) => ({
      ...e,
      timestamp: e.timestamp || new Date().toISOString(),
    }));
    const records = await this._readAll();
    records.push(...stamped);
    await this._writeAll(records);
    return stamped;
  }

  /**
   * 按 phase 查询评估记录
   * @param {string} phase - 阶段名
   * @param {number} [limit=50] - 最大返回条数
   * @returns {Promise<Evaluation[]>}
   */
  async queryByPhase(phase, limit = 50) {
    const records = await this._readAll();
    return records
      .filter((r) => r.phase === phase)
      .slice(-limit);
  }

  /**
   * 获取统计信息
   * @param {string} [taskType] - 按任务类型过滤
   * @returns {Promise<Object>} 统计摘要
   */
  async getStats(taskType) {
    let records = await this._readAll();
    if (taskType) {
      records = records.filter((r) => r.task_type === taskType);
    }
    if (records.length === 0) {
      return { total: 0, task_type: taskType || 'all' };
    }

    const successes = records.filter((r) => r.success);
    const withScore = records.filter((r) => r.ai_quality_score != null);
    const sumField = (arr, field) => arr.reduce((s, r) => s + (r[field] || 0), 0);

    return {
      total: records.length,
      task_type: taskType || 'all',
      success_rate: successes.length / records.length,
      avg_gpu_time_sec: sumField(records, 'gpu_time_sec') / records.length,
      max_gpu_time_sec: Math.max(...records.map((r) => r.gpu_time_sec || 0)),
      avg_peak_vram_gb: sumField(records, 'peak_vram_gb') / records.length,
      max_peak_vram_gb: Math.max(...records.map((r) => r.peak_vram_gb || 0)),
      oom_risk_count: records.filter((r) => r.oom_risk).length,
      avg_retry_count: sumField(records, 'retry_count') / records.length,
      avg_ai_quality: withScore.length > 0
        ? sumField(withScore, 'ai_quality_score') / withScore.length
        : null,
      by_phase: this._groupByPhase(records),
    };
  }

  /** 按 phase 分组统计 */
  _groupByPhase(records) {
    const map = {};
    for (const r of records) {
      const p = r.phase || 'unknown';
      if (!map[p]) map[p] = { count: 0, success: 0, gpu_time: 0 };
      map[p].count++;
      if (r.success) map[p].success++;
      map[p].gpu_time += r.gpu_time_sec || 0;
    }
    for (const p of Object.keys(map)) {
      const g = map[p];
      g.success_rate = g.success / g.count;
      g.avg_gpu_time = g.gpu_time / g.count;
      delete g.gpu_time;
    }
    return map;
  }

  // ─── Phase 16 PERF-03: 单集成本核算 ────────────────────────────

  /**
   * 聚合本 episode 所有任务评估,产出 cost-report.json
   *
   * 按 phase / task_type 聚合 GPU 时间,计算失败任务浪费成本,
   * 按 episode-id 落盘到 {workdir}/cost-report.json。
   *
   * 幂等性: 每次调用读全量 records 重新聚合,覆盖上次的 cost-report.json。
   * 无 records 时返回空报告 (空对象结构,success_rate='0.0%')。
   *
   * @returns {Promise<object>} 聚合报告 (同时落盘到 cost-report.json)
   */
  async aggregateForEpisode() {
    const records = await this._readAll();

    const byPhase = {};
    const byTaskType = {};
    let totalGpuSec = 0;
    let totalRetryWasteSec = 0;
    const failedTasks = [];

    for (const r of records) {
      const gpuSec = Number(r.gpu_time_sec) || 0;
      totalGpuSec += gpuSec;

      const phaseKey = r.phase || 'unknown';
      byPhase[phaseKey] = byPhase[phaseKey] || { count: 0, gpu_sec: 0, failed: 0 };
      byPhase[phaseKey].count++;
      byPhase[phaseKey].gpu_sec += gpuSec;
      if (!r.success) byPhase[phaseKey].failed++;

      const taskTypeKey = r.task_type || 'unknown';
      byTaskType[taskTypeKey] = byTaskType[taskTypeKey] || { count: 0, gpu_sec: 0 };
      byTaskType[taskTypeKey].count++;
      byTaskType[taskTypeKey].gpu_sec += gpuSec;

      // 浪费在 retry 上的时间: 每条 record 自身的 gpu_time × retry_count
      const retryCount = Number(r.retry_count) || 0;
      if (retryCount > 0) {
        totalRetryWasteSec += gpuSec * retryCount;
      }
      if (!r.success) failedTasks.push(r);
    }

    // round gpu_sec to 3 decimals to avoid float drift in cost-report
    for (const k of Object.keys(byPhase)) {
      byPhase[k].gpu_sec = Math.round(byPhase[k].gpu_sec * 1000) / 1000;
    }
    for (const k of Object.keys(byTaskType)) {
      byTaskType[k].gpu_sec = Math.round(byTaskType[k].gpu_sec * 1000) / 1000;
    }

    const successRate = records.length > 0
      ? ((records.length - failedTasks.length) / records.length * 100).toFixed(1) + '%'
      : '0.0%';

    const report = {
      episode: this._episodeId || null,
      workdir: this._workdir,
      generated_at: new Date().toISOString(),
      total_records: records.length,
      total_gpu_sec: Math.round(totalGpuSec * 1000) / 1000,
      total_gpu_minutes: Math.round(totalGpuSec / 60 * 10) / 10,
      total_retry_waste_sec: Math.round(totalRetryWasteSec * 1000) / 1000,
      by_phase: byPhase,
      by_task_type: byTaskType,
      failed_tasks: failedTasks,
      summary: {
        success_rate: successRate,
        failed_count: failedTasks.length,
        // 粗略成本/分钟: GPU-min ÷ episode-min (暂留, v3.0 接财务系统)
        cost_per_minute: Math.round(totalGpuSec / 60 * 100) / 100,
      },
    };

    // 落盘到 workdir 根目录的 cost-report.json (幂等覆盖)
    await this._ensureDir();  // 确保 .pipeline-assets 存在 (根目录必然存在)
    await writeFile(join(this._workdir, 'cost-report.json'),
      JSON.stringify(report, null, 2), 'utf-8');
    return report;
  }

  // ─── GoldTeam 结果提取 ─────────────────────────────

  /**
   * 从 gold-team 任务返回值提取评估数据
   *
   * 字段映射:
   *   elapsed_seconds → gpu_time_sec
   *   peak_memory_gb  → peak_vram_gb
   *   retry_count     → retry_count
   *   status === 'completed' → success
   *
   * @param {object} taskResult - gold-team 返回的任务结果
   * @param {string} phase      - 所属阶段
   * @param {object} [params]   - 使用的参数
   * @returns {Evaluation}
   */
  extractFromGoldTeamResult(taskResult, phase, params = {}) {
    const success = taskResult.status === 'completed'
      || taskResult.status === 'done';

    // OOM 风险判断: 显存 > 90% of 8GB (RTX 3060 Ti)
    const PEAK_VRAM_THRESHOLD_GB = 7.2;
    const peakVram = taskResult.peak_memory_gb || 0;
    const oomRisk = peakVram >= PEAK_VRAM_THRESHOLD_GB;

    return {
      task_id: taskResult.task_id || taskResult.id || 'unknown',
      phase,
      task_type: taskResult.task_type || 'unknown',
      timestamp: new Date().toISOString(),
      gpu_time_sec: taskResult.elapsed_seconds || 0,
      peak_vram_gb: peakVram,
      success,
      retry_count: taskResult.retry_count || 0,
      oom_risk: oomRisk,
      parameters_used: params,
      output_path: taskResult.output_path || null,
      thumbnail_path: taskResult.thumbnail_path || null,
    };
  }

  // ─── Hermes 导出 ───────────────────────────────────

  /**
   * 导出指定 phase 的统计摘要，供 Hermes 经验学习消费
   *
   * 输出格式:
   *   { phase, total_tasks, success_rate, avg_gpu_time_sec,
   *     avg_peak_vram_gb, avg_ai_quality, best_params, worst_params,
   *     recommendations }
   *
   * @param {string} phase - 阶段名
   * @returns {Promise<Object|null>} Hermes 格式摘要，无数据时返回 null
   */
  async exportForHermes(phase) {
    const records = await this.queryByPhase(phase, 500);
    if (records.length === 0) return null;

    const successes = records.filter((r) => r.success);
    const failures = records.filter((r) => !r.success);
    const withScore = records.filter((r) => r.ai_quality_score != null);

    const avg = (arr, field) =>
      arr.length > 0
        ? arr.reduce((s, r) => s + (r[field] || 0), 0) / arr.length
        : 0;

    // 最佳参数: 成功任务中 AI 评分最高的那组参数
    const bestParams = this._pickBestParams(successes);
    // 最差参数: 失败次数最多的参数组合
    const worstParams = this._pickWorstParams(failures);

    return {
      phase,
      total_tasks: records.length,
      success_rate: successes.length / records.length,
      avg_gpu_time_sec: Math.round(avg(records, 'gpu_time_sec') * 100) / 100,
      avg_peak_vram_gb: Math.round(avg(records, 'peak_vram_gb') * 1000) / 1000,
      avg_ai_quality: withScore.length > 0
        ? Math.round(avg(withScore, 'ai_quality_score') * 100) / 100
        : null,
      best_params: bestParams,
      worst_params: worstParams,
      recommendations: this._generateRecommendations(records, successes, failures),
    };
  }

  /** 挑选最佳参数（成功 + AI 评分最高） */
  _pickBestParams(successes) {
    if (successes.length === 0) return null;
    const scored = successes
      .filter((r) => r.ai_quality_score != null)
      .sort((a, b) => b.ai_quality_score - a.ai_quality_score);
    const best = scored[0] || successes[0];
    return {
      parameters: best.parameters_used || {},
      ai_quality_score: best.ai_quality_score || null,
      gpu_time_sec: best.gpu_time_sec,
    };
  }

  /** 挑选最差参数（失败任务中出现最多的参数） */
  _pickWorstParams(failures) {
    if (failures.length === 0) return null;
    // 简单策略: 返回最后一个失败任务的参数
    const worst = failures[failures.length - 1];
    return {
      parameters: worst.parameters_used || {},
      gpu_time_sec: worst.gpu_time_sec,
      retry_count: worst.retry_count,
    };
  }

  /** 基于数据生成简单建议 */
  _generateRecommendations(records, successes, failures) {
    const recs = [];

    // OOM 风险
    const oomCount = records.filter((r) => r.oom_risk).length;
    if (oomCount > 0) {
      recs.push({
        type: 'oom_warning',
        message: `${oomCount}/${records.length} 任务接近 OOM，考虑降低分辨率或 batch size`,
      });
    }

    // 成功率
    const successRate = successes.length / records.length;
    if (successRate < 0.8) {
      recs.push({
        type: 'low_success_rate',
        message: `成功率 ${(successRate * 100).toFixed(1)}%，建议检查参数或增加重试`,
      });
    }

    // 重试过多
    const avgRetry = records.reduce((s, r) => s + (r.retry_count || 0), 0) / records.length;
    if (avgRetry > 1) {
      recs.push({
        type: 'high_retry',
        message: `平均重试 ${avgRetry.toFixed(1)} 次，考虑优化参数`,
      });
    }

    return recs;
  }
}
