# Phase 11: Migrate Layer 0-3 Agents — SUMMARY

**Phase:** 11
**Status:** ✅ Complete
**Date:** 2026-06-17

## What Was Built

### 9 Layer 0-3 nodes refactored to native v2.0

All 9 nodes now have `isV2Native = true` and override `run()` with native v2.0 PRFP per-node implementations per `02-NODE-SPECS.md §2.1-§2.10`:

| Node | Layer | Native implementation highlights |
|---|---|---|
| `creative_source` | 0 (root) | LLM kernel mining + structured-interview fallback for thin input + anti-trope retry loop (novelty ≥ 0.7) |
| `style_genome` | 1 (intent_parallel) | 5D vector extraction (palette/composition/rhythm/texture/emotional_tone); publishes to InvariantBus |
| `character_designer` | 1 (intent_parallel) | Identity asset definition + 4D anchor; publishes to InvariantBus |
| `screenplay` | 2 (narrative) | LLM expansion + form-context adaptation + loop_with_critic participant |
| `script_auditor` | 2 (critic) | 5-dim quantitative audit (plot_coherence/dialogue_quality/character_arc/pacing/three_act_compliance); max 3 iter, ¥5/iter, exit ≥ 0.75 |
| `cinematographer` | 2 (visual_intent) | 3 sub-steps: mise_en_scene → shot_list → composition_lock |
| `prompt_injector` | 3 (cross_cutting) | NEW AI-native; embeds style+identity invariants into per-shot prompts + builds consistency_context |
| `visual_executor` | 3 (generation) | GoldTeamClient GPU scheduling + loop_with_critic participant; stub fallback |
| `continuity_auditor` | 3 (critic) | Identity + axis + wardrobe + spatial + plot audit; max 2 iter, ¥50/iter, exit identity ≥ 0.85 AND axis = 100% |

### Cross-cutting invariant bus

New `lib/v2_topology/_invariants.js` — `InvariantBus` class:
- `setStyleGenome()` / `getStyleGenome()` — 5D vector propagation
- `setCharacterAsset()` / `getCharacterAssets()` — identity asset propagation
- `setConsistencyContext()` / `getConsistencyContext()` — Phase 14 stub
- Validates invariant shape (5D dimensions, character.name required)
- `snapshot()` / `toJSON()` for traceability

### v2_pipeline.js native DAG orchestration

`_runV2()` rewritten to natively iterate Layer 0-3 DAG with loop_with_critic support:
- Layer 0: creative_source
- Layer 1: style_genome + character_designer (publish invariants)
- Layer 2: screenplay ↔ script_auditor loop (3 iter, ¥5/iter, exit ≥ 0.75)
- Layer 2: cinematographer (consumes invariants)
- Layer 3: prompt_injector (builds model_prompts with invariants)
- Layer 3: visual_executor ↔ continuity_auditor loop (2 iter, ¥50/iter, exit identity ≥ 0.85 AND axis = 100%)

`_execLoopWithCritic()` orchestrates generator ↔ critic iteration with:
- Cost tracking against per-iter ceiling
- Exit on `accept` verdict
- Exit on `escalate_human` verdict
- Exit on `max_iter_reached` (per critic's spec)
- Hard safety cap at 5 iter to prevent infinite loops

### Smoke test — 16 checks

All 16 checks pass:
- 9 Layer 0-3 nodes confirmed `is_v2_native=true`
- Layer 4-6 nodes still V8 pass-through (Phase 12 scope)
- InvariantBus validates 5D style genome + tracks characters
- creative_source runs + rejects missing inputs
- style_genome + character_designer publish to invariants
- screenplay signals awaiting_critic
- script_auditor + continuity_auditor return verdict + loop_state
- cinematographer implements 3 sub-steps
- prompt_injector embeds invariants (color hex + character name appear in prompts)
- Mock screenplay↔script_auditor loop terminates within 3 iter
- Mock visual_executor↔continuity_auditor loop terminates within 2 iter

## Success Criteria Status

1. ✅ 9 Layer 0-3 node agents refactored (creative_source, style_genome, screenplay, script_auditor, character_designer, cinematographer, prompt_injector, visual_executor, continuity_auditor)
2. ✅ Each implements core_task per `02-NODE-SPECS.md` (not V8 step semantics)
3. ✅ `screenplay ↔ script_auditor` loop (max 3 iter, ¥5/iter ceiling, exit score ≥ 0.75)
4. ✅ `visual_executor ↔ continuity_auditor` loop (max 2 iter, ¥50/iter ceiling, exit identity ≥ 0.85 AND axis = 100%)
5. ✅ `prompt_injector` native implementation (cross-cutting consistency context)
6. ✅ Cross-cutting invariant edges implemented (InvariantBus pattern, not V8 JSON asset bus)

## Files Changed

**Modified:**
- `lib/v2_topology/creative_source.js` — native
- `lib/v2_topology/style_genome.js` — native
- `lib/v2_topology/character_designer.js` — native
- `lib/v2_topology/screenplay.js` — native + loop participant
- `lib/v2_topology/script_auditor.js` — native + loop participant
- `lib/v2_topology/cinematographer.js` — native
- `lib/v2_topology/prompt_injector.js` — native (NEW)
- `lib/v2_topology/visual_executor.js` — native + loop participant
- `lib/v2_topology/continuity_auditor.js` — native + loop participant
- `lib/v2_topology/index.js` — exports InvariantBus
- `lib/v2_pipeline.js` — native DAG orchestration + loop_with_critic

**Added:**
- `lib/v2_topology/_invariants.js` — InvariantBus
- `test/v2-phase11-smoke.mjs` — 16-check coverage

**V8 baseline:** untouched (Phase 10 covenant preserved)

## Hand-off to Phase 12

Phase 12 will:
- Migrate 7 Layer 4-6 nodes: audio_pipeline, editor, colorist, hook_retention, quality_gate, compliance_gate, theory_critic
- Implement `audio_pipeline` 5 sub-steps (voicer + lip_sync + composer + foley + mixer)
- Implement `theory_critic` consultative edge (META-06 creator-pulled)
- Implement human gates: post-screenplay + post-editor
- Make `KAI_PIPELINE_MODE=v2` fully functional end-to-end (Layer 4-6 native, no V8 pass-through)
