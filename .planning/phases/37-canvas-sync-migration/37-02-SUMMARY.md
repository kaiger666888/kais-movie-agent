---
phase: 37-canvas-sync-migration
plan: 37-02
subsystem: kais-aigc-canvas-sync
tags: [canvas, flowgraph, subscriber, port, python]
requires:
  - "Phase 32 CanvasClient (plugins/kais_aigc/canvas.py) — reused for HTTP"
provides:
  - "canvas_graph.py — pure FlowGraph mutation functions (upsert_node, ensure_link, compute_node_position, default_phase_mapper, empty_graph, normalize_loaded_graph)"
  - "canvas_sync.py — CanvasSyncSubscriber class (on_phase_complete, on_gate_resolved) + register_canvas_sync factory"
affects:
  - "Phase 37-03 (tools.py dispatch — will import register_canvas_sync)"
  - "Phase 37-01 (RunnerConfig callbacks — subscriber is the callback target)"
tech-stack:
  added: []
  patterns:
    - "Pure FlowGraph builder separated from HTTP I/O (PATTERN 2 — mirrors Phase 32 canvas.py philosophy)"
    - "Degrade-tolerant subscriber boundary: every public method wrapped in try/except Exception (CANVAS-IN-HERMES-03)"
    - "httpx.MockTransport injected into real CanvasClient for tests (PATTERN 4 — never mock the client)"
    - "Per-instance subscriber state for prev_phase_id link drawing (PATTERN 6 — safe for concurrent episodes)"
key-files:
  created:
    - /data/workspace/hermes-agent/plugins/kais_aigc/canvas_graph.py
    - /data/workspace/hermes-agent/plugins/kais_aigc/canvas_sync.py
    - /data/workspace/hermes-agent/plugins/kais_aigc/tests/test_canvas_graph.py
    - /data/workspace/hermes-agent/plugins/kais_aigc/tests/test_canvas_sync.py
  modified: []
decisions:
  - "D-37-03 split architecture honored: canvas_graph.py is pure (no httpx import), canvas_sync.py does all HTTP I/O via reused Phase 32 CanvasClient"
  - "Node id convention n-{phase_id}, gate node id g-{gate_id}, link id l-{prev}-{cur} — mirrors Node.js ref"
  - "Gate reject marks the associated phase node (payload['phase_id'] or gate_id fallback) with state=error rather than deleting it — preserves audit trail on canvas"
  - "_infer_stage helper extracts suffix after first underscore (p01_topic → topic) so default_phase_mapper's prefix match works when the runner only passes phase_id"
metrics:
  duration: 4m12s
  completed: 2026-06-25
  tasks: 5
  files: 4
  tests_added: 30
---

# Phase 37 Plan 02: Canvas Sync Migration (canvas_graph + canvas_sync) Summary

Pure-Python port of Node.js `lib/canvas-sync-hook.js` split into `canvas_graph.py` (pure FlowGraph mutation, trivially testable) and `canvas_sync.py` (degrade-tolerant subscriber doing HTTP I/O via the reused Phase 32 CanvasClient).

## What Was Built

### canvas_graph.py (pure functions, no I/O)
- `default_phase_mapper(phase)` — verbatim port of Node.js defaultPhaseMapper (CF-37-04). Maps `stage` prefix to phase group (research / story / production), review flag → `["需审核"]` tag.
- `compute_node_position(phase_group, stage_order)` — verbatim port (CF-37-05). 4-lane layout (research x=100, story x=1200, production x=2000, post x=2800), 3-per-row wrap, 200px row height.
- `upsert_node(graph, node_id, node_data)` — port of upsertNode. Find by id, shallow-merge top-level + deep-merge `data` dict, preserve existing `position` when new payload omits it.
- `ensure_link(graph, link_id, source, target)` — port of ensureLink. No-op if link id already present (idempotent).
- `empty_graph(project_id, episodes_id)` — constructs full FlowGraph skeleton (`nodes`, `links`, `branches` with main lane, `variantGroups`, `meta` with version=2 + timestamps).
- `normalize_loaded_graph(loaded, project_id, episodes_id)` — defensive normalization of `load_canvas()` return; handles None, partial dicts, and degrade envelopes without crashing.

