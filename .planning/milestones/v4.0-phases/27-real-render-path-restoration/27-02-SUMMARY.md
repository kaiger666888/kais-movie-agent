---
phase: 27
plan: 02
phase_name: real-render-path-restoration
subsystem: render-path
tags: [jimeng-client, deprecation, fallback-only, degrade-path, regression-test]
requires:
  - lib/jimeng-client.js @deprecated class (3 production call sites)
provides:
  - "Module-level dedup deprecate warn marking jimeng-client fallback-only at all 3 production call sites"
  - "Regression test (5 cases) preventing silent warn removal + verifying strict degrade path"
  - "Test-only export _resetJimengDeprecateFlagForTest for first-call assertion"
affects:
  - "Operators: see exactly one deprecate warn per pipeline run instead of N×handler invocations"
  - "Future maintainers: regression test catches removal of warn or relaxation of degrade gate"
tech_stack:
  added: []
  patterns:
    - "Module-level once-flag dedup (`let _flag = false; function _warn() { if (_flag) return; _flag = true; console.warn(...) }`)"
    - "Test-only flag-reset export (`_resetForTest` suffix convention)"
key_files:
  created:
    - test/phases/jimeng-deprecate-warn.test.mjs
  modified:
    - lib/phases/index.js
decisions:
  - "D-PIPE-RENDER-02 honored: NOT migrating to dreamina CLI (no CLI in repo); marking fallback-only with deprecate warn + verifying strict degrade. No edit to lib/jimeng-client.js, no edit to real-generation logic."
  - "Added `_resetJimengDeprecateFlagForTest()` export — one-line test-only helper within scope (plan line 253 explicitly permits this as test infrastructure). No existing `_forTest` convention in the repo; this establishes one for module-private flag state."
  - "Cross-handler dedup test uses character-generation (not soul-visual) because soul-visual has a pre-existing constructor signature mismatch (passes `{ apiKey }` to positional-string param) that throws synchronously outside the try/catch degrade. This mismatch is out-of-scope per D-PIPE-RENDER-02 — documented for operator awareness."
  - "TDD split: Task 1 (GREEN — add warn mechanism) before Task 2 (RED-guard regression test). Plan-level RED/GREEN gate satisfied: Task 2's Test 5 (source-string guard) + Test 2 (dedup assertion) would have failed pre-Task-1."
metrics:
  duration: 12min
  completed: 2026-06-24
  tasks_completed: 2
  files_changed: 2
  tests_added: 5
---

# Phase 27 Plan 02: jimeng-client Deprecation Warn + Strict Degrade Summary

Marked the deprecated `jimeng-client` (`lib/jimeng-client.js` JSDoc: "已被 dreamina CLI 取代") as fallback-only at all 3 production call sites, with a module-level deduplicated warn so operators see the migration hint exactly once per process. Verified the no-API-key degrade path is strict at all 3 sites (no real jimeng API call attempted when service is unreachable).

## What Shipped

**Deprecation mechanism (lib/phases/index.js, +16 lines):**
- Module-level flag `let _jimengDeprecateWarned = false;` (line 86) and helper `function _warnJimengDeprecate()` (line 87) that emits `[deprecate] jimeng-client fallback-only — migrate to dreamina CLI when available` exactly once per process.
- All 3 production `new JimengClient(...)` call sites wrapped with `_warnJimengDeprecate()` immediately before instantiation:
  - soul-visual (line 651) — pre-existing `{ apiKey }` constructor signature mismatch (out of scope per D-PIPE-RENDER-02).
  - character-generation (line 2185) — positional-string signature matches.
  - scene-generation (line 2606) — positional-string signature matches.
- Test-only export `_resetJimengDeprecateFlagForTest()` (line 93) so the regression test can re-assert first-call semantics.

