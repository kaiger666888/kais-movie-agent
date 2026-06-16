# Roadmap: kais-movie-agent — Milestone **v2.0 V8 → v2.0 PRFP DAG Migration**

**Milestone:** v2.0 V8 → v2.0 PRFP DAG Migration
**Defined:** 2026-06-16
**Granularity:** standard
**Phase numbering:** continues from v1.0 (v1.0 ended at Phase 9; v2.0 starts at **Phase 10**)
**Coverage:** 10/10 v2.0 requirements mapped ✓ (0 orphaned)
**Deliverable form:** `lib/` 重构 — wrapper-first migration from V8 20-step to v2.0 PRFP 16-role DAG. ZERO edits to hermes-agent/(parallel milestone).

---

## Milestones

- ✅ **v1.0 AIGC Integration** — Phases 1-9 (shipped 2026-05-18)
- 🚧 **v2.0 V8 → v2.0 PRFP DAG Migration** — Phases 10-14 (in planning)

---

## v2.0 Coverage Map (10 requirements mapped)

| Phase | Requirements | Count |
|---|---|---|
| 10 | WRAP-01, WRAP-02 | 2 |
| 11 | MIGRATE-01 | 1 |
| 12 | MIGRATE-02 | 1 |
| 13 | REMOVE-01, REMOVE-02, VALIDATE-01, VALIDATE-02 | 4 |
| 14 | CREATIVE-01, CREATIVE-02 | 2 |
| **Total** | | **10** |

---

## v2.0 Phases

### Phase 10: Topology Wrapper (lib/v2_topology/ + lib/v2_pipeline.js)

**Goal:** A reader can read `lib/v2_topology/index.js` and find 16 node API stubs corresponding to hermes-agent `nodes.yaml` IDs, plus `lib/v2_pipeline.js` as the v2.0 entry point with `KAI_PIPELINE_MODE` env var controlling v8/v2/parallel modes. V8 baseline `734dc71c9d` is preserved as fallback.

**Depends on:** hermes-agent v2.0 PRFP design shipped (Phase 12); `kais-migration-matrix.yaml` is canonical source

**Requirements:** WRAP-01, WRAP-02

**Success Criteria** (what must be TRUE):
1. `lib/v2_topology/` directory exists with 16 node stub files (one per pipeline-role ID from hermes-agent `nodes.yaml`)
2. Each node stub transparently passes through to existing V8 `lib/agents/` implementation (no V8 rewrite)
3. `lib/v2_pipeline.js` exists as v2.0 entry point; accepts `KAI_PIPELINE_MODE` env var
4. `KAI_PIPELINE_MODE=v8` runs V8 baseline (default at Phase 10 ship)
5. `KAI_PIPELINE_MODE=v2` runs v2.0 topology (transparent pass-through to V8 agents at this phase)
6. `KAI_PIPELINE_MODE=parallel` runs both + emits diff for A/B validation
7. V8 lib/pipeline.js + lib/phases/index.js untouched (fallback preserved)

**Plans:** TBD

---

### Phase 11: Migrate Layer 0-3 Agents (root + intent + visual)

**Goal:** A reader can read `lib/v2_topology/creative_source.js`, `screenplay.js`, `cinematographer.js`, `visual_executor.js`, etc. and find fully refactored agents that implement v2.0 PRFP per-node specs (per `02-NODE-SPECS.md` §2.1-§2.10), no longer just V8 pass-through. Layer 0-3 covers root + intent parallel + visual intent + visual execution.

**Depends on:** Phase 10 (wrapper established + node ID API stable)

**Requirements:** MIGRATE-01

**Success Criteria:**
1. 9 Layer 0-3 node agents refactored: `creative_source`, `style_genome`, `screenplay`, `script_auditor`, `character_designer`, `cinematographer`, `prompt_injector` (NEW), `visual_executor` (drawer+animator merged), `continuity_auditor` (renamed)
2. Each agent implements its `core_task` per `02-NODE-SPECS.md` (not V8 step semantics)
3. `screenplay ↔ script_auditor` loop implemented per `edges.yaml` (max 3 iter, ¥5/iter ceiling, exit score ≥ 0.75)
4. `visual_executor ↔ continuity_auditor` loop implemented per `edges.yaml` (max 2 iter, ¥50/iter ceiling, exit identity ≥ 0.85)
5. `prompt_injector` agent created from scratch (no V8 precedent) — implements cross-call consistency context per Phase 8 §2.7
6. Cross-cutting invariant edges implemented: `style_genome` + `character_designer` outputs flow to all downstream consumers (not V8 JSON asset bus pattern)

