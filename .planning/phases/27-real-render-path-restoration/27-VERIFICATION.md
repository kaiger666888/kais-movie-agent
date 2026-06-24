---
phase: 27-real-render-path-restoration
verified: 2026-06-24T13:30:00Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: N/A
  gaps_closed: []
  gaps_remaining: []
  regressions: []
---

# Phase 27: Real Render Path Restoration Verification Report

**Phase Goal:** 真实渲染路径不再沉默失败 — motion-preview 的 Blender 调用能成功提交任务并接收 taskId，jimeng-client 的 deprecated 调用要么迁移到 dreamina CLI 要么显式标注为 fallback-only（不再让 461 测试通过但渲染永远不发生）
**Verified:** 2026-06-24T13:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | motion-preview handler submits Blender tasks with camelCase `taskType` field (not snake_case `task_type`) | ✓ VERIFIED | `lib/phases/index.js:1088` reads `taskType: 'blender_render', priority: 3,`. Confirmed against `lib/gold-team-client.js:53` contract `submitTask({ taskType, ... })`. Negative grep: no `task_type:` in motion-preview submitTask block. |
| 2 | motion-preview handler reads `taskId` from submitTask response via `task.taskId` (not `task.task_id`) | ✓ VERIFIED | `lib/phases/index.js:1092` reads `previewResults.push({ shot_id: shot.id, taskId: task.taskId });`. Confirmed against `lib/gold-team-client.js:70` return shape `{ taskId: result.data.task_id, ... }`. |
| 3 | Existing baseline tests still pass + new regression test for camelCase (4 cases) | ✓ VERIFIED | `node --test test/phases/motion-preview-camelcase.test.mjs` → 4 pass / 0 fail. Full `npm test` → 483/483 pass (474 prior + 9 new). |
| 4 | Each of 3 JimengClient call sites emits one-shot deprecation warn | ✓ VERIFIED | `_warnJimengDeprecate()` helper at `lib/phases/index.js:87-91`, invoked at lines 651 (soul-visual), 2185 (character-generation), 2606 (scene-generation). Module-level flag `_jimengDeprecateWarned` at line 86 ensures once-per-process. |
| 5 | When JIMENG_API_KEY absent, degrade path is strict (no real API call, placeholder taken) | ✓ VERIFIED | Degrade audit: soul-visual try/catch (670-676), character-generation `jimeng.ping(3000)` gate (2239-2253), scene-generation AbortController ping (2615-2641) → `if (!jimengAvailable) { degraded = true; }` (2646-2648). All three strict. |
| 6 | Deprecate warn fires exactly once per process even across multiple JimengClient instantiations | ✓ VERIFIED | `test/phases/jimeng-deprecate-warn.test.mjs` Test 2 (3 invocations → 1 warn) + Test 3 (cross-handler: scene-gen + character-gen → 1 warn) both pass. |

**Score:** 6/6 truths verified

### Roadmap Success Criteria Mapping

| SC | Description | Status | Evidence |
| --- | --- | --- | --- |
| SC#1 | motion-preview 用 camelCase (`taskType`/`taskId`) + 单测断言请求体含非空 `task_type` | ✓ VERIFIED | Line 1088 `taskType`, line 1092 `task.taskId`. Test 1 asserts `calls[0].taskType === 'blender_render'`. Note: the "request body contains task_type" claim is indirect — `submitTask` builds `task_type: taskType` internally (gold-team-client.js:59), so passing camelCase `taskType` produces the request body field. The unit test mocks at submitTask boundary so it asserts the handler-side contract, not the wire-level body. |
| SC#2 | task 返回从 `task.taskId` 读取，单测断言 taskId 正确解析 | ✓ VERIFIED | Line 1092. Test 2 asserts `record.camera_paths[0].taskId === 'gt-task-123'` matching mock return. |
| SC#3 | 三个 handler 不再 active 调用 deprecated；要么迁移要么显式 try/catch + deprecation 标注 | ✓ VERIFIED (deviation accepted per D-PIPE-RENDER-02) | Did NOT migrate to dreamina CLI (no CLI in repo). Instead marked fallback-only with deprecation warn + verified strict try/catch degrade at all 3 sites. Per locked decision D-PIPE-RENDER-02 this satisfies the "显式标注为 fallback-only" branch. |
| SC#4 | 降级路径不抛 silent error，按 DEGRADE 契约返回 degraded 标记 | ✓ VERIFIED | All 3 sites set `degraded = true` / `degradedReason` on failure; scene-gen Test 4 + character-gen audit confirm placeholder path taken without throw. |

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `lib/phases/index.js` | motion-preview Blender submitTask call with correct camelCase fields + jimeng deprecate warn at 3 sites | ✓ VERIFIED | Lines 86-93 (deprecate mechanism), 651/2185/2606 (3 wraps), 1088/1092 (motion-preview fix). 18 insertions / 2 deletions total per `git diff`. |
| `lib/phases/index.js` line 1129 (was 1115 in plan) | snake_case `task_type: 'blender_render'` UNCHANGED — EvaluationCollector schema | ✓ VERIFIED | Line 1129 confirmed `task_type: 'blender_render'` inside `collector.record({...})`. Collector filters by `r.task_type` (lib/evaluation-collector.js:133) — changing would break schema. Documented deviation honored. |
| `test/phases/motion-preview-camelcase.test.mjs` | Regression test for camelCase submitTask (4 cases) | ✓ VERIFIED | 179 lines, 4 tests pass. Test 1 (taskType arg), Test 2 (taskId read), Test 3 (snake_case absence), Test 4 (degrade warn preserved). |
| `test/phases/jimeng-deprecate-warn.test.mjs` | Regression test for deprecate warn dedup + strict degrade (5 cases) | ✓ VERIFIED | 227 lines, 5 tests pass. Test 1 (warn emits), Test 2 (3× → 1 warn), Test 3 (cross-handler dedup), Test 4 (no-API-key → placeholder), Test 5 (source-string guard). |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `lib/phases/index.js:1088` (motion-preview submitTask call) | `lib/gold-team-client.js:53` `submitTask({ taskType })` | camelCase arg destructuring | ✓ WIRED | `taskType: 'blender_render'` matches `{ taskType }` destructure. Request body line 59 builds `task_type: taskType` correctly. |
| `lib/phases/index.js:1092` (previewResults.push) | `lib/gold-team-client.js:70` return shape `{ taskId }` | camelCase property read | ✓ WIRED | `task.taskId` reads return shape correctly. |
| `lib/phases/index.js:651, 2185, 2606` (3 JimengClient instantiations) | `lib/jimeng-client.js:14` deprecated class | `_warnJimengDeprecate()` wrap | ✓ WIRED | All 3 sites invoke helper immediately before `new JimengClient(...)`. Module-level flag dedups. |
| `lib/phases/index.js:2646` (scene-gen degrade gate) | placeholder path (no real API call) | `jimengAvailable === false → degraded = true` | ✓ WIRED | Ping at 2615-2641 sets flag; line 2646-2648 takes placeholder branch. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| --- | --- | --- | --- | --- |
| `lib/phases/index.js:1088-1092` motion-preview submitTask | `task.taskId` | `gtClient.submitTask(...)` return | Yes (when gold-team reachable) — but degraded to empty on reject | ✓ FLOWING |
| `lib/phases/index.js:651, 2185, 2606` JimengClient instantiate | `jimeng` instance | `new JimengClient(baseUrl)` constructor | N/A — instance used only inside strict degrade gate | ✓ FLOWING (gated) |

