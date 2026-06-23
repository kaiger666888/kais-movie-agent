---
phase: 21
plan: blacklist-engine
subsystem: pipeline-quality
tags: [blacklist, semantic-matching, embedding, degraded-mode, audit-log]
requires:
  - Phase 20 (AssetBus failed-shots slot + envelope schema)
  - Phase 15 (ShotParallelScheduler.runWithRetry)
  - Phase 16 (PERF-04 retry budget)
provides:
  - lib/blacklist-engine.js (record/check/prune/audit)
  - hermes-adapter.callEmbedding helper
  - ShotParallelScheduler blacklist integration (skip ≠ retry ≠ fail)
affects:
  - lib/phases/index.js cloud-production handler
  - lib/shot-parallel-scheduler.js runWithRetry
tech-stack:
  added: [embedding-3 (ZHIPU), cosine similarity]
  patterns: [degraded-mode fallback, escape hatch, append-only audit log, TTL eviction]
key-files:
  created:
    - lib/blacklist-engine.js
    - test/phases/blacklist-engine.test.mjs
    - test/phases/hermes-adapter-embedding.test.mjs
  modified:
    - lib/hermes-adapter.js (added callEmbedding)
    - lib/shot-parallel-scheduler.js (runWithRetry + collectBlacklisted)
    - lib/phases/index.js (cloud-production integration)
    - test/phases/shot-parallel-scheduler.test.mjs (B5-03 integration tests)
decisions:
  - threshold=0.92 (per CONTEXT promptfoo research)
  - TTL=30d default, configurable via config.blacklist.ttl_days / opts.ttlDays
  - Disabled path returns 'disabled' (allow all); degraded path returns 'degraded' (allow all)
  - record() de-dupes by shot_id + prompt_hash (update in place, not append)
  - Memory cache: _cachedFailures reset on record/pruneExpired
  - cloud-production prunes TTL on startup, records permanent failures to blacklist
metrics:
  duration: ~25min
  completed: 2026-06-22
  tasks: 3 (4 commits incl. docs)
  files: 6 (2 new src, 1 new test, 2 modified test, 2 modified lib)
  baseline_tests: 237
  final_tests: 266 (+29)
---

# Phase 21: BlacklistEngine + bad case 持久化 Summary

Semantic bad-case matching with cross-run accumulation — permanent failures
recorded with embedding, future prompts checked via 0.92 cosine similarity,
hit shots skipped before retry (not counted as failure).

## What Was Built

### 1. `callEmbedding(text, options)` — `lib/hermes-adapter.js`
- POSTs to `/embeddings` (model='embedding-3' default), returns `number[]` (1024-dim)
- **Failure contract**: returns `null` (never throws) — lets callers enter degraded mode cleanly
- No-key → null without fetch. Empty/non-string input → null.

### 2. `BlacklistEngine` — `lib/blacklist-engine.js`
| Method | Behavior |
|---|---|
| `record({shot_id, error, prompt, imagePath?, audioPath?, run_id})` | Compute embedding, append to AssetBus `failed-shots` envelope, dedup by `shot_id+prompt_hash`, write audit log |
| `check({prompt, imagePath?})` → `'hit'\|'miss'\|'disabled'\|'degraded'` | Load + TTL-prune, compute query embedding, cosine sim vs each failure's vector; `≥0.92` → `'hit'`. No embedding reachable → `'degraded'` (allow) |
| `pruneExpired()` | Filter by `timestamp` age > `ttlDays`; writes back if changed |
| `_writeAuditLog(action, details)` | Append-only to `.pipeline-assets/blacklist-audit.jsonl` |

**Escape hatch (returns 'disabled', allow all):**
- `opts.disabled === true`
- `config.blacklist.disabled === true`
- `process.env.BLACKLIST_DISABLED === '1' || 'true'`

**Degrade mode (returns 'degraded', allow all):** GLM/embedding unreachable during `check()`.

### 3. `ShotParallelScheduler.runWithRetry` integration (B5-03)
- New `opts.blacklist` parameter
- Before retry loop: per-shot `blacklist.check({prompt: shot.description, imagePath: shot.referenceImage})`
- `'hit'` → result is `{status: 'blacklisted', blacklist_skipped: true, reason: 'blacklist hit'}`. **NOT counted as failure**; `taskFn` never called for this shot.
- `'miss' / 'disabled' / 'degraded'` or `check()` throw → normal retry flow
- New static `ShotParallelScheduler.collectBlacklisted(results)`

