# Requirements: kais-movie-agent — Milestone v2.0 V8 → v2.0 PRFP DAG Migration

**Defined:** 2026-06-16
**Core Value:** 把 V8 20-step linear pipeline 迁移到 hermes-agent v2.0 PRFP 设计的 16-pipeline-role DAG,实施 `kais-migration-matrix.yaml` 锁定的 4-phase migration plan,在不破坏 V8 现有功能的前提下提升 narrative coherence + cross-shot identity + emotional arc 质量。

> **Scope reminder:** 本次里程碑执行 hermes-agent v2.0 PRFP 设计的 impl 层决策(per HANDOFF-05 ownership matrix),仅修改 `lib/`。hermes-agent `skills/movie-experts/` 是 parallel milestone(在该 repo)。

---

## v2.0 Requirements

### WRAP — Topology Wrapper(2 reqs)

- [ ] **WRAP-01**: 新增 `lib/v2_topology/` 目录,暴露 16 节点 API(15 linear + 1 consultative theory_critic)。每节点对应 hermes-agent `nodes.yaml` 的 id(`creative_source` / `style_genome` / `screenplay` / ... / `theory_critic`)。Wrapper 不重写 V8,只暴露新 API 调用 V8 现有 lib/agents/ 实现(transparent pass-through)。
- [ ] **WRAP-02**: `lib/pipeline.js` 保留 V8 实现作为 fallback;新增 `lib/v2_pipeline.js` 作为 v2.0 入口。环境变量 `KAI_PIPELINE_MODE=v8|v2|parallel` 控制模式。`parallel` 模式下 V8 + v2 同时运行,产出 diff 用于 A/B 验证。

### MIGRATE — Per-Node Agents Migration(2 reqs,split by layer)

- [ ] **MIGRATE-01**: 重构 `lib/agents/` Layer 0-3 agents(root + intent parallel + visual intent + visual execution)从 V8 step-mapping 到 v2.0 node-mapping。包括:`creative_source` / `style_genome` / `screenplay` + `script_auditor` (loop) / `character_designer` / `cinematographer` / `prompt_injector` (NEW) / `visual_executor` (drawer+animator merged) / `continuity_auditor` (renamed from continuity)。
- [ ] **MIGRATE-02**: 重构 `lib/agents/` Layer 4-6 agents(audio + post + final gates)从 V8 step-mapping 到 v2.0 node-mapping。包括:`audio_pipeline` (5 audio merged) / `editor` / `colorist` / `hook_retention` / `quality_gate` / `compliance_gate` (renamed)。

### REMOVE — V8 Legacy Cleanup(2 reqs)

- [ ] **REMOVE-01**: V8 step dispatch (`lib/phases/index.js`) deprecate — 一旦 v2.0 拓扑稳定(Phase 11-12 完成 + A/B 验证通过),移除 V8 20-step dispatch 代码。`KAI_PIPELINE_MODE=v8` 仍可启用作为应急 fallback,但 default = v2。
- [ ] **REMOVE-02**: V8 specific 设计弃用:
  - OpenClaw Agent 唯一 LLM 编排 → 替换为分层 LLM 调用(per Phase 7 §3.1 D1.4)
  - sketch-then-render 强制两阶段 → `composition_lock` 是 user-value 层;sketch-then-render 是 instantiation(per Phase 7 §3.3 D3.4)
  - Toonflow review platform → quality_gate + compliance_gate 接管
  - Hard-coded Sora/Kling/Veo/CosyVoice in node specs → capability-spec canonical;模型名只在 dated annex(per NODE-08 + PITFALLS §1.3)

### CREATIVE — LLM-Creative Wiring(2 reqs)

- [ ] **CREATIVE-01**: 实施 hermes-agent Phase 10 设计的 `consistency_context` + `logic-critic` 扩展。`lib/state/` 扩展支持 consistency-context schema(character_knowledge_state + timeline + stakes + spatial_layout + emotional_arc per `04-LLM-CREATIVE-DISTILLATION.md §2.1`)。`script_auditor` agent 扩展 6th dim:consistency_context_violations。
- [ ] **CREATIVE-02**: 实施 `novelty_constraint` 从 `creative_source` 流出(per `04-LLM-CREATIVE-DISTILLATION.md §7`)。`creative_source` agent 输出新增 `novelty_constraint` schema(avoid_tropes + require_novelty_in + novelty_score_threshold + selected_template + template_choice_rationale)。`screenplay` agent 消费 novelty_constraint 作为 prompt 一部分。

### VALIDATE — Cross-Repo Coordination + Backward Compat(2 reqs)

