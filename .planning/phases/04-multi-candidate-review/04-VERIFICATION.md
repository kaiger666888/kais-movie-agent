# Phase 4 Verification: 多候选审核调用改造

**Date:** 2026-05-17
**status:** passed

## Analysis
`lib/pipeline.js` `_runRemoteReview()` (lines 186-239) already implements multi-candidate review:
- Line 196: Builds candidates from phaseConfig or reviewConfig.buildCandidates()
- Lines 202-207: Maps candidates to { id, label, image_url, description }
- Lines 210-230: submitReview with full metadata:
  - candidates array ✓
  - select_mode / max_select ✓
  - enable_scoring / enable_feedback ✓
  - preview_images ✓
  - callback_url / callback_secret ✓

## Verified
- [x] 审核提交可携带 candidates 数组
- [x] 支持 enable_scoring 和 enable_feedback 配置
- [x] 不破坏现有 submitReview 接口
- [x] candidates 包含 id, image_url, description 字段
- [x] select_mode 支持 single/multi 模式
