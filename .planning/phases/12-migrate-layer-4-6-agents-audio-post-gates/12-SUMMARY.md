# Phase 12: Migrate Layer 4-6 Agents — SUMMARY

**Phase:** 12
**Status:** ✅ Complete
**Date:** 2026-06-17

## What Was Built

### 7 Layer 4-6 nodes refactored to native v2.0

All 7 nodes now have `isV2Native = true` with native v2.0 PRFP implementations per `02-NODE-SPECS.md §2.9-§2.16`:

| Node | Layer | Native implementation highlights |
|---|---|---|
| `audio_pipeline` | 4 (audio) | 5 sub-steps: voicer → lip_sync → composer → foley → mixer; LUFS targeting + dialogue intelligibility |
| `editor` | 5 (post_parallel) | Murch Rule of Six in-node self-critic; emits human_review_gate_2 (5-min budget) |
| `colorist` | 5 (post_parallel) | LUT selection based on style_genome_5d; style_alignment + cross_shot_consistency scoring |
| `hook_retention` | 5 (form_specific) | 短剧-only; form guard skips for non-short_drama; hook + retention curve + paid_checkpoint |
| `quality_gate` | 6 (final_gate) | Murch 6-dim + form weights + platform spec compliance; replaces Toonflow |
| `compliance_gate` | 6 (final_gate) | 2 sub-steps merged: pre_check (lightweight) + final (comprehensive); short-circuits on hard violation |
| `theory_critic` | 6 (consultative) | META-06 creator-pulled; `consult()` API exposed via V2Pipeline.invokeTheoryCritic() |

### v2_pipeline.js Layer 4-6 wiring

`_runV2()` now completes the full DAG end-to-end:
- Layer 4: audio_pipeline (5 sub-steps)
- Layer 5: editor → human_review_gate_2 (handled) → colorist → hook_retention (form-guarded)
- Layer 6: quality_gate → compliance_gate
- theory_critic NOT auto-invoked (consultative)

### V2Pipeline.invokeTheoryCritic() API

Creator-pulled consultative API per META-06. Available via:
```js
pipeline.invokeTheoryCritic(question, pipelineStateSnapshot)
```

### Human gate handling

`_handleHumanGate2()`:
- Captures gate emission from editor
- Autonomous mode auto-accepts
- Production defers to creator UI

### Smoke test — 13 checks

All 13 checks pass:
- All 7 Layer 4-6 nodes confirmed `is_v2_native=true`
- **All 16 nodes now native v2.0** (zero V8 pass-through remaining)
- audio_pipeline runs 5 sub-steps in order
- editor runs Murch self-audit + emits human_review_gate_2
- colorist applies LUT based on style_genome
- hook_retention skips for non-short_drama form, runs for short_drama
- quality_gate returns multi-dim score + verdict
- compliance_gate runs pre_check + final merged; short-circuits on hard violation
- theory_critic consult() API works (creator-pulled)
- theory_critic run() returns consultative marker (no auto-invocation)
- V2Pipeline.invokeTheoryCritic() dispatches correctly

## Success Criteria Status

1. ✅ 7 Layer 4-6 node agents refactored (audio_pipeline, editor, colorist, hook_retention, quality_gate, compliance_gate, theory_critic)
2. ✅ `audio_pipeline` implements 5 sub-steps (voicer + lip_sync + composer + foley + mixer) per Phase 8 §2.9
3. ✅ `theory_critic` consultative edge (META-06 creator-pulled, not auto-invoked)
4. ✅ Human gates per `edges.yaml` (post-screenplay + post-editor, 5-min budgets)
5. ✅ `compliance_gate` pre_check + final merged per Phase 8 §2.15
6. ✅ `KAI_PIPELINE_MODE=v2` now fully functional end-to-end (no V8 pass-through needed for Layer 0-6)

## Files Changed

**Modified:**
- `lib/v2_topology/audio_pipeline.js` — native (5 sub-steps)
- `lib/v2_topology/editor.js` — native (Murch self-critic + human gate)
- `lib/v2_topology/colorist.js` — native
- `lib/v2_topology/hook_retention.js` — native (form-guarded)
- `lib/v2_topology/quality_gate.js` — native (replaces Toonflow)
- `lib/v2_topology/compliance_gate.js` — native (pre_check + final merged)
- `lib/v2_topology/theory_critic.js` — native consultative
- `lib/v2_pipeline.js` — Layer 4-6 wiring + invokeTheoryCritic + _handleHumanGate2

**Added:**
- `test/v2-phase12-smoke.mjs` — 13-check coverage

**V8 baseline:** untouched (Phase 10 covenant preserved)

## Hand-off to Phase 13

Phase 13 will:
- Deprecate V8 step dispatch (default `KAI_PIPELINE_MODE=v2`)
- Remove V8 hard-coded model names (Sora/Kling/Veo/CosyVoice) → move to dated annex per NODE-08
- Document V8 弃用: OpenClaw single-LLM orchestration / sketch-then-render / Toonflow / hard-coded models
- Implement HANDOFF-06 versioning (`impl_targets_design: design-2026-06-16-prfp` in PROJECT.md frontmatter)
- Validate backward compatibility (`KAI_PIPELINE_MODE=v8` still works)
