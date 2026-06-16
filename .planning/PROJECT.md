---
impl_targets_design: design-2026-06-16-prfp
v8_baseline_ref: 734dc71c9d5ff20d55dbd0255f367030962cf329
v8_deprecated_at: 2026-06-17
hermes_agent_baseline_ref: 85965c393f44deae29a833f2ae98af66d26548ce
---

# kais-movie-agent 集成开发

## What This Is
movie-agent 的 AIGC 集成层 — 将 gold-team GPU 调度和 review-platform 审核平台连接到电影制作流水线,实现 GPU 密集型任务(TTS、Blender、FLUX 图像、视频生成)的远程调度和人工审核工作流。

v2.0 起扩展为 **基于 hermes-agent v2.0 PRFP 设计的 16-pipeline-role DAG 实现** —— 从 V8 的 20-step linear pipeline 迁移到 hybrid topology(root + parallel intent + visual chain + audio/post parallel + final gates + consultative vertical)。

## Core Value
降级优先的 GPU 任务调度 — 外部服务不可用时系统仍可运行。

v2.0 起:**对齐 hermes-agent v2.0 PRFP 设计的 16 节点 DAG**,实现跨节点 invariant ownership + 显式 critic pairing + theory_critic consultative edge,以提升短剧/微电影输出的 narrative coherence + cross-shot identity + emotional arc 质量。

## Requirements

### Validated
- ✓ GoldTeamClient GPU 任务调度 — v1.0
- ✓ ReviewClient 降级逻辑 — v1.0
- ✓ Voice Phase GoldTeam 集成 — v1.0
- ✓ 多候选审核调用 — v1.0
- ✓ V4.1 引擎对接 (13 函数: FLUX/VIDEO/VOICE/MUSIC/SFX/LIP_SYNC) — v1.0

### Active

<!-- v2.0 in planning — DAG Migration. See REQUIREMENTS.md. -->

Milestone **v2.0 — V8 → v2.0 PRFP DAG Migration** is being scoped. Requirements defined via /gsd:new-milestone; see `.planning/REQUIREMENTS.md`.

### Deferred to operator (acknowledged at v2.0 close)
- live statistical GO/NO-GO(需 hermes-agent v3.0 skills 完成 + 实际 budget)
- 跨 repo ADR 治理流程(需 hermes-agent + kais-movie-agent 双方 sign-off 协调)
- production execution node(超 v2.0 范围)

### Out of Scope
- 非 Node.js 运行时支持
- 非 GPU 任务类型
- hermes-agent/skills/movie-experts/ 任何编辑(由 hermes-agent v3.0 milestone 负责)
- 设计文档修改(v2.0 PRFP 设计 frozen-pending-impl;只在 impl 团队 challenge 时通过 cross-repo ADR 修订)

## Principles
- 零 npm 依赖 — 使用原生 fetch + Node.js 内置模块
- 所有客户端跟随现有 ES module 模式 (export class)
- 降级优先 — 外部服务不可用时系统仍可运行
- HMAC-SHA256 回调签名验证
- 参考 INTEGRATION.md 契约层规范
- **v2.0 新增:** capability-spec canonical;模型名只在 dated annex(per NODE-08 + PITFALLS §1.3)
- **v2.0 新增:** 每 generation 节点配 critic(per Phase 7 §3.2 D2.5 + NODE-09)
- **v2.0 新增:** theory_critic consultative 垂直边,非 linear blocking gate(META-06 + AF-12)

## Context
Shipped v1.0 with 6,742 LOC in lib/, 103 files changed.
Tech stack: Node.js ES modules, native fetch, HMAC-SHA256.
9 phases, 13 V4.1 engine functions, full degradation coverage.

**v1.0 deferred to v2.0:**
- V8 → v2.0 PRFP DAG 拓扑迁移(per hermes-agent `.planning/research/v2-pipeline-design/kais-migration-matrix.yaml`)
- 16 pipeline-roles 实施(15 linear + 1 consultative)
- Cross-repo handoff execution(per hermes-agent `.planning/research/v2-pipeline-design/07-HANDOFF-PLAN.md`)

