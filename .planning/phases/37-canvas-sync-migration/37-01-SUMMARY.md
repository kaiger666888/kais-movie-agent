---
phase: 37-canvas-sync-migration
plan: 37-01
subsystem: pipeline-runner-event-hooks
tags: [phase-37, runner, runner_hooks, event-hooks, callback-injection]
requires:
  - phase-35-runner-checkpoint (CF-37-02 insertion point)
  - phase-34-runner_hooks-resume (CF-37-03 insertion point)
provides:
  - RunnerConfig.on_phase_complete callback (episode_id, phase_id, result) -> None
  - RunnerConfig.on_gate_resolved callback (episode_id, gate_id, decision, payload) -> None
  - runner_hooks.set_gate_resolved_hook(fn) + module-level _on_gate_resolved
affects:
  - skills/kais-movie-pipeline/pipeline/runner.py
  - plugins/review_gates/runner_hooks.py
tech-stack:
  added: []
  patterns:
    - callback-injection-over-event-bus (D-37-01)
    - degrade-tolerant subscriber boundary (D-37-04, try/except guard)
    - default-None regression preservation (D-37-06)
key-files:
  created:
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_runner_canvas_hooks.py
  modified:
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/runner.py
    - /data/workspace/hermes-agent/plugins/review_gates/runner_hooks.py
decisions:
  - D-37-01 callback injection (no formal event bus) — applied
  - D-37-04 subscriber exceptions swallowed at runner boundary — applied
  - D-37-06 RunnerConfig defaults None preserves Phase 35/36 regression — applied
  - D-37-07 gate hook module-level in runner_hooks, fires after review-outcomes write — applied
metrics:
  duration: ~12m
  completed: 2026-06-25T23:33:12Z
  tasks: 6
  files-created: 1
  files-modified: 2
  tests-added: 10
---

# Phase 37 Plan 01: Runner + runner_hooks Event Hooks Summary

One-liner: Added two dormant callback hooks (`RunnerConfig.on_phase_complete`, `runner_hooks._on_gate_resolved`) with safe None defaults — the canvas subscriber (37-02) plugs into them later; Phase 35/36 tests stay green unchanged.

## What was built

**1. `RunnerConfig` callback fields** (`runner.py`)
- `on_phase_complete: Callable[[str, str, dict], None] | None = None`
- `on_gate_resolved: Callable[[str, str, str, dict], None] | None = None` (reserved for symmetry; gate path uses module-level hook in runner_hooks per D-37-07)
- Both default `None` (D-37-06 regression preservation)

**2. `run_episode` guarded invocation** (`runner.py`)
- After `store.save_checkpoint(...)`, if `cfg.on_phase_complete is not None`: invoke `cfg.on_phase_complete(episode_id, phase_id, result)` inside `try/except Exception`
- Subscriber exception logged at WARNING, swallowed — episode continues with checkpoint already persisted (D-37-04)

**3. Module-level gate hook** (`runner_hooks.py`)
- `_on_gate_resolved: Callable | None = None` module global
- `set_gate_resolved_hook(fn)` setter (clears with `None`)
- `resume_from_callback`: after `_write_review_outcome(gate, outcome)`, if `_on_gate_resolved is not None`: invoke `_on_gate_resolved(gate.episode_id, gate_id, decision, outcome)` inside try/except

**4. `resolve_direct` mirrored invocation** (`runner_hooks.py`) — Rule 2 addition (see Deviations). Operator-side gate resolutions must also notify subscribers; same guarded hook invocation as `resume_from_callback`.

**5. Tests** (`test_runner_canvas_hooks.py`, 10 tests, all green):
- Hook defaults None (2 tests)
- Hooks settable
- `on_phase_complete` invoked after checkpoint with shared event-log ordering assertion
- Default config runs cleanly (regression)
- Callback exception swallowed, episode completes, WARNING logged
- `set_gate_resolved_hook` set + clear
- Hook fires after `review-outcomes` write (shared event-log ordering assertion)
- Hook exception swallowed, resume returns normal payload
- `test_runner_full_dag` module still imports

## Verification

```
skills/kais-movie-pipeline/tests/test_runner_canvas_hooks.py: 10 passed
Full suite (skills + plugins/review_gates): 223 passed, 0 failed
```

No Phase 35/36 regressions. Total 233 tests in scope, all green.

## Commits

| Hash | Type | Subject |
| ---- | ---- | ------- |
| `9ae5da4b9` | feat | add on_phase_complete event hook to runner |
| `385b57160` | feat | add _on_gate_resolved hook to runner_hooks |
| `236ec76ec` | test | add event hook tests for runner + runner_hooks |

All commits on `main` of `/data/workspace/hermes-agent`. SUMMARY.md + state updates on planning repo `/data/workspace/kais-movie-agent`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Critical Functionality] Mirrored gate hook into `resolve_direct`**
- **Found during:** Task 4
- **Issue:** Plan only specifies hook invocation in `resume_from_callback`. But `resolve_direct` (Phase 34-04) is the operator-side gate resolution path used by the `gate_resolve` tool — it also writes `review-outcomes` and advances state. Without the same hook wiring, manual operator approvals/rejects would never trigger canvas sync, breaking the SC#2 two-trigger-path contract (phase completion + gate resolution) for half of the gate resolution surface.
- **Fix:** Added identical guarded `_on_gate_resolved` invocation to `resolve_direct`, immediately after `_write_review_outcome`, before the rollback hint construction. Same D-37-04 try/except guard.
- **Files modified:** `plugins/review_gates/runner_hooks.py`
- **Commit:** `385b57160`

**2. [Rule 3 - Blocking Issue] `GateMode.CALLBACK` does not exist**
- **Found during:** Task 5 (test execution)
- **Issue:** Test helper `_seed_pending_gate` initially used `GateMode.CALLBACK` based on plan text referencing "callback mode", but the actual `GateMode` enum has only `BLOCKING`, `WEBHOOK`, `POLLING` (no `CALLBACK`).
- **Fix:** Used `GateMode.WEBHOOK` (semantically correct for callback-driven resume flow). Tests passed.
- **Files modified:** `skills/kais-movie-pipeline/tests/test_runner_canvas_hooks.py`
- **Commit:** `236ec76ec`

No architectural changes (Rule 4). No auth gates. No deferred items.

## Known Stubs

None. All callbacks are wired end-to-end (guarded invocation paths with real type signatures). The subscriber itself is Plan 37-02's deliverable — the hooks are dormant until registered, which is the intended design (D-37-06).

## Threat Flags

None. No new network endpoints, auth paths, or file access patterns introduced. The hooks are pure callback plumbing; security boundary is unchanged.

## Self-Check: PASSED

- runner.py — FOUND
- runner_hooks.py — FOUND
- test_runner_canvas_hooks.py — FOUND
- 37-01-SUMMARY.md — FOUND
- Commit 9ae5da4b9 — FOUND
- Commit 385b57160 — FOUND
- Commit 236ec76ec — FOUND
