---
phase: 33-pipeline-state-asset-bus
plan: 04
subsystem: pipeline_state
tags: [wiring, dispatch, tools.py, wave-2, integration]
requires:
  - 33-01  # PipelineStateStore
  - 33-02  # AssetBus + AssetBusError + JSONL_SLOTS
  - 33-03  # CreativeHistoryTracker (end-to-end integration test)
provides:
  - "tools.py with 4 real dispatch handlers replacing Phase 31 stubs"
  - "_state_store() / _asset_bus() factory helpers (os.getcwd()-based, monkeypatchable)"
  - "test_tools_dispatch.py — 9 integration tests across 3 classes"
  - "Phase 31 smoke Test 4 downgraded to valid-JSON-shape (stubs removed)"
affects:
  - "Phase 35 orchestration skill — can dispatch real PipelineStateStore + AssetBus via tool_view/tool_use"
  - "Phase 34 review gates — asset_bus_read/write tool surface live for review-outcomes slot"
tech-stack:
  added: []
  patterns:
    - "Tool handler dispatch (mirror Phase 32-05 _gold_team_client() factory pattern)"
    - "JSONL-aware routing: slot in AssetBus.JSONL_SLOTS -> append_line/read_lines; else write/read"
    - "Error layering: missing args -> tool_error; AssetBusError (programmer) -> tool_error; Exception -> tool_error with type name"
    - "monkeypatch.chdir(tmp_path) so os.getcwd()-based factories operate in test temp dir"
key-files:
  created:
    - path: /data/workspace/hermes-agent/plugins/pipeline_state/tests/test_tools_dispatch.py
      lines: 223
      provides: "9 dispatch + integration tests"
  modified:
    - path: /data/workspace/hermes-agent/plugins/pipeline_state/tools.py
      lines: 242
      provides: "4 real dispatch handlers + factory helpers; 0 stubs remaining"
    - path: /data/workspace/hermes-agent/plugins/pipeline_state/tests/test_smoke.py
      lines: 191
      provides: "Test 4 downgraded from stub-envelope to valid-JSON-shape assertion"
decisions:
  - "Single feat commit for impl + tests (inseparable GREEN state; mirrors Phase 33-01 and 32-05 pattern)"
  - "Dispatch handlers use os.getcwd() default (factory helpers); tests use monkeypatch.chdir(tmp_path). This matches the orchestration-skill usage pattern: runner chdirs to episode workdir before invoking tools."
  - "Test 4 in test_smoke.py downgraded from stub-envelope assertion to valid-JSON-shape assertion (Rule 1 — same bug Phase 32-05 hit). Stubs are gone; real dispatch verified by test_tools_dispatch.py."
  - "Schemas UNCHANGED (Phase 31 contract preserved); only description fields updated to remove 'Phase 33 implements' framing (optional polish explicitly permitted by plan task-1 action step 5)."
metrics:
  duration: ~6m
  completed: 2026-06-25
  tasks_completed: 2
  files_created: 1
  files_modified: 2
  tests_added: 9
---

# Phase 33 Plan 04: Wire 3 Modules to Tool Dispatch Summary

Swapped Phase 31's 4 stub handlers in `tools.py` for real dispatch against Wave 1 modules (PipelineStateStore / AssetBus), completing the Hermes tool surface so Phase 35 (orchestration runner) and Phase 34 (review gates) can call `pipeline_checkpoint_save` / `pipeline_checkpoint_load` / `asset_bus_read` / `asset_bus_write` through normal tool dispatch. Includes a 9-test integration suite proving end-to-end flow from `CreativeHistoryTracker.stamp` (Plan 33-03) through `AssetBus` (Plan 33-02) back out via the `asset_bus_read` tool handler.

## What Shipped

### `tools.py` (242 LOC, Phase 33 implementation replaces Phase 31 skeleton)

