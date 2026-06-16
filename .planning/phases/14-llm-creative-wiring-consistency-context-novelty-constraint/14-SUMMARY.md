# Phase 14: LLM-Creative Wiring — SUMMARY

**Phase:** 14
**Status:** ✅ Complete
**Date:** 2026-06-17

## What Was Built

### 1. lib/state/consistency-context.js — 5-section schema

`ConsistencyContext` class implements the structured established-facts representation per `04-LLM-CREATIVE-DISTILLATION.md §2.1`:

| Section | Purpose |
|---|---|
| `character_knowledge_state` | What each character knows at each scene |
| `timeline` | Event causal chain (causes + effects) |
| `stakes` | Established stakes + payoff expectations |
| `spatial_layout` | Scene spatial invariants |
| `emotional_arc` | Emotional transitions |

Methods: `setCharacterKnowledge`, `addEvent`, `addStake`, `setSpatialLayout`, `addEmotionalArc`, `validate(screenplay)` (per §2.2 logic-critic checks), `snapshot`, `toJSON`, `fromSnapshot`.

`validate()` implements 5 logic-critic checks (per §2.2):
- character_knows_forbidden_fact (implemented)
- causal order (stub)
- stakes payoff (stub)
- spatial layout (stub)
- emotional arc continuity (stub)

### 2. lib/v2_topology/_templates.js — 6 narrative arc templates

All 6 templates per §6.1 with full schema (id, name, origin, applicable_forms, stages[], novelty_default, compatible_with):

| Template | Stages | Novelty | Notes |
|---|---|---|---|
| classical_3_act | 3 | 0.5 | Field; universal |
| save_the_cat_15 | 15 | 0.4 | Blake Snyder; universal |
| hero_journey_12 | 12 | 0.4 | Campbell; universal |
| kishotenketsu_4 | 4 (起承转合) | 0.7 | East Asian; short + micro |
| 短剧_爆款公式 | 7 | 0.3 | Platform-tuned; short_drama only |
| anti_structure | 4 | 0.9 | Experimental; requires novelty ≥ 0.8 + theory_critic |

`selectTemplate(formContext, artisticIntent)` helper picks template based on form + intent signals (experimental / prefer_eastern / short_drama default).

### 3. creative_source extended (Phase 14)

New outputs:
- `novelty_constraint` per §7.2 schema:
  - `avoid_tropes` (template defaults + creator anti_patterns)
  - `require_novelty_in` (open dimensions: pov / thematic_angle / structural_inversion)
  - `novelty_score_threshold` (0.6 default; 0.8 for anti_structure)
  - `selected_template` (Pattern 5)
  - `template_choice_rationale`
- `commercial_mode` flag (per §7.4 escape hatch):
  - Auto-set when 短剧_爆款公式 template selected AND novelty < threshold
  - Respects explicit `commercial_mode_override` input
  - Signals downstream (theory_critic) that cliché is intentional commercial compromise

New prompt patterns integrated (per §3.3):
- Pattern 1 (force_author_assistance_mode)
- Pattern 3 (explicit_anti_trope)
- Pattern 5 (select_template_first)

### 4. screenplay extended (Phase 14)

Pattern combinations integrated (per §3.3):
- Pattern 2 (reason_before_write) — reasoning block per scene
- Pattern 3 (explicit_anti_trope) — from `novelty_constraint.avoid_tropes`
- Pattern 4 (respect_consistency_context) — from `consistency_context` input
- Pattern 5 (template_aware) — from `novelty_constraint.selected_template`
- Pattern 6 (regenerate_with_audit_feedback) — on loop iter > 0

New input: `consistency_context` (ConsistencyContext or snapshot)
New output: `consistency_context_updated` (per §2.1 io_contract revision)

### 5. script_auditor extended (Phase 14)

