# Milestones

## v2.0 Pipeline Remediation (Shipped: 2026-06-22)

**Phases completed:** 9 phases (Phase 10-18), 19 plans, 165 tests passing

**Key accomplishments:**
- PHASES 数组与 phaseHandlers 100% 对齐(20/20 V6 handlers)
- HermesClient.VALID_PHASES 与 PHASES 同步,决策闭环解锁
- _getDINOv2Score 接入 GLM-4V 真实打分,删除假数据
- 质量门控删除 80% 兜底,null score 语义
- ShotParallelScheduler 镜头级并行 + runWithRetry 自适应重试
- CompositionEngine 改用 execFile + sanitizePath
- EvaluationCollector.aggregateForEpisode → cost-report.json
- character-generation 真实 L1(20选3) + L2(compositions API)
- 12 个 V6 stub handler 全部真实化(pain-discovery → delivery)
- E2E degraded-mode 全流程跑通(< 5s)
- QUAL-02 hardening 单元测试(12 用例)
- E2E-RUNBOOK.md 文档化真实 GPU 运行流程

**Audit status:** tech_debt (3/4 structural findings closed)
**v3.0 backlog:** W-3 (GLM-4V real API key) + B-1 (real GPU final.mp4)

---

## v1.0 AIGC Integration (Shipped: 2026-05-18)

**Phases completed:** 3 phases, 0 plans, 0 tasks

**Key accomplishments:**
- (none recorded)

---
