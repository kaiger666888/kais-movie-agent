---
phase: 16
plan: cost-retry
subsystem: infrastructure
tags: [cost-accounting, retry-budget, gpu, scheduler, evaluation]
requires:
  - phase-15 (ShotParallelScheduler.runAll baseline)
  - phase-10 (delivery stub)
provides:
  - EvaluationCollector.aggregateForEpisode
  - cost-report.json (单集成本核算产出)
  - ShotParallelScheduler.runWithRetry
  - failed_shots.json (永久失败镜头清单)
  - delivery handler real implementation (cost-report 写入)
  - cloud-production retry budget (maxRetries=3)
affects:
  - lib/evaluation-collector.js
  - lib/shot-parallel-scheduler.js
  - lib/phases/index.js (delivery + cloud-production handlers, HERMES_DEFAULTS)
tech-stack:
  added: []
  patterns:
    - idempotent cost aggregation (overwrites cost-report.json)
    - per-shot retry budget with permanent_failure marking
key-files:
  created:
    - test/phases/evaluation-collector.test.mjs
  modified:
    - lib/evaluation-collector.js
    - lib/shot-parallel-scheduler.js
    - lib/phases/index.js
    - test/phases/shot-parallel-scheduler.test.mjs
    - test/phases/handlers.test.mjs
decisions:
  - "EvaluationCollector 构造函数增 episodeId opts 参数 (向后兼容)"
  - "retry waste = gpu_time × retry_count (而非 retry_count 之和)"
  - "permanent_failure threshold = maxRetries (非 maxRetries+1)"
  - "delivery 仍保留 _stub: true (完整实化留给 phase-13)"
  - "cost-report.json 写在 workdir 根目录 (非 .pipeline-assets/)"
metrics:
  duration: ~25min
  completed: 2026-06-22
  task-count: 4
  file-count: 5
---

# Phase 16 Plan cost-retry: 成本核算 + 重试预算 Summary

落实 PERF-03 (单集 GPU 成本核算) 和 PERF-04 (镜头级失败重试预算) 两个工业化能力,通过扩展 EvaluationCollector 与 ShotParallelScheduler 实现。

## What Was Built

### 1. EvaluationCollector.aggregateForEpisode (PERF-03)
新增方法 `aggregateForEpisode()` 在 `lib/evaluation-collector.js`:
- 读取 `.pipeline-assets/evaluations.json` 全量记录
- 按 `phase` / `task_type` 双维度聚合 GPU 时间
- 计算 `total_gpu_sec` / `total_gpu_minutes` / `total_retry_waste_sec`
- 失败任务入 `failed_tasks` 数组
- 写幂等的 `{workdir}/cost-report.json`
- 构造函数新增 `episodeId` opts (向后兼容,旧调用 `new EvaluationCollector(workdir)` 仍工作)

### 2. ShotParallelScheduler.runWithRetry (PERF-04)
新增方法 `runWithRetry(shots, taskFn, { maxRetries=3 })` 在 `lib/shot-parallel-scheduler.js`:
- 第 1 轮全量跑 runAll,失败的进下一轮
- 每轮仅重跑上次失败的 shots (不重跑已成功的)
- 单 shot 累计尝试达 maxRetries 仍失败 → 标记 `permanent_failure: true`
- 永久失败写入 `{workdir}/failed_shots.json` 供人工介入 / v3.0 bad case 库
- 失败判定: taskFn throw OR `result._failed` OR `result.error` OR `result.video_path` falsy
- 结果数组按原 shots 索引严格对齐 (即使部分被 retry)
- 静态工具 `collectPermanentFailures(results)` 过滤永久失败

### 3. delivery handler 实化 (替换 Phase 10 stub)
`lib/phases/index.js` 的 `delivery` handler:
- 保留 quality-report.json 写入 (Phase 10 已有,仍为 stub,完整实化推迟到 phase-13)
- 新增 `aggregateForEpisode()` 调用,自动产出 `cost-report.json`
- metrics 增加 `quality_report_written` / `cost_report_written` / `cost_total_records`

### 4. cloud-production handler 用 runWithRetry
`lib/phases/index.js` 的 `cloud-production` handler:
- 从 `scheduler.runAll(...)` 升级为 `scheduler.runWithRetry(..., { maxRetries })`
- `maxRetries` 从 `HERMES_DEFAULTS['cloud-production'].max_retries` 读取 (新值 3)
- video_tasks.json 新增 `permanent_failures` / `max_retries` 字段
- metrics 新增 `permanent_failed` / `max_retries`

### 5. HERMES_DEFAULTS 升级
`lib/phases/index.js` 第 99 行:
- `cloud-production.max_retries: 1 → 3` (Phase 16 PERF-04 自适应预算基础)

## Commits

| Hash | Description |
| ---- | ----------- |
| `3496143` | feat(16-cost-retry): add EvaluationCollector.aggregateForEpisode + cost-report.json |
| `9c820ec` | feat(16-cost-retry): add ShotParallelScheduler.runWithRetry + failed_shots.json |
| `4a0d7d4` | feat(16-cost-retry): real delivery handler + cloud-production retry + HERMES_DEFAULTS upgrade |

## Test Results

