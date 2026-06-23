---
phase: 15
plan: 15
subsystem: parallel-safety
tags: [parallelism, security, shell-injection, ffmpeg, seedance, scheduler]
requires:
  - lib/gold-team-client.js (GoldTeamClient.waitForTask)
  - lib/character-asset-manager.js (getOmniReferencePack)
  - lib/asset-bus.js
  - lib/phases/index.js (Phase 10 cloud-production stub to replace)
  - lib/composition-engine.js (execSync string → execFile args)
provides:
  - lib/shot-parallel-scheduler.js (ShotParallelScheduler worker-pool, error isolation)
  - lib/composition-engine.js#sanitizePath (shell metachar reject)
  - cloud-production handler real impl (Seedance omni_reference parallel)
  - ai-preview / final-production ShotParallelScheduler upgrade
affects:
  - lib/phases/index.js
  - lib/composition-engine.js
  - test/phases/handlers.test.mjs
tech-stack:
  added:
    - node:child_process execFile (replaces execSync)
    - node:util promisify(execFile)
  patterns:
    - Worker-pool scheduler with shared cursor (no overspawn)
    - Error isolation: per-shot failure → {shot_id, error, _failed}, others continue
    - Idempotent re-run via video_tasks.json status=completed skip
    - Path sanitize before any external command invocation
    - Single-degradation fallback (no double string concat)
key-files:
  created:
    - lib/shot-parallel-scheduler.js
    - test/phases/shot-parallel-scheduler.test.mjs
    - test/phases/cloud-production.test.mjs
    - test/phases/composition-engine-safe.test.mjs
    - .planning/phases/15-parallel-safety/15-SUMMARY.md
    - .planning/phases/15-parallel-safety/15-VERIFICATION.md
  modified:
    - lib/phases/index.js
    - lib/composition-engine.js
    - test/phases/handlers.test.mjs
decisions:
  - Worker-pool model (shared cursor) over Promise.all chunks — simpler, no overspawn
  - Failed shots recorded to failed_shots[] for Phase 16 retry budget (not fatal)
  - Idempotency via video_tasks.json status=completed check — preserves prior task IDs
  - gold-team unavailable → stub result with degraded flag (NOT throw fatal, for Phase 17 E2E)
  - sanitizePath rejects 7 chars: " ` $ ; | \n \r (common shell metas)
  - execFile over execSync even for ffprobe — zero shell surface
  - Removed second-pass string-concat fallback in compose() (was masking real ffmpeg errors)
metrics:
  duration: ~25min
  completed: 2026-06-22
---

# Phase 15 Plan 15: 镜头级并行 + 工程安全 Summary

Three industrial-grade upgrades in one phase: real shot-level parallel video generation (replacing serial for...of loops + the Phase 10 cloud-production stub), and shell-injection-safe CompositionEngine via execFile + path sanitize.

## Commits

| # | Hash | Subject |
|---|------|---------|
| 1 | 5399248 | feat(15-01): add ShotParallelScheduler for shot-level parallelization (PERF-01) |
| 2 | d3fb00c | feat(15-01): real cloud-production handler + ai-preview/final-production parallelization |
| 3 | 2f5da96 | feat(15-01): CompositionEngine execFile rewrite + path sanitize (SAFE-01/02/03) |

## What Was Built

### 1. ShotParallelScheduler (PERF-01 infrastructure)

New `lib/shot-parallel-scheduler.js` — worker-pool model:

- `runAll(shots, taskFn)` returns array index-aligned with input shots
- Worker count = `min(parallelism, shots.length)` — never overspawns
- Failed shot → `{shot_id, error, _failed}` in result array (others continue)
- `collectFailures(results)` static helper for Phase 16 retry budget
- Empty shots array returns immediately, zero workers spawned

### 2. cloud-production Real Handler (PERF-01, was Phase 10 stub)

Replaced `video_tasks.json` stub with real Seedance omni_reference pipeline:

