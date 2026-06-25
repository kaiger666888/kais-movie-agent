---
phase: 38-openclaw-decoupling-docs-cleanup
plan: 38-01
subsystem: docs-cleanup
tags: [openclaw-removal, v5.0, deprecation, regression-test]
requires: [36, 37]
provides: [openclaw-decoupling-regression-test, deprecated-md-v5-final]
affects:
  - hermes-agent/plugins/kais_aigc/tests/test_openclaw_decoupled.py
  - kais-movie-agent/DEPRECATED.md
  - kais-movie-agent/SKILL.md
  - kais-movie-agent/INTEGRATION.md
tech-stack:
  added: []
  patterns: [AST-based code-grep regression test, HISTORICAL banner doc cleanup]
key-files:
  created:
    - hermes-agent/plugins/kais_aigc/tests/test_openclaw_decoupled.py
  modified:
    - kais-movie-agent/DEPRECATED.md
    - kais-movie-agent/SKILL.md
    - kais-movie-agent/INTEGRATION.md
decisions:
  - AST-scan approach over regex-line-grep for SC#1/SC#3 (mirrors Phase 37 precedent)
  - Test files (test_*.py) excluded from scan target — prevents self-failing on own source
  - SKILL.md banner approach (D-38-04 locked) — 40KB V8.6 body preserved as Phase 36 reference
metrics:
  duration_min: 12
  completed: "2026-06-26"
  tasks: 4
  files_touched: 4
---

# Phase 38 Plan 01: OpenClaw Decoupling + Docs Cleanup Summary

Finalized v5.0 openclaw decoupling at the documentation and reference layer —
3-test regression suite locks the 4 v5.0 deliverable dirs against future drift,
DEPRECATED.md rewritten as v5.0 final notice with actionable migration guide,
and the 3 kais-movie-agent deliverable docs carry HISTORICAL banners where
preserving the V8.6 reference contract had ongoing value.

## Completed Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Regression test (SC#1 + SC#3 + T-38-01) | `hermes-agent@3973e9664` | `plugins/kais_aigc/tests/test_openclaw_decoupled.py` |
| 2 | DEPRECATED.md v5.0 final notice (SC#2) | `kais-movie-agent@f958164` | `DEPRECATED.md` |
| 3 | SKILL.md + INTEGRATION.md cleanup | `kais-movie-agent@f958164` | `SKILL.md`, `INTEGRATION.md` |
| 4 | Full regression verification | (no commit) | — |

## Verification Results

| Check | Expected | Actual |
|-------|----------|--------|
| `test_openclaw_references_zero_in_v5_deliverables` | PASSED | PASSED (SC#1, OPENCLAW-REMOVE-01) |
| `test_no_nodejs_runtime_dependency_in_v5_deliverables` | PASSED | PASSED (SC#3, OPENCLAW-REMOVE-03) |
| `test_deprecated_md_points_to_live_skill` | PASSED | PASSED (T-38-01 mitigation) |
| Full v5.0 regression | 498 passed | **498 passed, 9 warnings** (495 baseline + 3 new) |
| DEPRECATED.md grep (v5.0 / Superseded By / skill path / Migration Guide) | ≥4 hits | 16 hits |
| All migration paths live (ls verified) | all OK | all 9 paths OK (SKILL.md, runner.py, 4 plugin dirs, 4 client modules) |
| Stale framing outside HISTORICAL banners | 0 hits | 0 hits outside banners (4 SKILL.md hits are below the HISTORICAL banner) |

## Success Criteria Met

- **SC#1 (OPENCLAW-REMOVE-01)**: `test_openclaw_references_zero_in_v5_deliverables`
  PASSED — AST-scans 4 v5.0 deliverable dirs for openclaw / Toonflow /
  `sessions_spawn(runtime="acp")`. Zero executable-code hits.
- **SC#2 (OPENCLAW-REMOVE-02)**: DEPRECATED.md rewritten to v5.0 final notice
  with 6-row migration table, behavioral equivalence statement, and live-path
  verification.
- **SC#3 (OPENCLAW-REMOVE-03)**: `test_no_nodejs_runtime_dependency_in_v5_deliverables`
  PASSED — AST-scans for `require(` / `subprocess.run(node)` /
  `import package.json` / `child_process` / `npm install`. Zero hits.
- **Doc cleanup**: SKILL.md carries HISTORICAL banner (D-38-04 locked, 40KB V8.6
  body preserved as Phase 36 port reference). INTEGRATION.md carries HISTORICAL
  banner + L62 stale "计划迁移至 openclaw" replaced with v5.0 completion framing.
  README.md already clean (zero hits).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] SC#1/SC#3 test switched from regex-line-grep to AST scan**

- **Found during:** Task 1 (first test run)
- **Issue:** The plan's `<interfaces>` sketch used a regex-line-grep with
  `ABSENCE_DECL_RE` to filter absence-declarations. In practice this produced
  false positives on legitimate docstring declarations of absence
  (e.g. `canvas_sync.py:29: "No openclaw / Toonflow / sqlite references"`)
  and on the SC#1 verification tests themselves
  (`test_no_openclaw_references_in_phase_37_deliverables`).
- **Fix:** Adopted the Phase 37 precedent's AST-walk approach (from
  `test_canvas_sync_integration.py::TestNoLegacyReferences`):
  (a) AST-walk skips docstring Constant ids;
  (b) `test_*.py` files are excluded from the scan target list (a test
  necessarily references the forbidden names to assert their absence).
  This is more robust than regex absence-declaration filtering because it
  cannot be defeated by creative phrasing.
- **Files modified:** `hermes-agent/plugins/kais_aigc/tests/test_openclaw_decoupled.py`
- **Commit:** `hermes-agent@3973e9664`

**2. [Rule 2 - Missing critical functionality] Test file exclusion documented**

- **Found during:** Task 1 deviation analysis
- **Issue:** Without excluding `test_*.py` from the scan, any regression test
  for SC#1/SC#3 would be self-failing (its own source contains `openclaw` and
  `require(` literals in regex patterns). CONTEXT.md D-38-05 anticipated this
  via absence-declaration filtering but the AST approach is cleaner.