Note: Phase 27 is a bug-fix phase; data-flow is verified via the contract match (camelCase in/out) rather than live API calls. The unit tests mock at the submitTask / JimengClient boundary, which is the correct seam for regression guarding.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| motion-preview regression suite passes | `node --test test/phases/motion-preview-camelcase.test.mjs` | 4 pass / 0 fail | ✓ PASS |
| jimeng deprecate warn regression suite passes | `node --test test/phases/jimeng-deprecate-warn.test.mjs` | 5 pass / 0 fail | ✓ PASS |
| Full test baseline green | `npm test` | 483 pass / 0 fail (474 prior + 9 new) | ✓ PASS |
| Gold-team-client contract intact | `grep "taskType\|taskId" lib/gold-team-client.js` | line 53 `{ taskType }` / line 70 `taskId:` | ✓ PASS |
| No scope creep into other subsystems | `git diff --stat 7182832 afee17f -- lib/` | only `lib/phases/index.js` changed (+18/-2) | ✓ PASS |

### Probe Execution

| Probe | Command | Result | Status |
| --- | --- | --- | --- |
| (no probes declared for this phase) | N/A | N/A | SKIP — phase is bug-fix + unit test; no migration/tooling probes apply |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| PIPE-RENDER-01 | 27-01 | motion-preview Blender 字段大小写修复 (`task_type` → `taskType`, `task.task_id` → `task.taskId`) | ✓ SATISFIED | Lines 1088 + 1092 fixed; 4-test regression guard prevents relapse. Marked Complete in REQUIREMENTS.md and ROADMAP.md. |
| PIPE-RENDER-02 | 27-02 | jimeng-client deprecated 调用清理 (迁移或显式 fallback-only 标注) | ✓ SATISFIED | Per D-PIPE-RENDER-02, took the "显式标注为 fallback-only" branch: module-level dedup warn at all 3 call sites + strict degrade verification + 5-test regression guard. Marked Complete in REQUIREMENTS.md and ROADMAP.md. |

No orphaned requirements — REQUIREMENTS.md maps exactly PIPE-RENDER-01/02 to Phase 27, both covered by plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| (none) | — | — | — | No TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER markers in modified file. No empty implementations. No hardcoded empty data flows. | ℹ️ Info |

### Scope Creep Check

Confirmed via `git diff --stat 7182832 afee17f -- lib/`: only `lib/phases/index.js` was modified (+18/-2). No touches to:
- data-spine (Phase 26 territory)
- `lib/canvas-client.js`
- composition
- consistency-guard
- `lib/jimeng-client.js` (explicitly preserved per D-PIPE-RENDER-02)

### Human Verification Required

None. All phase truths are unit-test verifiable. No UI/visual/real-time/external-service behavior introduced. The phase is a surgical bug fix + regression test addition; `npm test` is sufficient acceptance.

### Gaps Summary

No gaps. All 6 must-have truths verified. All 4 roadmap Success Criteria met. Both requirement IDs (PIPE-RENDER-01, PIPE-RENDER-02) satisfied. 9 new tests added (4 + 5), full baseline 483/483 green, no scope creep, no debt markers, no anti-patterns.

**Documented deviations (all in-plan, accepted):**
- Line 1129 (collector.record) intentionally kept snake_case — EvaluationCollector schema contract.
- D-PIPE-RENDER-02 chose "fallback-only marking" branch over "dreamina CLI migration" branch — no CLI in repo.
- `_resetJimengDeprecateFlagForTest` test-only export added — establishes new `_forTest` convention; within plan scope (line 253).

---

_Verified: 2026-06-24T13:30:00Z_
_Verifier: Claude (gsd-verifier)_
