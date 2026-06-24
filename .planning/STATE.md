---
gsd_state_version: 1.0
milestone: v4.0-shipped
milestone_name: Production Pipeline Remediation (shipped)
status: planning
last_updated: "2026-06-24T12:19:24.187Z"
last_activity: 2026-06-24
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-24)

**Core value:** 降级优先的 GPU 任务调度 — 外部服务不可用时系统仍可运行。
**Current focus:** Milestone complete

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-06-24 — Milestone v4.0-shipped started

## Performance Metrics

**Velocity:**

- Total plans completed (cumulative v1.0+v2.0+v3.0): 19+
- v3.0 plans completed: archived
- v2.0 average duration: ~2 min/plan (Phase 10 baseline reference)

**By Phase (v4.0):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 26. Data Spine Repair | 0/TBD | - | - |
| 27. Real Render Path Restoration | 2/2 | 8min avg | 2 tasks/plan, 2 files/plan |
| 28. Cross-System Integrity & Safety | 0/TBD | - | - |
| 29. Composition Tail + Quality Gate | 0/TBD | - | - |
| 30. End-to-End Shipping Verification | 0/TBD | - | - |
| 26 | 2 | - | - |
| 27 | 2 | - | - |
| 28 | 2 | - | - |
| 29 | 3 | - | - |
| 30 | 3 | - | - |

*v4.0 metrics will populate as plans complete*
| Phase 26 P01 | 6min | 2 tasks | 2 files |
| Phase 26 P02 | 4min | 2 tasks | 4 files |
| Phase 27 P01 | 4min | 2 tasks | 2 files |
| Phase 27 P02 | 12min | 2 tasks | 2 files |
| Phase 28 P01 | 3.4min | 2 tasks | 2 files |
| Phase 28 P02 | 4.0min | 2 tasks | 2 files |
| Phase 29 P01 | 6min | 1 task | 2 files |
| Phase 29 P02 | 4min | 1 task | 3 files |
| Phase 29 P03 | 14min | 2 tasks | 3 files |
| Phase 30 P01 | 5min | 1 task | 1 file |
| Phase 30 P02 | 6min | 1 task | 1 file |
| Phase 30 P03 | 3min | 2 tasks | 1 file |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md.
Recent decisions affecting current work:

