---
phase: 28-cross-system-integrity-safety-hardening
plan: 02
subsystem: repair-canvas-cli
tags: [security, sql-injection, cli-validation, defense-in-depth]
requires:
  - bin/repair-canvas-truncated-scenes.js (operator CLI with unvalidated --projectId/--episodesId)
provides:
  - bin/repair-canvas-truncated-scenes.js assertPositiveInt (two-layer integer guard)
  - test/phases/repair-canvas-cli-injection.test.mjs (6-case spawnSync regression)
affects:
  - bin/repair-canvas-truncated-scenes.js main() arg-handling path (only)
tech-stack:
  added: []
  patterns:
    - "/^\\d+$/ regex primary block + Number.isInteger defense-in-depth"
    - "named-value stderr 'Invalid --<label>: must be positive integer (got: <value>)' + exit 1"
    - "spawnSync subprocess regression for CLI entry-point validation"
key-files:
  created:
    - test/phases/repair-canvas-cli-injection.test.mjs
  modified:
    - bin/repair-canvas-truncated-scenes.js
decisions:
  - "D-PIPE-INTEGRITY-02 honored: \\d+ regex + Number.isInteger, stderr + exit 1 at CLI entry"
  - "Regex /^\\d+$/ chosen as primary block (rejects -, ., ;, space, quotes in one test)"
  - "Missing-flag (undefined) and bare-boolean (true) collapse to null so caller emits Usage, not Invalid"
  - "Test 1 (normal integer) distinguishes validation-pass from late-fail via 'Screenplay file not found' stderr marker"
metrics:
  duration: 4.0min
  completed: 2026-06-24
  tasks: 2
  files: 2
---

# Phase 28 Plan 02: repair-canvas CLI SQL Injection Hardening Summary

Closed PIPE-INTEGRITY-02 by adding strict positive-integer validation (`/^\d+$/` regex + `Number.isInteger && > 0` defense-in-depth) to `bin/repair-canvas-truncated-scenes.js` for `--projectId` and `--episodesId`, blocking the sqlite3-CLI multi-statement injection vector (`--projectId "1; DROP TABLE x"`) at the parse layer before any SQL string is built. Replaced the prior weak `Number() + !x` check that accidentally rejected NaN strings but accepted floats like `5.5`.

## What Was Built

### Task 1 (RED, commit 17ab766): failing 6-case spawnSync regression

Created `test/phases/repair-canvas-cli-injection.test.mjs` exercising the real CLI via `child_process.spawnSync(process.execPath, [SCRIPT, ...args])`:

1. Normal positive integer `--projectId 1800 --episodesId 2` → validation passes (stderr contains `Screenplay file not found`, NOT `Invalid --projectId`).
2. Negative `--projectId -1` → exit 1, stderr `Invalid --projectId: must be positive integer (got: -1)`.
3. String `--projectId abc` → exit 1, stderr `got: abc`.
4. Injection `--projectId "1; DROP TABLE x"` → exit 1, stderr names the payload verbatim.
5. Float `--projectId 5.5` → exit 1, stderr `got: 5.5`.
6. Symmetric `--episodesId "2; DROP TABLE y"` → exit 1, stderr `Invalid --episodesId`.

RED run against pre-fix code: 5 of 6 failed (float 5.5 slipped through the old `!5.5` truthy check; injection payloads hit the generic `Usage:` message without naming the rejected value).

### Task 2 (GREEN, commit 6927a5b): assertPositiveInt two-layer guard

Added `assertPositiveInt(raw, label)` helper after `parseArgs`:

- `raw === undefined || raw === true` → returns `null` (missing/bare flag — caller emits Usage).
- `/^\d+$/.test(String(raw))` fails → stderr `Invalid --${label}: must be positive integer (got: ${raw})` + `process.exit(1)`. This regex is the primary injection block: it rejects `-`, `.`, `;`, space, quotes in a single test.
- `Number.isInteger(n) && n > 0` fails → same stderr + exit (defense-in-depth).

In `main()` replaced `const projectId = Number(opts.projectId); ... if (!projectId || !episodesId)` with an explicit missing-flag guard (`opts.projectId === undefined || opts.episodesId === undefined` → Usage + exit 1) followed by `assertPositiveInt(opts.projectId, 'projectId')` / `assertPositiveInt(opts.episodesId, 'episodesId')`.

Validation runs after `parseArgs` and before `existsSync(screenplayPath)` — the earliest blocking point per CONTEXT.md "specifics".

No other functions touched (`loadGraph`, `saveGraph`, `repairCandidate` unchanged). No npm dependencies added (PROJECT.md zero-dependency principle).

