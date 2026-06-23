# Phase 21 Verification

**Plan:** 21-blacklist-engine
**Status:** PASSED
**Date:** 2026-06-22
**Executor:** Claude Code (combined plan + execute)

## Verification Scope

Full Phase 21 CONTEXT.md requirements verified via automated tests +
manual integration inspection.

## Requirements Coverage

| CONTEXT.md Requirement | Status | Evidence |
|---|---|---|
| New file `lib/blacklist-engine.js` per API | PASS | File exists, 328 lines |
| `callEmbedding(text)` helper in hermes-adapter | PASS | Exported, 7 tests pass |
| `record({shot_id, error, prompt, imagePath, audioPath?, run_id})` | PASS | Test B5-01 / dedup test |
| `check({prompt, imagePath})` → 'hit'\|'miss'\|'disabled'\|'degraded' | PASS | 15 BlacklistEngine tests |
| `pruneExpired()` TTL eviction | PASS | B5-04 (2 tests) |
| `_writeAuditLog()` append-only jsonl | PASS | B5-06 (2 tests) |
| Threshold 0.92 cosine | PASS | `_cosineSimilarity` test + hit test |
| TTL 30d default + configurable | PASS | ttlDays=7 test |
| Escape hatch env (BLACKLIST_DISABLED=1) | PASS | B5-05 env test |
| Escape hatch config (config.blacklist.disabled) | PASS | B5-05 config test |
| Escape hatch opts.disabled | PASS | B5-05 opts test |
| Degraded mode (GLM unreachable) | PASS | failing embedding fn test |
| Audit log path .pipeline-assets/blacklist-audit.jsonl | PASS | B5-06 path test |
| `runWithRetry({blacklist})` skip before retry | PASS | B5-03 hit test |
| Skip ≠ retry ≠ fail (3-state distinguishable) | PASS | B5-03 three-state test |
| cloud-production instantiates BlacklistEngine | PASS | Manual code review (lib/phases/index.js:3050+) |
| cloud-production passes blacklist to scheduler | PASS | Manual code review |
| cloud-production records permanent failures | PASS | Manual code review (for loop after runWithRetry) |
| Audit log on every record/check-hit/disable | PASS | B5-06 test + manual inspection |
| All 237 baseline tests still pass | PASS | `npm test`: 266 / 266 pass |

## Automated Test Run

```
$ npm test
ℹ tests 266
ℹ suites 78
ℹ pass 266
ℹ fail 0
ℹ duration_ms 10363.83625
```

Net new tests: **+29** (266 - 237 baseline).

## Integration Inspection (cloud-production handler)

Code path verified manually in `lib/phases/index.js`:

1. **Construction** (~line 3050):
   ```js
   const blacklist = new BlacklistEngine({
     assetBus: bus,
     workdir: pipeline.workdir,
     config: pipeline.config,  // reads config.blacklist.{disabled,ttl_days,threshold}
   });
   ```
2. **Startup prune**: `await blacklist.pruneExpired()` wrapped in try/catch (non-blocking)
3. **Pass to scheduler**: `scheduler.runWithRetry(shotsToRun, taskFn, {maxRetries, blacklist})`
4. **Record permanent failures**: loop over `ShotParallelScheduler.collectPermanentFailures(newResults)`, call `blacklist.record({shot_id, error, prompt: shot.description, imagePath, run_id: pipeline.episode})`
5. **Stats added**: `stats.blacklisted` + `metrics.blacklisted` + `_hermesAudit({blacklisted: ...})`

## Failure Modes Verified

| Mode | Behavior | Test |
|---|---|---|
| GLM API 500 | `callEmbedding → null → check → 'degraded'` | callEmbedding HTTP 500 test + degraded test |
| Network error | `callEmbedding → null → check → 'degraded'` | callEmbedding network error test |
| No ZHIPU_API_KEY | `callEmbedding → null (no fetch)` | callEmbedding no-key test |
| AssetBus read fail | `check → empty failures → 'miss'` | "无 failed-shots" test |
| Audit log write fail | swallowed (warn only) | defensive code path |

## Edge Cases Handled

- **Empty prompt**: `check → 'miss'` (cannot semantic-match nothing)
- **Failed-shot w/o embedding** (recorded during degraded mode): skipped during cosine scan, doesn't block matches against other recorded failures
- **Same shot re-failed**: dedup by `shot_id + prompt_hash`, updates timestamp (prevents unbounded growth)
- **blacklist.check() throws unexpectedly**: scheduler treats as 'miss', continues (defensive)
- **All shots blacklisted**: 0 taskFn calls, all results `{status:'blacklisted'}`

## Conclusion

**Phase 21 PASSED.** All CONTEXT.md requirements implemented, all critical-constraint
checkboxes satisfied, all 266 tests green (237 baseline + 29 new). The pipeline
now has a cross-run bad-case memory: permanent failures from run N feed embeddings
into the blacklist, and run N+1 skips semantically similar prompts before retry.
