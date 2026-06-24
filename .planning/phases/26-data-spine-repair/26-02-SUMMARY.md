---
phase: 26-data-spine-repair
plan: 02
subsystem: data-spine
tags: [scene-generation, spatio-temporal-script, phase-ordering, pipe-data-02]
requires:
  - lib/pipeline.js PHASES array (drives execution order via for-loop at line 659)
  - lib/phases/index.js:2571 (scene-generation bus.read('spatio-temporal-script'))
provides:
  - "PHASES array reordered: spatio-temporal-script(8) → scene-generation(9) → scene-selection(10)"
  - "VALID_PHASES in lib/hermes-client.js synced 1:1 (still module-private)"
  - "6-test regression suite test/phases/scene-sts-order.test.mjs"
affects:
  - scene-generation handler (now reads non-null sts in default V6 run)
  - canvas positioning (lib/canvas-sync-hook.js computeNodePosition — 3 nodes repositioned, intended)
  - bin/pipeline.js status output ordering
tech-stack:
  added: []
  patterns:
    - "Module-private const accessor via static getPhases() (not named export)"
    - "Textual source parse for module-private VALID_PHASES sync assertion"
key-files:
  created:
    - test/phases/scene-sts-order.test.mjs
  modified:
    - lib/pipeline.js
    - lib/hermes-client.js
    - test/v41-integration.test.js
    - test/phases/handlers.test.mjs
decisions:
  - "Reorder via array index + stageOrder field together (plan rationale: stageOrder feeds canvas/reporting, array index drives execution — both must change or silent drift)"
  - "Update two pre-existing hardcoded PHASE-id lists (v41-integration.test.js, handlers.test.mjs) — both carried explicit 'must stay in sync' comments"
metrics:
  duration: ~4 min
  completed: 2026-06-24
  tasks: 2
  files: 4
---

# Phase 26 Plan 02: Scene↔STS Ordering Repair Summary

Reordered the PHASES array so `spatio-temporal-script` (stageOrder 8) runs before `scene-generation` (stageOrder 9) before `scene-selection` (stageOrder 10), closing PIPE-DATA-02 root cause (scene-generation's `bus.read('spatio-temporal-script')` at lib/phases/index.js:2571 was returning null because sts hadn't executed yet, silently degrading all scene data to a single hardcoded default scene at lines 2580-2587).

## What Was Built

### PHASES reorder (lib/pipeline.js:77-91)
- The three consecutive entries at array indices 8/9/10 were block-moved so the declaration sequence is now `...character-selection(7), spatio-temporal-script(8), scene-generation(9), scene-selection(10), script-lock(11)...`
- `stageOrder` fields reassigned: spatio-temporal-script 10→8, scene-generation 8→9, scene-selection 9→10 (full 0-19 sequence stays monotonic with no gaps/duplicates — verified by the new unit test and by the runtime check in lib/pipeline.js integrity self-check)
- Added a comment block above the reordered entries explaining the PIPE-DATA-02 root cause and the old→new mapping, so future readers don't accidentally reorder them back
- `V2_MIGRATION_MAP` (lib/pipeline.js:118-135) left untouched — entries map by string ID, not by stageOrder (confirmed by the existing integrity self-check at lines 137-144 which still passes)
- No other phase entries (indices 0-7, 11-19) were touched

### VALID_PHASES sync (lib/hermes-client.js:16-24)
- The same three string entries reordered: `'spatio-temporal-script', 'scene-generation', 'scene-selection'` (was `'scene-generation', 'scene-selection', 'spatio-temporal-script'`)
- VALID_PHASES remains `const` with NO `export` keyword (kept module-private — tests must parse source textually, verified by the new sync test)
- The file's own "must stay 1:1 in sync with lib/pipeline.js PHASES array" comment at line 13 is now actually true (and is asserted as a deepEqual in the new test)