- **Fix:** Added `TEST_FILE_RE` pattern and `_iter_production_files()` helper
  that skips test files. Documented the rationale in the module docstring
  (mirrors Phase 37's comment on the same design choice).
- **Files modified:** same as Deviation 1
- **Commit:** same as Deviation 1

No other deviations. Plan executed as written (all 4 tasks, all 3 SC met,
all decisions from CONTEXT.md honored: D-38-01 single plan, D-38-02 full
rewrite, D-38-03 test location, D-38-04 SKILL.md banner, D-38-05 absence-filter
equivalent — superseded by AST approach).

## Migration Guide Path Verification (T-38-01)

All 9 paths in DEPRECATED.md's migration table were `ls`-verified live before
commit:

| Path | Status |
|------|--------|
| `hermes-agent/skills/kais-movie-pipeline/SKILL.md` | OK |
| `hermes-agent/skills/kais-movie-pipeline/pipeline/runner.py` | OK |
| `hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p01_*.py`–`p13_*.py` | OK (p01_hook_topic.py confirmed) |
| `hermes-agent/plugins/kais_aigc/canvas_sync.py` | OK |
| `hermes-agent/plugins/pipeline_state/` | OK |
| `hermes-agent/plugins/review_gates/` | OK |
| `hermes-agent/plugins/kais_aigc/gold_team.py` | OK |
| `hermes-agent/plugins/kais_aigc/review_platform.py` | OK |
| `hermes-agent/plugins/kais_aigc/canvas.py` | OK |
| `hermes-agent/plugins/kais_aigc/jimeng.py` | OK |

## TDD Gate Compliance

Not applicable — this plan has `type: execute`, not `type: tdd`. The regression
test added in Task 1 is a verification artifact, not a TDD RED/GREEN cycle.

## Threat Flags

None. No new trust boundaries, network endpoints, auth paths, or schema changes
introduced. The regression test is a read-only AST scanner.

## Self-Check: PASSED

- File `hermes-agent/plugins/kais_aigc/tests/test_openclaw_decoupled.py`: FOUND
- File `kais-movie-agent/DEPRECATED.md` (rewritten): FOUND (16 grep hits for v5.0/Superseded/path/Migration)
- File `kais-movie-agent/SKILL.md` (banner added): FOUND (HISTORICAL banner at top)
- File `kais-movie-agent/INTEGRATION.md` (banner + L62 update): FOUND (HISTORICAL banner + v5.0 completion framing)
- Commit `3973e9664` in hermes-agent: FOUND
- Commit `f958164` in kais-movie-agent: FOUND
- 498 passed in full v5.0 regression: confirmed via pytest run
