---
phase: 42-feedback-ingestion
plan: 01
subsystem: kais_aigc/feedback_ingest
tags: [python, assetbus, jsonl, tdd, pure-stdlib, skeleton]

# Dependency graph
requires:
  - phase: 41-emotion-recipe-library
    provides: RecipeLibrary class (duck-typed; 42-02 will call update_validation)
  - phase: 33-asset-bus-v3
    provides: AssetBus.append_line/read_lines JSONL dispatch (V5.0)
provides:
  - FeedbackIngestClient skeleton class (plugins/kais_aigc/feedback_ingest.py) with __init__ + get_feedback + submit_feedback stub + close/__enter__/__exit__ lifecycle
  - 2 new AssetBus JSONL slots: feedback-data (raw accepted feedback) + feedback-rejected (audit trail)
  - Default port 8091 (KAIS_FEEDBACK_PORT env, sibling to gold-team :8002 + review :8090)
affects:
  - Plan 42-02 HMAC verification + 4-stage validation pipeline (uses FeedbackIngestClient + both slots)
  - Plan 42-03 Starlette HTTP server wiring + list_pending_updates (uses FeedbackIngestClient skeleton + port config)
  - Plan 42-04 E2E closure + V5.0/40/41 regression guard + structural no-auto-modify-pipeline grep test
  - plugins.pipeline_state.asset_bus (ASSET_SCHEMA gains 2 entries — 36 slots total)
  - plugins.pipeline_state.tests.test_v50_regression_phase41 (snapshot updated)
  - plugins.pipeline_state.tests.test_asset_bus_phase35_slots (JSONL list snapshot updated)

tech-stack:
  added: []
  patterns:
    - append-only AssetBus slot extension (D-36-05 — V5.0/Phase 40/41 slots byte-equivalent; only appends)
    - TDD RED→GREEN per task (test commit + feat commit per task)
    - Constructor env-var resolution at construction time (D-06 — KAIS_FEEDBACK_PORT/SECRET read in __init__, not at module import)
    - Sync API (D-07 — no async, no threads, no httpx in skeleton)
    - Duck-typed RecipeLibrary dependency (avoid hard import to prevent cycle)
    - Stub envelope contract for deferred implementation (submit_feedback returns {status: not_implemented, reason: ...} — callers/tests pin skeleton without coupling to 42-02/42-03 internals)
    - Context-manager lifecycle mirroring GoldTeamClient / ReviewPlatformClient

key-files:
  created:
    - /data/workspace/hermes-agent/plugins/kais_aigc/feedback_ingest.py
    - /data/workspace/hermes-agent/plugins/kais_aigc/tests/test_feedback_ingest_skeleton.py
    - /data/workspace/hermes-agent/plugins/pipeline_state/tests/test_asset_bus_feedback_slots.py
  modified:
    - /data/workspace/hermes-agent/plugins/pipeline_state/asset_bus.py (2 new ASSET_SCHEMA entries appended after emotion-recipe; comment header documents D-36-05 preservation)
    - /data/workspace/hermes-agent/plugins/pipeline_state/tests/test_asset_bus_phase35_slots.py (JSONL slot list snapshot extended to 5 entries — deviation Rule 3)
    - /data/workspace/hermes-agent/plugins/pipeline_state/tests/test_v50_regression_phase41.py (EXPECTED_SLOTS snapshot extended to 36 entries — deviation Rule 3)

key-decisions:
  - "submit_feedback ships as a documented stub envelope {status: not_implemented, reason: 'Phase 42-02 (HMAC + validation) + 42-03 (HTTP server) pending'} — lets callers and tests pin the skeleton contract today without coupling to implementation details that haven't landed"
  - "Constructor takes recipe_library: Any (duck-typed) rather than hard-importing RecipeLibrary — prevents a potential import cycle if RecipeLibrary ever imports this module"
  - "DEFAULT_FEEDBACK_PORT = 8091 per CONTEXT.md — sibling to gold-team :8002 and review-platform :8090 so a single host can run all three services without port conflicts"
  - "close() is a no-op in skeleton — defined today so context-manager protocol works for callers that wrap construction in a `with` block; 42-03 will add httpx client teardown"
  - "JSONL_SLOTS frozenset UNCHANGED at frozenset({'finetune-dataset'}) — dispatch consults ASSET_SCHEMA[slot]['format'] directly (verified Phase 40-01 + 41-01 pattern)"
  - "Both new slots use writer_phase='feedback_ingest' (Phase 42 owns both; reader_phases=[] per blueprint — operator-side + RecipeLibrary.update_validation consume but they aren't registered pipeline phases)"
  - "Pre-existing Phase 41 snapshot tests (test_v50_regression_phase41.EXPECTED_SLOTS + test_asset_bus_phase35_slots.test_jsonl_slots_unchanged) extended rather than preserved as-is — they asserted exact-set equality with pre-Phase-42 state, and the plan's append-only contract necessarily extends that set"