**Plans:** TBD

---

### Phase 12: Migrate Layer 4-6 Agents (audio + post + gates)

**Goal:** A reader can read `lib/v2_topology/audio_pipeline.js`, `editor.js`, `quality_gate.js`, `compliance_gate.js`, etc. and find fully refactored agents that implement v2.0 PRFP per-node specs. Layer 4-6 covers audio + post parallel + final gates + form-specific + consultative.

**Depends on:** Phase 11 (Layer 0-3 stable + cross-cutting invariant pattern established)

**Requirements:** MIGRATE-02

**Success Criteria:**
1. 7 Layer 4-6 node agents refactored: `audio_pipeline` (5 audio merged + lip_sync sub-step), `editor`, `colorist`, `hook_retention`, `quality_gate`, `compliance_gate` (renamed), `theory_critic` (consultative vertical)
2. `audio_pipeline` implements 5 sub-steps (voicer + lip_sync + composer + foley + mixer) per Phase 8 §2.9
3. `theory_critic` implements consultative edge (META-06 creator-pulled, not auto-invoked) — no linear DAG blocking
4. Human gates implemented per `edges.yaml`: post-screenplay (< 5 min) + post-editor (< 5 min)
5. `compliance_gate` implements pre_check + final merged sub-steps per Phase 8 §2.15
6. `KAI_PIPELINE_MODE=v2` now fully functional end-to-end (no V8 pass-through needed for Layer 0-6)

**Plans:** TBD

---

### Phase 13: V8 Legacy Cleanup + Cross-Repo Validation

**Goal:** A reader can verify (a) V8 step dispatch deprecated in `lib/phases/index.js` (default mode = v2), (b) V8 specific design弃用 documented (OpenClaw / sketch-then-render / Toonflow / hard-coded models), (c) hermes-agent HANDOFF-06 versioning scheme implemented (`impl_targets_design: design-2026-06-16-prfp`), (d) backward compatibility validated (V8 still works via `KAI_PIPELINE_MODE=v8`).

**Depends on:** Phase 11-12 (v2.0 topology fully functional + A/B validation passed)

**Requirements:** REMOVE-01, REMOVE-02, VALIDATE-01, VALIDATE-02

**Success Criteria:**
1. `lib/phases/index.js` V8 dispatch marked deprecated; default `KAI_PIPELINE_MODE=v2`
2. OpenClaw single-LLM orchestration replaced with layered LLM calls per node (Phase 7 §3.1 D1.4)
3. Sketch-then-render强制两阶段 replaced with `composition_lock` user-value layer + instantiation annex (Phase 7 §3.3 D3.4)
4. Toonflow review platform replaced with `quality_gate` + `compliance_gate` integration
5. All hard-coded model names (Sora/Kling/Veo/CosyVoice) removed from canonical node specs; moved to dated annex per NODE-08
6. `impl_targets_design: design-2026-06-16-prfp` declared in PROJECT.md frontmatter
7. V8 baseline `734dc71c9d` still works via `KAI_PIPELINE_MODE=v8` (backward compat validated)
8. Cross-repo ADR process documented (any future structural DAG change requires hermes-agent + kais-movie-agent sign-off)

**Plans:** TBD

---

### Phase 14: LLM-Creative Wiring (consistency_context + novelty_constraint)

**Goal:** A reader can verify (a) `lib/state/` extended with consistency-context schema (5 sections per Phase 10 §2.1), (b) `script_auditor` agent has 6th dimension (consistency_context_violations), (c) `creative_source` outputs `novelty_constraint` (per Phase 10 §7.2 schema), (d) `screenplay` consumes `novelty_constraint` in its prompt.

**Depends on:** Phase 13 (v2.0 topology stable + V8 cleanup done)

**Requirements:** CREATIVE-01, CREATIVE-02

