---
phase: 40-rapid-preview-tier
plan: 04
subsystem: testing
tags: [pytest, integration-tests, regression-guard, tdd, rapid-preview, p10b]

# Dependency graph
requires:
  - phase: 40-01
    provides: "rapid-preview-clips + episode-meta AssetBus slots; 14-phase PHASE_REGISTRY (p10b inserted); plan-01 unit/regression test updates"
  - phase: 40-02
    provides: "PreviewEngine ABC + SlideshowEngine (FFmpeg subprocess) + LTXVideoEngine (httpx); select_engine factory + D-09 degrade-first contract"
  - phase: 40-03
    provides: "p10b_rapid_preview.run() skeleton + variant builder (BLOCKER #4 cycling matrix) + degrade WARN path (episode-meta flag)"
provides:
  - "5 cross-cutting integration test files (39 tests total) verifying dual-engine E2E + JSONL format + WARN-level degrade + full-DAG runner integration + V5.0 regression baseline"
  - "RAPID-PREVIEW-02/05/07 explicit verification coverage (BLOCKER #1 episode-meta slot-name disambiguation + BLOCKER #4 cycling matrix coverage + WARNING #9 full-DAG integration)"
  - "V5.0 502-test regression guard via subprocess isolation (final gate before Phase 40 marked complete)"
affects: [phase-41-recipe-library, phase-42-feedback-ingest, operator-side-monitoring]

# Tech tracking
tech-stack:
  added: []  # pure verification plan — no new libraries
  patterns:
    - "Subprocess-isolated regression tests (avoids import-state contamination from v6.0 tests)"
    - "Pytest caplog for strict WARN-level verification (not INFO, not ERROR)"
    - "Autouse fixture to force-restore real p10b module in PHASE_REGISTRY (defends against test_runner_full_dag.py's _P10bStubProxy swap leaking via importlib.reload rebinding)"
    - "Shell-redirection output capture for nested-pytest subprocess (robust against -q suppressing the summary line under parent-pytest)"

key-files:
  created:
    - "/data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_p10b_dual_engine_e2e.py"
    - "/data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_p10b_jsonl_format.py"
    - "/data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_p10b_degrade_warning.py"
    - "/data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_p10b_full_dag_integration.py"
    - "/data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_v50_regression.py"
  modified: []

key-decisions:
  - "Plan type = tdd: every behavior is an assertion against an observable output (log record, JSONL content, slot name, test count)"
  - "Slot name is `rapid-preview-clips` (NOT `preview-clips`) — Test 1 of test_p10b_jsonl_format.py asserts file extension is .jsonl under .pipeline-assets/"
  - "Slot name is `episode-meta` for preview_skipped flag (NOT `pipeline-state`) — Test 9 of test_p10b_degrade_warning.py is a NEGATIVE assertion that NO call targets `pipeline-state`"
  - "BLOCKER #4 cycling matrix coverage asserted at JSONL file level (Test 11 of test_p10b_jsonl_format.py) — not just unit-test level"
  - "WARNING #9 fix: dedicated E2E test asserts `result['phases']['p10b_rapid_preview']` exists with expected shape after full DAG run with mocked engines (TestP10bFullDagIntegration)"
  - "V5.0 502-test regression guard via subprocess.run + shell redirection (avoids -q suppression of summary line under parent-pytest)"
  - "Pre-existing out-of-scope failure: test_no_openclaw_references_in_phase_37_deliverables (canvas_sync sqlite references from BEFORE Phase 40) — documented, NOT fixed by Phase 40"

patterns-established:
  - "Subprocess isolation pattern: regression tests that invoke pytest in a clean subprocess to avoid v6.0 import-state contamination"
  - "Strict WARN-level verification: caplog fixture + filter on levelno==WARNING (not >= WARNING) to catch silent INFO downgrade (T-40-16)"
  - "Slot-name negative assertions: explicit `assert 'wrong-name' not in writes` to catch silent slot renames (T-40-20)"

requirements-completed:
  - RAPID-PREVIEW-02
  - RAPID-PREVIEW-05
  - RAPID-PREVIEW-07

# Metrics
duration: ~35min
completed: 2026-06-27
---

# Phase 40 Plan 04: Rapid Preview Tier — Verification Summary

**39 cross-cutting integration tests verifying dual-engine E2E + JSONL format + WARN-level degrade + full-DAG runner integration + V5.0 502-test regression baseline preserved.**

## Performance

- **Duration:** ~35 min (incl. subprocess-isolated regression runs)
- **Tasks:** 6/6 complete
- **Files created:** 5 test files (all in `skills/kais-movie-pipeline/tests/`)
- **Total Phase 40-04 tests added:** 39 (5 + 11 + 9 + 6 + 8)