- Per-shot: `getOmniReferencePack` → `submitTask(seedance_omni_reference)` → `waitForTask` (5s poll, 10min timeout)
- **Idempotent**: shots already in `video_tasks.json` with `status=completed` are skipped on re-run; their task IDs are preserved in the merged output
- **Degradation**: `gold-team ping` fails OR no shots → stub `{_stub:true, degraded:true, reason}`, returns normally (no fatal)
- **Error isolation**: per-shot failures collected to `failed_shots[]` for Phase 16 retry
- **Stats**: total_shots, completed, failed, skipped_idempotent written to video_tasks.json

### 3. ai-preview / final-production Parallelization (PERF-02)

Converted serial `for...of` loops in both V4.1 handlers to `ShotParallelScheduler.runAll`:

- `parallelism: 4` (from `effectiveParams.parallel_shots` or `HERMES_DEFAULTS['cloud-production'].parallel_shots`)
- All existing per-shot try/catch logic preserved inside the taskFn
- Order alignment via scheduler's index contract
- Hermes audit calls fire from within workers (fire-and-forget, no ordering dependency)

### 4. CompositionEngine execFile + sanitize (SAFE-01, SAFE-02, SAFE-03)

Eliminated shell injection surface in `lib/composition-engine.js`:

- **SAFE-01**: `execSync(cmd_string)` → `execFileP(ffmpegPath, args[])`. All FFmpeg / ffprobe invocations use args arrays, no shell.
- **SAFE-02**: New exported `sanitizePath(p)` rejects paths containing `"`, `` ` ``, `$`, `;`, `|`, `\n`, `\r`. Applied to all inputs before any execFile call.
- **SAFE-02**: loudnorm LUFS measurement no longer uses shell pipe `2>&1 | tail -12` — reads stderr directly via execFile.
- **SAFE-03**: Deleted second-pass execSync string concatenation fallback in `compose()`. Now single-degradation only: no audio → video `-c copy`. ffmpeg failures return `{output:null, error}` instead of masking via secondary string-built command.

## Test Results

```
ℹ tests 126
ℹ suites 50
ℹ pass 126
ℹ fail 0
ℹ duration_ms ~1500
```

Test breakdown (added this phase, 30 new tests):
- `shot-parallel-scheduler.test.mjs`: 8 tests (concurrency timing, error isolation, empty array, overspawn guard, order alignment, ctor validation, collectFailures)
- `cloud-production.test.mjs`: 4 tests (degraded stub for unavailable gold-team / no shots, idempotency skip, parallel + error isolation)
- `composition-engine-safe.test.mjs`: 18 tests (9 sanitizePath cases, 3 path-enforcement cases, static source check, no-audio single degradation, multi-track amix, ffmpeg-failure no-secondary-concat)
- `handlers.test.mjs`: 1 existing cloud-production test updated to match new degraded contract (was checking `_pendingRealImplementation`, now checks `degraded + reason`)

## Deviations from Plan

None — plan executed exactly as written. The only adjustment was updating `handlers.test.mjs` to match the new degraded-mode contract for cloud-production (the prior test asserted `_pendingRealImplementation` which was a Phase 10 stub marker, now removed). This was a Rule 1 auto-fix: the prior assertion referenced a field that no longer exists by design.

## Notes

- `seedance_omni_reference` task_type is assumed supported by gold-team per CONTEXT.md `decisions.Claude's Discretion`. Real Seedance API integration is deferred to v3.0 per plan.
- The parallelism config (`parallel_shots: 4`) lives in `HERMES_DEFAULTS['cloud-production']` and is read by all three handlers (cloud-production, ai-preview, final-production) via `effectiveParams.parallel_shots`.
- `_loadPreviousVideoTasks(workdir)` helper added to `lib/phases/index.js` for idempotency detection.
- ffmpeg integration tests in `composition-engine-safe.test.mjs` auto-detect availability and inline-skip if absent (CI-friendly).

## Self-Check: PASSED

All created files verified to exist on disk via `[ -f path ]`. All three task commit hashes (5399248, d3fb00c, 2f5da96) verified present in `git log --oneline --all`. 126/126 tests pass.
