# Phase 13 — 质量门控实化 — Summary

**Phase:** 13 — 质量门控实化
**Plans:** 1 (inline — single-file targeted change)
**Status:** ✅ Complete
**Date:** 2026-06-22

## What Shipped

### 修改文件
1. **`lib/quality-gate.js`** — 4 处修改:
   - **删除** `Math.round(meta.max * 0.8)` 兜底(API 失败 + 评分异常两处)
   - **新增** `score: null` + `_failed: true` 失败语义,不再伪造分数
   - **新增** 全维度失败 → 抛 `QUALITY_GATE_ALL_DIMENSIONS_FAILED` 错误
   - **更新** `decide()` 一票否决逻辑跳过 null 维度
   - **更新** `generateReport()` 显示 `--/max ⚠️ 评分失败`
   - **更新** `totalScore` 计算:跳过 null 维度 + 归一化到 100 分

### 关键 diff
```diff
- // API 失败,给默认分
- dimensions[dimKey] = { score: Math.round(meta.max * 0.8), ... };
+ // QUAL-02 (v2.0): API 失败 → score=null
+ dimensions[dimKey] = { score: null, _failed: true, ... };

+ // 全维度失败 → 直接 fail
+ const failedCount = Object.values(dimensions).filter(d => d._failed).length;
+ if (failedCount === Object.keys(dimensions).length) {
+   const err = new Error('质量门控失败:所有维度 LLM 评分均失败');
+   err.code = 'QUALITY_GATE_ALL_DIMENSIONS_FAILED';
+   throw err;
+ }

+ // decide() 跳过 null 维度
+ for (const [dimKey, dim] of Object.entries(dimensions)) {
+   if (dim.score === null || dim.score === undefined) continue;
+   ...
+ }

+ // totalScore 归一化到 100 分
+ const rawSum = scoredDims.reduce((sum, d) => sum + d.score, 0);
+ const rawMax = scoredDims.reduce((sum, d) => sum + d.max, 0);
+ totalScore = rawMax > 0 ? Math.round((rawSum / rawMax) * 100) : 0;
```

## Requirements Closed
- **QUAL-02**: 删除 quality-gate.js 默认 80% 兜底,LLM 失败立即标记评分异常 ✓

## Success Criteria Achieved
- **SC-1**: `Math.round(max * 0.8)` 兜底删除 ✓ (代码搜索: 0 occurrences)
- **SC-2**: LLM 故障 pipeline 标"评分异常",不再 80 分假通过 ✓ (返回 `_failed: true`)
- **SC-3**: 正常路径不受影响 ✓ (71/71 测试通过)

## Test Coverage
- 现有 71 测试全部通过(无回归)
- 新增测试覆盖由后续 E2E Phase 17 完成

## Deviations
无。

## Downstream Impact
- `composition` handler 末尾的质量门控现在可能抛 `QUALITY_GATE_ALL_DIMENSIONS_FAILED`,pipeline 将标记 failed 而非假通过
- 部分维度失败时,总分按已成功维度归一化,不再被失败维度稀释
