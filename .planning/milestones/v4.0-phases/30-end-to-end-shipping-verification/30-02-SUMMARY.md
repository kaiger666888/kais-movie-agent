---
phase: 30-end-to-end-shipping-verification
plan: 02
subsystem: audit-verification
tags: [testing, regression, audit, sc2, v4-0-acceptance]
dependency_graph:
  requires:
    - "Phase 26 P01 PIPE-DATA-01 pain-report.json main reader (F4)"
    - "Phase 26 P02 PIPE-DATA-02 PHASES stageOrder reorder (F5)"
    - "Phase 27 P01 PIPE-RENDER-01 motion-preview taskType fix (F3)"
    - "Phase 27 P02 PIPE-RENDER-02 _warnJimengDeprecate at 3 sites (F7)"
    - "Phase 28 P01 PIPE-INTEGRITY-01 canvas saveGraph HTTP API (F8)"
    - "Phase 28 P02 PIPE-INTEGRITY-02 repair-canvas assertPositiveInt (F9)"
    - "Phase 29 P01 PIPE-COMPOSE-01 composition handler master.mp4 (F1)"
    - "Phase 29 P02 PIPE-COMPOSE-02 delivery master.mp4 filename (F2)"
    - "Phase 29 P03 PIPE-GUARD-01 consistency-guard throw + dead-code delete (F6)"
  provides:
    - "Executable 9-finding audit regression suite — future-proofs v4.0 ship"
  affects: []
tech_stack:
  added: []
  patterns:
    - "Brace-depth-tracked function-body slicer (string/comment/brace aware) for region-scoped grep assertions"
    - "Per-finding test() block pattern — adding F10+ is mechanical (one test block per finding)"
key_files:
  created:
    - test/audit-v4-acceptance.test.mjs
  modified: []
decisions:
  - "F2 assertion refines plan literal 'count of final.mp4 === 0' to 'no string-literal path reference' — comment mentions documenting the fix (e.g. 'no longer checks final.mp4') are allowed; only path literals flowing to join/existsSync/readFile count as regression"
  - "Slice helper scopes to the `export const phaseHandlers = {` region because HERMES_DEFAULTS (earlier in same file) has same-named keys ('motion-preview', 'consistency-guard') that are config-only and would produce false matches"
  - "RED spot-check protocol: temporarily reverted F3 taskType → task_type via sed, confirmed test F3 fails, restored source — verifies the regression-prevention contract is real, not a tautology"
  - "F9 regex-source assertion uses String.includes('/^\\\\d+$/') instead of a regex literal — escaping a regex-literal-search pattern inside another regex literal is error-prone; substring search is unambiguous"
metrics:
  duration: 6min
  completed: 2026-06-24
  tasks: 1
  files: 1
acceptance_scs: [SC2]
---

# Phase 30 Plan 02: 9-Finding Audit Acceptance Regression Suite Summary

Single regression test (`test/audit-v4-acceptance.test.mjs`) that automates the 9-row audit closure checklist from the 2026-06-23 pipeline audit memory. Each audit finding (F1-F9) maps 1:1 to one strict `test()` block reading the relevant source file at HEAD and asserting the regression-prevention signal is present. Replaces manual `grep` audit with an executable contract — any refactor that silently reintroduces a finding breaks the matching F-test and pinpoints the exact regression.

## What Was Built

**`test/audit-v4-acceptance.test.mjs`** — 9-test suite, one per audit finding:

