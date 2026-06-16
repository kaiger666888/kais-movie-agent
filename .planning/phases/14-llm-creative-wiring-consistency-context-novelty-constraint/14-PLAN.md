# Phase 14: LLM-Creative Wiring — PLAN

## Plan 1: lib/state/consistency-context.js (5-section schema)

Implement `ConsistencyContext` class with:
- character_knowledge_state: Map<character_id, Map<scene_id, {knows: [], does_not_know: []}>>
- timeline: events[] with causes + effects
- stakes: stake_id → {established_at, payoff_expected_at, payoff_type}
- spatial_layout: scene_id → {layout, character_positions, invariant}
- emotional_arc: scene_id → {target_emotion, transition_from, intensity}

Methods: `setCharacterKnowledge()`, `addEvent()`, `addStake()`, `setSpatialLayout()`, `addEmotionalArc()`, `validate()`, `toJSON()`

## Plan 2: 6 narrative arc templates (lib/v2_topology/_templates.js)

Per §6.2 schema: id, name, origin, applicable_forms, stages[], novelty_default, compatible_with.

6 templates:
- classical_3_act
- save_the_cat_15
- hero_journey_12
- kishotenketsu_4
- 短剧_爆款公式
- anti_structure

`selectTemplate(formContext, artisticIntent)` helper.

## Plan 3: Extend creative_source.js

Add to output:
- `novelty_constraint` { avoid_tropes, require_novelty_in, novelty_score_threshold, selected_template, template_choice_rationale }
- `commercial_mode` flag (escape hatch per §7.4)
- Pattern 5: select template first; document rationale
- Pattern 3: explicit anti-trope (already partially implemented in Phase 11)

## Plan 4: Extend screenplay.js

Update `_expandToScreenplay()` prompt to consume novelty_constraint:
- Pattern 3: explicit_anti_trope (avoid_tropes list)
- Pattern 4: respect_consistency_context (consistency_context input)
- Pattern 5: selected_template (structure constraints)
- Pattern 6: regenerate_with_audit_feedback (already partially in loop)

Add `consistency_context_updated` output (per §2.1 io_contract revision).

## Plan 5: Extend script_auditor.js

Add 6th dimension: `consistency_context_violations`
- threshold = 0 (ZERO tolerated)
- on_violation = regenerate
- Same loop_with_critic edge (max 3 iter, ¥5/iter)

Logic-critic checks per §2.2:
- No character knows fact they should not know
- No event happens before its causal antecedent
- No stake mentioned that was never established
- No spatial-layout violation
- No emotional-arc discontinuity

## Plan 6: Wire InvariantBus

Update `_invariants.js`:
- `setConsistencyContext()` already stubbed — wire to real ConsistencyContext
- `getConsistencyContext()` returns instance

## Plan 7: Smoke test extensions

Add Phase 14 coverage:
- ConsistencyContext validates 5 sections
- All 6 templates listed with correct schema
- creative_source outputs novelty_constraint
- screenplay prompt includes novelty_constraint
- script_auditor 6th dim returns violations list (default empty for compliant screenplay)
- commercial_mode flag toggle works

## Verification

Per ROADMAP success criteria 1-6:
1. lib/state/consistency-context.js implements 5-section schema ✅
2. script_auditor extended with 6th dim (threshold=0, regenerate on violation) ✅
3. creative_source outputs novelty_constraint per §7.2 ✅
4. screenplay consumes novelty_constraint (Pattern 3+4+5) ✅
5. 6 narrative arc templates available ✅
6. commercial_mode escape hatch flag implemented ✅
