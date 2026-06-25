---
phase: 36-remaining-10-phases-port
plan: 36-04
subsystem: kais-movie-pipeline (p12 composition + p13 delivery)
tags: [port, python, pipeline, audio, delivery, gate-8]
requires:
  - 36-01 (p04-p06 + asset-bus slots)
  - 36-02 (p07-p09 + asset-bus slots, esp. style-vector + color-intent read by p12/p13)
  - 36-03 (p10-p11 produce video-clips/voice-clips/lip-sync-reports read by p12)
provides:
  - p12_composition.py (atomic §6 audio master + timeline edit)
  - p13_delivery.py (Gate 8 final-delivery, master.mp4 output)
  - asset-bus slots: master-timeline, audio-stems, master-mp4, delivery-package
affects:
  - plugins/pipeline_state/asset_bus.py (ASSET_SCHEMA extended, 4 slots appended)
  - 36-05 (PHASE_REGISTRY will register p12 + p13; references/ will document new slots)
tech-stack:
  added: []
  patterns:
    - CF-36-03 atomic §6 single delegate_task (audio_pipeline 6 sub-steps internal)
    - Pattern 1 phase module skeleton (PHASE_ID/EXPERT/INPUT_SLOTS/OUTPUT_SLOTS/GATE_ID)
    - Pattern 5 unit test layout (mocked delegate_task, no real subagents)
key-files:
  created:
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p12_composition.py
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p13_delivery.py
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_p12_unit.py
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_p13_unit.py
  modified:
    - /data/workspace/hermes-agent/plugins/pipeline_state/asset_bus.py
decisions:
  - p12 composition = atomic §6 (audio_pipeline encapsulates 6 sub-steps internally; exactly 1 delegate_task call)
  - p13 GATE_ID = "final-delivery" (Gate 8, operator + compliance_gate confirm CN rules + AIGC labeling)
  - master-mp4 slot preserves v4.0 PIPE-COMPOSE-01 contract (master.mp4 = canonical pipeline artifact)
metrics:
  duration: ~12 min
  completed: 2026-06-26
  tasks: 7
  tests-added: 15
  files-created: 4
  files-modified: 1
---

# Phase 36 Plan 36-04: p12 Composition + p13 Delivery Port Summary

Ported the final two pipeline phases (p12 composition + p13 delivery) as PURE ORCHESTRATION modules following the Phase 35 template, exercising the V8.6 §6 atomic operation (audio_pipeline 6 sub-steps in a single delegate_task call) and triggering Gate 8 final-delivery.

## What Was Built

### p12_composition.py
- **EXPERT**: `audio_pipeline` (primary, encapsulates 6 atomic sub-steps: composer BGM + foley SFX + mixer balance + spatial_audio + lip_sync final alignment + dialog cleanup) + `editor` (collaborator, assembles FxRxT timeline)
- **Atomic §6 invariant (CF-36-03)**: exactly 1 `delegate_task` call despite audio_pipeline having 6 internal sub-steps — the sub-steps are orchestrated internally by the audio_pipeline expert, NOT split across delegate calls (avoids V8.4-era 25-step complexity)
- **INPUT_SLOTS**: video-clips, voice-clips, lip-sync-reports, style-vector
- **OUTPUT_SLOTS**: master-timeline, audio-stems
- **GATE_ID**: None (final Gate 8 fires in p13)

### p13_delivery.py
- **EXPERT**: `colorist` (LUT + final grade per color-intent) + `compliance_gate` (CN red-line + AIGC labeling) + `editor` (final-cut + render) — single delegate_task call
- **INPUT_SLOTS**: master-timeline, audio-stems, color-intent
- **OUTPUT_SLOTS**: master-mp4 (preserves v4.0 PIPE-COMPOSE-01 contract), delivery-package
- **GATE_ID**: `"final-delivery"` (Gate 8 — operator + compliance_gate confirm before release)

### asset_bus.py extension
Appended 4 new JSON slots (preserves all existing slots byte-equivalent): `master-timeline`, `audio-stems`, `master-mp4`, `delivery-package`.

## Test Results

```
skills/kais-movie-pipeline/tests/test_p12_unit.py: 7 passed
skills/kais-movie-pipeline/tests/test_p13_unit.py: 8 passed
Total: 15 passed in 0.06s
```

Full pipeline suite: 119 passed, 1 failed (pre-existing sibling-plan failure in test_p10_unit.py — see Deferred Issues).

## Verification

- `grep -c "master-timeline\|audio-stems\|master-mp4\|delivery-package" asset_bus.py` → 10 (4 slot keys + file/description references)
- `grep "final-delivery" p13_delivery.py` → present (GATE_ID + Gate 8 docs)
- `grep -c "delegate_task(" p12_composition.py` → 1 (atomic §6 invariant held)
- `grep -c "delegate_task(" p13_delivery.py` → 1
- Anti-pattern scan: 0 matches for `openai|anthropic|prompt_template|llm.`, `subprocess.*node`, `async def run`, `TBD|FIXME|XXX`

## Deviations from Plan

None — plan executed exactly as written.

## Deferred Issues

**1. [Out of scope] test_p10_unit.py failure (sibling plan 36-03)**
- **Found during:** Task 6 (full suite regression run)
- **Issue:** `test_p10_writes_voice_clips_and_voice_timeline_slots` raises `TypeError: argument of type 'function' is not iterable` at line 164 — bug in the p10 test itself (asserts `"voice-clips" in write` where `write` is a function, not the recorded dict)
- **Owner:** Wave 1 sibling plan 36-03 (owns p10/p11)
- **Reason deferred:** Per SCOPE BOUNDARY rule, only auto-fix issues directly caused by the current task's changes. My asset_bus extension appends 4 slots without touching p10 slots — the failure is pre-existing in 36-03's test file and unrelated to p12/p13.

## Self-Check: PASSED

- `/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p12_composition.py` — FOUND
- `/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p13_delivery.py` — FOUND
- `/data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_p12_unit.py` — FOUND
- `/data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_p13_unit.py` — FOUND
- `/data/workspace/hermes-agent/plugins/pipeline_state/asset_bus.py` (modified) — FOUND
- Commit `a738b6ddb` — FOUND in `git log --oneline --all`