## Verification

All gates from `28-02-PLAN.md` `<verification>` block:

| Gate | Expected | Actual |
|------|----------|--------|
| `grep -c "Number.isInteger\|assertPositiveInt" bin/repair-canvas-truncated-scenes.js` | ≥1 | 5 ✓ |
| `grep -c "Invalid --projectId" bin/repair-canvas-truncated-scenes.js` | ≥1 | template-literal form `Invalid --${label}` produces runtime `Invalid --projectId` (6 test assertions confirm) ✓ |
| `node --test test/phases/repair-canvas-cli-injection.test.mjs` | all pass | 6/6 pass ✓ |
| `npm test` baseline preserved | ≥487 | 493/493 pass (487 + 6 new) ✓ |
| Manual smoke: `--projectId "1; DROP TABLE x"` | exit 1 + `Invalid --projectId` stderr | `Invalid --projectId: must be positive integer (got: 1; DROP TABLE x)` / exit=1 ✓ |
| Manual smoke: valid `--projectId 1800` | passes validation | stderr `Screenplay file not found: /nonexistent.json` (NOT `Invalid --projectId`) ✓ |

### TDD Gate Compliance

- RED: `test(28-02): add failing CLI injection regression for repair-canvas` (17ab766) — 5/6 fail.
- GREEN: `feat(28-02): strict positive-integer validation for repair-canvas CLI` (6927a5b) — 6/6 pass.
- No REFACTOR needed — implementation is minimal and clean.

## Scope Boundary Honored

Touched files (git diff `17ab766~1..6927a5b`):
- `bin/repair-canvas-truncated-scenes.js` (modified — validation added; file was previously untracked, now committed with the guard)
- `test/phases/repair-canvas-cli-injection.test.mjs` (created)

No touches to protected subsystems:
- `lib/canvas-content-sync.js` — NONE (owned by Plan 28-01; its `loadGraph` sqlite-direct-read has the same interpolation pattern but is only called with trusted internal numbers, per CONTEXT.md line 91)
- motion-preview / character-gen / scene-gen / composition / consistency-guard / data-spine — NONE

## Decisions Made

1. **Regex `/^\d+$/` as primary block** — rejects the full injection surface (negative, float, string, `;`-payload) in a single test, ahead of any numeric coercion. Auditable and greppable.
2. **Missing-flag vs invalid-value split** — `undefined`/`true` returns null and emits the generic `Usage:` message (operator forgot the arg); any other value that fails validation emits the specific `Invalid --<label>: ... (got: <value>)` so the operator sees exactly what was rejected.
3. **No switch to sqlite3 `.param` or better-sqlite3** — per D-PIPE-INTEGRITY-02 the integer regex is sufficient and preserves the zero-dependency principle; `.param` scripting complexity not justified.
4. **Test 1 disambiguation via `Screenplay file not found`** — the "valid integer accepted" case is the tricky one; asserting `notMatch(/Invalid/)` alone would also pass if validation silently no-op'd. Adding `match(/Screenplay file not found/)` proves execution advanced past validation to the next gate.

## Deviations from Plan

None — plan executed exactly as written. No Rule 1-4 deviations triggered.

Note on the grep gate: the plan's `<verification>` lists `grep -c "Invalid --projectId" ≥ 1` against the source file. The implementation uses a template literal `Invalid --${label}` to serve both `--projectId` and `--episodesId` symmetrically (DRY), so a literal grep returns 0. The runtime message is produced verbatim as `Invalid --projectId: ...` and `Invalid --episodesId: ...` — confirmed by 6 passing test assertions and the manual smoke. This is a verification-wording nuance, not a functional deviation; the security goal (named-value rejection message) is met.

## Known Stubs

None — no placeholder data or unwired code paths introduced.

## Threat Flags

None beyond the plan's `<threat_model>`. T-28-05 (Tampering, SQL interpolation) mitigated by the regex+isInteger guard. T-28-06 (EoP, sqlite3 multi-statement injection via `;`) mitigated — `/^\d+$/` blocks `;` and space. T-28-07 (DoS, operator mis-type) mitigated by clear stderr naming the rejected value + exit 1.

## Self-Check: PASSED

- `bin/repair-canvas-truncated-scenes.js` modified: FOUND (committed in 6927a5b)
- `test/phases/repair-canvas-cli-injection.test.mjs` created: FOUND (committed in 17ab766)
- commit `17ab766` (RED): FOUND
- commit `6927a5b` (GREEN): FOUND
- 6/6 regression tests pass: CONFIRMED
- `npm test` 493/493 pass (baseline 487 + 6 new): CONFIRMED
