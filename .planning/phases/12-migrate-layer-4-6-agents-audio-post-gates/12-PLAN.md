# Phase 12: Migrate Layer 4-6 Agents — PLAN

## Plan 1: 7 Native node refactors

### 1.1 audio_pipeline (Layer 4)
- Inputs: screenplay_full + generated_visuals + character_assets (via invariants)
- 5 sub-steps sequential: voicer → lip_sync → composer → foley → mixer
- Output: mixed_audio { voicer_assets, lip_sync_offsets, bgm_asset, foley_assets, mixed_track, lufs_final }
- Reuse: lib/bgm-strategy.js, lib/scene-reverb-manager.js, lib/sfx-manager.js (wrap)

### 1.2 editor (Layer 5)
- Inputs: generated_visuals + screenplay_full + style_genome_5d (via invariants)
- Murch Rule of Six in-node self-critic
- Output: edited_sequence { cut_points, scene_order, transitions, murch_rhythm_score }
- Triggers human_review_gate_2 (5 min budget)

### 1.3 colorist (Layer 5)
- Inputs: edited_sequence + style_genome_5d (via invariants)
- Output: color_graded_sequence { lut_applied, per_shot_grades, style_alignment_score, cross_shot_consistency }
- Reuse: existing color grading helpers (V8 has none; build minimal native)

### 1.4 hook_retention (Layer 5 form_specific)
- Form guard: returns null if form != 'short_drama'
- Inputs: screenplay_full + form_context
- Output: hook_pacing_recommendations { hook_strength_score, retention_curve_fit, paid_checkpoint_feedback }
- Sends feedback to screenplay via feedback edge (already wired in edges.yaml)

### 1.5 quality_gate (Layer 6 final_gate)
- Inputs: color_graded_sequence + mixed_audio
- Murch 6-dim: emotion/story/rhythm/eye_trace/2D_plane/3D_space
- Output: quality_score_multidim + verdict (accept/reject/escalate)
- Reuse: lib/quality-gate.js + lib/ai-scorer.js internally

### 1.6 compliance_gate (Layer 6 final_gate)
- Inputs: quality_approved_sequence + form_context
- 2 sub-steps: pre_check → final (merged per Phase 8 §2.15)
- Output: compliance_verdict + rejection_reason

### 1.7 theory_critic (Layer 6 consultative)
- NOT in LINEAR_EXECUTION_ORDER (already excluded)
- API: `consult(pipeline_state_snapshot, creator_consultation_question)`
- v2_pipeline exposes `invokeTheoryCritic(question)` for creator UI

## Plan 2: Wire Layer 4-6 into v2_pipeline._runV2

After Layer 3 visual_executor loop:
- audio_pipeline (consumes generated_visuals + screenplay)
- editor (consumes generated_visuals + screenplay)
- colorist (consumes edited_sequence)
- quality_gate (consumes color_graded + mixed_audio)
- compliance_gate (consumes quality_approved + form_context)
- hook_retention invoked conditionally (form_scope=short_drama only)

## Plan 3: Theory_critic invocation API

Add to V2Pipeline:
- `invokeTheoryCritic(question)` — creator-pulled consultation
- Returns critique without affecting DAG flow

## Plan 4: Human gate stubs

- human_review_gate_1 (post-screenplay): emit gate event with 5-min budget
- human_review_gate_2 (post-editor): emit gate event with 5-min budget
- Stub: auto-accept for autonomous mode; real human interface via creator UI

## Plan 5: Update smoke test

Add Phase 12 coverage:
- 7 Layer 4-6 nodes report is_v2_native=true
- audio_pipeline runs 5 sub-steps
- theory_critic consult API works
- hook_retention returns null for non-short_drama form

## Verification

Per ROADMAP success criteria 1-6:
1. 7 Layer 4-6 nodes refactored ✅
2. audio_pipeline 5 sub-steps implemented ✅
3. theory_critic consultative edge (creator-pulled, not blocking) ✅
4. Human gates per edges.yaml (post-screenplay + post-editor, 5-min budgets) ✅
5. compliance_gate pre_check + final merged ✅
6. KAI_PIPELINE_MODE=v2 fully functional end-to-end ✅
