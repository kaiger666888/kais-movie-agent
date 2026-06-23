# Phase 16: 成本核算 + 重试预算 - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped)

<domain>

## Phase Boundary

落实 2 个 P1 工业化能力:

1. **单集 GPU 成本核算 (PERF-03)**: `EvaluationCollector` 已存在但只写日志,本 phase 让它聚合产出 `cost-report.json`,包含:
   - 按阶段(task_type)的 GPU 时间总和
   - 单集总 GPU-分钟数
   - 失败任务成本(浪费的 GPU 时间)
   - 按 character/scene 的成本分摊

2. **镜头级失败重试预算 (PERF-04)**: 当前 `max_retries: 1` 写死,改为:
   - 自适应预算: 首次失败 retry=1,连续 2 次失败 retry=2,连续 3 次失败 retry=3
   - 上限 3,超过则跳过该 shot 并标记 `permanent_failure`
   - 重试预算耗尽 → 写入 `failed_shots.json` 供人工介入

</domain>

<decisions>

## Implementation Decisions

### EvaluationCollector 增强

```javascript
// lib/evaluation-collector.js 已存在 record() 方法
// 本 phase 新增 aggregateForEpisode() 方法

class EvaluationCollector {
  // ... existing record() ...
  
  /**
   * 聚合本 episode 所有任务评估,产出成本报告
   */
  async aggregateForEpisode() {
    const records = await this._loadAllRecords();  // 从 evaluation log
    
    const byPhase = {};
    const byTaskType = {};
    let totalGpuSec = 0;
    let totalRetrySec = 0;  // 浪费在 retry 上的时间
    const failedTasks = [];
    
    for (const r of records) {
      const gpuSec = r.gpu_time_sec || 0;
      totalGpuSec += gpuSec;
      
      byPhase[r.phase] = byPhase[r.phase] || { count: 0, gpu_sec: 0, failed: 0 };
      byPhase[r.phase].count++;
      byPhase[r.phase].gpu_sec += gpuSec;
      if (!r.success) byPhase[r.phase].failed++;
      
      byTaskType[r.task_type] = byTaskType[r.task_type] || { count: 0, gpu_sec: 0 };
      byTaskType[r.task_type].count++;
      byTaskType[r.task_type].gpu_sec += gpuSec;
      
      if (r.retry_count > 0) totalRetrySec += gpuSec * r.retry_count;
      if (!r.success) failedTasks.push(r);
    }
    
    const report = {
      episode: this._episodeId,
      generated_at: new Date().toISOString(),
      total_gpu_sec: totalGpuSec,
      total_gpu_minutes: Math.round(totalGpuSec / 60 * 10) / 10,
      total_retry_waste_sec: totalRetrySec,
      by_phase: byPhase,
      by_task_type: byTaskType,
      failed_tasks: failedTasks,
      summary: {
        success_rate: ((records.length - failedTasks.length) / records.length * 100).toFixed(1) + '%',
        cost_per_minute: Math.round(totalGpuSec / 60 * 100) / 100,  // GPU-min per episode-min (rough)
      },
    };
    
    await writeFile(join(this.workdir, 'cost-report.json'), JSON.stringify(report, null, 2));
    return report;
  }
}
```

### delivery handler 实化

`delivery` 是 pipeline 最后阶段,在 quality-report 之后调用 `aggregateForEpisode()`。

```javascript
'delivery': {
  after: async (pipeline, phase, phaseConfig) => {
    const collector = _makeCollector(pipeline);
    const costReport = await collector.aggregateForEpisode();
    
    // 已有的 quality-report 复用 Phase 13 的 quality-gate
    // ... 写 quality-report.json + cost-report.json ...
  },
},
```

### 重试预算自适应

```javascript
// lib/shot-parallel-scheduler.js 新增 runWithRetry() 方法
class ShotParallelScheduler {
  async runWithRetry(shots, taskFn, options = {}) {
    const { maxRetries = 3 } = options;
    const results = new Array(shots.length);
    const retryCounts = new Map();  // shot_id → current retry count
    
    // 第一轮
    let currentShots = shots.slice();
    let attempt = 0;
    
    while (currentShots.length > 0 && attempt <= maxRetries) {
      attempt++;
      const attemptResults = await this.runAll(currentShots, taskFn);
      
      // 分离成功/失败
      const failed = [];
      for (let i = 0; i < currentShots.length; i++) {
        const shot = currentShots[i];
        const result = attemptResults[i];
        if (result?.error || !result?.video_path) {
          const retry = (retryCounts.get(shot.id) || 0) + 1;
          retryCounts.set(shot.id, retry);
          
          if (retry >= maxRetries) {
            // 永久失败
            const idx = shots.indexOf(shot);
            results[idx] = { ...result, permanent_failure: true, retry_count: retry };
            await writeFile(join(this.pipeline.workdir, 'failed_shots.json'), ...);
          } else {
            // 加入下一轮 retry
            failed.push(shot);
            const idx = shots.indexOf(shot);
            results[idx] = { ...result, retrying: true, retry_count: retry };
          }
        } else {
          const idx = shots.indexOf(shot);
          results[idx] = result;
        }
      }
      
      currentShots = failed;
    }
    
    return results;
  }
}
```

### cloud-production handler 用 runWithRetry

```javascript
const results = await scheduler.runWithRetry(shots, async (shot) => {
  // ... Seedance 任务 + waitForTask ...
}, { maxRetries: HERMES_DEFAULTS['cloud-production'].max_retries || 3 });
```

注:Phase 15 已实现 cloud-production 的并行,本 phase 升级为 runWithRetry。同时把 HERMES_DEFAULTS['cloud-production'].max_retries 从 1 改为 3。

### Claude's Discretion

- **Evaluation log format**: EvaluationCollector 已有 log 格式,本 phase 只加 aggregate
- **failed_shots.json**: 供后续人工介入或 v3.0 自动 bad case 库使用
- **测试**: 单元测试 mock EvaluationCollector.record,验证 aggregateForEpisode 输出结构

</decisions>

<code_context>

## Existing Code Insights

### Reusable Assets
- `lib/evaluation-collector.js` — 现有 record() 方法,本 phase 增 aggregateForEpisode()
- `lib/shot-parallel-scheduler.js` — Phase 15 新增,本 phase 增 runWithRetry()
- `lib/phases/index.js` 的 `delivery` handler(Phase 10 stub,本 phase 实化)
- `lib/phases/index.js` 的 `cloud-production` handler(Phase 15 已实化,本 phase 改用 runWithRetry)

### Established Patterns
- EvaluationCollector.record() 已被所有 handler 末尾调用
- ShotParallelScheduler.runAll() 已被 cloud-production/ai-preview/final-production 调用

### Integration Points
- `delivery` handler 末尾调 aggregateForEpisode()
- `cloud-production` handler 改用 runWithRetry()

</code_context>

<specifics>

## Specific Ideas

- **HERMES_DEFAULTS 修改**: `cloud-production.max_retries` 从 1 改为 3
- **cost-report.json 字段**: episode / total_gpu_sec / total_gpu_minutes / by_phase / by_task_type / failed_tasks
- **failed_shots.json 字段**: shot_id / error / retry_count / last_attempt_at
- **不做**: 不实现成本计价(GPU-min → ¥)换算,留给 v3.0 接入财务系统

</specifics>

<deferred>

## Deferred Ideas

- 成本计价(¥/GPU-min)→ v3.0
- 跨 episode 成本对比 → v3.0
- Bad case 库自动构建 → v3.0

</deferred>
