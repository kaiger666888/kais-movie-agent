# Phase 12: Migrate Layer 4-6 Agents — Context

**Gathered:** 2026-06-17
**Mode:** Auto-generated (infrastructure migration phase)

<domain>
## Phase Boundary

Refactor 7 Layer 4-6 node agents from V8 pass-through to native v2.0 PRFP implementations per `02-NODE-SPECS.md §2.9-§2.16`. Implement 5-sub-step audio_pipeline. Implement theory_critic consultative edge. Implement human gates (post-screenplay + post-editor). After this phase, `KAI_PIPELINE_MODE=v2` is fully functional end-to-end.

</domain>

<decisions>
## Implementation Decisions

### Native v2.0 nodes (7):
1. `audio_pipeline` (Layer 4) — 5 sub-steps: voicer + lip_sync + composer + foley + mixer
2. `editor` (Layer 5) — Murch Rule of Six + rhythm + cut-point selection + human_review_gate_2
3. `colorist` (Layer 5) — color grading + style_alignment + cross_shot_consistency
4. `hook_retention` (Layer 5 form-specific) — 短剧-only: hook + retention curve + paid_checkpoint pacing
5. `quality_gate` (Layer 6 final_gate) — Murch 6-dim + form weights + platform spec compliance
6. `compliance_gate` (Layer 6 final_gate) — CN platform compliance pre_check + final merged
7. `theory_critic` (Layer 6 consultative) — creator-pulled consultation per META-06; not auto-invoked

### Loop / edge semantics
- `editor → human_review_gate_2`: 5-min review budget; reject → revise OR escalate to theory_critic
- `screenplay → human_review_gate_1`: 5-min review budget; reject → revise creative_source OR rewrite (wired in Phase 11 native flow)

### Theory_critic consultative API (success criterion 3)
- NOT auto-invoked by DAG
- Exposes `consult(pipeline_state, question)` method
- Called by creator UI / human_review_gate_2 escalation

### audio_pipeline 5 sub-steps (success criterion 2, per Phase 8 §2.9)
- voicer: TTS per character voice_profile
- lip_sync: align audio to visual timing (lip_sync sub-edge in edges.yaml)
- composer: BGM generation
- foley: SFX generation
- mixer: LUFS targeting + dialogue intelligibility

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- lib/v2_topology/_node-base.js + _invariants.js (Phase 10-11)
- lib/bgm-strategy.js, lib/scene-reverb-manager.js, lib/sfx-manager.js — V8 audio modules (wrap, don't rewrite)
- lib/quality-gate.js — V8 quality gate (wrap)
- lib/ai-scorer.js — V8 multi-dim scoring (reuse)
- lib/gold-team-client.js — GPU dispatch
- lib/asset-bus.js — JSON asset propagation

### Established Patterns
- Each native node sets `isV2Native = true`
- Override `run()` with native implementation
- Consume upstream invariants (style_genome_5d, character_assets)
- LLM stub fallback for test mode (no LLM configured)

</code_context>

<specifics>
## Specific Ideas

### quality_gate replaces Toonflow (per migration matrix)
Per Phase 11 §5: Toonflow review platform弃用; quality_gate covers review.
- quality_gate consumes V8 lib/quality-gate.js + lib/ai-scorer.js internally
- Adds Murch 6-dim: emotion/story/rhythm/eye_trace/2D_plane/3D_space

### compliance_gate pre_check + final merged (per Phase 8 §2.15)
- pre_check: lightweight CN regulation scan (can short-circuit early)
- final: comprehensive platform spec check
- Single node, two-phase execution

### theory_critic consultative (success criterion 3)
- Inputs: pipeline_state_snapshot + creator_consultation_question
- Outputs: theoretical_critique { artistic_value_assessment, commercial_drift_analysis, recommendations }
- NOT in LINEAR_EXECUTION_ORDER (already excluded)
- v2_pipeline exposes `invokeTheoryCritic(question)` method

</specifics>

<deferred>
## Deferred Ideas

- LLM-creative wiring (consistency_context + novelty_constraint) — Phase 14
- V8 cleanup + cross-repo validation — Phase 13

</deferred>
