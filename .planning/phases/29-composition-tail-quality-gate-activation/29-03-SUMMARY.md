---
phase: 29-composition-tail-quality-gate-activation
plan: 03
subsystem: quality-gate
tags: [consistency-guard, blocking-gate, dead-code-removal, consistency-blocked, pipe-guard-01]
requires:
  - "Phase 29 Plan 01 composition handler (makes consistency-guard's 'defer to composition' comment obsolete)"
  - "Phase 29 Plan 02 delivery handler (quality-report.json _composition marker pattern)"
provides:
  - "consistency-guard audit fail now blocks the pipeline (throws → episode marked failed)"
  - "consistency-blocked.json marker file with _consistencyBlocked: true on audit fail"
  - "Dead-code removal: lib/gate-constraints.js + lib/invariant-bus.js deleted (746 lines removed)"
affects:
  - "Phase 30 E2E SC#2 (consistency-guard fail now halts the run instead of warning)"
  - "Pipeline.run loop (handler throw propagates via runPhase catch → episode failed)"
tech-stack:
  added: []
  patterns:
    - "blocking throw after telemetry (hermesAudit + collector run BEFORE throw so failures are still recorded)"
    - "separate marker file (consistency-blocked.json) to avoid ordering coupling with composition's quality-report.json write"
    - "fetch-mock pattern for forcing LLM-dependent audit to fail in unit tests (continuity-auditor-multimodal precedent)"
key-files:
  deleted:
    - lib/gate-constraints.js
    - lib/invariant-bus.js
  created:
    - test/phases/consistency-guard-blocking.test.mjs
  modified:
    - lib/phases/index.js
decisions:
  - "_consistencyBlocked marker placed in separate consistency-blocked.json file (not quality-report.json) to avoid ordering coupling — consistency-guard (stageOrder 15) runs BEFORE composition (stageOrder 18), so writing into quality-report.json would require pre-create or merge logic (CONTEXT Claude's Discretion)"
  - "hermesAudit + collector.record reordered to run BEFORE the blocking throw so telemetry captures failures on both pass and fail paths (plan Implementation note)"
  - "Fetch-mock strategy chosen over config-threshold forcing: auditContinuity treats null-scored dimensions as pass (not fail), so the only reliable way to trigger passed=false in a test env without API keys is to mock fetch so callLLMJson returns below-threshold scores"
metrics:
  duration: ~14min
  tasks: 2
  files: 3
  completed: 2026-06-24T08:48:00Z
---

# Phase 29 Plan 03: Consistency-Guard Blocking Activation + Dead-Code Deletion Summary

Activated consistency-guard as a blocking quality gate (audit fail now throws → episode marked failed, writes consistency-blocked.json marker) and deleted two dead-code modules (gate-constraints.js + invariant-bus.js, 746 lines) that had zero production imports.

## What Changed

### `lib/phases/index.js` (consistency-guard handler, ~line 3091-3145)
- **Removed** the silent warn-and-continue block (`// 不抛 fatal` comment + `console.warn` at former line 3093-3096). The outdated comment "让质量门控在 composition 阶段统一判定" is gone — composition is now a real output phase (Plan 29-01), so consistency-guard IS the quality gate.
- **Reordered** telemetry calls: `_hermesAudit` + `collector.record` now run BEFORE the fail check so both pass and fail paths record telemetry. Previously the fail check (warn) was before these calls — if the throw had been in that position, telemetry would have been skipped on failure.
- **Added blocking fail path** (after collector, before return): when `stubData.passed === false`:
  1. `console.error` with `(BLOCKING)` tag (not console.warn) for operator visibility.
  2. Writes `consistency-blocked.json` with `{ _consistencyBlocked: true, _phase, _generatedAt, overall, recommendation, findings_count }` — wrapped in try/catch (T-29-08: throw happens after write attempt regardless, so blocking propagates even if marker write fails).
  3. Throws `Error` with code `CONSISTENCY_BLOCKED` + `consistencyBlocked: true` flag. Message contains "一致性审计未通过 (consistency-guard blocking)" — propagates to `Pipeline.run` runPhase catch → marks episode failed.
- **Pass path unchanged**: when `passed === true` (including the no-visuals short-circuit at line 3018), handler returns normally, no marker file, no throw. `consistency-pass.json` still written on both paths (forensics, T-29-09).

### `lib/gate-constraints.js` (DELETED, 418 lines)
- Pre-delete grep confirmed zero external imports. Exported `getPhaseConstraints` / `injectConstraints` / `getConstraintsSummary` / `getConstraintsFromBlueprint` — none consumed anywhere in lib/, bin/, or test/.
- Doc-only `from InvariantBus` mentions in murch-scoring.js, script-auditor.js, continuity-auditor.js are JSDoc provenance notes, not imports.

### `lib/invariant-bus.js` (DELETED, 329 lines)
- Pre-delete grep confirmed zero external imports. Exported `InvariantBus` class — never instantiated outside its own `restoreFrom()` static method. package.json had no references.

