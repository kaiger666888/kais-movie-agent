---
phase: 36-remaining-10-phases-port
plan: 36-02
subsystem: kais-movie-pipeline/skills
tags: [phase-36, port, scene-generation, scene-selection, shot-breakdown, atomic-op]
requires:
  - 36-01 (p04-p06 upstream slots: spatio-temporal-script, character-bible, character-assets)
provides:
  - p07_scene_generation phase module
  - p08_scene_selection phase module
  - p09_shot_breakdown phase module
  - 7 asset-bus slots (scene-images, style-vector, color-intent, scene-selection, geometry-bed, shot-list, e-konte-sheets)
affects:
  - 36-03 (p10-p11: consumes shot-list, scene-images, style-vector, geometry-bed)
  - 36-04 (p12-p13: consumes style-vector, color-intent)
  - 36-05 (PHASE_REGISTRY registration + references/ refinement)
tech-stack:
  added: []
  patterns:
    - "V8.6 §4 atomic operation: 4 experts in single delegate_task (p07)"
    - "Conditional gate triggering: GATE_ID=None + CF-36-04 (p08, p09)"
    - "Per-plan asset-bus slot extension (D-36-04): preserve existing, only append"
key-files:
  created:
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p07_scene_generation.py
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p08_scene_selection.py
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p09_shot_breakdown.py
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_p07_unit.py
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_p08_unit.py
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_p09_unit.py
  modified:
    - /data/workspace/hermes-agent/plugins/pipeline_state/asset_bus.py
decisions:
  - "p07 atomic §4: single delegate_task call wrapping 4-expert collaboration (CF-36-03, Pattern 3) — verified by test_p07_calls_delegate_task_exactly_once_atomic_invariant"
  - "p08 + p09 GATE_ID=None per CONTEXT D-36-02 table; run() returns gate=None unconditionally even when trigger_gate callable provided (CF-36-04 conditional triggering)"
  - "Goal strings name all collaborating experts via skill_view('...') per D-35-07 (no parent-context skill_view — that would burn parent context across 13 phases)"
metrics:
  duration: 2m48s
  completed: 2026-06-26
  tasks_total: 9
  tasks_completed: 9
  files_created: 6
  files_modified: 1
  tests_added: 22
  tests_passing: 22
  full_suite_passing: 96
---

# Phase 36 Plan 36-02: p07-p09 Visual Design Phases Port Summary

V8.6 §4 atomic scene generation (4 experts in single delegate_task) + scene selection with geometry-bed + E-Konte shot breakdown — 3 PURE-ORCHESTRATION phase modules, 7 asset-bus slots, 22 unit tests.

## What Was Built

### p07_scene_generation (V8.6 §4 atomic)
- **Experts:** visual_executor + prompt_injector + style_genome + colorist — all 4 collaborate in ONE `delegate_task` call (atomic §4 invariant per CF-36-03/Pattern 3).
- **Inputs:** `spatio-temporal-script` (from p06), `character-assets` (from p04).
- **Outputs:** `scene-images` (5-view per scene), `style-vector` (5D genome: genre/mood/aesthetic/pace/color), `color-intent` (CxSxZ 28-combination + LUT plan).
- **Gate:** `scene-design` (Gate 5 — operator confirms 4-dim consistency).

### p08_scene_selection (V8.6 Step 8)
- **Experts:** cinematographer + editor.
- **Inputs:** `scene-images`, `spatio-temporal-script`.
- **Outputs:** `scene-selection` (operator-approved subset), `geometry-bed` (cross-shot 3D anchor frame).
- **Gate:** None (per CONTEXT D-36-02 table).

### p09_shot_breakdown (V8.6 Step 9)
- **Experts:** cinematographer + continuity_auditor.
- **Inputs:** `scene-selection`, `spatio-temporal-script`, `character-bible`.
- **Outputs:** `shot-list` (one entry per shot with intent + duration), `e-konte-sheets` (5-layer decomposition: composition/camera/lighting/action/dialogue).
- **Gate:** None.

### Asset-bus extension (D-36-04)
7 new slots appended to `ASSET_SCHEMA` in `plugins/pipeline_state/asset_bus.py`:
`scene-images`, `style-vector`, `color-intent`, `scene-selection`, `geometry-bed`, `shot-list`, `e-konte-sheets`. Existing Phase 33/35/36-01 slots preserved byte-equivalent (only additions).

## Verification Results

| Check | Result |
|-------|--------|
| `test_p07_unit.py` (8 tests) | PASS |
| `test_p08_unit.py` (7 tests) | PASS |
| `test_p09_unit.py` (7 tests) | PASS |
| Full kais-movie-pipeline suite | **96 passed** (74 Phase 35 + 22 Phase 36-02) |
| Atomic §4 invariant (p07 = 1 delegate_task) | PASS |
| Anti-pattern scan (openai/anthropic/subprocess/async/prompt_template) | CLEAN |
| `skill_view` only in goal strings (D-35-07) | PASS |
| Asset-bus slot count (≥7 new) | 15 occurrences (7 keys × 2-3 refs each) |

## Deviations from Plan

**None** — plan executed exactly as written. No Rule 1-3 auto-fixes triggered; no Rule 4 architectural decisions needed. Wave 1 sibling 36-01 had already committed p04/p05/p06 slots to `asset_bus.py` before this plan started; my 7 slot additions appended cleanly after their block (non-overlapping slot names verified).

## Commits

- `9b0abe065` — `feat(36-02): p07-p09 phase modules + asset-bus slots`
- `9c47f92e5` — `test(36-02): p07-p09 unit tests (22 tests, all pass)`

## Self-Check: PASSED

- p07_scene_generation.py exists and contains `skill_view(name='colorist')` ✓
- p08_scene_selection.py exists and contains `EXPERT = "cinematographer"` ✓
- p09_shot_breakdown.py exists and contains `EXPERT = "cinematographer"` ✓
- asset_bus.py contains `scene-images` ✓
- Commit `9b0abe065` found in git log ✓
- Commit `9c47f92e5` found in git log ✓
