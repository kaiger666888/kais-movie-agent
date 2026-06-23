# Phase 19 Verification — callLLM 重构 + GLM-4.6V 升级

**Date:** 2026-06-23
**Status:** PASSED (framework + mock baseline; real GPU run deferred to operator)
**Executor:** Claude Code (GSD executor)
**Commits:** 4 implementation + 1 docs

## Verification Matrix

| Decision | Success Criterion | Status | Evidence |
|----------|-------------------|--------|----------|
| D1-01 | callLLM/callLLMJson accept Array<ContentBlock> | ✅ PASS | lib/hermes-adapter.js L91-200; 20 unit tests pass |
| D1-01 | imagePathToDataUrl helper (file → base64) | ✅ PASS | lib/hermes-adapter.js L62-90; 5 dedicated tests |
| D1-01 | file:// / abs path auto-convert in adapter | ✅ PASS | _normalizeContentBlocks L99-125; 3 tests |
| D1-01 | Hermes path bypassed for multimodal | ✅ PASS | callViaHermes returns null for array prompt; 1 test |
| D1-02 | 5 hardcoded model names → ZHIPU_VISION_MODEL env | ✅ PASS | grep verified: no 'glm-4v-flash' literals in lib/ |
| D1-02 | continuity-auditor:398 glm-4v-flash → env | ✅ PASS | lib/continuity-auditor.js L398 |
| D1-02 | quality-gate.js:152 → env | ✅ PASS | lib/quality-gate.js L152 |
| D1-02 | scripts/*.py → env via _get_vision_model() | ✅ PASS | 3 files (scene-evaluator, anatomy-validator, hermes_helper) |
| D1-03 | 50-pair golden set framework | ✅ PASS | test/golden-set/ structure + 5 placeholders + runner |
| D1-03 | baseline-runner.mjs runnable | ✅ PASS | CLI exits 0 with mock data; 13 unit tests |
| D1-03 | baseline-report.json schema | ✅ PASS | mean/std/min/max/threshold_recommendation + _mock flag |
| D1-04 | _scoreCache model_version 前缀 | ✅ PASS | _cacheKey() updated; D1-04 tests pass |
| D1-04 | cache miss on model switch | ✅ PASS | unit test asserts different keys for different models |
| All | 165 baseline tests still pass | ✅ PASS | 208/208 pass (165 baseline + 43 new) |
| All | Zero npm deps | ✅ PASS | package.json unchanged |
| All | Idempotent | ✅ PASS | all calls read state, no destructive writes |

## Test Counts

```
Baseline (pre-Phase 19):    165 tests / 165 pass
Phase 19 added:             +43 tests / +43 pass
─────────────────────────────────────────────
Final:                      208 tests / 208 pass / 0 fail
Duration:                   ~10.3s
```

### New test files

| File | Tests | Covers |
|------|-------|--------|
| test/phases/hermes-adapter-multimodal.test.mjs | 20 | D1-01 multimodal + imagePathToDataUrl |
| test/phases/continuity-auditor-multimodal.test.mjs | 10 | D1-01 auditImageVsL1 + D1-04 cache key |
| test/phases/golden-set-baseline.test.mjs | 13 | D1-03 golden set framework |

## Real-API Verification (DEFERRED)

The following verifications require a real ZHIPU_API_KEY + real GPU access, deferred to operator:

- [ ] Run baseline-runner with real key on 5 placeholder pairs (replace with real images first)
- [ ] Compare glm-4v-flash vs glm-4.6v score distribution on identical pairs
- [ ] Verify threshold_recommendation matches empirical cliff (expected ~0.7-0.75)
- [ ] Validate auditImageVsL1 returns > 0.85 for known-same-character pairs

These are W-3 / B-1 items from v2.0 audit carried forward — they cannot be closed without real API access.

## Pitfall Compliance (Pitfalls.md P7)

| P7 Avoidance Step | Compliance |
|-------------------|------------|
| Refactor callLLM first, change model names second | ✅ Done (Commit 1 then Commit 2) |
| Centralize model name via ZHIPU_VISION_MODEL env | ✅ Done (5 sites unified) |
| _scoreCache version-stamped by model | ✅ Done (D1-04 prefix) |
| Golden-set scoring baseline before cutover | ✅ Framework done; real baseline = operator |
| Per-call thinking parameter | ✅ Supported via options.thinking (not enabled by default) |
| Test against real API key before merge | ⏳ Deferred (no key in executor env) |

## Files Changed

**Created (new):**
- test/phases/hermes-adapter-multimodal.test.mjs
- test/phases/continuity-auditor-multimodal.test.mjs
- test/phases/golden-set-baseline.test.mjs
- test/golden-set/README.md
- test/golden-set/baseline-runner.mjs
- test/golden-set/pairs/pair-001.json through pair-005.json (5 placeholders)

**Modified (existing):**
- lib/hermes-adapter.js (multimodal refactor + imagePathToDataUrl + env var)
- lib/continuity-auditor.js (auditImageVsL1 multimodal + _cacheKey model_version)
- lib/quality-gate.js (env var for visionModel)
- lib/scripts/scene-evaluator.py (_get_vision_model reads env)
- lib/scripts/anatomy-validator.py (_get_vision_model reads env)
- lib/scripts/hermes_helper.py (_default_vision_model reads env)

## Conclusion

Phase 19 achieves the primary objective: callLLM/callLLMJson now natively support OpenAI multimodal content blocks, and GLM-4.6V scoring will actually "see" images instead of guessing from file paths. The 5 scattered model literals are unified to a single env var, and the score cache is model-versioned.

Status: **PASSED** for the framework. Real GPU run is required before production cutover (carry-forward from v2.0 audit W-3/B-1, not introduced by this phase).
