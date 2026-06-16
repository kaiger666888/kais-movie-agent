# Milestones

## v1.0 AIGC Integration (Shipped: 2026-05-18)

**Phases:** 1-9
**Key accomplishments:** GoldTeamClient GPU 调度 + ReviewClient 降级 + Voice Phase 集成 + 多候选审核 + V4.1 引擎对接 (13 functions)

---

## v2.0 V8 → v2.0 PRFP DAG Migration (Shipped: 2026-06-17)

**Phases:** 10-14 (5 phases)
**Requirements satisfied:** 10/10 (audit PASSED — 14/14 integration, 7/7 E2E flows)
**Test coverage:** 83/83 smoke checks (77 unit + 6 E2E integration)
**Baseline preserved:** V8 (734dc71c9d) byte-equivalent except @deprecated banners

**Key accomplishments:**

- lib/v2_topology/ — 16 native v2.0 PRFP nodes (15 linear + 1 consultative theory_critic)
- lib/v2_pipeline.js — KAI_PIPELINE_MODE switching (v8/v2/parallel), default=v2
- InvariantBus cross-cutting propagation (style_genome + character + consistency_context)
- 2 loop_with_critic edges (screenplay ↔ script_auditor, visual_executor ↔ continuity_auditor)
- theory_critic consultative API (META-06 creator-pulled)
- 6 narrative arc templates + commercial_mode escape hatch
- V8 deprecated with backward compat preserved (KAI_PIPELINE_MODE=v8 still works)
- Canonical cleanliness verified (0 hard-coded model names in lib/v2_topology/)
- 3 new docs: V8-DEPRECATION.md, v2-model-annex-2026-06-16.md, CROSS-REPO-ADR-PROCESS.md

---
