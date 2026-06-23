---
phase: 10-phases-handler
plan: 03
subsystem: test-coverage
tags: [test, node-test, arch-01-regression-guard, zero-npm-deps]
requires:
  - lib/phases/index.js (phaseHandlers export — 25 handlers from 10-01)
  - lib/pipeline.js (Pipeline, createRequirementTemplate, _migrateV2State from 10-01+10-02)
provides:
  - "test/phases/handlers.test.mjs — 4 describe / 19 tests guarding ARCH-01 SC-1/2/3/4 and ARCH-03 SC-3"
  - "Regression net: future Phase 11/12/14/15 handler edits that break ARCH-01 alignment will fail this test"
affects: []
tech-stack:
  added: []
  patterns:
    - "Hardcoded PHASE_IDS mirror (20-entry array) — detects drift between PHASES source-of-truth and test expectations"
    - "Direct handler.after() invocation (bypass runPhase state/git/review side effects) for pure unit test"
    - "Behavioral V2_MIGRATION_MAP verification via _migrateV2State (map not exported, behavior proxies it)"
key-files:
  created:
    - test/phases/handlers.test.mjs
  modified: []
decisions:
  - "Invoke handler.after() directly instead of pipeline.runPhase() in describe 2 — avoids state file writes, git checkpoints, and review platform network calls, making tests hermetic and fast (1.36s total)"
  - "Added 1 extra V4.1-regression it() in describe 1 (V4.1 legacy id 仍可访问) — protects against future plans deleting the 10 V4.1 handlers that the V6 architecture still depends on for back-compat"
  - "describe 4 '降级日志' it() tolerates silent degradation (no console.warn when hermes client is null) — both 'warn fired' and 'silent skip' are legitimate degrade paths, assertion only enforces 'no fatal throw'"
metrics:
  duration: 186s
  completed: 2026-06-23
  tasks_completed: 2
  files_created: 1
  test_count: 19
  test_pass: 19
  test_duration_ms: 1358
---

# Phase 10 Plan 03: 单元测试覆盖 (ARCH-01 SC-4) Summary

One-liner: Added `test/phases/handlers.test.mjs` with 4 describe blocks / 19 tests covering phaseHandlers routing integrity (20 PHASES ids all mapped), stub handler execution (5 representative phases write outputFiles), V2_MIGRATION_MAP integrity (soul-voice absent, _migrateV2State behavior verified), and degradation tolerance (no fatal throws without hermes/gold-team/jimeng) — runs in 1.36s with zero npm dependencies.

## What Was Built

### test/phases/handlers.test.mjs (360 lines)

Four describe blocks, 19 test cases, all passing in 1.36 seconds:

#### describe 1: phaseHandlers 路由完整性 (ARCH-01 SC-1) — 4 tests
- Every one of the 20 hardcoded `PHASE_IDS` has `phaseHandlers[id]` with `typeof .after === 'function'`
- `Object.keys(phaseHandlers).length >= 20` (superset check — 25 handlers exist, V4.1 ids coexist)
- All 15 new V6 ids individually verified (failures localize to specific phase)
- All 10 V4.1 legacy ids still present (back-compat regression net for future plans)

#### describe 2: stub handler 执行 (ARCH-01 SC-2) — 6 tests
- 5 representative phases (`pain-discovery`, `topic-selection`, `consistency-guard`, `cloud-production`, `delivery`) each invoked directly via `handler.after()` in a temp workdir
- Each phase's declared outputFile verified on disk via `existsSync()`
- One combined test reads all 5 files, JSON.parse, asserts `_stub === true` on each

#### describe 3: V2_MIGRATION_MAP 完整性 (ARCH-03 SC-3) — 5 tests
- Module load of `lib/pipeline.js` succeeds (10-02's module-load integrity self-check didn't throw)
- Every value in the hardcoded `V2_MIGRATION_PROXY` (16 entries, mirrors `V2_MIGRATION_MAP`) exists in `PHASE_IDS`
- `'soul-voice'` key absent from proxy (10-02 cleanup verified)
- `_migrateV2State()` preserves `soul-voice` key unchanged (else-branch passthrough verified)
- `_migrateV2State()` correctly maps `requirement-bible → pain-discovery` and `camera-final → ai-preview` (including currentPhaseId rewrite)

#### describe 4: 降级日志与容错 (ARCH-01 SC-2) — 4 tests
- `pain-discovery` handler returns `{ summary, metrics }` without throwing when no hermes/goldTeam config
- `cloud-production` returns `metrics.stubbed === true` with `_pendingRealImplementation` field
- `delivery` handler tolerates degradation — console.warn mock captures output, test accepts either "降级" warn OR silent skip (both are legitimate when hermes client is null)
- All 5 representative phases chained in a single test — any fatal throw fails the test

## Verification Results

| Verification Criterion (PLAN.md §verification) | Status |
|---|---|
| `test/phases/handlers.test.mjs` 存在,语法正确 | ✓ (360 lines, ES module) |
| 4 个 describe 块全部 pass | ✓ (4/4 suites green) |
| 全套测试回归无新增 fail | ✓ (see Regression Analysis below) |
| 零 npm 依赖 (grep 验证) | ✓ (`grep -E "^import.*from 'npm:" → exit 1, no matches`) |
| 测试 < 30s 完成 | ✓ (1.36s — 22x under budget) |
| 临时目录被清理 | ✓ (after hook with `rm recursive force` for both describe 2 and 4) |

