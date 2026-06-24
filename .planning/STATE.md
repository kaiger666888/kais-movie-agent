---
gsd_state_version: 1.0
milestone: v4.0
milestone_name: Production Pipeline Remediation
status: planning
last_updated: "2026-06-24T03:05:00.000Z"
last_activity: 2026-06-24
progress:
  total_phases: 5
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-24)

**Core value:** 降级优先的 GPU 任务调度 — 外部服务不可用时系统仍可运行。
**Current focus:** v4.0 Production Pipeline Remediation — Phase 26 Data Spine Repair (first v4.0 phase)

## Current Position

Phase: 26 of 30 (Data Spine Repair) — ready to plan
Plan: —
Status: Roadmap defined, ready for `/gsd:plan-phase 26`
Last activity: 2026-06-24 — v4.0 Roadmap created (Phases 26-30, 9 REQs mapped, 100% coverage)

Progress: [░░░░░░░░░░] 0% (0/5 phases)

## Performance Metrics

**Velocity:**
- Total plans completed (cumulative v1.0+v2.0+v3.0): 19+
- v3.0 plans completed: archived
- v2.0 average duration: ~2 min/plan (Phase 10 baseline reference)

**By Phase (v4.0):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 26. Data Spine Repair | 0/TBD | - | - |
| 27. Real Render Path Restoration | 0/TBD | - | - |
| 28. Cross-System Integrity & Safety | 0/TBD | - | - |
| 29. Composition Tail + Quality Gate | 0/TBD | - | - |
| 30. End-to-End Shipping Verification | 0/TBD | - | - |

*v4.0 metrics will populate as plans complete*

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

### Pending Todos

- [ ] `/gsd:plan-phase 26` — Phase 26 plan + execute (Data Spine Repair)
- [ ] **Operator: 补 45 对真实 golden set pair + 首次 baseline 运行 (v3.0 Phase 19 D1-03 deferred — 仍 carry-forward)**
- [ ] Operator consultation needed before any Seedance 2.0 audio real-API work (v3.1)
- [ ] 50+50 pair labeled eval set construction for DINOv2 threshold calibration (v3.1)

### Blockers

None. v4.0 roadmap defined, ready for Phase 26 planning.

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

Last session: 2026-06-24 — v4.0 Roadmap created (Phases 26-30, 9 REQs mapped, 100% coverage).
Stopped at: Roadmap complete, ready for Phase 26 planning.
Resume file: `.planning/ROADMAP.md`

**Next action:**

```
/gsd:plan-phase 26
```

**Critical context to preserve across sessions:**

- Phase 26 (Data Spine) is foundation — PIPE-DATA-01/02 必须先于 27/29，否则下游测试无真实输入
- Phase 29 (Composition + Gate) 是 v4.0 决战点 — 三个耦合 REQ 必须 ship together
- Phase 28 独立 hardening — canvas 双写 + SQL 注入，无渲染/数据流依赖
- Phase 30 验收 gate — degraded E2E 产出 master.mp4 + 审计 checklist 100% pass
- v4.0 不重置 phase 编号 — 继续 v3.0 的 25，从 26 起
- 9 项审计点来自 2026-06-23 memory: project_pipeline-audit_2026-06-23.md
