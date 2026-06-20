/**
 * Pipeline Manager — 管线状态机
 *
 * 管理 Pipeline 实例的创建、启动、恢复、取消、状态查询。
 * 将 V6.0 Phase 0~7 映射到现有 11 Phase system。
 * 复用 lib/pipeline.js 的 Pipeline 类，不修改原逻辑。
 */

import { Pipeline } from '../../lib/pipeline.js';
import { PHASES_V6, mapV6ToLegacy, PHASES_ORDER } from './phase-registry.js';

export class PipelineManager {
  constructor() {
    /** @type {Map<string, {pipeline: Pipeline, status: string, config: object, job: object|null}>} */
    this.pipelines = new Map();
    /** @type {Map<string, string>} — taskId → pipelineId mapping for callbacks */
    this.taskIndex = new Map();
  }

  /**
   * 创建新管线实例
   */
  create(projectId, config = {}, metadata = {}) {
    const pipelineId = `pipe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const workdir = config.workdir || `/data/projects/${projectId}/${metadata.episode || projectId}/${pipelineId}`;

    const pipeline = new Pipeline({
      workdir,
      episode: metadata.episode || projectId,
      config: config.config || {},
      traceId: pipelineId,
    });

    const entry = {
      pipelineId,
      projectId,
      pipeline,
      status: 'pending',
      v6Config: config,
      metadata,
      workdir,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      phases: PHASES_V6.map(p => ({
        id: p.id,
        name: p.name,
        status: 'pending',
      })),
      currentPhase: null,
      job: null,
    };

    this.pipelines.set(pipelineId, entry);
    return this._summarize(entry);
  }

  /**
   * 启动管线
   */
  async start(pipelineId, options = {}) {
    const entry = this._get(pipelineId);
    if (!entry) throw new Error(`Pipeline not found: ${pipelineId}`);
    if (entry.status === 'running') {
      const err = new Error('Pipeline already running');
      err.status = 409;
      throw err;
    }

    entry.status = 'running';
    entry.updatedAt = new Date().toISOString();

    // 确定 V6 起始 phase
    const fromPhase = options.from_phase || 'requirement';
    const v6Phase = PHASES_V6.find(p => p.id === fromPhase);
    if (!v6Phase) throw new Error(`Unknown phase: ${fromPhase}`);

    entry.currentPhase = fromPhase;
    const startIdx = PHASES_V6.indexOf(v6Phase);

    // 标记之前的 phase 为 completed
    for (let i = 0; i < startIdx; i++) {
      entry.phases[i].status = 'completed';
    }
    entry.phases[startIdx].status = 'running';

    // 异步执行管线
    this._runPipeline(entry, startIdx);

    return this._summarize(entry);
  }

  /**
   * 异步执行管线（非阻塞）
   */
  async _runPipeline(entry, startIdx) {
    try {
      for (let i = startIdx; i < PHASES_V6.length; i++) {
        const v6Phase = PHASES_V6[i];
        entry.currentPhase = v6Phase.id;
        entry.phases[i].status = 'running';
        entry.updatedAt = new Date().toISOString();

        // 执行该 V6 Phase 对应的 legacy stages
        const legacyStages = v6Phase.stages;
        for (const stageId of legacyStages) {
          await entry.pipeline.runPhase(stageId);
        }

        entry.phases[i].status = 'completed';
        entry.updatedAt = new Date().toISOString();
      }

      entry.status = 'completed';
      entry.currentPhase = null;
      entry.updatedAt = new Date().toISOString();
    } catch (err) {
      entry.status = 'failed';
      const failedPhaseIdx = PHASES_V6.findIndex(p => p.id === entry.currentPhase);
      if (failedPhaseIdx >= 0) {
        entry.phases[failedPhaseIdx].status = 'failed';
        entry.phases[failedPhaseIdx].error = err.message;
      }
      entry.updatedAt = new Date().toISOString();
      console.error(`[PipelineManager] Pipeline ${entry.pipelineId} failed: ${err.message}`);
    }
  }

  /**
   * 统一审核决策入口 — 处理来自 telegram / canvas / review-platform 的审核决定
   *
   * @param {string} pipelineId - 管线 ID
   * @param {string} phaseId - V6 phase ID（如 'art-character'）
   * @param {'approved'|'rejected'} decision - 审核决定
   * @param {object} context - 审核上下文
   * @param {'telegram'|'canvas'|'review-platform'} context.source - 决定来源
   * @param {string} [context.nodeId] - Canvas 节点 ID（canvas 来源时）
   * @param {string} [context.reason] - 驳回原因
   * @param {Array} [context.selectedItems] - 选中的候选项
   * @returns {Promise<object>} { status, nextPhase?, reason? }
   */
  async handleReviewDecision(pipelineId, phaseId, decision, context = {}) {
    const entry = this._get(pipelineId);
    if (!entry) throw new Error(`Pipeline not found: ${pipelineId}`);

    const v6Idx = PHASES_V6.findIndex(p => p.id === phaseId);
    if (v6Idx < 0) throw new Error(`Unknown phase: ${phaseId}`);

    const phaseEntry = entry.phases[v6Idx];
    const source = context.source || 'unknown';

    console.log(JSON.stringify({
      event: 'review_decision',
      pipeline_id: pipelineId,
      phase_id: phaseId,
      decision,
      source,
      node_id: context.nodeId || null,
      selected_items: context.selectedItems || [],
      ts: new Date().toISOString(),
    }));

    if (decision === 'approved') {
      phaseEntry.status = 'completed';
      phaseEntry.review_result = 'approved';
      if (context.selectedItems) {
        phaseEntry.selected_items = context.selectedItems;
      }
      entry.updatedAt = new Date().toISOString();

      // 推进到下一个 phase
      const nextIdx = v6Idx + 1;
      if (nextIdx >= PHASES_V6.length) {
        entry.status = 'completed';
        entry.currentPhase = null;
        return { status: 'completed', nextPhase: null };
      }

      const nextPhase = PHASES_V6[nextIdx].id;
      // 异步恢复管线
      this.resume(pipelineId, { phase: nextPhase, decision: 'approved' }).catch(err => {
        console.error(`[PipelineManager] Resume after approval failed: ${err.message}`);
      });

      return { status: 'approved', nextPhase };
    }

    if (decision === 'rejected') {
      phaseEntry.status = 'failed';
      phaseEntry.review_result = 'rejected';
      if (context.reason) {
        phaseEntry.rejection_reason = context.reason;
      }
      entry.updatedAt = new Date().toISOString();
      return { status: 'rejected', nextPhase: null, reason: context.reason || '' };
    }

    throw new Error(`Invalid decision: ${decision}`);
  }

  /**
   * 恢复管线
   */
  async resume(pipelineId, options = {}) {
    const entry = this._get(pipelineId);
    if (!entry) throw new Error(`Pipeline not found: ${pipelineId}`);
    if (entry.status === 'running') {
      const err = new Error('Pipeline already running');
      err.status = 409;
      throw err;
    }

    const fromPhase = options.phase || entry.currentPhase;
    if (!fromPhase) throw new Error('Cannot determine resume phase');

    entry.status = 'running';
    entry.updatedAt = new Date().toISOString();

    const v6Idx = PHASES_V6.findIndex(p => p.id === fromPhase);
    if (v6Idx < 0) throw new Error(`Unknown phase: ${fromPhase}`);

    // 如果有审核决定，处理之
    if (options.decision) {
      const phaseEntry = entry.phases[v6Idx];
      phaseEntry.status = options.decision === 'approved' ? 'completed' : 'failed';
    }

    // 从下一个 phase 继续
    const nextIdx = options.decision === 'approved' ? v6Idx + 1 : v6Idx;
    if (nextIdx >= PHASES_V6.length) {
      entry.status = 'completed';
      entry.currentPhase = null;
      return this._summarize(entry);
    }

    this._runPipeline(entry, nextIdx);
    return this._summarize(entry);
  }

  /**
   * 取消管线
   */
  async cancel(pipelineId, reason = '') {
    const entry = this._get(pipelineId);
    if (!entry) throw new Error(`Pipeline not found: ${pipelineId}`);
    if (['completed', 'cancelled', 'failed'].includes(entry.status)) {
      const err = new Error(`Pipeline already ${entry.status}, cannot cancel`);
      err.status = 409;
      throw err;
    }

    entry.status = 'cancelled';
    entry.currentPhase = null;
    entry.updatedAt = new Date().toISOString();
    return this._summarize(entry);
  }

  /**
   * 获取管线状态
   */
  getStatus(pipelineId) {
    const entry = this._get(pipelineId);
    if (!entry) return null;
    return this._summarize(entry);
  }

  /**
   * 获取 Phase 列表
   */
  getPhases(pipelineId) {
    const entry = this._get(pipelineId);
    if (!entry) return null;
    return { pipeline_id: pipelineId, phases: entry.phases };
  }

  /**
   * 注册 task → pipeline 映射（供回调使用）
   */
  registerTask(taskId, pipelineId, phaseId) {
    this.taskIndex.set(taskId, { pipelineId, phaseId });
  }

  /**
   * 通过 taskId 查找管线
   */
  findByTaskId(taskId) {
    const mapping = this.taskIndex.get(taskId);
    if (!mapping) return null;
    return { ...mapping, entry: this._get(mapping.pipelineId) };
  }

  /**
   * 通过 pipelineId 查找
   */
  _get(pipelineId) {
    return this.pipelines.get(pipelineId);
  }

  /**
   * 生成管线摘要
   */
  _summarize(entry) {
    const completedPhases = entry.phases.filter(p => p.status === 'completed').length;
    const progress = entry.phases.length > 0 ? completedPhases / entry.phases.length : 0;

    return {
      pipeline_id: entry.pipelineId,
      status: entry.status,
      current_phase: entry.currentPhase,
      progress: Math.round(progress * 100) / 100,
      phases: entry.phases,
      created_at: entry.createdAt,
      updated_at: entry.updatedAt,
    };
  }
}
