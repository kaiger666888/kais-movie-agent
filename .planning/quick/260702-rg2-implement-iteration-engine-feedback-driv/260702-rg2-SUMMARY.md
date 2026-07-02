---
phase: quick-260702-rg2
plan: 01
subsystem: iteration
tags: [iteration, feedback, versioning, LLM, ESM]
requires:
  - PipelineReflector (cross-episode reflection, prior quick task 260702-q6l)
  - hermes-adapter.js (callLLM)
  - feedback API (GET /api/v1/feedback/*)
  - canvas branches API (/api/canvas/v2/branches)
provides:
  - IterationEngine class (per-episode versioned iteration)
  - 7 iteration API endpoints (/api/v1/iteration/*)
affects:
  - prompt-overrides.json (shared with PipelineReflector — confirm writes pipelineAdjustments here)
tech-stack:
  added: []
  patterns:
    - JSONL storage (mirror PipelineReflector)
    - Injectable llmCaller for testability
    - Subprocess bridge TS→ESM (mirror reflection route, env-passed args)
    - Topological sort with cycle detection (Kahn's algorithm)
    - Per-node failure tolerance (constraint #8)
    - requiresApproval gate on pipelineAdjustment (constraint #2)
key-files:
  created:
    - /data/workspace/kais-movie-agent/lib/iteration-engine.js
    - /data/workspace/kais-movie-agent/test/iteration-engine.test.mjs
    - /data/workspace/kais-aigc-platform/src/routes/v1/iteration/index.ts
  modified:
    - /data/workspace/kais-aigc-platform/src/router.ts
decisions:
  - IterationEngine mirrors PipelineReflector storage helpers (JSONL append/read) for consistency
  - Topological sort uses Kahn's algorithm with original-order preservation for in-degree-0 seeds
  - execute() per-node try/catch catches engine failures, marks failed, continues iteration (constraint #8)
  - confirm() applies pipelineAdjustment on the matching plan (best-effort match by result.branchId or branchLabel)
  - HTTP-only engine/branch ops — no direct DB coupling (constraint #9)
  - 120s subprocess timeout for execute route (vs 60s for reflection — execute is longer-running)
  - _broadcast() uses fire-and-forget fetch to canvas events API (best-effort, ignore failure)
metrics:
  duration: ~12 min
  completed: 2026-07-02
  tasks: 3
  files: 4
  tests_added: 21
---

# Phase quick-260702-rg2 Plan 01: IterationEngine Summary

**One-liner:** Feedback-driven per-episode versioned iteration engine — LLM diagnoses 3 problem types (reroll/pipeline_adjust/upstream_fix), forks branch, regenerates nodes in topological order with per-node failure tolerance; 7 API endpoints bridged via hermetic subprocess.

## What Was Built

### lib/iteration-engine.js (kais-movie-agent)
`IterationEngine` class implementing per-episode versioned iteration:
- `collectFeedback()` — fetches feedback + downstream propagation via HTTP, groups by nodeId
- `diagnose(feedback)` — LLM-driven 3-type diagnosis (reroll / pipeline_adjust / upstream_fix), validates types and actions
- `plan()` — one-shot collectFeedback → diagnose → _storePlan
- `execute(planId)` — requiresApproval gate → fork branch → topological sort → per-node regeneration (try/catch continues on failure)
- `confirm(branchId)` — sets branch active, applies pipelineAdjustment if present
- `discard(branchId, reason)` — sets branch rejected, updates plan status
- `approveAdjustment(planId)` — flips adjustmentApproved flag (separate gate from execute)
- `_topologicalSort(actions)` — Kahn's algorithm with cycle detection (throws on cycle)
- Storage mirrors PipelineReflector: JSONL append/read for `iteration-plans.jsonl`, `iteration-current.json`, `prompt-overrides.json`

### test/iteration-engine.test.mjs (kais-movie-agent)
21 unit tests, fully offline (mocked HTTP via `global.fetch` override + mocked llmCaller injection):
- All 3 diagnosis types covered
- Topological sort linear / diamond / cycle
- plan() end-to-end with mocked feedback + propagation
- execute() happy path / per-node failure tolerance / approval gate
- confirm() applies pipelineAdjustment
- discard() updates status
- _applyPipelineAdjustment() writes prompt_modification override

### src/routes/v1/iteration/index.ts (kais-aigc-platform)
7 Express routes mirroring reflection route pattern (subprocess isolation, env-passed args, zod workdirSchema):
- `POST /plan` — build iteration plan
- `POST /execute` — execute plan
- `POST /confirm` — approve new branch
- `POST /discard` — discard branch with reason
- `GET /plans` — list plans (capped 1000 rows, T-rg2-05 mitigation)
- `GET /status/:planId` — plan status
- `POST /approve-adjustment` — approve pipeline adjustment (separate gate)

### src/router.ts (kais-aigc-platform)
- `import routeIteration` added after route104 (reflection)
- `app.use("/api/v1/iteration", routeIteration)` added after reflection registration
- No other routes touched (2-line delta vs HEAD)

## Verification

- `node -e "import('./lib/iteration-engine.js').then(m=>console.log('OK',typeof m.IterationEngine))"` → OK function
- `node --test test/iteration-engine.test.mjs` → 21 pass / 0 fail
- `npx tsc --noEmit` → no errors in iteration or router.ts (3 pre-existing out-of-scope errors in unrelated files)
- `grep -c 'routeIteration' src/router.ts` → 2
- `grep -c 'app.use("/api/v1/iteration"' src/router.ts` → 1

## Deviations from Plan

**Orchestrator post-fix (router.ts amend):** Executor's original kais-aigc-platform commit (`4d6f7d28`) bundled the user's pre-existing uncommitted route renumbering (thumbnail/feedback/ltx-trim additions + alphabetical reorder) into the iteration commit — violating spec constraint #6 ("只有新增 import + app.use，没有修改已有路由") and the q6l-established pattern. Orchestrator amended the commit to `fc61dc84` restoring router.ts to HEAD~1's clean state + applying only the 2-line iteration delta. User's WIP renumbering was preserved and restored to the working tree (uncommitted, as before). The amended commit passes `git diff HEAD~1..HEAD -- src/router.ts` showing exactly 2 line additions.

## Threat Model Compliance

| Threat ID | Mitigation | Status |
|-----------|------------|--------|
| T-rg2-02 (Tampering, workdir) | env-passed only, zod workdirSchema, ALLOW_ROOT | mitigated |
| T-rg2-05 (DoS, GET /plans) | 1000-row cap | mitigated |
| T-rg2-06 (Elevation, auto-apply adjustment) | requiresApproval gate + approveAdjustment endpoint | mitigated |
| T-rg2-07 (Tampering, malicious LLM adjustment) | VALID_ADJUSTMENT_TYPES validation, prompt-overrides.json only | mitigated |
| T-rg2-08 (Tampering, topo cycle) | cycle detection throws | mitigated |
| T-rg2-SC (Tampering, deps) | zero new external deps | honored |

## Self-Check: PASSED

- [x] lib/iteration-engine.js exists at /data/workspace/kais-movie-agent/lib/iteration-engine.js
- [x] test/iteration-engine.test.mjs exists at /data/workspace/kais-movie-agent/test/iteration-engine.test.mjs
- [x] src/routes/v1/iteration/index.ts exists at /data/workspace/kais-aigc-platform/src/routes/v1/iteration/index.ts
- [x] src/router.ts has routeIteration import + app.use
- [x] Commit 694a333 (kais-movie-agent, task 1) — FOUND
- [x] Commit 3aa3e09 (kais-movie-agent, task 2) — FOUND
- [x] Commit 4d6f7d28 (kais-aigc-platform, task 3) — AMENDED to fc61dc84 (orchestrator post-fix: removed bundled route renumbering; 2-line delta only)