- **Imports added:** `os`, `PipelineStateStore` from `plugins.pipeline_state.store`, `AssetBus, AssetBusError` from `plugins.pipeline_state.asset_bus`, `tool_error` from `tools.registry`.
- **2 factory helpers:** `_state_store(workdir=None)` and `_asset_bus(workdir=None)` — each constructs the Wave 1 module with `workdir or os.getcwd()`. Module-level (not nested in handlers) so tests can `monkeypatch.setattr` them to inject fakes without touching the real filesystem. Mirrors Phase 32-05's `_gold_team_client()` pattern.
- **4 handler bodies rewritten:**
  - `_handle_pipeline_checkpoint_save` — extracts episode_id/phase/payload (defaults to `{}`); validates episode_id+phase required; calls `store.save_checkpoint(episode_id, phase, payload)`; returns `{status:"saved", episode_id, phase}`. `Exception` → `tool_error` with type name.
  - `_handle_pipeline_checkpoint_load` — validates episode_id required; calls `store.load_latest_checkpoint(episode_id)`; returns `{status:"loaded", episode_id, checkpoint}` on hit or `{status:"no_checkpoint", episode_id}` on miss.
  - `_handle_asset_bus_read` — validates episode_id+slot required; if `slot in AssetBus.JSONL_SLOTS` calls `bus.read_lines(slot)` else `bus.read(slot)`; returns `{status:"read", episode_id, slot, data}`. `AssetBusError` (programmer error) → `tool_error(str(exc))`.
  - `_handle_asset_bus_write` — validates episode_id+slot+entry required; if `slot in AssetBus.JSONL_SLOTS` calls `bus.append_line(slot, entry)` else `bus.write(slot, entry, envelope=True)`; returns `{status:"written", episode_id, slot, path}`.
- **Schemas UNCHANGED:** all 4 SCHEMA dicts (PIPELINE_CHECKPOINT_{SAVE,LOAD}_SCHEMA, ASSET_BUS_{READ,WRITE}_SCHEMA) keep the exact Phase 31 parameter shape. Only description strings updated to remove "Phase 33 implements" framing.
- **Removed:** `_stub()` helper, all `"status": "not_implemented"` strings (count: 0), all `implementing_phase` framing.

### `test_tools_dispatch.py` (new — 223 LOC, 9 tests, 3 classes)

- `TestCheckpointSaveLoad` (4): save_then_load round-trips payload through `.pipeline-state.json` at workdir root (NOT under `.pipeline-assets/`); missing args → tool_error; load on missing episode → `status:"no_checkpoint"`.
- `TestAssetBusDispatch` (4): write/read round-trip for failed-shots (JSON slot, envelope-unwrapped); double-write to finetune-dataset appends 2 JSONL lines (verifies `append_line` dispatch); read on missing slot → `data:null`; missing args → tool_error.
- `TestEndToEndCreativeHistory` (1): instantiates `AssetBus(tmp_path)` + `CreativeHistoryTracker(asset_bus=bus)`; calls `tracker.stamp({asset_slot, asset_id, source_hashes})`; then dispatches `_handle_asset_bus_read({"episode_id":"EP01","slot":"creative-history"})`; verifies `data.shots[0]` carries the stamped record with `asset_id`, `asset_slot`, `source_hashes`, `content_hash`, `timestamp`. **Proves Plan 33-03 + 33-04 wiring.**
- **Mocking strategy:** none. Tests use real Wave 1 modules with `monkeypatch.chdir(tmp_path)` so the handlers' `os.getcwd()`-based factories operate in the temp dir. No fakes, no `MockTransport` — pure integration coverage.

### `test_smoke.py` (Test 4 updated)

Phase 31 Test 4 asserted every handler returned the stub envelope `{status:"not_implemented", plugin, tool, implementing_phase, args_received}`. With stubs removed, the assertion is invalid. Test 4 (renamed `test_handlers_return_valid_json`) now verifies the weaker-but-stable contract: each handler on empty args returns valid JSON containing a non-empty `error` string. Real routing behavior covered by `test_tools_dispatch.py`. Module docstring updated to reflect Phase 31+33 evolution.

## Verification Results

| Done criterion | Status |
|----------------|--------|
| `tools.py` has 0 occurrences of `"status": "not_implemented"` | MET (grep count: 0) |
| All 4 handlers dispatch to real modules | MET (grep `PipelineStateStore\|AssetBus`: 17 matches in tools.py) |
| `_state_store()` and `_asset_bus()` factory helpers present | MET |
| All schemas UNCHANGED (Phase 31 contract preserved) | MET (parameter shape identical; only descriptions polished) |
| `test_tools_dispatch.py` passes with ≥8 tests | MET (9 tests, all passing) |
| End-to-end CreativeHistoryTracker → asset_bus_read integration test passes | MET (`test_creative_history_stamp_then_asset_bus_read`) |
| Phase 31 smoke test still passes (register() loop intact) | MET (Test 4 updated; 5/5 smoke tests pass) |
| `__init__.py` UNCHANGED | MET (`git diff` = 0 lines) |
| Full pipeline_state test suite runs clean | MET — **98 passed, 1 warning, 0 failed in 1.09s** |
| tools.py ≥ 130 LOC | MET (242 LOC) |
| test_tools_dispatch.py ≥ 150 LOC | MET (223 LOC) |

