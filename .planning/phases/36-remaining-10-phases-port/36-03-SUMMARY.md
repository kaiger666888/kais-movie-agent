---
phase: 36-remaining-10-phases-port
plan: 36-03
subsystem: kais-movie-pipeline (p10-p11 voice + video render)
tags: [phase-port, parallel-shots, audio-pipeline, visual-executor, wave-1]
requires: [36-01, 36-02]
provides: [p10_voice, p11_video_render, voice-clips-slot, voice-timeline-slot, video-clips-slot, lip-sync-reports-slot]
affects: [p12_composition, asset_bus, PHASE_REGISTRY]
tech-stack:
  added:
    - concurrent.futures.ThreadPoolExecutor (shot-level fan-out for p11 only)
  patterns:
    - D-36-08 parallel_shots keyword-only kwarg (p11 ONLY — signature extension)
    - Pattern 1 (5-arg base signature) for p10
    - Pattern 1 + Pattern 7 (parallel_shots kwarg + ThreadPoolExecutor) for p11
    - Pattern 3 (atomic operation = single delegate_task per shot for p11)
    - Pattern 4 (per-plan asset-bus extension, append-only)
    - Pattern 5 (4-7 mocked unit tests per phase)
key-files:
  created:
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p10_voice.py
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p11_video_render.py
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_p10_unit.py
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_p11_unit.py
  modified:
    - /data/workspace/hermes-agent/plugins/pipeline_state/asset_bus.py  # +4 slots
decisions:
  - D-36-08 realized — p11 is the ONLY phase with parallel_shots; ThreadPoolExecutor(max_workers=parallel_shots) fans out one delegate_task per shot, aggregated into single writes
  - parallel_shots kwarg is keyword-only (after *) to distinguish from the 5-arg base signature — other p04-p13 phases keep the Phase 35 signature unchanged
  - p11 video-clips + lip-sync-reports are aggregated SINGLE writes (not per-shot appends) per the plan's asset_bus_slots_to_add contract
  - Each per-shot goal embeds the shot payload + shared inputs (scene-images, character-assets, voice-timeline) so the subagent has full context for that shot
metrics:
  duration: 4min
  completed: 2026-06-26
  tasks_total: 7
  tests_added: 19
  tests_passing: 130/130 (full suite)
  loc_added: 920
---

# Phase 36 Plan 36-03: p10-p11 Voice + Video Render Port Summary

Wave 1c port of p10_voice (audio_pipeline voicer) + p11_video_render (visual_executor animator + audio_pipeline lip_sync, the ONLY phase exercising D-36-08 parallel_shots via ThreadPoolExecutor shot-level fan-out).

## What Was Built

### p10_voice.py (Step 7B + Step 10 TTS)
- Single `delegate_task` call to audio_pipeline (voicer sub-step)
- Reads: `shot-list` (p09) + `script-draft` (p03)
- Writes: `voice-clips` + `voice-timeline`
- GATE_ID = None (CF-36-04 conditional skip — no gate for p10)

### p11_video_render.py (Step 10 + Step 11 video half, D-36-08)
- **The ONLY phase using parallel_shots** (D-36-08 realized)
- Per-shot `delegate_task` to visual_executor (animator) + audio_pipeline (lip_sync), fanned out via `ThreadPoolExecutor(max_workers=parallel_shots)`
- Signature extension: keyword-only `parallel_shots: int = 4` (other phases keep 5-arg base signature)
- Reads: `shot-list` + `scene-images` + `character-assets` + `voice-timeline`
- Aggregates per-shot results into SINGLE writes: `video-clips` + `lip-sync-reports` (NOT per-shot appends)
- GATE_ID = "render-preview" (Gate 7)

### Asset bus extension
- 4 new slots: `voice-clips`, `voice-timeline`, `video-clips`, `lip-sync-reports`
- Append-only — all Phase 33/35/36-01/36-02 slots preserved byte-equivalent (D-36-05)

## Tests

| File | Tests | Coverage |
|------|-------|----------|
| test_p10_unit.py | 9 | reads 2 slots, goal mentions audio_pipeline skill_view + voicer sub-step, delegate called once with [skills,file], writes voice-clips + voice-timeline, gate None even when trigger_gate provided, parses JSON, empty slot graceful, module constants |
| test_p11_unit.py | 10 | reads 4 slots, per-shot goal mentions both skill_views (visual_executor animator + audio_pipeline lip_sync), parallel_shots=4 + 4 shots → exactly 4 delegate calls, parallel_shots=1 → deterministic shot-list order, aggregates all shots into single writes, default kwarg=4 keyword-only, gate render-preview fires, gate None, empty shot-list graceful, module constants |

**Full suite: 130 passed** (was 111 — added 19 new, zero regressions).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test helper return signature**
- **Found during:** Task 6 (test run)
- **Issue:** `_asset_bus_factory` returned `(read_fn, write_fn)` but tests needed access to the written-entries dict to assert on writes. Three tests crashed with `TypeError: argument of type 'function' is not iterable`.
- **Fix:** Extended helper to return `(read_fn, write_fn, written_dict)` 3-tuple; updated all callsites in both test files.
- **Files modified:** test_p10_unit.py, test_p11_unit.py
- **Commit:** 10a865044

### Notes

- **Sibling 36-04 concurrency:** The asset_bus.py file was concurrently modified by sibling plan 36-04. The 36-04 sibling's commit `a738b6ddb` (p12-p13) captured both sets of slot additions in a single commit. My voice-clips/voice-timeline/video-clips/lip-sync-reports slots are present in the tree (verified via grep). No conflict — both plans append-only to disjoint slot blocks.
- **PHASE_REGISTRY untouched** per plan (36-05 owns the registration step).

## Verification

All plan verification checks pass:

```bash
# p11 signature extension present
grep "parallel_shots" pipeline/phases/p11_video_render.py | head -3   # ✓ (5 hits)

# ThreadPoolExecutor used
grep "ThreadPoolExecutor" pipeline/phases/p11_video_render.py          # ✓ (multiple hits, including the runtime call)

# Asset bus slots
grep -c "voice-clips\|voice-timeline\|video-clips\|lip-sync-reports" plugins/pipeline_state/asset_bus.py  # = 12 (≥4 ✓)

# Tests
python -m pytest skills/kais-movie-pipeline/tests/test_p10_unit.py skills/kais-movie-pipeline/tests/test_p11_unit.py -v   # 19/19 pass
python -m pytest skills/kais-movie-pipeline/tests/   # 130/130 pass
```

## Anti-Pattern Scan

Zero anti-patterns detected in either phase module:
- No `openai|anthropic|prompt_template|llm\.` imports
- No `subprocess.*node`
- No `async def run()` (sync only per Phase 35 contract)
- No `TBD|FIXME|XXX` debt markers
- Module LOC: p10 ~140, p11 ~190 — both well under the 200 LOC suspicious threshold

## Self-Check: PASSED

- FOUND: /data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p10_voice.py
- FOUND: /data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p11_video_render.py
- FOUND: /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_p10_unit.py
- FOUND: /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_p11_unit.py
- FOUND: commit 10a865044 (feat(skills): p10-p11 voice/video-render port (Phase 36-03))
- FOUND: voice-clips/voice-timeline/video-clips/lip-sync-reports slots in asset_bus.py (committed via 36-04 sibling at a738b6ddb)