## Accomplishments

- RAPID-PREVIEW-02 (dual-engine integration) verified end-to-end with mocked FFmpeg subprocess + mocked httpx — both SlideshowEngine and LTXVideoEngine paths produce rapid-preview-clips records via the real p10b.run() fan-out, each tagged with the correct `engine` field.
- RAPID-PREVIEW-05 (WARN-level degrade signaling) verified strictly: degrade level is EXACTLY `logging.WARNING` (NOT INFO, NOT ERROR); message contains canonical `preview_skipped` token + episode_id for operator correlation; episode-level WARN fires exactly once on full degrade (silent on partial).
- RAPID-PREVIEW-07 (test coverage complete) verified across 5 dimensions: (a) dual-engine paths produce previews, (b) degrade path emits warning not silent skip + flag on correct slot, (c) rapid-preview-clips JSONL format valid (6-field + single-delta contract), (d) full-DAG runner integration works (WARNING #9), (e) V5.0 502-test baseline explicitly preserved.
- BLOCKER #1 (episode-meta slot disambiguation) verified via Test 4 + Test 9 of `test_p10b_degrade_warning.py`: positive assertion that the 3-key shape `{episode_id, preview_skipped: True, skip_reason}` lands on `episode-meta`, AND negative assertion that ZERO writes target `pipeline-state`.
- BLOCKER #4 (cycling matrix coverage) verified at the JSONL file level (Test 11 of `test_p10b_jsonl_format.py`): 4-shot fixture produces 12 records, `turning_points_sec` appears in >=1 variant across the episode, union of all structure_delta keys == all 4 params.
- WARNING #9 (full-DAG integration) verified via dedicated `test_p10b_full_dag_integration.py`: runner iterates PHASE_REGISTRY to p10b; `result["phases"]["p10b_rapid_preview"]` exists with expected shape after full DAG run; p10_voice → p10b_rapid_preview → p11_video_render relative order in checkpoint saves; degrade path doesn't break DAG (runner proceeds to p11).
- V5.0 502-test regression baseline explicitly guarded: subprocess-isolated run asserts the total passing count >= 502 (actual: 676 passed); all canonical V5.0 test files still exist on disk (T-40-17 mitigation).

## Task Commits

Each task was committed atomically:

1. **Task 1: Dual-engine end-to-end test (mocked FFmpeg + mocked HTTP)** — `5ded22463` (test)
2. **Task 2: rapid-preview-clips JSONL format validation (incl. BLOCKER #4 cycling matrix)** — `14230e96c` (test)
3. **Task 3: WARN-level degrade + episode-meta slot (BLOCKER #1)** — `a1903b8db` (test)
4. **Task 4: Full DAG integration test (WARNING #9)** — `5e19b7772` (test)
5. **Task 5: V5.0 regression guard (502-test baseline)** — `e8ad4bc4a` (test)
6. **Task 6: Phase 40 SUMMARY** — this commit (docs)

**Plan type = tdd:** All 5 test files are pure verification — they assert against observable outputs (log records, JSONL content, slot names, test counts). GREEN state was already achieved by plans 02 + 03 production code; plan 04 closes the cross-cutting verification gap.

## Files Created

- `/data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_p10b_dual_engine_e2e.py` — 5 dual-engine E2E tests (RAPID-PREVIEW-02)
- `/data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_p10b_jsonl_format.py` — 11 JSONL format tests (RAPID-PREVIEW-07c, BLOCKER #4)
- `/data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_p10b_degrade_warning.py` — 9 strict WARN-level + episode-meta tests (RAPID-PREVIEW-05, BLOCKER #1)
- `/data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_p10b_full_dag_integration.py` — 6 full-DAG integration tests (WARNING #9)
- `/data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_v50_regression.py` — 8 subprocess-isolated V5.0 regression tests (T-40-17, T-40-18)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] `_StubBus` needed JSONL-aware writes for rapid-preview-clips**
- **Found during:** Task 4
- **Issue:** The plan's `_StubBus.write` (mirrored from test_runner_full_dag.py) unconditionally overwrites slots; for the jsonl-format `rapid-preview-clips` slot, this would lose records after the first variant.
- **Fix:** Added JSONL-format detection via `ASSET_SCHEMA[slot]["format"]` in `_StubBus.write` — appends to a list when slot is jsonl-format, overwrites otherwise. Also records every (slot, entry) pair to a `writes` side-channel for assertions.
- **Files modified:** `test_p10b_full_dag_integration.py` (local test double — no production code changed)
- **Commit:** `5e19b7772`

**2. [Rule 3 - Blocking issue] test_runner_full_dag.py's `_P10bStubProxy` swap leaks across tests**
- **Found during:** Task 4
- **Issue:** `test_runner_full_dag.py::TestFullDagRun` uses an autouse fixture to swap p10b in PHASE_REGISTRY with `_P10bStubProxy` (a no-op stub from the plan 01 boundary). The fixture restores the registry on teardown, BUT `test_p03_unit.py` calls `importlib.reload(phases_mod)` which rebinds `phases_mod.PHASE_REGISTRY` to a new list — leaving `runner_mod.PHASE_REGISTRY` holding the OLD list (still containing the stub proxy). When `test_p10b_full_dag_integration.py` runs after, it sees the stub proxy, not the real p10b module, so outputs are empty `{}`.
- **Fix:** Added an autouse fixture `_restore_real_p10b_in_both_registries` to `TestP10bFullDagIntegration` that force-overrides p10b in BOTH `phases_mod.PHASE_REGISTRY` AND `runner_mod.PHASE_REGISTRY` with the real module before each test. Restores whatever was there on teardown (defensive).
- **Files modified:** `test_p10b_full_dag_integration.py` (local fixture — no production code changed)
- **Commit:** `5e19b7772`

**3. [Rule 3 - Blocking issue] `-q` flag suppresses pytest summary line under nested-pytest invocation**
- **Found during:** Task 5
- **Issue:** The plan's Test 7 (total test count assertion) originally used `-q --tb=no` extra_args. When invoked from inside a pytest parent process, `-q` suppresses the final summary line (`N passed in X.XXs`), making the regex parse fail. This appears to be a pytest 9.0.3 quirk with nested invocations.
- **Fix:** Removed `-q` from the Test 7 invocation (uses default verbosity). Also switched from `subprocess.run(stdout=PIPE)` to shell redirection to a temp file for robustness against pytest's parent-process capture interference.
- **Files modified:** `test_v50_regression.py` (local test infrastructure)
- **Commit:** `e8ad4bc4a`

## Pre-existing Out-of-Scope Failure (Documented, NOT Fixed)

**`plugins/kais_aigc/tests/test_canvas_sync_integration.py::TestNoLegacyReferences::test_no_openclaw_references_in_phase_37_deliverables`**

- **Status:** Pre-existing — from BEFORE Phase 40 started.
- **Cause:** `canvas_sync.py` references sqlite databases that contain "openclaw" in their path (Phase 37 deliverable). The test scans for legacy references and trips on these.
- **Phase 40 impact:** None — Phase 40 added 174 tests (502 → 676 passing) without touching canvas_sync.py.
- **Disposition:** Documented in user's pre-execution context as "pre-existing out-of-scope item — logged, not yours to fix." Phase 41+ may address via canvas_sync migration.

## Authentication Gates

None encountered.

## RAPID-PREVIEW-XX Requirement Coverage (Phase 40 Complete)

| Requirement | Plans Covering | Tests Verifying |
|-------------|----------------|-----------------|
| RAPID-PREVIEW-01 (p10b PHASE_REGISTRY insertion) | 40-01 | test_phase_registry_full.py (V5.0), test_p10b_full_dag_integration.py Test 6 |
| RAPID-PREVIEW-02 (dual-engine integration E2E) | 40-02, 40-04 | test_p10b_dual_engine_e2e.py (5 tests) |
| RAPID-PREVIEW-03 (PreviewEngine ABC + factory) | 40-02 | test_preview_engine.py (plan 02) |
| RAPID-PREVIEW-04 (rapid-preview-clips JSONL schema) | 40-01, 40-03, 40-04 | test_asset_bus.py (plan 01), test_p10b_unit.py (plan 03), test_p10b_jsonl_format.py (11 tests) |
| RAPID-PREVIEW-05 (WARN-level degrade signaling + episode-meta flag) | 40-03, 40-04 | test_p10b_unit.py::TestP10bDegradePath (plan 03), test_p10b_degrade_warning.py (9 tests) |
| RAPID-PREVIEW-06 (no new review gate for p10b) | 40-01 | test_phase_registry_full.py (asserts GATE_ID is None) |
| RAPID-PREVIEW-07 (test coverage complete) | 40-02, 40-03, 40-04 | All Phase 40 test files |

## Slot Naming Decisions (BLOCKERS #1 + #5)

- **`rapid-preview-clips`** (NOT `preview-clips`): Renamed to avoid namespace collision with v3.0-era SKILL.md p06.5 future slot. Verified by Test 1 of `test_p10b_jsonl_format.py` (file extension is .jsonl) + Test 5 of `test_p10b_full_dag_integration.py` (slot populated with correct shape).
- **`episode-meta`** (NOT `pipeline-state`): Disambiguated from PipelineStateStore's `pipeline-state.json` file. Verified by Test 4 (positive: episode-meta has 3-key shape) + Test 9 (negative: ZERO writes to pipeline-state) of `test_p10b_degrade_warning.py`.

## Variant Generation Rule (BLOCKER #4 — CYCLING Matrix)

For shot at index N (0-based), the 3 variants are selected by:
```
STRUCTURE_PARAMS[(N + offset) % len(STRUCTURE_PARAMS)] for offset in range(VARIANTS_PER_SHOT)
```
where `STRUCTURE_PARAMS = (hook_position_sec, emotion_sequence, turning_points_sec, ending_state)`.

Concrete cycling (VARIANTS_PER_SHOT=3, len(STRUCTURE_PARAMS)=4):
- Shot 0: `[hook_position_sec, emotion_sequence, turning_points_sec]`
- Shot 1: `[emotion_sequence, turning_points_sec, ending_state]`
- Shot 2: `[turning_points_sec, ending_state, hook_position_sec]`
- Shot 3: `[ending_state, hook_position_sec, emotion_sequence]`
- Shot 4: same as shot 0 (cycles)

Across shots 0..3 ALL 4 params are covered (each appears in exactly 3 of the 4 shots). Verified by Test 11 of `test_p10b_jsonl_format.py` (BLOCKER #4 explicit: `turning_points_sec` appears in >=1 variant across a 4-shot episode at the JSONL file level).

## Degrade Semantics (RAPID-PREVIEW-05)

- **Per-variant degrade:** Silent (counted in `outputs.variants_degraded`). Recoverable — successes still flow to rapid-preview-clips. Verified by Test 5 of `test_p10b_degrade_warning.py`.
- **Episode-level full-degrade:** Triggers WARN log + `preview_skipped: True` flag written to `episode-meta` AssetBus slot (BLOCKER #1 — NOT pipeline-state). Verified by Tests 1-4 + 7-9 of `test_p10b_degrade_warning.py`.
- **WARN token:** Literal `preview_skipped` (canonical monitoring grep target) + episode_id for correlation. Verified by Tests 2-3.
- **WARN level:** Exactly `logging.WARNING` (NOT INFO, NOT ERROR). Verified by Test 1.
- **WARN frequency:** Exactly once on episode-level full degrade (not per-shot, not per-variant). Verified by Test 7.

## V5.0 Baseline Preservation

- **V5.0 SHIPPED baseline:** 502 tests passing.
- **Phase 40 final count:** 676 passed, 1 failed (pre-existing canvas_sync out-of-scope), 9 warnings.
- **Delta:** +174 tests added (plan 01: ~20 AssetBus/registry; plan 02: ~26 PreviewEngine; plan 03: ~89 p10b unit + DAG updates; plan 04: 39 cross-cutting integration).
- **Regression guard:** `test_v50_regression.py::test_total_test_count_meets_v50_baseline` asserts `>= 502` via subprocess isolation (T-40-18 mitigation: uses `>=` to allow granularity variance).
- **File preservation guard:** `test_v50_regression.py::test_no_v50_test_file_deleted` asserts all 19 canonical V5.0 test files still exist on disk (T-40-17 mitigation).

## Self-Check

### Files Exist

- `test_p10b_dual_engine_e2e.py` — FOUND
- `test_p10b_jsonl_format.py` — FOUND
- `test_p10b_degrade_warning.py` — FOUND
- `test_p10b_full_dag_integration.py` — FOUND
- `test_v50_regression.py` — FOUND

### Commits Exist

- `5ded22463` — FOUND (test(40-04): RED/GREEN — add dual-engine E2E integration tests)
- `14230e96c` — FOUND (test(40-04): RED/GREEN — add rapid-preview-clips JSONL format tests)
- `a1903b8db` — FOUND (test(40-04): RED/GREEN — add WARN-level degrade + episode-meta tests)
- `5e19b7772` — FOUND (test(40-04): RED/GREEN — add full-DAG p10b integration tests)
- `e8ad4bc4a` — FOUND (test(40-04): RED/GREEN — add V5.0 regression guard)

## Self-Check: PASSED

## Phase 40 Status: READY FOR VERIFICATION

All 7 RAPID-PREVIEW-XX requirements satisfied. V5.0 502-test baseline preserved (+174 tests). Phase 40 deliverables:

- p10b_rapid_preview.py (real implementation, plan 03)
- PreviewEngine ABC + SlideshowEngine + LTXVideoEngine (plan 02)
- rapid-preview-clips + episode-meta AssetBus slots (plan 01)
- 39 cross-cutting integration tests + V5.0 regression guard (plan 04)
