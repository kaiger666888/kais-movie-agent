---
gsd_state_version: 1.0
milestone: v5.0
milestone_name: Hermes-Native Migration
status: executing
stopped_at: Phase 33 verified — Phase 34 (Review Gate Framework) planned, ready to execute.
last_updated: "2026-06-25T15:45:00.000Z"
last_activity: 2026-06-25 — Phase 33 verified (VERIFICATION.md status=passed, 98 tests). Phase 34 PLAN.md + 4 plans + CONTEXT.md + PATTERNS.md created.
progress:
  total_phases: 9
  completed_phases: 4
  total_plans: 16
  completed_plans: 16
  percent: 44
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-25)

**Core value:** 降级优先的 GPU 任务调度 — 外部服务不可用时系统仍可运行。
**v5.0 focus:** kais-movie-agent 13 步短剧管线整体迁入 hermes-agent 成为原生 skill,彻底清除 openclaw 编排层。

## Current Position

Phase: 34 — Review Gate Framework | Status: Ready to plan | Last activity: 2026-06-25 — Phase 33 verified
Plan: 0/4 (Phase 34 PLAN.md + 34-01..04 + CONTEXT.md + PATTERNS.md ready for execution)
Status: Phase 33 closed (VERIFICATION.md status=passed, 4/4 SC, 98 tests). Phase 34 plan created — ready to execute `/gsd:execute-phase 34`.
Last activity: 2026-06-25 — Phase 33 verified (4/4 SC met, 98/98 pytest pass); Phase 34 plan created (4 plans: gate.py lifecycle, gates.yaml 8 gates, runner_hooks.py delegate_task, tools.py wiring).

**Progress bar:**

```
v5.0: [░░░░░░░░░░░░░░░░░░░░] 0/9 phases (0%)
       31........................39
```

## Performance Metrics

**Velocity (cumulative):**

- v1.0 + v2.0 + v3.0 + v4.0: 9 + 19 + 35 + 12 = 75 plans archived
- v4.0 average: ~5-6 min/plan (reference baseline from Phase 26-30)

**v5.0 By Phase (populates as plans complete):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 31. Plugin Skeleton + Wiring | 3/3 | 21min | 7min |
| 32. Kais-AIGC Backend (Python) | 5/5 | ~50min | 10min |
| 33. Pipeline State & Asset Bus | 4/4 | ~42min | 10.5min |
| 34. Review Gate Framework | 0/4 | - | - |
| 35. Orchestration Skill Skeleton | 0/TBD | - | - |
| 36. Remaining 10 Phases Port | 0/TBD | - | - |
| 37. Canvas Sync Migration | 0/TBD | - | - |
| 38. OpenClaw Decoupling + Docs | 0/TBD | - | - |
| 39. E2E Validation + v5.0 Audit | 0/TBD | - | - |

*v5.0 metrics populate as plans complete*

## Accumulated Context

### Decisions

Decisions logged in PROJECT.md + REQUIREMENTS.md.
v5.0 key decisions (locked 2026-06-25):