| # | Finding | Closure Phase | Assertion Signal |
|---|---------|---------------|------------------|
| F1 | composition phase had no handler | 29 P01 | `composition` handler body references `master.mp4` + constructs path via `join(pipeline.workdir, 'master.mp4')` |
| F2 | delivery checked final.mp4, not master.mp4 | 29 P02 | `delivery` body references `master.mp4` AND has zero `'final.mp4'` string-literal path references |
| F3 | motion-preview submitTask field-case wrong | 27 P01 | `motion-preview` submitTask call uses `taskType: 'blender_render'` (not snake_case) + return reads `task.taskId` |
| F4 | V6 no longer writes requirement.json | 26 P01 | `_loadCharactersForGeneration` reads `pain-report.json` (Tier 1); `requirement.json` only as tagged legacy fallback |
| F5 | scene ↔ spatio-temporal-script ordering flip | 26 P02 | `lib/pipeline.js` PHASES: `stageOrder(sts) < stageOrder(scene-generation) < stageOrder(scene-selection)` |
| F6 | consistency-guard non-blocking + dead code | 29 P03 | `consistency-guard` body contains `throw` + `_consistencyBlocked: true`; `lib/gate-constraints.js` + `lib/invariant-bus.js` absent |
| F7 | jimeng-client deprecated but still called | 27 P02 | `_warnJimengDeprecate` defined + invoked at ≥3 call sites (≥4 total occurrences including definition) |
| F8 | canvasGraph double-write race | 28 P01 | `saveGraph` in `canvas-content-sync.js` uses `client.saveCanvas` (HTTP API); no `execSync + sqlite3 UPDATE` in body |
| F9 | repair-canvas SQL injection surface | 28 P02 | `assertPositiveInt` defined with `/^\d+$/` regex + `Number.isInteger` defense-in-depth, invoked on both `opts.projectId` + `opts.episodesId` |

**Region-scoped slicing:** a brace-depth-tracking helper (`sliceHandlerBody`) isolates each phase handler's body from the `export const phaseHandlers = {` opener through its matching close brace. The walker is string/comment/brace aware so nested objects and JSDoc comments inside the handler body do not prematurely close the slice or trip false matches. This is T-30-04 (false-positive regex matches) mitigation — without region scoping, `master.mp4` / `task_type` / `throw` would match anywhere in the 4400-line `lib/phases/index.js`.

## Deviations from Plan

### Rule 1 — Bug: F2 assertion literal was too strict

**Found during:** Task 1 (test implementation)

**Issue:** The plan's `<behavior>` block specified F2 as "count of 'final.mp4' === 0 within the delivery function region". A literal substring count of `final.mp4` in the delivery handler returns 1, not 0 — but that single occurrence is inside a documentation comment: `// Phase 29-02 PIPE-COMPOSE-02: 对齐 Plan 01 — 验证 master.mp4 (不再验证 final.mp4)`. This comment documents the fix; it does not perform any file lookup.

**Fix:** Refined the assertion to count **string-literal path references** (`'final.mp4'` or `"final.mp4"`) — the form that would flow into `join()` / `existsSync()` / `readFile()`. Comment mentions remain allowed because they document the closure, not perform lookups. Verified zero string-literal path references to `final.mp4` in the delivery body (lines 3536-3715).

**Files modified:** `test/audit-v4-acceptance.test.mjs` (F2 test block).

**Commit:** `092cb84`

### Rule 3 — Blocking Issue: sliceHelper initially matched HERMES_DEFAULTS keys

**Found during:** Task 1 (test implementation, first run)

**Issue:** `lib/phases/index.js` declares two top-level objects with same-named keys — `HERMES_DEFAULTS` (line 99, config-only) and `phaseHandlers` (line 560, the actual handlers). Both have `'motion-preview': {` and `'consistency-guard': {` entries at identical 2-space indentation. The first-version `sliceHandlerBody` matched the FIRST occurrence (inside HERMES_DEFAULTS), slicing only the config object — which contains no `gtClient.submitTask`, no `throw`, no `_consistencyBlocked`. Tests F3 and F6 failed with "must contain ..." not because the fix regressed, but because the slicer was looking at the wrong object.

**Fix:** Scoped the regex search to start from the `export const phaseHandlers = {` line. HERMES_DEFAULTS is now excluded by construction; the slicer only ever sees handler bodies. Tests F3 and F6 then passed against the correct source region.

**Files modified:** `test/audit-v4-acceptance.test.mjs` (`sliceHandlerBody` helper).

**Commit:** `092cb84`

## Acceptance Criteria Status

| SC | Description | Status |
|----|-------------|--------|
| SC#2 | 9 audit findings 100% closed at HEAD, verified by automated test | **VERIFIED** — All 9 F-tests pass at HEAD; each finding maps to a discrete executable assertion |