**Regression test (test/phases/jimeng-deprecate-warn.test.mjs, 5 cases):**
- Test 1: warn emits on first scene-generation invocation.
- Test 2: warn deduped module-wide — 3 invocations produce exactly 1 warn (module flag suppresses repeats).
- Test 3: cross-handler dedup — scene-generation + character-generation in same process produces exactly 1 warn.
- Test 4: strict degrade — forced `fetch` failure still completes via degrade path; placeholder candidates produced, `degraded: true` set.
- Test 5: source-string regression guard — asserts the warn message + flag + helper all still exist in `lib/phases/index.js`.

## Degrade Path Audit (Task 1 Step 3)

| Call Site | Real-API Gate | Strict? |
|-----------|---------------|---------|
| soul-visual (651) | `if (candidates.length === 0) { try { ... soulLock.generateVisualSoul(...) } catch (e) { console.warn('[soul-visual] Jimeng 降级') } }` (lines 667-671) | YES — try/catch wraps the real call |
| character-generation (2185) | `jimengAvailable = await jimeng.ping(3000)` (line 2239) → `if (!jimengAvailable) { degraded=true; ... }` (lines 2243-2253) | YES — ping gate skips all jimeng calls when service down |
| scene-generation (2606) | 1s `AbortController` ping to `${jimeng.baseUrl}/health` (lines 2614-2641) → `if (!jimengAvailable) { degraded=true; ... }` (line 2647) | YES — ping gate skips all jimeng calls when service down |

No non-strict paths found. No real-API-call hole exists when `JIMENG_API_KEY`/`JIMENG_BASE_URL` are absent.

## Deviations from Plan

None — plan executed exactly as written. Plan's documented carve-outs were honored:
- `lib/jimeng-client.js` untouched (D-PIPE-RENDER-02).
- soul-visual constructor signature mismatch NOT fixed (out-of-scope, pre-existing, contained by degrade logic downstream).
- Real-generation logic NOT rewritten (D-PIPE-RENDER-02 scope).
- Warn NOT placed inside `JimengClient` constructor (would fire on every import — explicitly rejected in D-PIPE-RENDER-02).
- Test-only reset export added — within scope per plan line 253 ("within scope as test infrastructure").

## Verification

| Check | Result |
|-------|--------|
| Module-level `_jimengDeprecateWarned` flag + helper defined | PASS |
| All 3 `new JimengClient(...)` call sites invoke `_warnJimengDeprecate()` | PASS (lines 651, 2185, 2606) |
| Exact warn message present once in source | PASS |
| `lib/jimeng-client.js` untouched | PASS (0 lines changed) |
| Phase 27-01 motion-preview fix (lines 1074/1078) intact | PASS |
| New regression test (5 cases) | PASS |
| Full `npm test` baseline | 483/483 PASS (478 prior + 5 new) |
| Degrade path strict at all 3 sites | PASS (audit above) |

## Threat Flags

None. The deprecate warn closes T-27-05 (Repudiation — operator unaware of fallback status): one-shot warn ensures visibility without log flood. T-27-03 (DoS) mitigated by verified strict degrade gates at all 3 sites. T-27-04 (Info Disclosure) accepted — warn contains no PII/secrets, only a migration hint. No new network/auth surface introduced.

## TDD Gate Compliance

- RED: Task 2's Test 5 (source-string regression guard) and Test 2 (dedup assertion) would both fail against pre-Task-1 code (no warn mechanism existed).
- GREEN: Task 1 commit `a319be9` adds the flag/helper/wrappings; all 5 tests pass.
- No REFACTOR needed — surgical additions.

Both gates satisfied across the two-task split.

## Self-Check: PASSED

- [x] `lib/phases/index.js` exists and contains the warn flag (line 86), helper (line 87), 3 wrappings (lines 651/2185/2606), test-only export (line 93).
- [x] `test/phases/jimeng-deprecate-warn.test.mjs` exists with 5 passing cases.
- [x] Commit `a319be9` present in `git log` (Task 1 GREEN).
- [x] Commit `0a532b3` present in `git log` (Task 2 regression guard).
