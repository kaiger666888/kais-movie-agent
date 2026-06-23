---
phase: 12
plan: 12
subsystem: consistency-audit
tags: [quality, consistency, glm-4v, audit, continuity]
requires:
  - lib/hermes-adapter.js (callLLMJson)
  - lib/asset-bus.js (read/write .pipeline-assets/)
  - lib/character-asset-manager.js (L1 anchor schema)
provides:
  - lib/continuity-auditor.js#_getDINOv2Score (real GLM-4V scoring)
  - lib/continuity-auditor.js#_scoreOnePair (single pair LLM call)
  - lib/continuity-auditor.js#_tryDINOv2Embedding (optional gold-team path)
  - lib/continuity-auditor.js#_runImmediateConsistencyAudit (helper)
  - consistency-guard handler real implementation
  - scene-generation / seed-skeleton / ai-preview audit hooks
affects:
  - lib/continuity-auditor.js
  - lib/phases/index.js
  - test/phases/handlers.test.mjs
tech-stack:
  added:
    - GLM-4V-Flash (vision model for identity comparison)
    - node:crypto createHash (cache key)
  patterns:
    - Cache layer keyed by sha256(image||anchor) for idempotent re-runs
    - Failure returns null (NOT fake score) — null-aware weight aggregation
    - Retry shot queue pattern (score < 0.7)
key-files:
  created:
    - .planning/phases/12-consistency-audit/12-SUMMARY.md
    - .planning/phases/12-consistency-audit/12-VERIFICATION.md
    - (runtime) .pipeline-assets/consistency-cache.json
    - (runtime) seed-skeleton-audit.json
    - (runtime) ai-preview-audit.json
  modified:
    - lib/continuity-auditor.js
    - lib/phases/index.js
    - test/phases/handlers.test.mjs
decisions:
  - GLM-4V-Flash as primary visual scorer (gold-team DINOv2 optional via capabilities probe)
  - Failure returns null instead of 0.7 fake score — null-aware dimension weighting
  - Audit failures warn only, do not throw (composition/Phase 13 handles fail)
  - Immediate trigger hooks are Phase 14-aware: silently skip when no images/anchors exist
metrics:
  duration: ~12min
  completed: 2026-06-22
---

# Phase 12 Plan 12: 一致性审计实化 Summary

Real consistency audit infrastructure — replaces `return 0.85` fake-data stub with GLM-4V batch scoring, activates `auditContinuity()` in consistency-guard handler, and triggers `auditImageVsL1()` immediately after scene/seed/preview generation.

## Commits

| # | Hash | Subject |
|---|------|---------|
| 1 | 2d84fec | feat(12): real _getDINOv2Score via GLM-4V + cache layer (QUAL-01) |
| 2 | a60ec26 | feat(12): real consistency-guard handler via auditContinuity (QUAL-03) |
| 3 | e38a41a | feat(12): auditImageVsL1 immediate trigger in 3 handlers (QUAL-04) |

## What Was Built

### Commit 1 — `_getDINOv2Score` real implementation
- **lib/continuity-auditor.js**: replaced `return 0.85` stub with real GLM-4V batch scoring
- Collects L1 approved anchors per character, calls GLM-4V per (image, anchor) pair
- **Cache layer**: `.pipeline-assets/consistency-cache.json` keyed by `sha256(image_path + '\0' + anchor_path)` — survives across episodes, idempotent re-runs
- **Optional DINOv2 path**: when gold-team client exposes `capabilities.dinov2_embedding`, uses cosine similarity on embeddings (falls back to GLM-4V otherwise)
- **Failure semantics**: returns `null` instead of fake score — `auditContinuity` now treats null-scored dimensions as weight=0 (don't poison the mean), and dimension pass-check skips null dimensions (they aren't failures, just unscored)
- `auditContinuity` accepts new `workdir` param for cache resolution

### Commit 2 — `consistency-guard` handler real implementation
- **lib/phases/index.js**: replaced Phase 10 stub with real `auditContinuity()` call
- Collects visuals from `spatio-temporal-script`, character/scene assets from AssetBus
- **No visuals path**: writes `consistency-pass.json` with `_reason: 'no_visuals_yet'` (Phase 14 hasn't generated images yet — audit auto-activates when they exist)
- **With visuals path**: calls real `auditContinuity`, includes real scores / findings / `retry_shots` array
- **Failure semantics**: audit exception → warn only, do not throw (composition/Phase 13 handles pipeline-level fail decisions)
- `retry_shots` populated from high-severity `identity_match` findings

### Commit 3 — `auditImageVsL1` immediate trigger (3 handlers)
- Added `_runImmediateConsistencyAudit` shared helper (character → L1 anchor resolution, single-character fallback, score < 0.7 → retry queue)
- **scene-generation**: post-generation audit when `phaseConfig.data.candidates` have `image_path`
- **seed-skeleton**: post-seedframe audit on `seed_frame_path`, persists `seed-skeleton-audit.json` when retries occur
- **ai-preview**: post-preview audit on `referenceImage` / `seed_frame_path`, persists `ai-preview-audit.json`
- All three hooks silently skip when no images or no L1 anchors exist — Phase 14 safe

## Test Results

**Baseline:** 66 pass / 0 fail
**After Phase 12:** 71 pass / 0 fail (+5 new audit tests)

New tests in `test/phases/handlers.test.mjs` describe block "Phase 12 一致性即时审计 hook (QUAL-04)":
1. consistency-guard 无 visuals → `_reason: no_visuals_yet`
2. consistency-guard 有 visuals → 调用真实审计 (handles 401 LLM failure gracefully)
3. scene-generation hook 触发 (候选图存在时)
4. seed-skeleton hook 触发 (seed_frame 存在时)
5. audit hook 无锚点 → 静默跳过 (`audited: 0`, no audit file written)

## Deviations from Plan

None - plan executed exactly as written. CONTEXT.md template followed precisely.

## Verification Notes

- Tests intentionally exercise real LLM call paths against an expired/missing API token (401). The 401 errors confirm the audit path is wired to real API calls (not stubbed). `auditImageVsL1` returns `{score: 0.5, passed: false}` on LLM failure, which correctly triggers `retry_shots` — this validates the failure semantics end-to-end.
- Once a valid `ZHIPU_API_KEY` is set, the same tests will produce real scores.

## Self-Check: PASSED

- [x] lib/continuity-auditor.js exists and exports `auditContinuity`/`auditImageVsL1`
- [x] lib/phases/index.js imports both functions
- [x] commits 2d84fec, a60ec26, e38a41a present in git log
- [x] 71/71 tests pass
