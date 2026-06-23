---
phase: 18
plan: 18
subsystem: pipeline-handlers
tags: [v6-stub-materialization, qual-02, degraded-mode, closure]
requires:
  - phase-10 (stub handler architecture)
  - phase-13 (QUAL-02 quality-gate hardening)
  - phase-14 (character-generation real impl)
provides:
  - 12 V6 handlers with non-empty degraded output
  - QUAL-02 direct unit test coverage
affects:
  - lib/phases/index.js (12 handlers materialized)
  - test/phases/handlers.test.mjs (assertions updated)
  - test/phases/quality-gate-hardening.test.mjs (new file)
tech-stack:
  added: []
  patterns:
    - "degraded template fallback (non-empty candidates)"
    - "1s ping before N×M GPU calls (avoid retry storm)"
    - "monkey-patched scoreDimension for deterministic LLM-bypass unit tests"
key-files:
  created:
    - test/phases/quality-gate-hardening.test.mjs
  modified:
    - lib/phases/index.js
    - test/phases/handlers.test.mjs
decisions:
  - "Preserve _degraded: true flag (not _stub: true) for degraded runs — distinguishes 'real but fell back' from 'placeholder'"
  - "cloud-production and consistency-guard keep stubbed: true (out of Phase 18 scope — Phase 15/12 特性)"
  - "1s JimengClient ping before per-view generation loop (avoids 5-retry × 6-views × 3-scenes = 90s timeout)"
metrics:
  duration: ~30min
  completed: 2026-06-22
  tasks_total: 5
  tasks_complete: 5
  files_changed: 3
  tests_baseline: 151
  tests_added: 14
  tests_total: 165
---

# Phase 18 Plan 18: V6 stub handler 真实化 + QUAL-02 测试 Summary

实化 12 个 V6 stub handler,让 pipeline 在 degraded 模式下产出有意义内容(非空 JSON candidates),并补充 QUAL-02 quality-gate 加固单元测试。Closes v2.0 audit W-1 (12 stub handlers) + W-4 (QUAL-02 weak test coverage).

## What was built

### Upper-half creative handlers (8 materialized)

- **pain-discovery**: 调用 `audienceMatch()` hook 获取受众分析;模板降级保证 ≥ 2 条 pain_points (含 id/pain_point/severity 字段)
- **topic-selection**: 读 candidate-topics.json → 调用 `generateTopics` hook → LLM 选优;模板降级保证 ≥ 1 候选 (含 hook_type / estimated_duration)
- **outline-generation**: 调用 `callLLM(prompt, options)` 生成 3 outline 候选;修复原签名 bug (原传 object,实际签名是 (prompt, options));模板降级保证每候选有 episodes 结构
- **outline-selection**: 读 outline-candidates → LLM 选优;空文件时生成兜底候选
- **script-generation**: 调用 `callLLM(prompt, options)` 生成 3 script 候选;模板降级保证每候选有 dialogues 数组
- **script-selection**: 读 script-candidates → LLM 选优;空文件时生成兜底剧本
- **script-lock**: 透传 selected-script + 完整 review_metadata (approved / approval_path / selection_method / reviewer / degraded / degrade_reason)
- **character-selection**: 读 character-assets (Phase 14 产出) → LLM 选 top 1 → 写 soul-pack.json (含 L1_anchors + L2_costumes + face_embedding_hash)

### Lower-half production handlers (4 materialized)

- **scene-generation**: 调用 JimengClient 6 视角;1s ping 预检 → 全场景 placeholder 降级 (避免 N×M 重试风暴);空 sts 时生成默认场景定义
- **scene-selection**: 读 scene-candidates → LLM 选优 → geometry-bed.json (含 views / glb_path / texture_resolution / pbr_enabled)
- **final-audio**: 收集 bgm-skeleton + temp-dialogue + sfx-stems 路径 → audio-stems.json (每 stem 含 path + source 字段,标记 placeholder/temp-dialogue/bgm-skeleton)
- **delivery**: 新增 final.mp4 路径验证 (stat.size_bytes / size_mb);删除 `_stub: true` + `_pendingRealImplementation`;保留完整 quality-report 字段 (overall_score / dimensions / passed / final_mp4)

