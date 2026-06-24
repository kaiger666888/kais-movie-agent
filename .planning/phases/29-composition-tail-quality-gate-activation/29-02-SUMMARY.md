---
phase: 29-composition-tail-quality-gate-activation
plan: 02
subsystem: composition-tail
tags: [delivery, master-mp4, web-preview, degrade-tolerant, quality-report, pipe-compose-02]
requires:
  - "Phase 29 Plan 01 composition handler (now writes master.mp4 + web-preview.mp4)"
provides:
  - "delivery handler validates master.mp4 (not final.mp4) at workdir root"
  - "delivery handler degrade-tolerates web-preview.mp4 absence (warn, no fail)"
  - "quality-report.json top-level _composition.delivered_mastermp4 + delivered_webpreview markers"
affects:
  - "Plan 29-03 consistency-guard (reads quality-report.json, may consume _composition marker)"
  - "Phase 30 E2E SC#1 (delivery now finds master.mp4 produced by composition)"
tech-stack:
  added: []
  patterns:
    - "degrade-tolerant stat block (warn-not-fail, non-blocking optional artifact)"
    - "operator-visibility top-level _composition marker in quality-report.json"
key-files:
  created:
    - test/phases/delivery-master-mp4.test.mjs
  modified:
    - lib/phases/index.js
    - test/phases/handlers.test.mjs
decisions:
  - "_composition marker placed at top level of qualityData (sibling to _phase) per CONTEXT Claude's Discretion for operator visibility"
  - "web-preview.mp4 absence emits console.warn + quality-report note but sets no failure flag — explicitly non-blocking (CONTEXT D-PIPE-COMPOSE-02)"
  - "_hermesAudit + return metrics renamed final_mp4_status -> master_mp4_status and added web_preview_status for symmetry"
metrics:
  duration: ~4min
  tasks: 1
  files: 3
  completed: 2026-06-24T08:30:00Z
---

# Phase 29 Plan 02: Delivery master.mp4 Alignment + web-preview Degrade-Tolerant + _composition Marker Summary

Aligned delivery handler's file check with composition's renamed output (master.mp4), added a non-blocking web-preview.mp4 check, and injected a top-level `_composition.delivered_mastermp4` / `delivered_webpreview` operator-visibility marker into quality-report.json — closing the audit finding that delivery checked `final.mp4` while composition produces `master.mp4`.

## What Changed