### Test coverage (test/phases/scene-sts-order.test.mjs — 6 tests)
1. **PHASES order via `Pipeline.getPhases()`** — asserts `indexOf('spatio-temporal-script') < indexOf('scene-generation') < indexOf('scene-selection')`. Uses the static accessor (PHASES is module-private, no named export).
2. **stageOrder monotonicity 0-19** — asserts `PHASES[i].stageOrder === i` for every i; catches any future gap/duplicate regression.
3. **VALID_PHASES textual sync** — reads `lib/hermes-client.js` source via `readFile(new URL(...))`, extracts the `const VALID_PHASES = [...]` body via regex, and asserts `deepEqual` against `Pipeline.getPhases().map(p => p.id)`. Required because VALID_PHASES cannot be imported.
4. **AssetBus read-after-write contract** — instantiates `AssetBus(tmpdir)`, writes a realistic `{shots, audio_events, duration_coupling}` payload to the `spatio-temporal-script` slot, reads it back, and asserts the payload round-trips. This is the contract scene-generation relies on at line 2571.
5. **scene-generation field-mapping regression guard** — replicates the exact mapping at lib/phases/index.js:2573-2577 (`scene_id→id`, `scene_description||description→description`, `characters||[character]→characters`) and asserts the output shape. Includes the singleton `s.character → [s.character]` fallback branch.
6. **Operator-visible ordering via `Pipeline.getStatus()`** — constructs a Pipeline in a fresh tmpdir (no state file needed — getStatus returns 'pending' defaults per lib/pipeline.js:698), reads `status.phases`, and asserts sts appears before scene-generation both by array index AND by the `order` (= stageOrder) field. This is what `bin/pipeline.js status` surfaces to operators.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Two pre-existing tests hardcoded the OLD phase-id order**
- **Found during:** Task 2 (full suite run after adding new test file)
- **Issue:** `node --test` reported 1 failure — `test/v41-integration.test.js:34 "has correct V6 phase IDs in order"` asserted `['scene-generation', 'scene-selection', 'spatio-temporal-script']` (the buggy pre-PIPE-DATA-02 order). A second occurrence in `test/phases/handlers.test.mjs:28` (the `PHASE_IDS` constant) carried an explicit comment "严格按照 lib/pipeline.js PHASES 数组的顺序硬编码。后续若 PHASES 变化, 此数组必须同步更新" — i.e., the file itself declares these lists must be kept in sync.
- **Fix:** Updated both hardcoded lists to the new order. Added a `Phase 26 PIPE-DATA-02` comment on the reordered line in each file so the next reorder finds the trail.
- **Files modified:** test/v41-integration.test.js, test/phases/handlers.test.mjs
- **Commit:** 263a347

This was a direct consequence of the Task 1 source change (the tests were encoding the bug PIPE-DATA-02 exists to fix), so it falls squarely under Rule 1 scope ("Only auto-fix issues DIRECTLY caused by the current task's changes").

## Verification Results

| Check | Result |
|-------|--------|
| `node -e` runtime order check via `Pipeline.getPhases()` | exit 0 (sts<sg<ss, stageOrder 0-19 monotonic) |
| `node --test test/phases/scene-sts-order.test.mjs` | 6 pass / 0 fail |
| Full suite `node --test 'test/**/*.test.{mjs,js}'` | 474 pass / 0 fail (was 468 from 26-01, +6 new) |
| `grep -n "stageOrder: 8," lib/pipeline.js` | line 82 = spatio-temporal-script |
| `grep -n "stageOrder: 9," lib/pipeline.js` | line 85 = scene-generation |
| `grep -n "stageOrder: 10," lib/pipeline.js` | line 88 = scene-selection |
| `grep -c "export.*VALID_PHASES" lib/hermes-client.js` | 0 (still module-private) |
| `grep -n "scenario: 'spatio-temporal-script'" lib/pipeline.js` | line 129 (V2_MIGRATION_MAP untouched) |
| `node --test test/phases/handlers.test.mjs` | 29 pass / 0 fail (V2 migration + handler structure intact) |

All acceptance criteria from PLAN.md tasks 1 & 2 satisfied.

## TDD Gate Compliance

Both tasks declared `tdd="true"` but are structurally source-first (Task 1) then test (Task 2), matching the explicit action text. Task 1 is a pure reordering of existing array constants — there is no new behavior to drive a RED cycle from. Task 2 creates the regression suite in the immediate subsequent commit (263a347). No gate warning.

## Commits

- `71dda9a` feat(26-02): reorder PHASES so spatio-temporal-script precedes scene-generation
- `263a347` test(26-02): scene↔sts ordering tests + sync hardcoded phase-id lists

## Self-Check: PASSED

- test/phases/scene-sts-order.test.mjs — FOUND (created, 6 tests)
- lib/pipeline.js — FOUND (lines 77-91 reordered + explanatory comment)
- lib/hermes-client.js — FOUND (VALID_PHASES line 20 reordered)
- Commit 71dda9a — FOUND in git log
- Commit 263a347 — FOUND in git log
- 468 baseline preserved (+6 new = 474)
- No touches to motion-preview / canvas-client / composition-engine / consistency-guard / jimeng-client (verified: git diff 71dda9a^..HEAD --name-only lists only the 5 in-scope files)
