# Phase 22 Verification Report

**Phase:** 22 — Seedance 2.0 Audio-Visual Sync (v3.0)
**Status:** PASSED
**Verified:** 2026-06-23
**Test count:** 290 (266 baseline + 24 new)

## Critical Constraints (all satisfied)

| # | Constraint | Verification |
|---|-----------|--------------|
| 1 | getOmniReferencePack accepts audioRefs opt, produces @Audio bindings, returns hasAudio | ✅ 6 tests in character-asset-manager.test.mjs |
| 2 | cloud-production reads voice-timeline from AssetBus | ✅ cloud-production-audio-sync.test.mjs "正常进入调度流程" |
| 3 | Timing lock: shots with dialogue but no voice-timeline → throw | ✅ test "shots 含 dialogue 但无 voice-timeline → 抛出时序锁错误" |
| 4 | Per-shot audio refs assembly | ✅ test "audio_refs 透传到 submitTask" |
| 5 | Submit with audio_refs + generate_audio flag | ✅ test asserts `params.generate_audio === true` |
| 6 | Mandatory @Audio binding validation (audio present but no @Audio → reject) | ✅ source code check at lib/phases/index.js (Phase 22 A2-03 block) |
| 7 | lip_sync_threshold: 1.0 → 0.75 | ✅ source code: HERMES_DEFAULTS.delivery.lip_sync_threshold: 0.75 |
| 8 | Chinese test set framework (samples.json schema + runner + report) | ✅ 12 tests in lip-sync-samples.test.mjs |
| 9 | Degraded: gold-team unreachable → write stub video_tasks, do NOT throw | ✅ test "gold-team 不可达 → 写 stub" |
| 10 | No-dialogue path: shots without dialogue skip audio | ✅ test "无 dialogue shot → generate_audio=false" |
| 11 | All 266 existing tests still pass | ✅ 290 total pass, 0 fail |

## Test Execution

```
$ npm test
ℹ tests 290
ℹ suites 85
ℹ pass 290
ℹ fail 0
ℹ duration_ms 10617
```

## Per-Commit Verification

### Commit 042d45b (A2-01)
- `node --test test/phases/character-asset-manager.test.mjs`: 6/6 pass
- Tests cover: audio-less (hasAudio=false), single audio, multi audio, default label, invalid filter, mixed bindings

### Commit b499477 (A2-02, A2-03)
- `node --test test/phases/cloud-production-audio-sync.test.mjs`: 6/6 pass
- Tests cover: timing lock throw, voice-timeline present passes, no-dialogue skip, @Audio binding submission, generate_audio=false, gold-team degraded stub

### Commit 3615b5b (A2-04, A2-05)
- `node --test test/phases/lip-sync-samples.test.mjs`: 12/12 pass
- Tests cover: samples.json schema valid, required fields, threshold range, unique ids, schema rejection (4 cases), report aggregation (4 cases)

## Regression Check

Pre-Phase-22 baseline: 266 tests
Post-Phase-22: 290 tests (+24 new)
No existing test failed — no regression introduced.

## Operator-Deferred Verification

These items cannot be verified without real GPU / real audio, documented as deferred:

1. **Seedance 2.0 audio_refs API contract**: assumed gold-team server supports audio_refs/generate_audio/prompt_audio_bindings fields
2. **Real Chinese lip sync scores**: requires operator to add audio/anchors and run runner
3. **lip_sync_threshold=0.75 calibration**: based on CONTEXT.md prediction, real test set run will confirm

## Pitfalls Defense

**Pitfalls trap 1 (most insidious failure):** Seedance 2.0 silently ignores audio_refs when prompt lacks @Audio token. Phase 22 implements a hard validation gate that rejects any shot where `hasAudio=true` but `promptBindings` lacks `@Audio`. This catches the failure at submission time instead of after a 10-minute GPU run.

Gate is in `lib/phases/index.js` cloud-production handler, inside the per-shot scheduler callback.