### `lib/phases/index.js` (delivery handler, ~line 3529-3585)
- **Rename**: `finalMp4Path = join(pipeline.workdir, 'final.mp4')` → `masterMp4Path = join(..., 'master.mp4')` (PIPE-COMPOSE-02 audit finding: composition now produces master.mp4 per Plan 01, but delivery was still stat-ing final.mp4).
- **Rename**: `finalMp4Status` → `masterMp4Status`; `qualityReport.final_mp4` → `qualityReport.master_mp4`. Absent-note message updated from `'final.mp4 未生成 ...'` to `'master.mp4 未生成 (degraded 模式或 composition 未执行)'`.
- **Add web-preview.mp4 degrade-tolerant block**: `const webPreviewPath = join(pipeline.workdir, 'web-preview.mp4')`. On stat success writes `qualityReport.web_preview_mp4 = { path, size_bytes, size_mb }`. On catch: `console.warn('[delivery] web-preview.mp4 缺失 (degrade-tolerant, 不阻断)')` + `qualityReport.web_preview_mp4 = { path, status: 'absent', note: 'web-preview 未生成 (degrade-tolerant)' }`. NO failure flag set — web-preview is best-effort per CONTEXT.
- **Inject `_composition` marker**: in the `qualityData` object assembly, added `_composition: { delivered_mastermp4: masterMp4Status === 'present', delivered_webpreview: webPreviewStatus === 'present' }` as a top-level sibling of `_phase` (per CONTEXT Claude's Discretion — top-level for operator visibility).
- **Update `_hermesAudit` call**: renamed `final_mp4_status` → `master_mp4_status`, added `web_preview_status: webPreviewStatus`.
- **Update return `metrics` object**: same rename (`final_mp4_status` → `master_mp4_status` + add `web_preview_status`).
- **Untouched (per plan boundary)**: composition handler (Plan 01 territory, ~line 1409), consistency-guard (Plan 03 territory, ~line 2940).

### `test/phases/delivery-master-mp4.test.mjs` (new, 4 cases)
- Test 1: master.mp4 present → `_composition.delivered_mastermp4: true`.
- Test 2: master.mp4 absent → `_composition.delivered_mastermp4: false` (no throw).
- Test 3: web-preview.mp4 absent (master present) → delivery succeeds, `delivered_webpreview: false`.
- Test 4: both present → both markers true.

### `test/phases/handlers.test.mjs` (modified, 1 assertion)
- Pre-existing delivery handler test (line 642-644) asserted `qParsed.report.final_mp4` exists. Updated to assert `qParsed.report.master_mp4` instead (the field renamed by this plan). Without this update the baseline test would fail — directly caused by the rename, in scope per Rule 1.

## Commits

| Hash | Type | Message |
|------|------|---------|
| `6b697ff` | test(29-02) | add failing tests for delivery master.mp4 alignment + web-preview degrade-tolerant + _composition marker (RED) |
| `a21151f` | feat(29-02) | delivery handler checks master.mp4 + degrade-tolerant web-preview + _composition marker (GREEN) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Second `final_mp4_status` reference in return `metrics` object**
- **Found during:** GREEN phase (tests threw `ReferenceError: finalMp4Status is not defined`)
- **Issue:** Plan `<action>` step 4 only mentioned updating the `_hermesAudit` call (~line 3555). But the delivery handler's returned `metrics` object (~line 3681) also referenced `finalMp4Status`. After renaming the variable, this second reference broke.
- **Fix:** Renamed `final_mp4_status: finalMp4Status` → `master_mp4_status: masterMp4Status` in the return metrics object and added `web_preview_status: webPreviewStatus` for symmetry.
- **Files modified:** lib/phases/index.js
- **Commit:** a21151f

**2. [Rule 1 - Bug] Pre-existing handlers.test.mjs delivery assertion referenced final_mp4**
- **Found during:** post-implementation baseline regression (handlers.test.mjs:642-644)
- **Issue:** The Phase 16 delivery handler regression test asserted `qParsed.report.final_mp4` exists. The rename to `master_mp4` broke this assertion.
- **Fix:** Updated the assertion to check `qParsed.report.master_mp4` instead. Directly caused by this plan's rename, in scope.
- **Files modified:** test/phases/handlers.test.mjs
- **Commit:** a21151f

No other deviations. Plan executed as written otherwise.

## Verification

- `node --test test/phases/delivery-master-mp4.test.mjs` → **4/4 pass**.
- `node --test test/phases/handlers.test.mjs` → **29/29 pass** (baseline preserved after Rule 1 fix).
- `node --test test/phases/composition-master-mp4.test.mjs` → **4/4 pass** (Plan 01 regression, no cross-plan breakage).
- `grep -n "final\.mp4" lib/phases/index.js` → only 2 comment-line matches explaining the rename (line 1414 composition-handler comment, line 3531 delivery-handler comment). No code/path references remain.
- `grep -n "delivered_mastermp4" lib/phases/index.js` → 1 match at the qualityData write site (the marker is computed from `masterMp4Status === 'present'`).

## Known Stubs

None. The degrade-tolerant web-preview path intentionally records `delivered_webpreview: false` without failing — this is the documented CONTEXT D-PIPE-COMPOSE-02 behavior, not a stub. Operators consume `_composition.delivered_webpreview` to decide whether to regenerate the preview manually.

## Threat Flags

None. The T-29-05 mitigation (existing try/catch preserved, absent path writes degrade note instead of throwing) is directly implemented by the unchanged try/catch structure around the renamed stat blocks. No new trust-boundary surface introduced.

## TDD Gate Compliance

- [x] RED gate: `test(29-02)` commit `6b697ff` exists, all 4 tests failed before implementation.
- [x] GREEN gate: `feat(29-02)` commit `a21151f` exists after RED, all 4 tests pass.
- [ ] REFACTOR: not needed — implementation is minimal and clean.

## Self-Check: PASSED

- Files: test/phases/delivery-master-mp4.test.mjs, lib/phases/index.js, test/phases/handlers.test.mjs, 29-02-SUMMARY.md — all FOUND.
- Commits: 6b697ff (RED), a21151f (GREEN) — both FOUND.