### canvas_sync.py (subscriber + registration)
- `CanvasSyncSubscriber.on_phase_complete(episode_id, phase_id, result)` — load → upsert → link-from-prev → save. Tracks `_prev_phase_id` per instance.
- `CanvasSyncSubscriber.on_gate_resolved(episode_id, gate_id, decision, payload)` — approve writes `g-{gate_id}` node with `reviewStatus=approved`; reject/contest marks the associated phase node `state=error`.
- `_build_phase_node` / `_build_gate_node` — port of Node.js onPhaseComplete node construction (rich description from summary/metrics/review, lane position, reviewStatus based on awaiting-review state).
- `register_canvas_sync(*, base_url, project_id, episodes_id, runner_config, transport=None)` — single-call wiring: constructs CanvasClient, constructs subscriber, sets both `runner_config` callbacks, calls `runner_hooks.set_gate_resolved_hook(...)` (D-37-07).
- **Degrade-tolerant (CANVAS-IN-HERMES-03):** every public method wrapped in `try/except Exception`; logs WARNING with `exc_info=True`, swallows, never raises to runner.

## Verification

- 30 new tests pass (18 canvas_graph pure-function + 12 canvas_sync MockTransport).
- SC#2 keystones pass: `test_phase_complete_triggers_save_v2` + `test_gate_approve_triggers_save_v2` both assert exactly 1 POST to `/api/canvas/v2/save-v2`.
- CANVAS-IN-HERMES-03 keystone passes: `test_canvas_unreachable_does_not_block` (MockTransport raises ConnectError) and `test_canvas_4xx_swallowed` (save returns 400 → CanvasClientError) both swallow without raising.
- Regression: full `plugins/kais_aigc/tests/` suite — 115 passed, 0 failed (pre-existing warnings only).
- No stubs (no bare `pass` or `...` in any function body).
- `canvas_graph.py` has zero HTTP imports (pure).
- `canvas_sync.py` has 3 `except Exception` blocks (>= 2 required by plan).
- Zero code-level openclaw/Toonflow/sqlite references in either module (verified via AST scan excluding docstrings).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test bodies[0] indexing for save-v2 filter**
- **Found during:** Task 4 (canvas_sync tests)
- **Issue:** Multiple tests indexed `bodies[0]` to inspect the saved graph, but `bodies[0]` is the load-v2 request body (which has no `graph` key). The handler records every request including load-v2.
- **Fix:** Filter `bodies` to save-v2 entries only before indexing: `save_bodies = [b for u, b in zip(urls, bodies) if u[1].endswith("/save-v2")]`. Applied to 4 tests (upserts_node_with_id, gate_approve_writes_gate_node, gate_reject_marks_phase_error, empty_canvas_handled, prev_phase_id_resets).
- **Files modified:** `plugins/kais_aigc/tests/test_canvas_sync.py`
- **Commit:** 2e4908cb6

**2. [Rule 1 - Bug] Fixed no-openclaw static check to skip docstrings**
- **Found during:** Task 4 (canvas_sync tests)
- **Issue:** The plan's `test_no_openclaw_references` grepped the raw source, but the module docstrings legitimately mention "openclaw / Toonflow / sqlite" to declare their absence (contract documentation). A naive grep flagged the docstring text as offenders.
- **Fix:** Rewrote the test to walk the AST, collect docstring `Constant` node ids (first stmt of Module/FunctionDef/ClassDef), and skip them when scanning. Only actual code string literals and Name identifiers are checked.
- **Files modified:** `plugins/kais_aigc/tests/test_canvas_sync.py`
- **Commit:** 2e4908cb6

No Rule 2 / Rule 3 / Rule 4 deviations. Plan executed as written apart from these two test-harness corrections.

## Known Stubs

None. All functions fully implemented.

## Threat Flags

None. No new network endpoints, auth paths, or schema changes at trust boundaries introduced beyond what Phase 32 CanvasClient already exposes (HTTP v2 save/load). The subscriber reuses CanvasClient verbatim — zero new HTTP surface.

## Self-Check: PASSED

All 4 created files exist on disk. Both task commits (7bad930e9, 2e4908cb6) found in `git log`. 30 new tests pass on re-run.
