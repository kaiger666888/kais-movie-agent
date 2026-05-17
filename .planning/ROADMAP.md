# ROADMAP — kais-movie-agent 集成

> Milestone: v1.0 — AIGC Integration
> Created: 2026-05-17

## Phase 1: GoldTeamClient 创建
- status: complete
- goal: 新建 lib/gold-team-client.js，GPU 任务调度客户端，参考 review-platform-client.js 模式
- requirements:
  - submitTask / getTask / listTasks / waitForTask / submitTTS 方法
  - X-API-Key 认证，HMAC 回调验证
  - ES module + native fetch
  - GoldTeamError 错误类
- success_criteria:
  - [x] GoldTeamClient.js 文件存在且可正常 import
  - [x] 所有方法符合 INTEGRATION.md Task 1 规范

## Phase 2: Review Client 降级逻辑
- status: complete
- goal: 在 review-platform-client.js 的 submitReview 中添加降级逻辑，服务不可用时自动放行
- requirements:
  - submitReview 捕获超时/5xx 错误，降级返回 DEGRADED_AUTO
  - 记录降级审计日志
  - GoldTeamClient 也需降级（不可用时回退本地或跳过）
- success_criteria:
  - [ ] review-platform-client.js submitReview 有降级路径
  - [ ] 降级时返回 DEGRADED_AUTO + APPROVED
  - [ ] gold-team-client.js 有降级方法
  - [ ] 不影响正常流程

## Phase 3: Voice Phase 集成 GoldTeamClient
- status: complete
- goal: 将 voice phase 的 TTS 调用改为通过 gold-team 调度
- requirements:
  - voice phase handler 使用 GoldTeamClient.submitTTS
  - 支持 waitForTask 轮询模式
  - 下载产物到 assets/tts/
- success_criteria:
  - [ ] voice phase 通过 GoldTeamClient 调度 TTS
  - [ ] TTS 产物正确保存
  - [ ] 支持 gold-team 配置传入

## Phase 4: 多候选审核调用改造
- status: complete
- goal: 提交审核时携带 candidates（3选1等），支持评分和反馈
- requirements:
  - submitReview 支持 candidates 参数
  - metadata 包含 select_mode, max_select, candidates, enable_scoring
  - 契约: review-platform-api.yaml
- success_criteria:
  - [ ] 审核提交可携带 candidates 数组
  - [ ] 支持 enable_scoring 和 enable_feedback 配置
  - [ ] 不破坏现有 submitReview 接口
