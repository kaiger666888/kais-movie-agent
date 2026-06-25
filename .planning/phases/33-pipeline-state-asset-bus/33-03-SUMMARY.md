---
phase: 33-pipeline-state-asset-bus
plan: 03
subsystem: pipeline_state
tags: [python, port, dag, bfs, lineage, creative-history]
requires:
  - "33-02 (AssetBus) — runtime collaborator; CreativeHistoryTracker constructor takes asset_bus"
provides:
  - "CreativeHistoryTracker class — DAG + reverse BFS with blast-radius cap (B4-03/04/05)"
  - "write_blast_radius_report() helper — operator review JSON for truncated BFS"
  - "plugins/pipeline_state/creative_history.py"
affects:
  - "plugins/pipeline_state/tools.py (Phase 33-04 will wire creative-history slot through AssetBus)"
tech-stack:
  added: []
  patterns:
    - "Reverse BFS with collections.deque.popleft() (O(1) FIFO)"
    - "Lazy reverse-index cache invalidated on every stamp()"
    - "Degraded mode: bus failure -> warn + return False (fire-and-forget)"
    - "Pure stdlib (hashlib/json/collections/dataclasses/datetime/pathlib)"
key-files:
  created:
    - path: /data/workspace/hermes-agent/plugins/pipeline_state/creative_history.py
      lines: 305
      provides: CreativeHistoryTracker + write_blast_radius_report
    - path: /data/workspace/hermes-agent/plugins/pipeline_state/tests/test_creative_history.py
      lines: 552
      provides: 22 pytest tests incl. perf
  modified: []
decisions:
  - "Replicated _compute_hash locally (not imported from asset_bus.py) to keep Wave 1 modules decoupled at import time — documented as load-bearing duplication"
  - "Response dicts keep camelCase cap keys (maxBlastRadius/maxDepth) for Node.js report interchangeability; all other API surfaces are snake_case (D-33-04)"
  - "Perf test constructs 1000-record chain via single direct bus.write instead of 1000 stamp() calls — only find_affected() is timed, per plan task-2 option (b)"
  - "FakeBus fixture used so tests run in isolation even if sibling plan 33-02 not yet landed; bonus TestRealAssetBusIntegration exercises real AssetBus when importable"
metrics:
  duration: ~12m
  completed: 2026-06-25
  tasks_completed: 2
  files_created: 2
  tests_added: 22
---

# Phase 33 Plan 03: CreativeHistoryTracker DAG + Reverse BFS Summary

Python port of the Node.js v3.0 flagship — "Git-for-AIGC-movies MVP" — implementing B4-03 (DAG + reverse BFS), B4-04 (blast radius cap + <500ms perf budget), and B4-05 (hash-stamped downstream lineage). Change one upstream content_hash and BFS returns the full set of downstream derived assets that need re-render.

## What Was Built

**`plugins/pipeline_state/creative_history.py` (~305 LOC)** — `CreativeHistoryTracker` class with:
- `stamp(entry)` — read-modify-write append of `{asset_slot, asset_id, source_hashes[], content_hash, timestamp}` record to creative-history slot; degrades to `return False` (warn, no throw) when AssetBus unreachable.
- `find_affected(changed_hash)` — reverse BFS via `collections.deque.popleft()` over the lazy reverse-index `{source_hash: [records]}`. Caps by `max_blast_radius=20` (sets `truncated=True`) and `max_depth=5` (stops BFS expansion). Returns `{affected, truncated, blast_radius, max_depth, cap: {maxBlastRadius, maxDepth}}` — camelCase cap keys preserved for Node.js report interchangeability.
- `diff(changed_hashes)` — batched union of multiple `find_affected` calls with per-hash breakdown.
- `_build_index()` — lazy reverse-index builder, cached on `self._index_cache`, invalidated on every `stamp()`.
- `write_blast_radius_report(result, output_path, changed_hash=None)` — module-level helper writing operator-review JSON with `generated_at`, `affected_count`, `note`, etc.
- Static `hash()` method + module-level `_compute_hash()` — SHA-256 of canonical JSON with `sort_keys=True` for cross-run determinism (documented duplication of AssetBus algorithm to keep modules decoupled at import time).

