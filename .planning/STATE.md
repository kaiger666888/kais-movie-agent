---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: V8 to v2.0 PRFP DAG Migration
status: complete
last_updated: "2026-06-17T00:00:00.000Z"
last_activity: 2026-06-17
progress:
  total_phases: 5
  completed_phases: 5
  total_plans: 5
  completed_plans: 5
  percent: 100
---

# STATE — kais-movie-agent 集成

> Milestone: v2.0 — V8 → v2.0 PRFP DAG Migration
> Updated: 2026-06-17

## Progress

- Phase 10: Topology Wrapper (lib/v2_topology/ + lib/v2_pipeline.js) — COMPLETE
- Phase 11: Migrate Layer 0-3 Agents (root + intent + visual) — COMPLETE
- Phase 12: Migrate Layer 4-6 Agents (audio + post + gates) — COMPLETE
- Phase 13: V8 Legacy Cleanup + Cross-Repo Validation — COMPLETE
- Phase 14: LLM-Creative Wiring (consistency_context + novelty_constraint) — COMPLETE

## Completed Phases

- Phase 10: lib/v2_topology/ with 16 node API stubs + KAI_PIPELINE_MODE switching (v8/v2/parallel)
- Phase 11: 9 Layer 0-3 nodes native + InvariantBus + loop_with_critic edges (screenplay ↔ script_auditor, visual_executor ↔ continuity_auditor)
- Phase 12: 7 Layer 4-6 nodes native + audio_pipeline 5 sub-steps + theory_critic consultative + human gates
- Phase 13: V8 deprecated (default KAI_PIPELINE_MODE=v2) + dated model annex + cross-repo ADR process
- Phase 14: consistency_context 5-section schema + 6 narrative templates + novelty_constraint + commercial_mode

## v2.0 Milestone Deliverables

- 16 native v2.0 nodes (15 linear + 1 consultative) in lib/v2_topology/
- Cross-cutting invariant bus (style_genome + character_assets + consistency_context)
- 2 loop_with_critic edges (max 3 iter / max 2 iter)
- 2 human gates (post-screenplay + post-editor)
- theory_critic consultative API (META-06 creator-pulled)
- 6 narrative arc templates + commercial_mode escape hatch
- V8 deprecated with backward compat (KAI_PIPELINE_MODE=v8 still works)
- Canonical cleanliness verified (0 hard-coded model names in lib/v2_topology/)

## Test Coverage

- test/v2-topology-smoke.mjs: 16 checks (Phase 10 baseline)
- test/v2-phase11-smoke.mjs: 16 checks (Layer 0-3 native + loops)
- test/v2-phase12-smoke.mjs: 13 checks (Layer 4-6 native + theory_critic)
- test/v2-canonical-clean.mjs: 10 checks (no hard-coded models + deprecation banners)
- test/v2-phase14-smoke.mjs: 22 checks (consistency_context + 6 templates + novelty_constraint)
- **Total: 77/77 checks pass (100%)**

## Blockers/Concerns

- None

## Notes

- V8 baseline (734dc71c9d) preserved through Phase 10-14 (only deprecation banners added in Phase 13)
- Pre-existing V8 bug (lib/gold-team-client.js → shared/hmac_node.js CommonJS/ESM mismatch) documented in V8-DEPRECATION.md; not in v2.0 scope
- v2.0 PRFP DAG frozen — no structural changes per cross-repo ADR process
- Live statistical GO/NO-GO (FUTURE-08) deferred to operator at v2.0 close

## Current Position

Phase: All complete (10-14)
Plan: All complete
Status: Ready for milestone audit + completion
Last activity: 2026-06-17 — All 5 phases shipped via /gsd:autonomous

## Operator Next Steps

- Run /gsd:audit-milestone to validate v2.0 completion against original intent
- Run /gsd:complete-milestone to archive v2.0
- Live run validation (FUTURE-08) requires hermes-agent v3.0 + actual budget
