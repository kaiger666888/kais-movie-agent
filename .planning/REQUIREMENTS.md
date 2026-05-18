# 集成需求

> 来源: INTEGRATION.md

## Must-Have

- [ ] Task 1: GoldTeamClient.js — GPU 任务调度客户端 (DONE)
- [ ] Task 2: Review Client 降级逻辑 — review-platform 不可用时回退 AUTO
- [ ] Task 3: Voice Phase 集成 GoldTeamClient — TTS 通过 gold-team 调度
- [ ] Task 4: 多候选审核调用改造 — 提交审核时携带 candidates

## Constraints
- 认证: GoldTeam 用 X-API-Key, ReviewPlatform 用 JWT
- 回调签名: HMAC-SHA256 (shared/hmac_node.js)
- 环境变量: GOLD_TEAM_URL, GOLD_TEAM_API_KEY, HMAC_SECRET_MA_GT, CALLBACK_BASE_URL
- 现有客户端使用 ES module export + native fetch