- **Skill 位置**: 并入 hermes-agent 仓库 (`hermes-agent/skills/kais-movie-pipeline/`)
- **代码迁移**: 全部 Python 重写(13 phase + lib/* clients),不做 Node subprocess 桥接(避免双运行时维护成本)
- **Canvas 去留**: 保留,迁移到 hermes-agent 内部 event hook,不走 openclaw

v5.0 roadmap decisions:

- **Phase 编号**: 继续 v4.0(Phase 30),v5.0 从 Phase 31 起,不重置
- **Critical path**: 31 → 32 → 35 → 36 → 38 → 39(main spine);33(state)∥ 34(gates)partial parallel after 31;37(canvas)follows 35
- **Phase 31 first (foundation)**: 3 plugin 骨架是 32/33/34 三个交付 phase 的填充目标,不先建骨架则无外壳可填
- **Phase 32 before 35 (backend before skill)**: orchestration skill 需要 4 个 client + asset bus + gate 三者就位才能 wired,GPU-DIRECT 必须先于 HERMES-SKILL
- **Phase 35 vertical slice (p01-p03 only)**: 用前 3 phase 验证 SKILL.md + runner.py + delegate_task + asset bus + gate 全链路打通,再做 Phase 36 剩余 10 phase。降低 risk(全 13 phase 一次 port 失败回退成本高)
- **Phase 36 reference port,非 re-design**: p04-p13 行为对齐 Node.js lib/* V8.6 handler,不重新设计 phase 逻辑
- **Phase 38/39 解耦验证决策点**: OPENCLAW-REMOVE-04 + CANVAS-IN-HERMES-04 E2E 是 v5.0 ship 决策点(类似 v4.0 Phase 30 角色)
- **Phase 33 无显式 REQ**: PipelineStateStore + AssetBus V3 + CreativeHistoryTracker 是 HERMES-SKILL-02/03 的隐式基础(从 v3.0 SCHEMA/B4 能力 porting 衍生),v5.0 REQ 未显式列出

### Pending Todos

- [ ] `/gsd:execute-phase 34` — Execute Phase 34 (Review Gate Framework) — 4 plans ready

### Blockers

None. Phase 33 verified. Phase 34 plan created. Ready to execute.

### Key Risks (v5.0)

1. **Python 重写工作量** — 13 phase + 4 client + state + gate 全 Python 重写,工作量大于 v4.0(5 phase 修复)。Phase 35 vertical slice(p01-p03 only)是风险隔离设计,先验证全链路再 port 剩余 10 phase。
2. **delegate_task approval callback 行为** — GATE-NATIVE-03 的 blocking gate 暂停 runner + webhook callback 驱动 resume,需确认 hermes-agent delegate_task 是否原生支持 approval 协议,不支持则需 adapter。Phase 34 plan 34-03 researches this.
3. **行为对齐验证** — Phase 36 reference port 必须与 Node.js V8.6 行为等价。
4. **openclaw grep 关键词覆盖** — OPENCLAW-REMOVE-01 grep 关键词覆盖需在 Phase 38 plan 时 double check。

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v3.1 | 上游 creative_history lineage retrofit (script→sts→shot) | Deferred | v3.0 roadmap |
| v3.1 | creative_history auto-rerender on script edit | Deferred | v3.0 roadmap |
| v4.1+ | 真实 GPU E2E 验证(产出可播放 master.mp4) | Deferred | v4.0 roadmap (operator 侧) |
| v6.0+ | 多模型 A/B 测试 (Runway/Kling/Sora) | Deferred | v3.0 roadmap |
| v6.0+ | 多平台导出 (抖音/B站/YouTube/快手) | Deferred | v3.0 roadmap |
| v6.0+ | 多语言 dubbing (HeyGen 175+) | Deferred | v3.0 roadmap |
| v6.0+ | 独立 lip sync phase (sync.so / HeyGen) | Deferred | v3.0 roadmap |
| v6.0+ | 分布式多机部署 | Deferred | v2.0 |
| v6.0+ | TypeScript 迁移 / CI/CD pipeline | Deferred | v2.0 |
| v6.0+ | hermes-agent dashboard 内嵌管线可视化 | Deferred | v5.0 PROJECT.md |

## Session Continuity

Last session: 2026-06-25T15:45:00.000Z
Stopped at: Phase 33 verified (VERIFICATION.md status=passed). Phase 34 PLAN.md + 34-01..04 + CONTEXT.md + PATTERNS.md created.
Resume file: None

**Next action:**

```
/gsd:execute-phase 34   # Review Gate Framework — 4 plans ready (gate.py + gates.yaml + runner_hooks.py + tools.py wiring)
```

**Critical context to preserve across sessions:**

- v5.0 phase numbering continues from v4.0 (Phase 30) — starts at Phase 31, do NOT reset
- Phase 31 (Plugin Skeleton) is foundation — 3 plugin 骨架是 32/33/34 填充目标
- Phase 32 before 35 — GPU-DIRECT clients 必须先于 HERMES-SKILL orchestration
- Phase 35 vertical slice (p01-p03 only) — 风险隔离,先验证全链路再 port 剩余
- Phase 36 is reference port — 行为对齐 Node.js lib/* V8.6,非 re-design
- Phase 38/39 是 v5.0 ship 决策点 — 0 openclaw 验证 + openclaw OFF E2E 产出 master.mp4
- Architectural decisions locked 2026-06-25: skill 并入 hermes-agent + 全 Python 重写 + canvas 保留迁 hook
- 不重写已存在资产: movie-experts 15 skill + kais-aigc-platform 微服务栈保持现状
