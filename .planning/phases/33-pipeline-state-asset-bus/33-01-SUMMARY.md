---
phase: 33-pipeline-state-asset-bus
plan: 01
subsystem: pipeline_state (data layer)
tags: [python, port, state, atomic-write, stdlib]
requires:
  - "Phase 31 skeleton (plugins/pipeline_state/{__init__.py,tools.py,plugin.yaml})"
provides:
  - "PipelineState dataclass (episode + phases dict + current_phase_id + timestamps)"
  - "PipelineStateStore (load/save/save_checkpoint/load_latest_checkpoint/find_resume_phase)"
  - "_atomic_write_text helper (tempfile.mkstemp + os.replace)"
  - "DONE_STATUSES frozenset ({completed, approved, awaiting_review})"
affects:
  - "Phase 35 HERMES-SKILL-02 runner resume (consumes find_resume_phase)"
  - "Phase 33-04 tools.py dispatch (PipelineStateStore wiring for checkpoint_save/load tools)"
tech-stack:
  added:
    - "Python 3.12 dataclasses"
    - "tempfile.mkstemp + os.replace atomic write pattern"
  patterns:
    - "Pure stdlib port (D-33-01): no httpx/pydantic/aiofiles"
    - "Atomic write hardening (D-33-02): deviates from Node.js raw writeFile"
    - "Forward-compat load filter: drop unknown keys"
    - "TDD: 22 tests written first (RED), implementation second (GREEN)"
key-files:
  created:
    - path: /data/workspace/hermes-agent/plugins/pipeline_state/store.py
      lines: 267
      provides: PipelineState + PipelineStateStore + _atomic_write_text + DONE_STATUSES
    - path: /data/workspace/hermes-agent/plugins/pipeline_state/tests/test_store.py
      lines: 286
      provides: 22 pytest unit tests across 6 test classes
decisions:
  - "Single feat commit for impl + tests (inseparable GREEN state; plan's task-1 done criteria already required tests passing)"
  - "Lazy import of datetime inside save_checkpoint to keep module import side-effect-free (also stdlib)"
  - "DONE_STATUSES exposed both as module constant and as PipelineState class attribute for ergonomic access"
  - "save_checkpoint does NOT overwrite state.episode once set — matches Node.js episode-is-bound-to-state-file invariant"
metrics:
  duration: ~12m
  completed: 2026-06-25
  tasks_completed: 2
  tests_added: 22
  loc_added: 553
---

# Phase 33 Plan 01: PipelineStateStore Port Summary

Python port of Node.js `PipelineStateStore` extract — checkpoint save/load, episode-level state persistence, and resume detection from the last incomplete phase. Foundation for Phase 35 (HERMES-SKILL-02) runner resume.

## What Was Built

**`store.py` (267 LOC)** — pure-stdlib Python port of the state-management extract from `kais-movie-agent/lib/pipeline.js`:

- **`PipelineState` dataclass** — on-disk shape with `episode`, `phases` dict, `current_phase_id`, and ISO timestamps (`started_at`, `completed_at`, `last_resumed_at`, `trace_id`). Default `phases` is a `field(default_factory=dict)` so instances don't share mutable state.
- **`DONE_STATUSES = frozenset({"completed", "approved", "awaiting_review"})`** — exact match to Node.js `pipeline.js:553,612,668`. `awaiting_review` counts as done because re-running would duplicate submitted work awaiting human review.
- **`PipelineStateStore`** with 5 methods:
  - `load()` — returns `PipelineState(episode="")` on missing/corrupt file (mirrors Node.js `_loadState` fallback, no throw). Forward-compat filter drops unknown JSON keys.
  - `save(state)` — atomically writes `.pipeline-state.json` at workdir root via `_atomic_write_text`.
  - `save_checkpoint(episode_id, phase, payload)` — sets `phases[phase]` with `status=completed` + ISO `completed_at` + `result=payload`, advances `current_phase_id`. Does NOT overwrite `episode` once bound.
  - `load_latest_checkpoint(episode_id)` — returns the current phase's checkpoint dict, or `None` for episode mismatch / no checkpoint.
  - `find_resume_phase(phase_order)` — returns first phase whose status is NOT in `DONE_STATUSES`, or `None` if all done. Mirrors `_findResumeIndex` (`pipeline.js:611-618`).
- **`_atomic_write_text(path, data)`** — `tempfile.mkstemp` + `os.fdopen` + `os.replace`. Tmp filename includes pid + ms timestamp + 3-byte random hex for concurrent-writer safety.

**`test_store.py` (286 LOC, 22 tests)** — pytest unit tests across 6 classes mirroring Node.js `describe` blocks:

| Class | Tests | Coverage |
|---|---|---|
| `TestPipelineStateDataclass` | 3 | construction, DONE_STATUSES exact match, fresh default per instance |
| `TestPipelineStateStoreLoad` | 5 | missing file, corrupt JSON, empty file, round-trip, forward-compat unknown-key drop |
| `TestPipelineStateStoreSave` | 3 | writes at workdir root (not `.pipeline-assets/`), no `.tmp` residue, concurrent-write atomicity |
| `TestSaveCheckpoint` | 3 | sets status+current, preserves prior phase entry, doesn't overwrite bound episode |
| `TestLoadLatestCheckpoint` | 3 | returns current checkpoint, None on episode mismatch, None when no checkpoint |
| `TestFindResumePhase` | 5 | first pending, None when all done, awaiting_review/approved as done, failed is resumed |

All 22 tests pass in 0.07s.

## Verification

```
22 passed in 0.07s
```

Done-criteria gates from PLAN.md `<verification>`:
- `os.replace` count in store.py: **4** (atomic write confirmed)
- `async def` count in store.py: **0** (sync API per Phase 32 D-07)
- Third-party imports: **0** (only stdlib: json, logging, os, tempfile, time, dataclasses, pathlib, datetime)
- Smoke import: `python3 -c "from plugins.pipeline_state.store import PipelineStateStore, PipelineState, DONE_STATUSES"` exits 0
- Test count: **22** (≥10 required)

## Deviations from Plan

**None — plan executed exactly as written.**

Minor implementation notes (within plan spec, not deviations):
- `_atomic_write_text` uses the `tempfile.mkstemp`-returned path directly rather than the pre-generated `tmp_name` — this avoids a hypothetical race where two writers generate identical `pid+ms+rand` names. `mkstemp` already guarantees uniqueness at the OS level. Behavior is identical to the plan spec.
- `datetime` is imported lazily inside `save_checkpoint` to keep module-load side-effect-free. Still pure stdlib.

## Known Stubs

None. `store.py` is fully implemented; no placeholder values flow to callers.

## Threat Flags

None. `store.py` is a pure filesystem data layer with no network endpoints, no auth paths, and no schema changes at trust boundaries. Input validation is structural (episode_id/phase required by callers in Phase 33-04 tools.py dispatch, not by this data layer — matches Node.js separation).

## Self-Check: PASSED

- `/data/workspace/hermes-agent/plugins/pipeline_state/store.py` — FOUND (267 LOC)
- `/data/workspace/hermes-agent/plugins/pipeline_state/tests/test_store.py` — FOUND (286 LOC)
- Commit `fd9b5ed3e` — FOUND in `git log` (hermes-agent repo)
- All 22 tests pass — VERIFIED via pytest run