**Baseline references (per HANDOFF-04):**
- `kais_movie_agent_baseline_ref: 734dc71c9d5ff20d55dbd0255f367030962cf329` (this repo, at v2.0 design time)
- `hermes_agent_baseline_ref: 85965c393f44deae29a833f2ae98af66d26548ce` (hermes-agent, at v2.0 PRFP design ship)

**Known risks(进入 v2.0 仍需关注):**
- ⚠ Design-impl drift — hermes-agent v2.0 PRFP 设计 frozen-pending-impl;baseline_ref 修订需 cross-repo ADR
- ⚠ Capability-spec 漂移 — v2.0 设计要求模型名只在 dated annex;v1 V8 hard-coded Sora/Kling/Veo 必须清理
- ⚠ V8 → v2.0 拓扑迁移风险 — V8 20-step → v2.0 16-role 是大重构;wrapper-first 策略(Phase 10)降低风险

## Current Milestone: v2.0 — V8 → v2.0 PRFP DAG Migration

**Goal:** 把 V8 20-step linear pipeline 迁移到 hermes-agent v2.0 PRFP 设计的 16-pipeline-role DAG(15 linear + 1 consultative theory_critic),实施 `kais-migration-matrix.yaml` 锁定的 4-phase migration plan,在不破坏 V8 现有功能的前提下提升 narrative coherence + cross-shot identity + emotional arc 质量。

**Target features(本次里程碑执行 v2.0 PRFP 设计决策):**

1. **Topology wrapper(Phase 10)** — 不重写 V8,加 wrapper 层暴露新 16 节点 API。`lib/v2_topology/` 新目录;`lib/pipeline.js` V8 保留作为 fallback。
2. **Per-node agents migration(Phase 11-12)** — 重构 `lib/agents/` 从 V8 step-mapping 到 v2.0 node-mapping。分两批:Layer 0-3(root + intent + visual)+ Layer 4-6(audio + post + gates)。
3. **V8 legacy removal(Phase 13)** — v2.0 拓扑稳定后,deprecate V8 step dispatch + sketch-then-render 两阶段 + OpenClaw 唯一 LLM 编排 + Toonflow review。
4. **LLM-creative wiring(Phase 14)** — 实施 hermes-agent Phase 10 设计的 consistency_context + novelty_constraint + logic-critic 扩展(per `04-LLM-CREATIVE-DISTILLATION.md`)。

**Key context:**

- **Source-of-truth:** hermes-agent `.planning/research/v2-pipeline-design/` 全部 18 个设计文档 + `kais-migration-matrix.yaml`
- **Per HANDOFF-05 ownership matrix:** 本里程碑是 **implementation layer** owner(kais-movie-agent);co-owned DAG 修改需与 hermes-agent team sign-off
- **Wrapper-first 策略:** Phase 10 wrapper 暴露新 API 不破坏 V8;Phase 11-12 渐进迁移;Phase 13 cleanup
- **capability-spec canonical:** v2.0 设计要求 capability-spec layer 规范化(`nodes.yaml` 是 source of truth);模型名只在 dated annex(`02-NODE-SPECS.md §2.17`),不在 node spec 主体硬编码
- **Backward compatibility:** V8 baseline `734dc71c9d` 保留作为 fallback;wrapper 期间 V8 + v2.0 可并行运行
- **范围严格收口:** 仅 kais-movie-agent `lib/`;hermes-agent skills 是 parallel milestone(在该 repo)
- **Live validation deferred:** FUTURE-08 live run 需要 hermes-agent v3.0 完成 + budget;v2.0 只做静态实施

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-16 — started milestone v2.0 (V8 → v2.0 PRFP DAG Migration) via /gsd-new-milestone*