- [ ] **VALIDATE-01**: 实施 hermes-agent HANDOFF-06 versioning scheme。`impl_targets_design: design-2026-06-16-prfp` 在 PROJECT.md frontmatter 声明。任何 structural DAG change(add/remove/reorder nodes)需 cross-repo ADR(per HANDOFF-05 co-owned DAG)。
- [ ] **VALIDATE-02**: Backward compatibility validation — V8 baseline `734dc71c9d` 保留作为 fallback;wrapper 期间(Phase 10-13)V8 + v2.0 可并行运行;V8 现有 API 消费者(外部 webhook + Telegram 通知等)不破坏。`KAI_PIPELINE_MODE=v8` 仍 work;default `KAI_PIPELINE_MODE=v2` 在 Phase 13 完成后切换。

---

## Future Requirements(v2.0 后续里程碑 / 不在 v2.0)

- **FUTURE-K1**: live statistical GO/NO-GO run(per hermes-agent FUTURE-04;需要 hermes-agent v3.0 skills 完成 + budget)
- **FUTURE-K2**: V8 baseline 完全删除(超 v2.0 后 + live run 验证 v2.0 稳定 6+ 月)
- **FUTURE-K3**: 跨 repo ADR 治理工具(自动化 sign-off + version stamp check)
- **FUTURE-K4**: 多形态参数化(短剧/微电影/长片)的 production-grade 实施(per hermes-agent Phase 7 §3.2 D2.6 + Phase 8 form_context 输入)
- **FUTURE-K5**: GPU Runtime Manager V6 升级(超 v2.0 范围;v2.0 保留 V5.1)

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| hermes-agent/skills/movie-experts/ 任何编辑 | hermes-agent v3.0 milestone 负责 |
| hermes-agent v2.0 PRFP 设计文档修改 | 设计 frozen-pending-impl;cross-repo ADR 才能修订 |
| live run execution | FUTURE-K1;需要 budget + hermes-agent v3.0 完成 |
| 多形态参数化 production-grade | FUTURE-K4;v2.0 只实施 single-form |
| GPU Runtime Manager V6 升级 | FUTURE-K5;v2.0 保留 V5.1 |
| 跨 repo ADR 治理工具 | FUTURE-K3;v2.0 用 manual ADR |
| V8 完全删除 | FUTURE-K2;v2.0 保留作为 fallback |
| 重写 lib/pipeline.js 全部 576 行 | Wrapper-first 策略;v2.0 加新 lib/v2_pipeline.js,V8 保留 |

---

## Traceability

> Phase 映射由 roadmapper 在 2026-06-16 生成。Phase 编号沿用 v1.0 后续(v1.0 结束于 phase 9,所以 v2.0 从 phase 10 起步)。

| Requirement | Phase | Status |
|-------------|-------|--------|
| WRAP-01 | 10 | Pending |
| WRAP-02 | 10 | Pending |
| MIGRATE-01 | 11 | Pending |
| MIGRATE-02 | 12 | Pending |
| REMOVE-01 | 13 | Pending |
| REMOVE-02 | 13 | Pending |
| CREATIVE-01 | 14 | Pending |
| CREATIVE-02 | 14 | Pending |
| VALIDATE-01 | 13 | Pending |
| VALIDATE-02 | 13 | Pending |

**Coverage:**
- v2.0 requirements: **10 total** (WRAP × 2 + MIGRATE × 2 + REMOVE × 2 + CREATIVE × 2 + VALIDATE × 2)
- Mapped to phases: **10 / 10** ✓
- Unmapped: **0**

**Per-phase summary:**

| Phase | Name | Requirements | Count |
|-------|------|--------------|-------|
| 10 | Topology Wrapper (lib/v2_topology/ + lib/v2_pipeline.js) | WRAP-01, WRAP-02 | 2 |
| 11 | Migrate Layer 0-3 Agents (root + intent + visual) | MIGRATE-01 | 1 |
| 12 | Migrate Layer 4-6 Agents (audio + post + gates) | MIGRATE-02 | 1 |
| 13 | V8 Legacy Cleanup + Cross-Repo Validation | REMOVE-01, REMOVE-02, VALIDATE-01, VALIDATE-02 | 4 |
| 14 | LLM-Creative Wiring (consistency_context + novelty_constraint) | CREATIVE-01, CREATIVE-02 | 2 |

---

*Requirements defined: 2026-06-16*
*Last updated: 2026-06-16 — v2.0 requirements traceability populated (10/10 mapped to 5 phases 10-14)*
