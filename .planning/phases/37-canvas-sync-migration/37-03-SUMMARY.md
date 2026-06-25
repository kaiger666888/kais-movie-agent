---
phase: 37-canvas-sync-migration
plan: 37-03
subsystem: kais-aigc-canvas-sync-wiring
tags: [canvas, integration-tests, tool-dispatch, subscriber-wiring, sc-keystone]
requires:
  - "Phase 37-01 (runner + runner_hooks event hooks)"
  - "Phase 37-02 (canvas_sync.CanvasSyncSubscriber + register_canvas_sync)"
  - "Phase 32 (CanvasClient HTTP v2 — reused, not duplicated)"
provides:
  - "tools.py: kais_canvas_sync_register tool dispatch — wires both trigger paths via register_canvas_sync"
  - "test_canvas_sync_integration.py — 10 end-to-end integration tests covering SC#2 keystones"
affects:
  - "Phase 37 SC#1/SC#2/SC#3 — all met"
  - "kais_aigc tool surface: 4 tools → 5 tools (kais_canvas_sync_register added)"
tech-stack:
  added: []
  patterns:
    - "Single registration call wires BOTH trigger paths (PATTERN 7 — register_canvas_sync sets cfg.on_phase_complete AND runner_hooks._on_gate_resolved)"
    - "httpx.MockTransport injected into real CanvasClient for integration tests (PATTERN 4)"
    - "Mocked-delegate full-DAG harness reused from test_runner_full_dag.py for 13-phase episode"
    - "Degrade-tolerant boundary (CANVAS-IN-HERMES-03) — ConnectError test confirms pipeline completes when canvas unreachable"
key-files:
  created:
    - /data/workspace/hermes-agent/plugins/kais_aigc/tests/test_canvas_sync_integration.py
  modified:
    - /data/workspace/hermes-agent/plugins/kais_aigc/tools.py
    - /data/workspace/hermes-agent/plugins/kais_aigc/__init__.py
    - /data/workspace/hermes-agent/plugins/kais_aigc/plugin.yaml
    - /data/workspace/hermes-agent/plugins/kais_aigc/README.md
    - /data/workspace/hermes-agent/plugins/kais_aigc/tests/test_smoke.py
    - /data/workspace/hermes-agent/plugins/kais_aigc/tests/test_loader_discovery.py
decisions:
  - "D-37-01 callback wiring applied: runner_config.on_phase_complete = subscriber.on_phase_complete; runner_hooks.set_gate_resolved_hook(subscriber.on_gate_resolved)"
  - "D-37-04 degrade-tolerant boundary verified end-to-end: test_canvas_unreachable_does_not_block_pipeline exercises ConnectError on every request"
  - "Named the new tool kais_canvas_sync_register (not kais_canvas_sync as the plan text suggested) — the latter name is already taken by Phase 32's node-sync dispatch (_handle_kais_canvas_sync + test_tools_dispatch.py contract). Same-named tool would collide; the _register suffix coexists cleanly."
metrics:
  duration: 4m51s
  completed: 2026-06-25T23:41:41Z
  tasks: 3
  files-created: 1
  files-modified: 6
  tests-added: 10
  total-tests-regression: 495
---

# Phase 37 Plan 03: Canvas Sync Wiring + Integration Tests Summary

Wired the Phase 37-02 `CanvasSyncSubscriber` into the Phase 37-01 event hooks via a single `register_canvas_sync()` call exposed as the new `kais_canvas_sync_register` tool; 10 integration tests prove both trigger paths fire `:10588` save-v2 — the SC#2 keystone is a full 13-phase mocked episode asserting exactly 13 save-v2 HTTP calls.

## What Was Built

### Task 1: tools.py + plugin surface (commit cdd453f74)