**`plugins/pipeline_state/tests/test_creative_history.py` (~552 LOC, 22 tests)**:
- `TestConstants` (3) — cap values match Node.js (20/5), asset_bus required, hash shape
- `TestStamp` (5) — append, accumulation, degraded mode, validation, hash-when-omitted
- `TestFindAffected` (7) — chain A→B→C, leaf, blast cap, depth cap, diamond DAG dedup, camelCase cap keys, cache invalidation
- `TestDiff` (2) — multi-hash union + per_hash, empty input
- `TestWriteBlastRadiusReport` (2) — truncated + non-truncated report shapes
- `TestPerformance` (2) — 1000-asset BFS <500ms (B4-04 budget), deep-10 chain
- `TestRealAssetBusIntegration` (1) — end-to-end on real AssetBus when importable

## Performance Verification

B4-04 spec: 1000-asset reverse BFS must complete in <500ms. Perf test builds a 1000-link chain (root → v0 → … → v999) directly via `bus.write` (per plan task-2 option b to keep setup fast — only `find_affected` is timed), then asserts:
- `elapsed_ms < 500`
- `blast_radius == 1000` (no false truncation)
- `truncated is False`
- All 1000 asset_ids reached

**Measured:** full 22-test suite (including perf) completes in **0.10s wall-clock** — far inside the budget. Node.js measured 0.47ms for the BFS alone (informational); Python is in the same order of magnitude.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Perf test chain too deep for default caps**
- **Found during:** Task 2 (perf test run)
- **Issue:** First run returned `blast_radius == 5` — the 1000-deep chain hit the default `max_depth=5` BFS depth cap, then `blast_radius == 20` after raising only max_depth (hit the default `max_blast_radius=20`).
- **Fix:** Construct the tracker for the perf test with `max_depth=1000, max_blast_radius=1000` so the full 1000-asset chain is reachable. This mirrors what the Node.js perf test would also require to traverse a 1000-deep chain (defaults would truncate identically).
- **Files modified:** `tests/test_creative_history.py` (perf test only — production `creative_history.py` untouched, defaults stay 20/5 per spec)
- **Commit:** (folded into final commit before push — pre-fix run was local only)

### Plan Adherence

All other plan directives followed exactly: pure stdlib (no async, no third-party), `collections.deque` for BFS FIFO, snake_case API + camelCase cap response keys, `@dataclass`-free (records are plain dicts per D-33-04), degraded mode returns `False` not raises, validation raises `ValueError`.

## Wave 1 Independence

The plan called for tests to import the sibling-owned `AssetBus` (plan 33-02). At execution start `asset_bus.py` was not yet committed in the working tree. Rather than block, I:
1. Added a small `FakeBus` fixture satisfying the `read(slot) / write(slot, data, envelope=False)` contract that `CreativeHistoryTracker` relies on — keeps the test file runnable in true isolation.
2. Added `TestRealAssetBusIntegration` with `pytest.importorskip("plugins.pipeline_state.asset_bus")` so the real-bus integration is exercised automatically once sibling plan 33-02 lands.

At final test run the real-bus integration test PASSED (sibling plan 33-02 had landed in the interim), so both layers are now covered.

## Known Stubs

None. All data paths flow through real `stamp`/`find_affected`/`diff`/`write_blast_radius_report` — no placeholders, no TODOs.

## Self-Check: PASSED

- File `/data/workspace/hermes-agent/plugins/pipeline_state/creative_history.py` — FOUND (305 LOC > 180 min)
- File `/data/workspace/hermes-agent/plugins/pipeline_state/tests/test_creative_history.py` — FOUND (552 LOC > 220 min)
- Commit `521295c65` — FOUND in `git log` (hermes-agent repo)
- 22 pytest tests passing (≥12 required) — VERIFIED via live run
- BFS uses `collections.deque` — VERIFIED (grep `deque|popleft` matches in creative_history.py)
- DEFAULT_MAX_BLAST_RADIUS=20 / DEFAULT_MAX_DEPTH=5 — VERIFIED (test_asserts exact values)