**Success Criteria:**
1. `lib/state/consistency-context.js` implements 5-section schema: character_knowledge_state + timeline + stakes + spatial_layout + emotional_arc (per `04-LLM-CREATIVE-DISTILLATION.md §2.1`)
2. `script_auditor` agent extended with 6th dim: consistency_context_violations (threshold = 0, on violation = regenerate)
3. `creative_source` agent outputs `novelty_constraint` object (avoid_tropes + require_novelty_in + novelty_score_threshold + selected_template + template_choice_rationale per `04-LLM-CREATIVE-DISTILLATION.md §7.2`)
4. `screenplay` agent prompt template updated to consume `novelty_constraint` (Pattern 3 + Pattern 4 + Pattern 5 per §3.2)
5. 6 narrative arc templates available (classical_3_act + save_the_cat_15 + hero_journey_12 + kishotenketsu_4 + 短剧_爆款公式 + anti_structure per §6.1)
6. `commercial_mode` escape hatch flag implemented (per §7.4 — creator accepts cliché with explicit flag)

**Plans:** TBD

---

## Critical Path

```
10 (wrapper) → 11 (Layer 0-3 migrate) → 12 (Layer 4-6 migrate) → 13 (V8 cleanup + validate) → 14 (LLM-creative wiring)
```

Strict sequential — wrapper-first strategy. Phase 10 is non-negotiable foundation; Phase 11-12 are bulk migration (could be parallelized in future with more subagents); Phase 13 is integration gate; Phase 14 is the LLM-creative layer on top.

**Phase 10 is bottleneck** — establishes wrapper pattern + KAI_PIPELINE_MODE switching.

**Phase 13 is integration gate** — validates v2.0 vs V8 A/B + V8 cleanup + cross-repo coordination.

---

## hermes-agent v2.0 PRFP Cross-References

- **Design source-of-truth:** `/data/workspace/hermes-agent/.planning/research/v2-pipeline-design/`
- **Canonical mapping:** `kais-migration-matrix.yaml` (in hermes-agent design suite)
- **Per-node specs:** `02-NODE-SPECS.md` + `nodes.yaml` + `edges.yaml`
- **LLM-creative deep-dive:** `04-LLM-CREATIVE-DISTILLATION.md`
- **Handoff contract:** `07-HANDOFF-PLAN.md` (non-binding recommendation)
- **Baseline references:**
  - `kais_movie_agent_baseline_ref: 734dc71c9d5ff20d55dbd0255f367030962cf329` (this repo at design time)
  - `hermes_agent_baseline_ref: 85965c393f44deae29a833f2ae98af66d26548ce` (hermes-agent at design ship)

---

## Coordination with hermes-agent parallel milestone

Per HANDOFF-05 ownership matrix:
- **kais-movie-agent (this milestone v2.0):** owns implementation layer (lib/)
- **hermes-agent (parallel milestone v3.0):** owns design-intent layer (skills)
- **Co-owned DAG:** structural changes require cross-repo sign-off (cross-repo ADR)

v2.0 implements the already-frozen v2.0 PRFP DAG — no structural DAG changes. So no cross-repo sign-off needed for individual phases; only Phase 13 VALIDATE-01 declares `impl_targets_design` for tracking.

**Sequencing recommendation:** hermes-agent v3.0 (skills alignment) and kais-movie-agent v2.0 (DAG migration) can run in **parallel**. Both inherit from the same v2.0 PRFP design. FUTURE-K1 (live run) requires both to be complete.

---

## Risk Mitigation

| Risk | Mitigation |
|---|---|
| V8 → v2.0 拓扑迁移破坏现有 webhook + Telegram 通知 | Wrapper-first(Phase 10);KAI_PIPELINE_MODE=v8 fallback 保留;parallel mode 做 A/B |
| Capability-spec 漂移 — V8 hard-coded 模型名清理遗漏 | Phase 13 REMOVE-02 显式清单;lint grep Sora/Kling/Veo/CosyVoice |
| Phase 11-12 重构工作量大(16 节点 × agent refactor) | 分两批(Layer 0-3 + Layer 4-6);wrapper 期间 pass-through,V8 不破坏 |
| LLM-creative wiring 在 Phase 14 才实施 — Phase 11-13 期间 consistency 漂移可能 | Phase 11 screenplay ↔ script_auditor loop 仍 work(loop_with_critic edge);只是没有显式 consistency_context schema |
| 跨 repo ADR 治理工具缺失 | v2.0 用 manual ADR;FUTURE-K3 才工具化 |

---

*Roadmap defined: 2026-06-16 — v2.0 V8 → v2.0 PRFP DAG Migration, 5 phases (10-14), 10 requirements*
