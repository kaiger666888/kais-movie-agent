# Phase 16 Verification: 成本核算 + 重试预算

**Status:** passed
**Verified:** 2026-06-22
**Verifier:** Claude Code executor (auto)

## Verification Scope

Phase 16 落实 PERF-03 (单集 GPU 成本核算) 和 PERF-04 (镜头级失败重试预算)。验证以下契约:

1. EvaluationCollector.aggregateForEpisode 产出 cost-report.json
2. ShotParallelScheduler.runWithRetry 重试到 maxRetries 后标记 permanent_failure
3. delivery handler 写入 quality-report.json + cost-report.json
4. cloud-production handler 使用 runWithRetry 而非 runAll
5. HERMES_DEFAULTS['cloud-production'].max_retries = 3
6. 所有现有测试 (126 baseline) 仍通过

## Verification Steps

### Step 1: Unit tests — EvaluationCollector.aggregateForEpisode

Command:
```bash
node --test test/phases/evaluation-collector.test.mjs
```

Result:
```
ℹ tests 6
ℹ pass 6
ℹ fail 0
```

Coverage:
- 空记录返回合法结构 (success_rate='0.0%')
- 混合成功/失败正确聚合 by_phase / by_task_type
- retry_count × gpu_time_sec 累计 retry waste
- 多次调用产出相同数值 (幂等)
- cost-report.json 落盘到 workdir 根目录
- 不传 opts 时 episode=null (向后兼容)

### Step 2: Unit tests — ShotParallelScheduler.runWithRetry

Command:
```bash
node --test test/phases/shot-parallel-scheduler.test.mjs
```

Result:
```
ℹ tests 17
ℹ pass 17
ℹ fail 0
```

Coverage:
- 全部 shot 首次成功 → 只跑 1 轮,无重试
- 第 2 次尝试成功 → retry 通过
- maxRetries=3 时连续失败 3 次 → permanent_failure + failed_shots.json 落盘
- 混合 batch: 部分 retry 成功,1 个永久失败
- 空 shots 立即返回
- 入参校验 (shots / taskFn)
- 默认 maxRetries=3
- 索引对齐 (含 retry 场景)
- collectPermanentFailures 静态工具

### Step 3: Integration tests — delivery + cloud-production

Command:
```bash
node --test test/phases/cloud-production.test.mjs
node --test test/phases/handlers.test.mjs
```

Result:
```
cloud-production: 4/4 pass
handlers: 27/27 pass (含 3 个新增 Phase 16 测试)
```

Coverage:
- delivery handler 同时产出 quality-report.json + cost-report.json
- delivery handler 在有 records 时 cost-report 反映聚合数据 (total_gpu_sec, success_rate)
- HERMES_DEFAULTS['cloud-production'].max_retries = 3 (源码静态断言)
- cloud-production handler 在 retry 升级后仍兼容现有 4 个测试

### Step 4: Full test suite

Command:
```bash
npm test
```

Result:
```
ℹ tests 144
ℹ suites 53
ℹ pass 144
ℹ fail 0
ℹ duration_ms ~2200
```

Baseline (Phase 15 完成): 126 tests, 50 suites
Phase 16 完成: 144 tests, 53 suites (+18 tests, +3 suites)
回归: 0 (所有原 126 tests 全部通过)

### Step 5: 文件产出契约 (静态检查)

| 产出 | 路径 | 触发 |
| ---- | ---- | ---- |
| cost-report.json | `{workdir}/cost-report.json` | delivery handler 调 aggregateForEpisode() |
| failed_shots.json | `{workdir}/failed_shots.json` | runWithRetry 出现 permanent_failure 时 |
| video_tasks.json (升级) | `{workdir}/video_tasks.json` | cloud-production handler, 含 `permanent_failures` + `max_retries` |
| quality-report.json (升级) | `{workdir}/quality-report.json` | delivery handler, metrics 增加 `cost_report_written` |

### Step 6: 幂等性检查

- `aggregateForEpisode()` 多次调用产生相同 total_records / total_gpu_sec (test 4 验证)
- `runWithRetry` 在已有 failed_shots.json 时会覆盖 (不追加)
- delivery handler 多次调用重新写 cost-report.json (不追加)

## Success Criteria

| Criterion | Status |
| --------- | ------ |
| EvaluationCollector.aggregateForEpisode 实现并产出 cost-report.json | ✅ |
| ShotParallelScheduler.runWithRetry 实现,失败重试至 maxRetries | ✅ |
| delivery handler 调用 aggregateForEpisode 写 cost-report.json | ✅ |
| cloud-production 使用 runWithRetry 替代 runAll | ✅ |
| HERMES_DEFAULTS['cloud-production'].max_retries: 1 → 3 | ✅ |
| failed_shots.json 在 permanent_failure 时写入 | ✅ |
| aggregateForEpisode 幂等 | ✅ |
| cost aggregation 数学正确 (by_phase, by_task_type, retry waste) | ✅ |
| retry exhaustion → permanent_failure marking | ✅ |
| npm test 100% 通过 (126 baseline + 新增,无回归) | ✅ |

## Conclusion

Phase 16 全部 8 个 critical_constraints 通过验证,3 个 commits 全部 land 到 main,18 个新增单元测试覆盖 cost aggregation / retry budget / delivery handler 实化。无回归 (126 → 144 tests, 0 fail)。

**Status:** passed