- **`_handle_kais_canvas_sync_register`** dispatch in `tools.py` — takes `project_id`, `episodes_id`, optional `base_url`, and a runtime `runner_config` object. Calls `register_canvas_sync(...)` which constructs a `CanvasClient` + `CanvasSyncSubscriber`, then sets both `runner_config.on_phase_complete = sub.on_phase_complete` AND `runner_hooks.set_gate_resolved_hook(sub.on_gate_resolved)` (PATTERN 7 single-call dual wiring).
- **`KAIS_CANVAS_SYNC_REGISTER_SCHEMA`** — tool schema with description documenting both trigger paths + degrade tolerance.
- **Tool surface 4 → 5**: `__init__.py` `_TOOLS` tuple extended; `plugin.yaml` `provides_tools` extended; README tool list updated; `test_smoke.py` `EXPECTED_TOOLS` + symbol check + count assertions updated; `test_loader_discovery.py` 4 → 5 tools.
- Return envelope reports `wired_phase_complete` + `wired_gate_resolved` so callers can verify PATTERN 7 contract held.

### Task 2: integration tests (commit 1f8aa1075)

**File:** `plugins/kais_aigc/tests/test_canvas_sync_integration.py` (10 tests, all pass):

| Test | Purpose |
| ---- | ------- |
| `test_full_pipeline_episode_canvas_save_v2_per_phase` | **SC#2 keystone** — mocked 13-phase episode with subscriber registered → exactly 13 `:10588` save-v2 calls |
| `test_save_v2_bodies_carry_phase_node_ids` | Every `n-pXX` phase node id appears at least once across the save stream |
| `test_gate_approve_triggers_save_v2` | Gate-resolution trigger path — `resume_from_callback(approve)` → 1 save-v2 call |
| `test_gate_reject_triggers_save_v2_with_error_state` | Reject path → 1 save-v2 + saved graph contains error-state node |
| `test_canvas_unreachable_does_not_block_pipeline` | **CANVAS-IN-HERMES-03 keystone** — ConnectError on every request, pipeline still completes |
| `test_no_openclaw_references_in_phase_37_deliverables` | **SC#1** — AST scan (skips docstrings) of canvas_sync.py + canvas_graph.py → 0 offenders |
| `test_no_subprocess_node_runtime_dependency` | D-37-05 — no `subprocess.run(node)` / `require(` |
| `test_phase_35_36_regression_full_dag_imports` | Phase 35/36 regression guard |
| `test_register_wires_both_trigger_paths` | PATTERN 7 — single call wires BOTH cfg.on_phase_complete AND runner_hooks._on_gate_resolved |
| `test_register_canvas_sync_subscriber_isolates_per_call` | PATTERN 6 — distinct subscriber per register call |

Harness: `httpx.MockTransport` injected into the real Phase 32 `CanvasClient` via the `transport` seam (PATTERN 4 — real client runs, only network is fake). Full-DAG delegate spy reused from `test_runner_full_dag.py`.

## Verification

```
cd /data/workspace/hermes-agent && python3 -m pytest \
  skills/kais-movie-pipeline/tests/ \
  plugins/kais_aigc/tests/ \
  plugins/pipeline_state/tests/ \
  plugins/review_gates/tests/
→ 495 passed, 0 failed (9 warnings — all pre-existing JWT key-length)
```

Phase 37 SC verification:

1. **SC#1** (Node → Python subscriber, no Node runtime dep):
   - `canvas_sync.py` + `canvas_graph.py` exist as Python modules ✓
   - `grep openclaw|Toonflow` in deliverables → only docstring absence-declaration (no code refs) ✓
   - `grep subprocess.run.*node|require\(` → 0 hits ✓
   - `tools.py` exposes `kais_canvas_sync_register` ✓

2. **SC#2** (two trigger paths fire `:10588` save-v2):
   - `test_full_pipeline_episode_canvas_save_v2_per_phase` asserts 13 save-v2 calls (phase path) ✓
   - `test_gate_approve_triggers_save_v2` asserts 1 save-v2 call (gate path) ✓
   - `test_register_wires_both_trigger_paths` confirms single call wires BOTH ✓

