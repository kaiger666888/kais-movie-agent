---
phase: 29-composition-tail-quality-gate-activation
plan: 01
subsystem: composition-tail
tags: [composition, ffmpeg, master-mp4, degraded-mode, pipe-compose-01]
requires:
  - "Phase 27 real-render (CompositionEngine execFile pattern)"
provides:
  - "composition handler writes master.mp4 (not final.mp4)"
  - "composition handler writes sibling web-preview.mp4"
  - "composition handler touches 0-byte placeholders on degraded path"
affects:
  - "Plan 29-02 delivery handler filename alignment (consumes master.mp4)"
  - "Plan 29-03 consistency-guard (expects master.mp4 to exist)"
  - "Phase 30 E2E SC#1 (degraded master.mp4 placeholder verification)"
tech-stack:
  added: []
  patterns:
    - "best-effort sibling transcode (warn-on-fail, T-29-02 mitigation)"
    - "degraded placeholder touch (0-byte, aligns Phase 27 degrade-warn pattern)"
key-files:
  created:
    - test/phases/composition-master-mp4.test.mjs
  modified:
    - lib/phases/index.js
decisions:
  - "web-preview.mp4 generated via inline ffmpeg transcode (854px H.264, -an, crf 28) — D-PIPE-COMPOSE-01 Claude's Discretion"
  - "degraded placeholders are 0-byte (not minimal mp4 header) — delivery checks existence only (CONTEXT specifics)"
  - "compose() returns {output:null,error} on failure rather than throwing — handler treats both throw AND null-output as degraded"
metrics:
  duration: ~6min
  tasks: 1
  files: 2
  completed: 2026-06-24T08:24:00Z
---

# Phase 29 Plan 01: Composition master.mp4 + web-preview.mp4 + Degraded Placeholders Summary

Aligned composition handler output filenames with PHASES `outputFiles: ['master.mp4', 'web-preview.mp4']` declaration and added degraded-mode 0-byte placeholder fallback so delivery always finds both files.

## What Changed

### `lib/phases/index.js` (composition handler, ~line 1409)
- **Rename**: `outputPath: join(pipeline.workdir, 'final.mp4')` → `masterPath = join(pipeline.workdir, 'master.mp4')` (PIPE-COMPOSE-01 audit finding: PHASES declared master.mp4 but handler wrote final.mp4).
- **Add web-preview.mp4**: after a successful compose + quality check, invoke `ffmpeg -i master.mp4 -vf scale=854:-2 -c:v libx264 -preset fast -crf 28 -an web-preview.mp4`. Best-effort: wrapped in try/catch that `console.warn`s on failure (T-29-02 DoS mitigation). `-an` drops audio so corrupt/empty audio streams in degraded master.mp4 don't break the transcode.
- **Degraded placeholder touch**: when compose throws OR returns `{output: null}` (CompositionEngine returns null-output instead of throwing on ffmpeg failure), touch 0-byte `master.mp4` + `web-preview.mp4` placeholders so downstream delivery always finds both files. Placeholder touch itself wrapped in try/catch (warn-and-continue — never crash handler).
- **Import**: added `execFile` from `node:child_process` + `promisify` from `node:util` at module top (`execFileP`).
- **Untouched (per plan boundary)**: delivery handler (lines ~3529+, Plan 02), consistency-guard (lines ~2940+, Plan 03), degradedMode quality-gate bypass logic (lines ~1441-1451).

### `test/phases/composition-master-mp4.test.mjs` (new, 4 cases)
- Test 1 (success path, ffmpeg-gated): `master.mp4` exists, `final.mp4` does NOT.
- Test 2 (success path, ffmpeg-gated): `web-preview.mp4` exists.
- Test 3 (degraded): when videoPath points at non-existent file → compose returns `{output:null}` → handler touches 0-byte `master.mp4` + `web-preview.mp4`.
- Test 4 (regression guard): `final.mp4` is never written under any path.

Tests 1 & 2 are skipped when ffmpeg is unavailable (CI without ffmpeg). Tests 3 & 4 run unconditionally — they validate the degraded path which is the Phase 30 SC#1 verification target.

## Commits

| Hash | Type | Message |
|------|------|---------|
| `bc6d2c4` | test(29-01) | add failing tests for composition master.mp4 + web-preview.mp4 + degraded placeholders (RED) |
| `97c0413` | feat(29-01) | composition handler outputs master.mp4 + web-preview.mp4 + degraded placeholders (GREEN) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Correctness] compose() returns null-output instead of throwing on failure**
- **Found during:** Task 1 RED phase (Test 3 design)
- **Issue:** Plan `<action>` step 3 specified touching placeholders only in the `catch` block. But `CompositionEngine.compose()` (lib/composition-engine.js:96-99, 134-138) returns `{ output: null, error }` on ffmpeg failure rather than throwing — so the catch block alone would never fire in the normal degraded scenario and no placeholders would be touched.
- **Fix:** Added a `composeSucceeded` flag set true only when `composeResult.output` is truthy. Placeholder touch runs whenever `!composeSucceeded` (covers both throw AND null-output cases). Also added an explicit warn for the null-output branch.
- **Files modified:** lib/phases/index.js
- **Commit:** 97c0413

No other deviations. Plan executed as written otherwise.

## Verification

- `node --test test/phases/composition-master-mp4.test.mjs` → **4/4 pass** (0 skipped on this host with ffmpeg installed).
- `node --test test/phases/handlers.test.mjs` → **29/29 pass** (composition handler still registered, still callable — baseline preserved).
- `grep -n "final\.mp4" lib/phases/index.js` → only matches in delivery handler (lines 3529-3574) and one composition-handler comment referencing the rename. Composition handler body no longer writes `final.mp4`.

## Known Stubs

None. The degraded-mode 0-byte placeholders are intentional per CONTEXT.md decisions (delivery checks existence only, does not play) — these are tracked as the Phase 30 SC#1 verification target, not stubs to resolve.

## Threat Flags

None. The web-preview ffmpeg transcode timeout (180s) and try/catch wrap directly implement T-29-02 (DoS mitigation) per the plan threat model. No new trust-boundary surface introduced beyond what the plan declared.

## TDD Gate Compliance

- [x] RED gate: `test(29-01)` commit `bc6d2c4` exists, tests failed before implementation.
- [x] GREEN gate: `feat(29-01)` commit `97c0413` exists after RED, tests pass.
- [ ] REFACTOR: not needed — implementation is minimal and clean.

## Self-Check: PASSED

- Files: test/phases/composition-master-mp4.test.mjs, lib/phases/index.js, 29-01-SUMMARY.md — all FOUND.
- Commits: bc6d2c4 (RED), 97c0413 (GREEN) — both FOUND.