## Verification Results

```
▶ Phase 30 P02 — v4.0 audit acceptance (9 findings)
  ✔ F1: composition handler writes master.mp4 (1.56881ms)
  ✔ F2: delivery handler checks master.mp4 (not final.mp4) (0.784779ms)
  ✔ F3: motion-preview submitTask uses camelCase taskType (not snake_case task_type) (0.31378ms)
  ✔ F4: _loadCharactersForGeneration reads pain-report.json (V6 main path) (0.18318ms)
  ✔ F5: spatio-temporal-script stageOrder < scene-generation < scene-selection (0.23953ms)
  ✔ F6: consistency-guard throws on audit fail + dead code files deleted (0.50017ms)
  ✔ F7: _warnJimengDeprecate emitted at the 3 known jimeng call sites (0.16144ms)
  ✔ F8: canvas-content-sync saveGraph uses HTTP API (no direct sqlite3 UPDATE writes) (0.971629ms)
  ✔ F9: repair-canvas CLI has assertPositiveInt validation (SQL injection guard) (0.25315ms)
✔ tests 9, pass 9, fail 0
```

`npm test`: **517/517 pass** (508 baseline + 9 new audit tests, 0 regressions).

### RED spot-check (regression-prevention contract verification)

To verify the tests are real contracts rather than tautologies, a deliberate regression was introduced and reverted:

```
$ cp lib/phases/index.js /tmp/backup.js
$ sed -i "s/taskType: 'blender_render'/task_type: 'blender_render'/" lib/phases/index.js
$ node --test test/audit-v4-acceptance.test.mjs
  ✖ F3: motion-preview submitTask must use taskType: 'blender_render' (camelCase)
$ mv /tmp/backup.js lib/phases/index.js
$ node --test test/audit-v4-acceptance.test.mjs
  ✔ F3: motion-preview submitTask uses camelCase taskType (not snake_case task_type)
```

F3 correctly fails when the Phase 27 P01 fix is reverted and passes when restored. `git diff --stat lib/phases/index.js` confirms zero source changes after the round-trip.

## Threat Model Mitigations

| Threat | Mitigation | Verified |
|--------|------------|----------|
| T-30-03 (Repudiation — verbal "verified" claims) | Each finding maps to an executable assertion; no verbal claims — all evidence is fs.readFile + regex/parse based | Yes — 9/9 tests run against source files at HEAD |
| T-30-04 (Tampering — false-positive regex matches) | Region-scope slicing via brace-depth-tracking `sliceHandlerBody`; assertions scoped to single handler body, not whole-file grep | Yes — confirmed by F3/F6 HERMES_DEFAULTS false-match fix |

## TDD Gate Compliance

This plan is a **verification-only test plan** — the features under test (all 9 audit-finding fixes) were shipped across Phases 26, 27, 28, and 29. There is no new production code to write; the test asserts existing shipped behavior. A single `test(...)` commit is appropriate and sufficient per the precedent established in 30-01-SUMMARY. No RED/GREEN separation applies because there is no implementation step.

- Commit `092cb84`: `test(30-02): 9-finding v4.0 audit acceptance regression suite`

The RED spot-check (deliberately reverting F3 and confirming the test fails) serves as the equivalent of a RED-gate witness: it proves the test is sensitive to regression of the fix it guards.

## Known Stubs

None. The test only reads source files and asserts static signals — no runtime execution, no mocks, no placeholder data.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes introduced. The test performs read-only `fs.readFile` + `fs.existsSync` on source files already in the repo.

## Self-Check: PASSED

- FOUND: `test/audit-v4-acceptance.test.mjs` (349 lines)
- FOUND: commit `092cb84` in `git log`
- FOUND: 9/9 tests pass via `node --test test/audit-v4-acceptance.test.mjs`
- FOUND: npm test 517/517 (baseline grew 508 → 517, 0 regressions)
- FOUND: RED spot-check confirmed F3 fails on regression and passes on restore
- FOUND: `git diff --stat lib/phases/index.js` empty (source unchanged after spot-check)