### `test/phases/consistency-guard-blocking.test.mjs` (new, 219 lines, 4 cases)
- **Test 1** (fail throws): mock fetch returns below-threshold LLM scores → auditContinuity returns `passed: false` → handler throws Error. Asserts message contains "consistency" or "一致性".
- **Test 2** (marker file): on audit fail, `consistency-blocked.json` exists with `_consistencyBlocked: true` + `_phase: 'consistency-guard'`.
- **Test 3** (console.error not warn): spies on console.error/warn — asserts the BLOCKING fail message uses console.error, NOT console.warn.
- **Test 4** (pass path unchanged): bare workdir (no visuals) → handler returns without throwing, no `consistency-blocked.json`, `consistency-pass.json` written.

**Fetch-mock strategy**: auditContinuity's internal LLM calls (`_llmStructuralAudit`, `_llmIdentityScore`) all catch errors and return null scores — and null-scored dimensions are treated as "not evaluated" (not failure). So in a bare test env without API keys, auditContinuity returns `passed=true`. To force a real `passed=false`, the test mocks `global.fetch` (pattern from continuity-auditor-multimodal.test.mjs) so `callLLMJson` receives below-threshold scores (`axis_compliance: 0.1`, threshold 1.0 → fail).

## Commits

| Hash | Type | Message |
|------|------|---------|
| `d6c95c6` | chore(29-03) | delete dead-code modules gate-constraints.js + invariant-bus.js |
| `2b857aa` | test(29-03) | add failing tests for consistency-guard blocking fail path (RED) |
| `b177264` | feat(29-03) | consistency-guard blocking fail path + _consistencyBlocked marker (GREEN) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] callLLMJson fetch mock required json() method + array-free content**
- **Found during:** Task 2 RED→GREEN iteration (tests would not trigger fail path)
- **Issue:** The plan's `<action>` suggested forcing a fail via "bare workdir → auditContinuity throws → catch sets passed=false". But auditContinuity is bulletproof — all internal LLM calls are individually try/caught and return null scores on failure. Null-scored dimensions are treated as "not evaluated" (pass), so auditContinuity returns `passed=true` in any env without working API keys. Additionally, the initial fetch mock omitted the `json()` method (callLLM uses `res.json()` at line 270, not `res.text()`), and the mock content's `findings:[]` array was greedily matched by callLLMJson's `content.match(/\[[\s\S]*\]/)` regex (tried before the object regex), causing JSON parse to return `[]` instead of the scores object.
- **Fix:** (a) Mock `global.fetch` to return below-threshold scores for all LLM calls (pattern from continuity-auditor-multimodal.test.mjs). (b) Include both `json()` and `text()` in the mock response. (c) Omit array fields from the mock content so the object regex matches the full payload. This is a test-infrastructure fix — the production code change is exactly as the plan specified.
- **Files modified:** test/phases/consistency-guard-blocking.test.mjs
- **Committed in:** b177264

No other deviations. The production code change (lib/phases/index.js) matches the plan's `<action>` block exactly — only the test harness required adaptation.

## Verification

- `node --test test/phases/consistency-guard-blocking.test.mjs` → **4/4 pass**.
- `node --test test/phases/handlers.test.mjs` → **29/29 pass** (consistency-guard handler still registered and callable; only the fail-path body changed).
- `node --test test/phases/composition-master-mp4.test.mjs` → **4/4 pass** (Plan 01 regression, no cross-plan breakage).
- `node --test test/phases/delivery-master-mp4.test.mjs` → **4/4 pass** (Plan 02 regression).
- `node --test test/phases/*.test.mjs` → **455/455 pass** (full phase test baseline, 0 fail).
- `test ! -f lib/gate-constraints.js && test ! -f lib/invariant-bus.js` → succeeds (dead code gone).
- `grep -rn "gate-constraints\|invariant-bus" --include="*.js" --include="*.mjs" lib/ bin/ test/` → zero matches.
- `grep -n "_consistencyBlocked" lib/phases/index.js` → 1 match at line 3125 (the marker write site).

## Known Stubs

None. The blocking throw is real and propagates to Pipeline.run. The consistency-blocked.json marker contains real audit data (overall score, recommendation, findings count).

## Threat Flags

None. The threat model mitigations are directly implemented:
- T-29-08 (DoS — marker write fails masking block): marker write is try/caught; throw happens after write attempt regardless.
- T-29-09 (Repudiation — operator cannot prove why blocked): consistency-blocked.json captures overall + recommendation + findings_count; consistency-pass.json retains full detail on both paths.
- T-29-10 (Info Disclosure — dead-code deletion): git history preserves deleted files; only unused code removed.

## TDD Gate Compliance

- [x] RED gate: `test(29-03)` commit `2b857aa` exists — 3 fail-path tests failed before implementation (handler only warned, did not throw). Pass-path test passed (confirmed harness correctness).
- [x] GREEN gate: `feat(29-03)` commit `b177264` exists after RED — all 4 tests pass.
- [ ] REFACTOR: not needed — implementation is minimal (blocking throw + marker write + telemetry reorder).

## Self-Check: PASSED

- Files: test/phases/consistency-guard-blocking.test.mjs (FOUND), lib/phases/index.js (FOUND), lib/gate-constraints.js (CONFIRMED DELETED), lib/invariant-bus.js (CONFIRMED DELETED), 29-03-SUMMARY.md (FOUND).
- Commits: d6c95c6 (dead-code delete), 2b857aa (RED), b177264 (GREEN) — all FOUND.