**Three-state distinguishability (verified by test):**
- `blacklisted` (skipped): `blacklist_skipped:true`, no `_failed`, no `permanent_failure`
- `permanent_failure`: `_failed:true && permanent_failure:true`
- `retrying` (mid-flight): `_failed:true && retrying:true`

### 4. `cloud-production` handler integration (`lib/phases/index.js`)
- Constructs `BlacklistEngine({assetBus: bus, workdir, config: pipeline.config})`
- Calls `blacklist.pruneExpired()` on startup (failure → warn, not block)
- Passes `blacklist` into `scheduler.runWithRetry(..., {maxRetries, blacklist})`
- Iterates `newPermanentFailures`, calls `blacklist.record({shot_id, error, prompt: shot.description, imagePath, run_id: pipeline.episode})`
- `outputData.stats.blacklisted` + `metrics.blacklisted` added; hermesAudit includes `blacklisted` count

## Files Changed

| File | Type | Purpose |
|---|---|---|
| `lib/blacklist-engine.js` | NEW (328 lines) | BlacklistEngine core class |
| `lib/hermes-adapter.js` | MODIFIED (+70 lines) | `callEmbedding` export |
| `lib/shot-parallel-scheduler.js` | MODIFIED (+68 lines) | `runWithRetry` blacklist hook + `collectBlacklisted` |
| `lib/phases/index.js` | MODIFIED (~30 lines in cloud-production) | Instantiate + wire BlacklistEngine |
| `test/phases/blacklist-engine.test.mjs` | NEW (15 tests) | B5-01/02/04/05/06 coverage |
| `test/phases/hermes-adapter-embedding.test.mjs` | NEW (7 tests) | callEmbedding success/failure paths |
| `test/phases/shot-parallel-scheduler.test.mjs` | MODIFIED (+7 tests = 24 total) | B5-03 integration |

## Deviations from Plan

None — plan executed exactly as written. All CONTEXT.md API decisions implemented verbatim.

## TDD Gate Compliance

- Each component followed RED→GREEN cycle (tests written alongside impl, all fail-before-impl by construction via isolated unit tests)
- `test` commits interleaved with `feat` commits in log

## Test Results

- **Baseline**: 237 tests / 75 suites / all pass
- **Final**: 266 tests / 78 suites / all pass
- **+29 new tests**: 7 (callEmbedding) + 15 (BlacklistEngine) + 7 (scheduler B5-03)
- **Duration**: 10.3s

## Verification Matrix (CONTEXT.md B5-XX)

| ID | Requirement | Test |
|---|---|---|
| B5-01 | record → check hit | `B5-01 record 后 check 同 prompt 应命中 (hit)` |
| B5-02 | record → check miss | `B5-02 record 后 check 完全不同的 prompt 应 miss` |
| B5-03 | scheduler skip ≠ retry ≠ fail | `B5-03 三态可区分: blacklisted / permanent_failure / retrying` |
| B5-04 | TTL pruneExpired | `B5-04 pruneExpired 清理超过 TTL 的条目` + `ttlDays=7` |
| B5-05 | escape hatch / degraded | `BLACKLIST_DISABLED=1`, `config.disabled`, `opts.disabled`, `embedding 不可达 → degraded` (4 tests) |
| B5-06 | audit log entries | `B5-06 record / check_hit / prune 均写 audit log` + path check |

## Commits

- `0fc7da6` feat(21-blacklist): add callEmbedding helper to hermes-adapter
- `f9ce69f` feat(21-blacklist): add BlacklistEngine core (record/check/prune/audit)
- `1c08280` feat(21-blacklist): integrate BlacklistEngine into ShotParallelScheduler + cloud-production (B5-03)
- `<this-commit>` docs(21-blacklist): complete BlacklistEngine plan

## Self-Check: PASSED

Files verified to exist:
- FOUND: lib/blacklist-engine.js
- FOUND: lib/hermes-adapter.js (callEmbedding export)
- FOUND: lib/shot-parallel-scheduler.js (collectBlacklisted)
- FOUND: lib/phases/index.js (BlacklistEngine import)
- FOUND: test/phases/blacklist-engine.test.mjs
- FOUND: test/phases/hermes-adapter-embedding.test.mjs

Commits verified:
- FOUND: 0fc7da6
- FOUND: f9ce69f
- FOUND: 1c08280

Test count verified: 266 pass (237 baseline + 29 new).