patterns-established:
  - "Stub-envelope contract: deferred-implementation methods return {status: 'not_implemented', reason: '<cites future plans>'} so downstream tests can lock the skeleton surface today"
  - "Phase 42 continues the D-36-05 append-only ASSET_SCHEMA extension pattern — new slots are appended after the most recent phase's entries, with a comment header documenting preservation"

requirements-completed:
  - FEEDBACK-INGEST-01
  - FEEDBACK-INGEST-03

metrics:
  duration: 5min
  completed: 2026-06-27
  loc:
    feedback_ingest.py: 202
    test_feedback_ingest_skeleton.py: 207
    test_asset_bus_feedback_slots.py: 147
  tests_added: 21 (11 slot + 10 skeleton)
  commits: 4 (2 RED + 2 GREEN)
---

# Phase 42 Plan 01: Feedback Ingestion Skeleton Summary

Registered 2 new AssetBus JSONL slots (feedback-data + feedback-rejected, both writer_phase=feedback_ingest) and scaffolded FeedbackIngestClient with __init__/get_feedback + submit_feedback stub envelope — JSONL_SLOTS frozenset UNCHANGED, V5.0+Phase 40+Phase 41 baseline regression-clean.

## Performance

- **Duration:** ~5 min
- **Started:** 2026-06-27T12:07:36Z
- **Completed:** 2026-06-27T12:12:10Z
- **Tasks:** 2/2 complete
- **Files modified:** 5 (3 created + 2 modified)

## Accomplishments

- Registered 2 new AssetBus JSONL slots (`feedback-data`, `feedback-rejected`) with correct file/format/writer_phase metadata, preserving the D-36-05 append-only invariant (no existing slot modified, JSONL_SLOTS frozenset unchanged).
- Created `plugins/kais_aigc/feedback_ingest.py` with `FeedbackIngestClient` skeleton: `__init__` validates both required deps + reads `KAIS_FEEDBACK_PORT`/`KAIS_FEEDBACK_SECRET` env vars at construction time; `get_feedback(episode_id=...)` reads + filters the feedback-data slot; `submit_feedback` returns a documented stub envelope; `close`/`__enter__`/`__exit__` provide context-manager lifecycle.
- Documented the STRUCTURAL "not auto-modify pipeline" invariant (FEEDBACK-INGEST-05) in the module header — no imports from `pipeline.phases.*`, `runner`, or `preview_engine`. The only references are RecipeLibrary (Phase 41, duck-typed), AssetBus (V5.0), and stdlib.
- All success criteria met: 11/11 slot tests + 10/10 skeleton tests GREEN; 497 pipeline_state+kais_aigc combined sweep GREEN; V5.0 + Phase 40 + Phase 41 regression subprocess tests GREEN.

## Task Commits

Each task was committed atomically (TDD: RED → GREEN):

1. **Task 1 RED: failing slot tests** — `f0890782f` (test)
2. **Task 1 GREEN: register feedback slots + update snapshots** — `c0743b142` (feat)
3. **Task 2 RED: failing skeleton tests** — `ed645e9dd` (test)
4. **Task 2 GREEN: FeedbackIngestClient skeleton module** — `d1d52fcaa` (feat)

**Plan metadata:** (pending final docs commit)

## Files Created/Modified

- `/data/workspace/hermes-agent/plugins/kais_aigc/feedback_ingest.py` — FeedbackIngestClient skeleton (202 LOC). __init__ + get_feedback + submit_feedback stub + close/__enter__/__exit__. No httpx/starlette imports (deferred to 42-03).
- `/data/workspace/hermes-agent/plugins/kais_aigc/tests/test_feedback_ingest_skeleton.py` — 10 skeleton tests (207 LOC). Constructor validation + get_feedback read+filter + stub envelope + context-manager + env-var config.
- `/data/workspace/hermes-agent/plugins/pipeline_state/tests/test_asset_bus_feedback_slots.py` — 11 slot tests (147 LOC). Slot metadata + JSONL_SLOTS frozenset invariant + round-trip append/read.
- `/data/workspace/hermes-agent/plugins/pipeline_state/asset_bus.py` — 2 new ASSET_SCHEMA entries (feedback-data + feedback-rejected) appended after emotion-recipe with D-36-05 preservation comment header.
- `/data/workspace/hermes-agent/plugins/pipeline_state/tests/test_asset_bus_phase35_slots.py` — JSONL slot list snapshot extended to include the 2 new entries (Rule 3 deviation).
- `/data/workspace/hermes-agent/plugins/pipeline_state/tests/test_v50_regression_phase41.py` — EXPECTED_SLOTS snapshot extended from 34 to 36 entries (Rule 3 deviation).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated 2 stale slot-set snapshot tests**
- **Found during:** Task 1 GREEN phase
- **Issue:** Two pre-existing Phase 41 / Phase 35 regression tests asserted exact equality between the live ASSET_SCHEMA slot set and a hardcoded snapshot. Adding the 2 new Phase 42 slots necessarily broke these snapshots:
  - `test_asset_bus_phase35_slots.py::TestNewSlotsSchemaMetadata::test_jsonl_slots_unchanged` — asserted JSONL slot list was exactly `[finetune-dataset, rapid-preview-clips, emotion-recipe]`
  - `test_v50_regression_phase41.py::TestV50RegressionPhase41::test_asset_schema_contains_all_expected_slots` — asserted ASSET_SCHEMA keys were exactly the 34 pre-Phase-42 slots