### QUAL-02 hardening tests (12 new tests)

新文件 `test/phases/quality-gate-hardening.test.mjs` 覆盖 Phase 13 引入但未单测的 4 类行为:

1. **全维度 LLM 失败** → 抛 `QUALITY_GATE_ALL_DIMENSIONS_FAILED` (2 tests)
2. **部分维度 null** → 总分按已成功维度归一化到 100 (3 tests,验证从 50 → 100 修复)
3. **单维度极低分** → veto 触发;null 维度跳过 veto (3 tests)
4. **全维度有分** → approve / warn / reject 正常路径 (4 tests,含 generateReport "--/max" 展示)

测试方法: monkey-patch `scoreDimension`,无实际 LLM 调用,deterministic。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed callLLM signature in script-generation**
- **Found during:** Commit 1
- **Issue:** 原 stub 代码 `callLLM({prompt, system})` 把 object 当 prompt 传,实际签名是 `callLLM(prompt, options)`
- **Fix:** 改为 `callLLM(prompt, { system })`
- **Files modified:** lib/phases/index.js
- **Commit:** c0c03ed

**2. [Rule 1 - Bug] Fixed JimengClient retry storm in scene-generation**
- **Found during:** Commit 2 (test ran 5s instead of <1s)
- **Issue:** 初版对每个 (scene × view) 调用 JimengClient.generateImage,失败时进入 `_requestWithRetry` 5 次指数退避 (每次 2s),3 scenes × 6 views × 5 retries × 2s = 180s
- **Fix:** 加 1s ping 预检,失败则全部降级为 placeholder,跳过真实生成
- **Files modified:** lib/phases/index.js
- **Commit:** c0c03ed

**3. [Rule 2 - Auto-add] JimengClient health check recognizes error JSON response**
- **Found during:** Commit 4 (test environment has service on :8003)
- **Issue:** jimeng 服务对 /health 返回 200 + `{code:-1000,...}` 错误 JSON,简单 `resp.ok` 检查会误判服务不可用为可用
- **Fix:** 解析响应 body,识别 jimeng 错误格式;保守判断服务可用 (实际 generateImage 会决定)
- **Files modified:** lib/phases/index.js
- **Commit:** c0c03ed

**4. [Rule 1 - Bug] Updated existing handler test assertions for materialized output**
- **Found during:** Commit 4 (4 baseline tests failed after materialization)
- **Issue:** Tests asserted `_stub: true` / `stubbed: true` which Phase 18 deleted
- **Fix:** Rewrote assertions to verify _phase field, non-empty candidates, final_mp4 presence
- **Files modified:** test/phases/handlers.test.mjs
- **Commit:** 8192787

### Out-of-scope items left unchanged

- **cloud-production**: 仍标 `stubbed: true` 在降级时 (Phase 15 实现特性,不在 Phase 18 范围)
- **consistency-guard**: 无 visuals 分支保留 `_stub: true` (Phase 12 实现特性)
- 真实 GPU 图/音频生成: deferred to v3.0

## Known Stubs

None — all 12 target handlers materialized. cloud-production/consistency-guard stub flags are intentional (out of scope).

## Test Results

```
ℹ tests 165
ℹ pass 165
ℹ fail 0
ℹ duration_ms 10331
```

- Baseline: 151 (Phase 17 final state)
- Added: 14 (12 QUAL-02 + 2 materialization assertions)
- Total: 165

## Threat Flags

None — no new network endpoints / auth paths / file access patterns / trust boundary schema changes. All new logic reads existing files within workdir and writes within workdir.

## Self-Check: PASSED

Verified:
- lib/phases/index.js exists (modified)
- test/phases/quality-gate-hardening.test.mjs exists (created)
- test/phases/handlers.test.mjs exists (modified)
- Commit c0c03ed exists: `feat(18): materialize 12 V6 stub handlers`
- Commit 11da4bb exists: `test(18): QUAL-02 hardening`
- Commit 8192787 exists: `test(18): update handler assertions`
- All 165 tests pass