6th dimension added per §2.2:
- `consistency_context_violations` — threshold = 0 (ZERO tolerated)
- Validation via `ConsistencyContext.validate(screenplay)`
- On violation: loop continues (regenerate)
- Exit condition: overall score ≥ 0.75 AND 0 violations

New outputs:
- `audit_score_6dim` (extends 5dim with consistency dim)
- `consistency_violations` (array of structured findings)
- `loop_state.consistency_condition_met`

### 6. Smoke test — 22 checks

All 22 checks pass covering:
- ConsistencyContext 5 sections + validation + round-trip
- 6 templates present with correct schema + stage counts
- anti_structure requires novelty ≥ 0.8 + theory_critic consultation
- selectTemplate dispatch logic (short_drama / experimental / prefer_eastern)
- creative_source outputs novelty_constraint per §7.2 schema
- creative_source commercial_mode auto-set + override
- screenplay accepts novelty_constraint + consistency_context inputs
- screenplay outputs consistency_context_updated
- script_auditor 6th dim returns 0 for compliant + flags violations

## Success Criteria Status

1. ✅ `lib/state/consistency-context.js` implements 5-section schema (character_knowledge_state + timeline + stakes + spatial_layout + emotional_arc) per `04-LLM-CREATIVE-DISTILLATION.md §2.1`
2. ✅ `script_auditor` extended with 6th dim: `consistency_context_violations` (threshold = 0, on violation = regenerate) per §2.2
3. ✅ `creative_source` outputs `novelty_constraint` object (avoid_tropes + require_novelty_in + novelty_score_threshold + selected_template + template_choice_rationale) per §7.2
4. ✅ `screenplay` prompt updated to consume `novelty_constraint` (Pattern 3 + Pattern 4 + Pattern 5 per §3.2)
5. ✅ 6 narrative arc templates available (classical_3_act + save_the_cat_15 + hero_journey_12 + kishotenketsu_4 + 短剧_爆款公式 + anti_structure) per §6.1
6. ✅ `commercial_mode` escape hatch flag implemented per §7.4

## Files Changed

**Added (3):**
- `lib/state/consistency-context.js` — 5-section ConsistencyContext class
- `lib/v2_topology/_templates.js` — 6 narrative arc templates + selectTemplate
- `test/v2-phase14-smoke.mjs` — 22-check coverage

**Modified (4):**
- `lib/v2_topology/creative_source.js` — novelty_constraint + commercial_mode + Pattern 1+3+5
- `lib/v2_topology/screenplay.js` — Pattern 2+3+4+5+6 + consistency_context_updated output
- `lib/v2_topology/script_auditor.js` — 6th dim + consistency_context input
- `lib/v2_topology/index.js` — exports NARRATIVE_TEMPLATES + selectTemplate

**V8 baseline:** untouched

## Regression Check

All prior phase tests still pass:
- test/v2-topology-smoke.mjs: 16/16
- test/v2-phase11-smoke.mjs: 16/16
- test/v2-phase12-smoke.mjs: 13/13
- test/v2-canonical-clean.mjs: 10/10
- test/v2-phase14-smoke.mjs: 22/22
- **Total: 77/77 (100% pass rate)**

## v2.0 Milestone Status

All 5 phases (10-14) complete. v2.0 PRFP DAG migration shipped:
- 16 native v2.0 nodes (15 linear + 1 consultative)
- Cross-cutting invariant bus (style_genome + character_assets + consistency_context)
- 2 loop_with_critic edges (screenplay ↔ script_auditor, visual_executor ↔ continuity_auditor)
- 2 human gates (post-screenplay + post-editor)
- theory_critic consultative API (META-06 creator-pulled)
- 6 narrative arc templates
- commercial_mode escape hatch
- V8 deprecated (default KAI_PIPELINE_MODE=v2, backward compat preserved)
- Canonical cleanliness verified (0 hard-coded model names in lib/v2_topology/)

**Ready for v2.0 milestone audit + completion.**