- **v4.0 Roadmap (2026-06-24):** 5 phases (26-30), derived from 2026-06-23 端到端数据流审计的 9 项沉默失败。数据流依赖链驱动 phase 划分（非按 REQ category）。
- **Phase 26 first (foundation):** PIPE-DATA-01/02 是上游数据 spine 修复，不先修复则下游 composition/渲染测试都没有真实输入。character-generation 拿不到 character 列表 + scene-generation 拿不到 sts 产物 → 必须先修。
- **Phase 29 (composition + gate)决战点:** PIPE-COMPOSE-01/02 + PIPE-GUARD-01 三个 REQ 耦合在一起 — composition 没 handler 则 consistency-guard 的"在 composition 阶段统一判定"无目标，文件名错位则即使 composition 实现也 delivery 失败。三者必须同 ship 或都不 ship。
- **Phase 28 独立 hardening:** PIPE-INTEGRITY-01/02 与渲染/数据流无依赖（canvas 双写 + SQL 注入），可并行或前置。保守排在 26/27 之后便于 review。
- **Phase 30 验收 gate (无新 REQ):** degraded E2E 跑通产出 master.mp4 + 重跑审计 checklist 100% pass + 测试基线 ≥461。是 v4.0 ship 决策点。
- v3.0 关键决策保留: Phase 19 D1 callLLM multimodal 已 shipped; AssetBus V3 / BlacklistEngine / Seedance 2.0 / CreativeHistoryTracker / CrossEpisodeAssetIndex / FineTuneETL 已 shipped。
- [Phase 26]: PIPE-DATA-01 closed: pain-report.json main reader + observable legacy warns (SC#4) — V6 pain-discovery writes pain-report.json (not requirement.json); reader migrated accordingly
- [Phase 26]: PIPE-DATA-02 closed: PHASES reordered so spatio-temporal-script (stageOrder 8) precedes scene-generation (9) precedes scene-selection (10) — scene-generation bus.read('spatio-temporal-script') now finds asset already written; VALID_PHASES synced; 6-test regression suite added; 2 pre-existing hardcoded phase-id lists (v41-integration.test.js, handlers.test.mjs) updated to match
- [Phase 27 P01]: PIPE-RENDER-01 closed: motion-preview submitTask field-case fix (line 1074 task_type→taskType, line 1078 task.task_id→task.taskId) + 4-case regression test; line 1115 (collector schema) intentionally left snake_case per D-PIPE-RENDER-01
- [Phase 27 P02]: PIPE-RENDER-02 closed: jimeng-client marked fallback-only at 3 production call sites (lines 651/2185/2606) with module-level dedup deprecate warn `_warnJimengDeprecate()` (one warn per process); strict degrade path verified at all 3 sites (soul-visual try/catch + character/scene-generation ping gates); `_resetJimengDeprecateFlagForTest()` test-only export added; 5-case regression test; baseline 483/483 pass
- [Phase ?]: Phase 28 P01: canvas saveGraph migrated to HTTP API — PIPE-INTEGRITY-01 closed
- [Phase 28 P02]: PIPE-INTEGRITY-02 closed: repair-canvas CLI assertPositiveInt (/^\d+$/ + Number.isInteger defense-in-depth) on --projectId/--episodesId; named-value stderr + exit 1; 6-case spawnSync regression (normal/negative/string/injection `1; DROP TABLE x`/float 5.5/episodesId-symmetric); baseline 487→493
- [Phase 29 P01]: PIPE-COMPOSE-01 (handler slice) closed: composition handler writes master.mp4 (not final.mp4) + sibling web-preview.mp4 (854px H.264 -an transcode, best-effort) + 0-byte degraded placeholders when compose throws or returns {output:null}; 4-case regression test (2 ffmpeg-gated success + 2 unconditional degraded); compose() returns null-output-not-throw deviation auto-fixed (Rule 2); full PIPE-COMPOSE-01 closure pending Plan 02 (bin/pipeline.js invocation + delivery filename alignment)
- [Phase 29 P02]: PIPE-COMPOSE-02 closed: delivery handler now checks master.mp4 (not final.mp4) + degrade-tolerant web-preview.mp4 check (warn-not-fail, non-blocking) + top-level _composition.delivered_mastermp4 + delivered_webpreview operator markers in quality-report.json; 4-case regression test; _hermesAudit + return metrics renamed (master_mp4_status + web_preview_status); pre-existing handlers.test.mjs delivery assertion updated (Rule 1, final_mp4 -> master_mp4); baseline 29/29 preserved
- [Phase 29 P03]: PIPE-GUARD-01 closed: consistency-guard audit fail now throws Error (propagates to Pipeline.run → episode marked failed, no more silent warn-and-continue) + writes consistency-blocked.json with _consistencyBlocked: true + console.error (not console.warn); hermesAudit + collector.record reordered to run BEFORE throw so telemetry captures failures; dead code deleted (lib/gate-constraints.js 418 lines + lib/invariant-bus.js 329 lines, zero external imports confirmed); 4-case regression test (fetch-mock forces below-threshold LLM scores since auditContinuity treats null-scored dims as pass); baseline 455/455 phase tests pass
- [Phase 30 P01]: SC#1 verified — degraded E2E test (test/e2e/degraded-shipping.test.mjs) runs all 20 stages in 10.3s, asserts master.mp4 produced + _composition.delivered_mastermp4 marker. Rule 3 deviation: plan's bin/pipeline.js --to subprocess interface did not match codebase (no --to flag; degraded mode is config-driven); test constructs Pipeline directly with v2.0 degraded pattern. npm baseline 508 preserved; e2e suite 7 -> 10.
- [Phase 30 P02]: SC#2 verified — 9-finding audit regression suite (test/audit-v4-acceptance.test.mjs) automates the 2026-06-23 audit closure checklist as 9 strict test() blocks (F1-F9). Brace-depth slicer isolates phase handler bodies (T-30-04 mitigation). RED spot-check (revert F3 taskType → task_type) confirmed test catches regression. npm baseline 508 → 517 (+9 audit tests, 0 regressions). Rule 1 deviation: F2 assertion refined from "count of final.mp4 === 0" to "no string-literal path reference" — comment mentions documenting the fix are allowed; only path literals flowing to join/existsSync count.
- [Phase 30 P03]: SC#4 verified — docs/E2E-RUNBOOK.md updated (324 → 478 lines) with §0 "Shipping master.mp4 — Two Paths": Path A (degraded, config-driven per 30-01 finding, CI-verifiable via test/e2e/degraded-shipping.test.mjs) + Path B (real GPU, OPERATOR-DEFERRED per v4.0 roadmap, prerequisites enumerated from lib/ process.env grep) + Ship-Readiness Gate (npm test + audit-v4-acceptance + degraded E2E) + 9-finding audit matrix. Zero stale refs to deleted gate-constraints.js/invariant-bus.js. v4.0 milestone complete (12/12 plans, 100%).

### Pending Todos

- [ ] `/gsd:plan-phase 26` — Phase 26 plan + execute (Data Spine Repair)
- [ ] **Operator: 补 45 对真实 golden set pair + 首次 baseline 运行 (v3.0 Phase 19 D1-03 deferred — 仍 carry-forward)**
- [ ] Operator consultation needed before any Seedance 2.0 audio real-API work (v3.1)
- [ ] 50+50 pair labeled eval set construction for DINOv2 threshold calibration (v3.1)

### Blockers

None. Phase 30 complete — all 4 SCs verified. v4.0 milestone ready for ship decision.

### Key Risks (v4.0)

1. **PIPE-RENDER-02 jimeng 迁移工作量未知** — 如果 dreamina CLI 迁移成本大，Phase 27 SC#3 允许"显式标注 fallback-only"快速路径。先 plan 时确认 dreamina CLI 现状再选路径。
2. **PIPE-DATA-01 修复路径未知** — 恢复 requirement.json 写入 vs 从 pain-report.json 读，需在 Phase 26 plan 时确认哪个对 V6 数据流更自然。
3. **PIPE-COMPOSE-01 真实渲染 vs degraded 模式** — composition handler 在 degraded 模式产出占位 mp4，真实 GPU 模式产出真实 mp4。真实 GPU 验证 operator 侧（out of scope），degraded 路径必须在 Phase 30 SC#1 可验证。
4. **canvasGraph 写入路径统一方案未定** — Phase 28 需确认是统一走 kais-aigc-platform HTTP API 还是统一走本地 sqlite3（前者更安全但需平台 API 契约）。

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v3.1 | 上游 creative_history lineage retrofit (script→sts→shot) | Deferred | v3.0 roadmap |
| v3.1 | creative_history auto-rerender on script edit | Deferred | v3.0 roadmap |
| v3.1 | 预算告警 + 阻断逻辑 | Deferred | v3.0 roadmap |
| v4.1+ | 真实 GPU E2E 验证(产出可播放 final.mp4) | Deferred | v4.0 roadmap (operator 侧) |
| v4.1+ | 多模型 A/B 测试 (Runway/Kling/Sora) | Deferred | v3.0 roadmap |
| v4.1+ | 多平台导出 (抖音/B站/YouTube/快手) | Deferred | v3.0 roadmap |
| v4.1+ | 多语言 dubbing (HeyGen 175+) | Deferred | v3.0 roadmap |
| v4.1+ | 分布式多机部署 | Deferred | v2.0 |
| v4.1+ | TypeScript 迁移 / CI/CD pipeline | Deferred | v2.0 |

## Session Continuity

Last session: 2026-06-24T12:05:00.000Z
Stopped at: Phase 30 Plan 03 complete — E2E-RUNBOOK.md updated with v4.0 two-path shipping procedure (degraded + real GPU). SC#4 verified. Phase 30 (all 3 plans) complete — v4.0 milestone ready for ship decision.
Resume file: None

**Next action:**

```
v4.0 milestone complete (12/12 plans, 100%). Ship decision: run Ship-Readiness Gate
(npm test ≥461 + node --test test/audit-v4-acceptance.test.mjs + node --test test/e2e/degraded-shipping.test.mjs)
then tag per docs/E2E-RUNBOOK.md §0 Ship-Readiness Gate.
```

**Critical context to preserve across sessions:**

- Phase 26 (Data Spine) is foundation — PIPE-DATA-01/02 必须先于 27/29，否则下游测试无真实输入
- Phase 29 (Composition + Gate) 是 v4.0 决战点 — 三个耦合 REQ 必须 ship together
- Phase 28 独立 hardening — canvas 双写 + SQL 注入，无渲染/数据流依赖
- Phase 30 验收 gate — degraded E2E 产出 master.mp4 + 审计 checklist 100% pass
- v4.0 不重置 phase 编号 — 继续 v3.0 的 25，从 26 起
- 9 项审计点来自 2026-06-23 memory: project_pipeline-audit_2026-06-23.md