3. **SC#3** (HTTP v2 only, no sqlite, degrade-tolerant):
   - Subscriber only calls `CanvasClient.save_canvas` / `load_canvas` (Phase 32 contract) ✓
   - `grep sqlite` → only docstring absence-declaration ✓
   - `test_canvas_unreachable_does_not_block_pipeline` passes ✓

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Renamed `kais_canvas_sync` to `kais_canvas_sync_register`**
- **Found during:** Task 1
- **Issue:** Plan text requested adding a new tool named `kais_canvas_sync`. However, that exact name is already taken by the Phase 32 node-sync dispatch (`_handle_kais_canvas_sync` in `tools.py` + 3 tests in `test_tools_dispatch.py` + the `EXPECTED_TOOLS` list in `test_smoke.py` + `test_loader_discovery.py::test_enable_and_load` asserts `tools == 4`). A same-named tool would collide on the tool surface and break the Phase 32 contract.
- **Fix:** Added the new tool as `kais_canvas_sync_register` (suffixed). The Phase 32 `kais_canvas_sync` (single-node sync via `save_canvas_degraded`) coexists with the Phase 37 `kais_canvas_sync_register` (subscriber wiring) on the 5-tool surface. Updated `EXPECTED_TOOLS`, `test_loader_discovery` tool count, README, and added the new schema/handler symbols to the imports check in `test_smoke`.
- **Files modified:** `tools.py`, `__init__.py`, `plugin.yaml`, `README.md`, `tests/test_smoke.py`, `tests/test_loader_discovery.py`
- **Commit:** cdd453f74

**2. [Rule 1 - Bug] Integration test assumed cumulative save bodies**
- **Found during:** Task 2
- **Issue:** `test_save_v2_bodies_carry_phase_node_ids` initially asserted that the LAST save-v2 body carried every phase node id (assuming the load-mutate-save cycle accumulated state). But the MockTransport returns `None` for every load-v2 (the test setup for empty canvas), so each save only contains the new node — saves are not cumulative across calls when load returns empty.
- **Fix:** Reframed the assertion to collect node ids from ALL 13 save bodies into a set, then assert every expected `n-pXX` appears at least once in that set. This correctly verifies the subscriber upserts each phase's node id without making incorrect assumptions about canvas server-side state.
- **Files modified:** `plugins/kais_aigc/tests/test_canvas_sync_integration.py`
- **Commit:** 1f8aa1075

**3. [Rule 1 - Bug] openclaw self-reference in no-openclaw test**
- **Found during:** Task 2
- **Issue:** The plan's `test_no_openclaw_references_in_phase_37_deliverables` initially included itself in the scan target list. The test source necessarily contains the strings `"openclaw"`, `"Toonflow"`, `"sqlite"` (in the `re.compile` pattern and assert messages), so the AST scan flagged the test file as an offender.
- **Fix:** Restricted the scan target list to the two production deliverable modules (`canvas_sync.py`, `canvas_graph.py`). Test files are excluded — they reference the forbidden names by necessity to assert their absence. The production code (the actual SC#1 contract surface) is still fully scanned, with docstring-constant skipping preserved.
- **Files modified:** `plugins/kais_aigc/tests/test_canvas_sync_integration.py`
- **Commit:** 1f8aa1075

No Rule 2 / Rule 3 / Rule 4 deviations. No auth gates. Plan executed as written apart from the naming-collision fix and two test-harness corrections.

## Known Stubs

None. All tool dispatch handlers are fully implemented (real register_canvas_sync call, no `pass` / `...` stubs).

## Threat Flags

None. The new tool dispatch delegates to `register_canvas_sync` which reuses the Phase 32 `CanvasClient` for all HTTP I/O — zero new network endpoints, auth paths, or schema changes at trust boundaries. The subscriber's degrade-tolerant boundary (CANVAS-IN-HERMES-03) is preserved end-to-end.

## Self-Check: PASSED

- tools.py — FOUND (5-tool surface, kais_canvas_sync_register present)
- __init__.py — FOUND (5 entries in _TOOLS)
- plugin.yaml — FOUND (5 tools in provides_tools)
- test_canvas_sync_integration.py — FOUND (10 tests)
- test_smoke.py — FOUND (EXPECTED_TOOLS has 5 entries)
- test_loader_discovery.py — FOUND (asserts tools == 5)
- Commit cdd453f74 — FOUND
- Commit 1f8aa1075 — FOUND
