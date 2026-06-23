# Phase 11 — Hermes ID 对齐 — Summary

**Phase:** 11 — Hermes ID 对齐
**Plans:** 1 (inline — trivial single-file change)
**Status:** ✅ Complete
**Date:** 2026-06-22

## What Shipped

### 修改文件
1. **`lib/hermes-client.js`** — `VALID_PHASES` 从 10 V4.1 IDs 扩展到 20 V6 IDs
2. **`test/phases/hermes-client.test.mjs`** — 新增 5 个测试,验证全 20 phase 都通过 validation

### 关键变化
```diff
- const VALID_PHASES = [
-   'requirement-bible', 'soul-visual', 'soul-voice', 'geometry-bed',
-   'spatio-temporal-script', 'seed-skeleton', 'motion-preview',
-   'ai-preview', 'final-production', 'composition',
- ];
+ const VALID_PHASES = [
+   // Upper half — creative ideation (Steps 1-11)
+   'pain-discovery', 'topic-selection', 'outline-generation', 'outline-selection',
+   'script-generation', 'script-selection', 'character-generation', 'character-selection',
+   'scene-generation', 'scene-selection', 'spatio-temporal-script',
+   // Lower half — production execution (Steps 12-20)
+   'script-lock', 'seed-skeleton', 'motion-preview', 'ai-preview',
+   'consistency-guard', 'cloud-production', 'final-audio', 'composition', 'delivery',
+ ];
```

## Requirements Closed
- **ARCH-02**: `HermesClient.VALID_PHASES` 与 PHASES 同步 ✓

## Success Criteria Achieved
- **SC-1**: `VALID_PHASES` 包含全 20 个新 id,decide 不被前端拒绝 ✓
- **SC-2**: 日志可见 hermes 调用对所有 20 阶段生效(降级日志从 `Invalid phase` 改为正常的 fetch-failed/network error,因为 hermes_url 未配置) ✓
- **SC-3**: audit 回调对新阶段生效 ✓

## Test Coverage
- `test/phases/hermes-client.test.mjs` — 5 tests pass
  - 全 20 V6 phase decide() 通过 validation
  - 全 20 V6 phase audit() 通过 validation
  - 未知 phase ID 仍被拒绝(safety net 保留)
- 全项目 `npm test`: **66/66 pass**

## Deviations
无。Phase 11 按 CONTEXT.md 推荐方案 A (静态同步) 实现,未走方案 B (动态导入)。

## Downstream Impact
- `lib/phases/index.js` 中 Phase 10 新增的 15 个 V6 handler 的 `_hermesDecide()` 调用现在能真正抵达 Hermes 服务端(若 HERMES_URL 配置),不再被前端拦截
- Hermes 闭环对全 20 阶段开放,后续 phases 可以依赖 decide/audit 工作