**Full suite breakdown:** Wave 1 = 81 tests (test_store 22 + test_asset_bus 37 + test_creative_history 22) + Wave 2 = 9 (test_tools_dispatch) + smoke = 5 (Test 4 updated) + loader = 3 = **98 total**.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Smoke Test 4 asserted stale stub contract**
- **Found during:** Task 1 (replacing stub handlers)
- **Issue:** `test_smoke.py::test_handlers_return_not_implemented_json` asserted `parsed["status"] == "not_implemented"` plus the full stub envelope (`plugin`, `tool`, `implementing_phase`, `args_received`). Phase 33 wiring removes the stubs, so the assertion is structurally invalid.
- **Fix:** Renamed test to `test_handlers_return_valid_json`; updated docstring; weakened assertion to "valid JSON + non-empty `error` string on empty args". Real dispatch behavior verified by `test_tools_dispatch.py` (9 tests). Module docstring updated. **Exact same fix Phase 32-05 applied** — this is a recurring pattern when Wave 2 replaces Phase 31 stubs.
- **Files modified:** `plugins/pipeline_state/tests/test_smoke.py`
- **Commit:** 709f4fef1 (folded into main implementation commit)

### Plan Adherence

All other plan directives followed exactly: factory helper pattern, `os.getcwd()` default + `monkeypatch.chdir` test pattern, JSONL-aware routing via `AssetBus.JSONL_SLOTS`, `AssetBusError` distinct from generic `Exception`, schemas unchanged (descriptions polished per task-1 action step 5), `__init__.py` untouched.

## Success Criteria Met

- **SC#4 final clause (Python unit tests cover core operations):** MET — Plan 33-01 (22) + 33-02 (37) + 33-03 (22) + 33-04 (9) = **90 new tests** this phase, exceeding the ≥45 target.
- **SC#1-3 wiring:** MET — All 4 Hermes tools dispatch to real implementations. Phase 35 (orchestration runner) and Phase 34 (review gates) can use them out of the box.
- **Phase 31 contract preserved:** MET — schemas unchanged, `register()` unchanged (loops same `_TOOLS` tuple), smoke test passes (Test 4 updated to reflect dispatch reality).

## End-of-Phase 33 Statement

Phase 33 complete. The `pipeline_state` plugin ships with:
- **PipelineStateStore** (Plan 33-01) — checkpoint save/load, episode persistence, resume detection
- **AssetBus V3** (Plan 33-02) — 4 typed slots, v3.0 envelope wrap/unwrap, atomic JSON writes, JSONL append
- **CreativeHistoryTracker** (Plan 33-03) — DAG + reverse BFS with blast-radius cap, hash-stamped lineage
- **Tool dispatch** (Plan 33-04) — 4 real handlers wiring Wave 1 modules to the Hermes tool surface

98 tests passing. Foundation laid for Phase 34 (HERMES-SKILL-03 review gates + Gate lifecycle) and Phase 35 (HERMES-SKILL-02 orchestration runner).

## Known Stubs

None. All 4 tool handlers dispatch to real Wave 1 implementations; no placeholder values flow to callers. The `review-outcomes` slot is routed as generic JSON per D-33-03 (Phase 34 defines the schema) — this is the documented Phase 33 contract, not a stub.

## Threat Flags

None. The dispatch layer adds no new network endpoints, no new auth paths, and no schema changes at trust boundaries. Filesystem access is scoped to the workdir (`os.getcwd()`) — the orchestration runner (Phase 35) is responsible for chdir-ing to the correct episode workdir before invoking these tools.

## Self-Check: PASSED

- `/data/workspace/hermes-agent/plugins/pipeline_state/tools.py` — FOUND (242 LOC > 130 min)
- `/data/workspace/hermes-agent/plugins/pipeline_state/tests/test_tools_dispatch.py` — FOUND (223 LOC > 150 min)
- `/data/workspace/hermes-agent/plugins/pipeline_state/tests/test_smoke.py` — FOUND (Test 4 updated)
- Commit `709f4fef1` — FOUND in `/data/workspace/hermes-agent` git log
- Full pipeline_state suite: 98/98 PASSED in 1.09s
