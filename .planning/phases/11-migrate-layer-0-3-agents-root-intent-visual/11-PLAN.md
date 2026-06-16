# Phase 11: Migrate Layer 0-3 Agents — PLAN

## Plan 1: Cross-cutting invariant bus

Create `lib/v2_topology/_invariants.js` — shared bus for style_genome + character_designer outputs.

- `InvariantBus` class with `setStyleGenome()`, `getStylesheet()`, `setCharacterAssets()`, `getCharacterAssets()` methods
- Passed through `inputs.invariants` to all downstream nodes
- Phase 14 extends with `consistency_context`

## Plan 2: 9 Native node refactors

For each Layer 0-3 node, override `run()`:

### 2.1 creative_source (Layer 0)
- Inputs: creator_anecdote, lived_experience_seed
- Output: story_kernel { logline, protagonist_desire, central_conflict, turning_points, resolution_stance, style_gene }
- Strategy: LLM call to expand anecdote → kernel; structured-interview fallback for thin input

### 2.2 style_genome (Layer 1)
- Inputs: story_kernel
- Output: style_genome_5d { palette, composition, rhythm, texture, emotional_tone }
- Strategy: Extract style gene from kernel via LLM; encode as 5D vector

### 2.3 character_designer (Layer 1)
- Inputs: story_kernel
- Output: character_assets [{ id, name, face, body, wardrobe, voice_profile, tics }]
- Strategy: Define per-character assets; register identity anchor

### 2.4 screenplay (Layer 2) — loop participant
- Inputs: story_kernel + form_context + (regeneration feedback from script_auditor if iter > 0)
- Output: screenplay_full { scene_list, dialogue, form_adaptations }
- Strategy: LLM expansion + loop_with_critic support

### 2.5 script_auditor (Layer 2 critic) — loop participant
- Inputs: screenplay_full
- Output: audit_score_5dim { plot_coherence, dialogue_quality, character_arc, pacing, three_act_compliance } + verdict
- Strategy: Quantitative LLM audit; exit loop when score ≥ 0.75 OR max 3 iter

### 2.6 cinematographer (Layer 2)
- Inputs: screenplay_full + style_genome_5d + character_assets
- Output: visual_intent { shot_list, lighting, framing, composition_lock }
- Strategy: 3 sub-steps (mise_en_scene → shot_list → composition_lock_preview)

### 2.7 prompt_injector (Layer 3 NEW)
- Inputs: visual_intent + style_genome_5d + character_assets
- Output: model_prompts [{ shot_id, prompt, negative_prompt }] + consistency_context
- Strategy: Build prompts with embedded invariants

### 2.8 visual_executor (Layer 3) — loop participant
- Inputs: model_prompts + consistency_context
- Output: generated_visuals [{ shot_id, image_asset, video_asset }]
- Strategy: GPU scheduling via GoldTeamClient + loop_with_critic support

### 2.9 continuity_auditor (Layer 3 critic) — loop participant
- Inputs: generated_visuals + character_assets
- Output: continuity_score { identity_match, axis_compliance, wardrobe_drift, spatial_consistency, plot_continuity } + verdict
- Strategy: Cross-shot invariant check; exit loop when identity_match ≥ 0.85 AND axis_compliance = 100% OR max 2 iter

## Plan 3: Loop_with_critic orchestration

In v2_pipeline.js `_runV2()`:
- Detect critic pairing from edges.yaml
- Run generator → critic → check exit_condition → regenerate (if iter < max)
- Track cost vs ceiling; escalate to human on max iter exhausted

## Plan 4: Update smoke test

Extend test/v2-topology-smoke.mjs with Phase 11 checks:
- All 9 nodes report `is_v2_native: true`
- InvariantBus propagates style_genome_5d correctly
- Mock screenplay ↔ script_auditor loop terminates within 3 iter
- Mock visual_executor ↔ continuity_auditor loop terminates within 2 iter

## Verification

Per ROADMAP success criteria 1-6:
1. 9 Layer 0-3 nodes refactored ✅
2. Each implements core_task per 02-NODE-SPECS ✅
3. screenplay ↔ script_auditor loop (3 iter max, ¥5/iter, exit ≥ 0.75) ✅
4. visual_executor ↔ continuity_auditor loop (2 iter max, ¥50/iter, exit ≥ 0.85) ✅
5. prompt_injector native (cross-call consistency context) ✅
6. Cross-cutting invariant pattern established ✅
