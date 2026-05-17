# Phase 2 Plan: Review Client 降级逻辑

## Goal
完成 review-platform-client.js 和 gold-team-client.js 的降级逻辑，确保外部服务不可用时系统自动放行。

## Tasks

### Task 1: ReviewClient 降级补全
**File:** `lib/review-platform-client.js`
**Changes:**
1. 在 3 处降级 return 中添加 `disposition: 'APPROVED'` 字段
2. 添加 `_logDegradedReview()` 方法记录降级审计日志
3. 每处降级调用 `_logDegradedReview()`

### Task 2: GoldTeamClient 降级
**File:** `lib/gold-team-client.js`
**Changes:**
1. 在 `_request()` 中捕获超时/5xx/网络错误，抛出带 `degradable: true` 标记的 GoldTeamError
2. 添加 `submitTaskDegraded()` 方法：正常提交，失败时返回降级结果
3. 添加 `submitTTSDegraded()` 便捷方法

### Task 3: 验证
- 两文件可正常 import
- 降级逻辑路径正确