- 基线: 126 tests / 50 suites / 全部通过
- 完成: 144 tests / 53 suites / 全部通过 (+18 新增)
- 新增测试覆盖:
  - `test/phases/evaluation-collector.test.mjs` (6 tests): empty/mixed/retry-waste/idempotent/disk-write/back-compat
  - `test/phases/shot-parallel-scheduler.test.mjs` (+9 tests): first-success / retry-success / permanent-failure / partial-batch / empty / validation / default-maxRetries / index-alignment / collectPermanentFailures
  - `test/phases/handlers.test.mjs` (+3 tests): delivery dual-report / cost-aggregation / HERMES_DEFAULTS source assertion
- `npm test` 通过率: 100% (144/144)

## cost-report.json 字段示例

```json
{
  "episode": "EP01",
  "workdir": "/data/projects/my-movie",
  "generated_at": "2026-06-22T12:34:56.789Z",
  "total_records": 15,
  "total_gpu_sec": 1250.5,
  "total_gpu_minutes": 20.8,
  "total_retry_waste_sec": 240.0,
  "by_phase": {
    "cloud-production": { "count": 8, "gpu_sec": 1000.0, "failed": 1 },
    "ai-preview": { "count": 7, "gpu_sec": 250.5, "failed": 0 }
  },
  "by_task_type": {
    "video_final": { "count": 8, "gpu_sec": 1000.0 },
    "preview_render": { "count": 7, "gpu_sec": 250.5 }
  },
  "failed_tasks": [ /* Evaluation[] */ ],
  "summary": {
    "success_rate": "93.3%",
    "failed_count": 1,
    "cost_per_minute": 20.84
  }
}
```

## failed_shots.json 字段示例

```json
{
  "_generatedAt": "2026-06-22T12:34:56.789Z",
  "_phase": "cloud-production",
  "count": 1,
  "failures": [
    {
      "shot_id": "shot-013",
      "error": "GPU OOM",
      "retry_count": 3,
      "last_attempt_at": "2026-06-22T12:34:50Z",
      "task_id": "task-xxx"
    }
  ]
}
```

## Deviations from Plan

### Minor Adjustments (auto-handled, Rule 2/3)

**1. [Rule 2 - Missing Functionality] EvaluationCollector 构造函数 episodeId 注入**
- **Found during:** Commit 1
- **Issue:** CONTEXT.md 示例代码用 `this._episodeId` 但原构造函数只接 `workdir`,无 episode 概念
- **Fix:** 给 `EvaluationCollector` 构造函数加 `opts.episodeId` 参数 (向后兼容,旧调用零影响),并在 `_makeCollector` 工厂中注入 `pipeline.episode`
- **Files modified:** lib/evaluation-collector.js, lib/phases/index.js
- **Commit:** 3496143

**2. [Rule 3 - Blocking Issue] delivery 测试 _stub:true 向后兼容**
- **Found during:** Commit 3
- **Issue:** 现有 `handlers.test.mjs` 断言 `quality-report.json` 顶层有 `_stub: true` (第 179-189 行),实化 delivery 时若移除该字段会破坏测试
- **Fix:** 保留 `_stub: true` 在 quality-report.json 顶层 (语义正确 — 完整实化确实推迟到 phase-13)
- **Files modified:** lib/phases/index.js
- **Commit:** 4a0d7d4

**3. [Rule 1 - Bug] cloud-production 测试兼容性**
- **Found during:** Commit 3
- **Issue:** 现有 `cloud-production.test.mjs` 第 4 个测试 (shot-B submitTask 抛错) 在 runWithRetry 下会重试 3 次而非 1 次,可能改变 metrics.failed 断言
- **Fix:** 验证后断言仍成立 (failed=1, completed=2, failed_shots.length=1 — 因 shot-B 仍最终失败一次)
- **Files modified:** 无 (验证通过,无需改测试)
- **Commit:** 4a0d7d4

### Authentication Gates

None. delivery handler 的 `assessQuality()` 会调 LLM API (需 token),但在测试环境 token 过期时 (401) handler 走降级路径 (`console.warn`) 写出 quality-report,不影响 cost-report.json 落盘契约 — 这是已记录的降级行为,非阻塞。

## Known Stubs

| File | Stub Reason | Future Plan |
| ---- | ----------- | ----------- |
| `quality-report.json` (delivery handler) | `_stub: true` + `_pendingRealImplementation: 'phase-13'` — 完整质量门控推迟到 phase-13 | Phase 13 (quality-gate) |
| `final-audio` handler | `_pendingRealImplementation: 'phase-15'` (遗留 stub) | Phase 15 (final-audio) — 不在本 phase 范围 |

注: `cost-report.json` (Phase 16 新增产出) **非 stub** — 完整实化,可直接消费。

## Threat Flags

无新增安全相关 surface。`aggregateForEpisode` 只读 evaluation log (本地 JSON),`runWithRetry` 只调度本地 taskFn。`failed_shots.json` 只写入 workdir 根目录,无网络外发。

## Self-Check: PASSED

- lib/evaluation-collector.js — FOUND (含 `aggregateForEpisode` 方法)
- lib/shot-parallel-scheduler.js — FOUND (含 `runWithRetry` 方法)
- lib/phases/index.js — FOUND (delivery 实化 + cloud-production runWithRetry + max_retries: 3)
- test/phases/evaluation-collector.test.mjs — FOUND (6 tests pass)
- test/phases/shot-parallel-scheduler.test.mjs — FOUND (17 tests pass)
- test/phases/handlers.test.mjs — FOUND (27 tests pass, 含 3 个新增 Phase 16 测试)
- Commit 3496143 — FOUND in git log
- Commit 9c820ec — FOUND in git log
- Commit 4a0d7d4 — FOUND in git log
- `npm test` 144/144 pass — VERIFIED