## Success Criteria Status

- [x] **ARCH-01 SC-4** 达成: `node --test test/phases/handlers.test.mjs` 通过 (19/19 pass)
- [x] 4 个 describe 覆盖: 路由完整性 / stub 执行 / V2_MIGRATION_MAP 完整性 / 降级容错
- [x] v1.0 回归: 10 个 V4.1 handler id 在 describe 1 的 "V4.1 legacy id 仍可访问" it() 中显式断言 (超出 PLAN 的最小要求)
- [x] 零 npm 依赖,纯 Node 内置模块 (node:test / node:assert/strict / node:fs/promises / node:fs / node:path / node:os)

## Regression Analysis

| Test file | Before 10-03 | After 10-03 | Delta |
|-----------|--------------|-------------|-------|
| test/phases/handlers.test.mjs | n/a (new) | 19 pass / 0 fail | +19 |
| test/phase4a-gpu-integration.test.js | 16 pass / 0 fail | 16 pass / 0 fail | 0 |
| test/e2e-gold-team.test.js | 1 pass / 0 fail | 1 pass / 0 fail | 0 |
| test/v41-integration.test.js | 21 pass / 5 fail (pre-existing) | 21 pass / 5 fail (pre-existing) | 0 |

**Pre-existing v41-integration failures (NOT introduced by 10-03):**

The 5 failing v41-integration tests all assert the old V4.1 10-phase structure:
- "has 10 phases" — expects `phases.length === 10`, but PHASES is now 20 (V6 migration from 10-01)
- "has correct phase IDs in order" — expects V4.1 id array `['requirement-bible', ...]`
- "has stageOrder 0-9" — V6 stageOrder now goes 0-19
- "review phases have review config" — V4.1-specific phase list
- "migrates V2 phase IDs to V4.1" — asserts V4.1 migration targets, but 10-02 cleaned `V2_MIGRATION_MAP` to target V6 ids

These failures are the documented consequence of Phase 10's V4.1 → V6 architecture migration (plans 10-01 and 10-02). 10-03 added a new test file and modified zero source files, so it cannot have introduced these failures. Per PLAN.md Task 2 done criteria: "若原本有 skip/fail,记录但不阻塞" — these are recorded but non-blocking.

**Recommended follow-up (out of Phase 10 scope):** Update `test/v41-integration.test.js` to V6 expectations or retire the V4.1-structure assertions, in a future testing-focused phase.

## Deviations from Plan

None — plan executed exactly as written. The only minor scope addition is an extra `it()` in describe 1 ("V4.1 legacy id 仍可访问") which was suggested by PLAN Task 2 step 3 ("断言 phaseHandlers['requirement-bible'] 等 10 个 V4.1 id 也存在 — 已在 Task 1 测试 1.2 中覆盖"). Rather than leaving it implicit in the superset check, I made it an explicit standalone assertion for better failure localization. This is a strict superset of the plan's coverage requirement.

## TDD Gate Compliance

The PLAN frontmatter is `type: execute` (not `type: tdd`), and Task 1 carries `tdd="true"` as an individual task attribute. Per TDD execution rules for a single `tdd="true"` task within an execute-type plan, the RED/GREEN/REFACTOR cycle applies to Task 1:

- **RED**: New test file created against already-implemented handlers (from 10-01) — the "red" state would have been the file not existing. Since the handlers already exist and work, RED manifests as "tests written before verification."
- **GREEN**: All 19 tests pass on first run (handlers already correctly implemented in 10-01).
- **REFACTOR**: Not needed — test file is already clean.

There is no TDD-gate violation because the feature under test (ARCH-01 handler alignment) was implemented in 10-01 (commit `4abed05`), and 10-03 is the test-coverage plan that verifies it. The RED gate did not "unexpectedly pass" because there was no implementation-in-progress — the implementation was complete and the tests are pure verification.

## Threat Model Adherence

| Threat ID | Disposition (per PLAN §threat_model) | How addressed |
|---|---|---|
| T-10-09 (DoS: temp dir not cleaned) | Mitigate | Both describe 2 and describe 4 have `after` hooks calling `rm(tmpDir, { recursive: true, force: true })` — verified temp dirs do not accumulate |
| T-10-10 (Info Disclosure: workdir in logs) | Accept | `mkdtemp` uses system tmp dir; test logs only emit 401 from LLM service (no workdir leak) |
| T-10-11 (Repudiation: test passes but handler buggy) | Mitigate | 4-dimension coverage (routing + execution + integrity + degradation) — not a single-point assertion; 19 tests across orthogonal axes |

## Commits

- `2b20574` — test(10-03): cover phaseHandlers routing + V2_MIGRATION_MAP integrity

(Task 2 is verify-only, no code changes — Task 1's commit covers the only modified file.)

## Self-Check: PASSED

- FOUND: test/phases/handlers.test.mjs (created, 360 lines)
- FOUND: .planning/phases/10-phases-handler/10-03-SUMMARY.md (this file)
- FOUND: commit 2b20574 in git log
- PASS: 19/19 tests green on `node --test test/phases/handlers.test.mjs`
- PASS: zero `npm:` import prefixes (grep exit 1)
- PASS: v1.0 regression tests show no new failures (5 pre-existing v41 fails documented as V6-migration consequence)
