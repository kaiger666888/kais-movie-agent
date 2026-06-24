---
phase: 27
plan: 01
phase_name: real-render-path-restoration
subsystem: render-path
tags: [motion-preview, gold-team-client, field-case, regression-test]
requires:
  - lib/gold-team-client.js:submitTask contract ({ taskType } in, { taskId } out)
provides:
  - "motion-preview handler now successfully submits Blender render tasks (silent failure closed)"
  - "Regression test preventing snake_case task_type / task.task_id relapse"
affects:
  - "Phase 27-02 (jimeng-client) shares lib/phases/index.js but different handler blocks — no conflict"
tech_stack:
  added: []
  patterns:
    - "GoldTeamClient.prototype.submitTask monkey-patch for handler-level mocking (mirrors character-generation.test.mjs pattern)"
key_files:
  created:
    - test/phases/motion-preview-camelcase.test.mjs
  modified:
    - lib/phases/index.js
decisions:
  - "D-PIPE-RENDER-01 honored: minimal scope — only line 1074 + 1078 changed. Line 1115 (collector.record) intentionally left snake_case because EvaluationCollector schema filters by r.task_type (lib/evaluation-collector.js:133). Changing it would break the collector."
  - "TDD split across the two plan tasks: Task 1 is the GREEN fix, Task 2 is the RED regression guard that would have failed pre-fix. Plan-level RED/GREEN gate satisfied."
metrics:
  duration: 4min
  completed: 2026-06-24
  tasks_completed: 2
  files_changed: 2
  tests_added: 4
---

# Phase 27 Plan 01: motion-preview submitTask camelCase Fix Summary

Fixed the silent-failure bug where motion-preview's Blender render submission passed snake_case `task_type` to `GoldTeamClient.submitTask` (which destructures camelCase `{ taskType }`) and read `task.task_id` from a return shape of `{ taskId }` — both yielding `undefined` and silently dropping the render request.

## What Shipped

**Bug fix (lib/phases/index.js, 2 lines):**
- Line 1074: `task_type: 'blender_render'` → `taskType: 'blender_render'` — submitTask now destructures the taskType correctly, the request body includes `task_type`, and gold-team can dispatch the Blender task.
- Line 1078: `task.task_id` → `task.taskId` — the recorded taskId now matches the submitTask return shape instead of being `undefined`.

**Regression test (test/phases/motion-preview-camelcase.test.mjs, 4 cases):**
- Test 1: asserts `calls[0].taskType === 'blender_render'` (camelCase invocation).
- Test 2: asserts the bus record's `camera_paths[0].taskId === 'gt-task-123'` (camelCase return read).
- Test 3: regression guard — `calls[0].task_type === undefined` (snake_case property MUST be absent).
- Test 4: degrade path preserved — submitTask reject fires `[motion-preview] Blender降级` warn + writes empty `camera_paths`.

## Deviations from Plan

None — plan executed exactly as written. The plan's documented line-1115 carve-out (collector schema uses snake_case deliberately, NOT a submitTask call) was honored: line 1115 is unchanged.

## Verification

| Check | Result |
|-------|--------|
| Line 1074 uses `taskType: 'blender_render'` | PASS |
| Line 1078 uses `task.taskId` | PASS |
| Line 1115 unchanged (`task_type: 'blender_render'` collector schema) | PASS |
| New regression test (4 cases) | PASS |
| Existing handlers.test.mjs (29 cases) | PASS |
| Full baseline suite | 478/478 PASS (474 prior + 4 new) |

## Threat Flags

None. The field-case fix closes the T-27-01 Tampering disposition in the plan's threat register: `taskType` now reaches the request body so gold-team can validate `task_type` server-side. T-27-02 (taskId recording) is mitigated as a side effect. No new network/auth surface introduced.

## TDD Gate Compliance

- RED: Task 2's regression test would have failed against pre-Task-1 code (Test 1 asserts `taskType`, Test 3 asserts `task_type === undefined`).
- GREEN: Task 1 commit `a9ecf38` makes all 4 tests pass.
- No REFACTOR needed — the fix is surgical (2 lines).

Both gates satisfied across the two-task split.

## Self-Check: PASSED

- [x] `lib/phases/index.js` exists and contains the fix (lines 1074, 1078).
- [x] `test/phases/motion-preview-camelcase.test.mjs` exists.
- [x] Commit `a9ecf38` present in `git log`.
- [x] Commit `3e4f736` present in `git log`.