- **Fix:** Extended both snapshots to include `feedback-data` + `feedback-rejected` (Phase 42 additions), bringing the canonical slot count to 36. Updated the explanatory docstrings to cite Phase 42 as the source of the extension.
- **Files modified:** `test_asset_bus_phase35_slots.py`, `test_v50_regression_phase41.py`
- **Commit:** `c0743b142`
- **Justification:** The plan's success criterion "V5.0 + Phase 40 + Phase 41 baseline must stay green" cannot be satisfied if these snapshots drift — updating them is the canonical way V5.0 + Phase 40 + Phase 41 themselves handled additive slot changes (the Phase 41 emotion-recipe slot was similarly added to the JSONL snapshot). The snapshots are documentary, not load-bearing invariants; their purpose is to surface unexpected drift, not to forbid legitimate extension.

No other deviations. Plan executed exactly as written apart from this necessary snapshot maintenance.

## Verification Results

| Check | Result |
|-------|--------|
| 11/11 new slot tests (test_asset_bus_feedback_slots.py) | GREEN |
| 10/10 new skeleton tests (test_feedback_ingest_skeleton.py) | GREEN |
| 325/325 pipeline_state tests (excluding slow subprocess regression) | GREEN |
| 172/172 kais_aigc tests (excluding slow canvas_sync integration) | GREEN |
| V5.0 AssetBus canonical tests (subprocess isolation) | GREEN |
| Phase 40 p10b unit tests (subprocess isolation) | GREEN |
| Phase 41 EXPECTED_SLOTS snapshot | GREEN (extended to 36) |
| Phase 41 JSONL_SLOTS frozenset invariant | GREEN (unchanged at `{finetune-dataset}`) |
| FEEDBACK-INGEST-05 structural check (no banned imports) | PASS — only `logging` + `os` + `typing` stdlib imports |
| No httpx/starlette imports in skeleton | PASS (deferred to 42-03) |
| STRUCTURAL "not auto-modify pipeline" comment present | PASS (module docstring lines 28-35) |

## Known Stubs

| Stub | File | Lines | Reason | Resolved By |
|------|------|-------|--------|-------------|
| `submit_feedback(body, signature)` returns `{status: "not_implemented", reason: "..."}` | `/data/workspace/hermes-agent/plugins/kais_aigc/feedback_ingest.py` | 154-172 | Plan 42-01 ships skeleton only; full HMAC verification + 4-stage validation pipeline arrives in 42-02 | Plan 42-02 (HMAC + validation) + 42-03 (HTTP server wiring) |
| `close()` is a no-op | `/data/workspace/hermes-agent/plugins/kais_aigc/feedback_ingest.py` | 184-192 | Skeleton has no httpx client to close; 42-03 adds the server and the resource teardown | Plan 42-03 (HTTP server) |

These stubs are **intentional and documented in the plan** — plan 42-01's `must_haves.truths` explicitly states "submit_feedback method exists with correct signature (no impl yet — full impl in 42-02/03)". They do not prevent the plan's goal from being achieved (scaffold the surface for 42-02/42-03 to fill in).

## Self-Check: PASSED

- [x] `/data/workspace/hermes-agent/plugins/kais_aigc/feedback_ingest.py` exists
- [x] `/data/workspace/hermes-agent/plugins/kais_aigc/tests/test_feedback_ingest_skeleton.py` exists
- [x] `/data/workspace/hermes-agent/plugins/pipeline_state/tests/test_asset_bus_feedback_slots.py` exists
- [x] `/data/workspace/hermes-agent/plugins/pipeline_state/asset_bus.py` modified (2 new ASSET_SCHEMA entries)
- [x] Commit `f0890782f` found in git log
- [x] Commit `c0743b142` found in git log
- [x] Commit `ed645e9dd` found in git log
- [x] Commit `d1d52fcaa` found in git log
