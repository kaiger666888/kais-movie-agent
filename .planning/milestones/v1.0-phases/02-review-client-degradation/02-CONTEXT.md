# Phase 2: Review Client 降级逻辑 - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped)

<domain>
## Phase Boundary

在 review-platform-client.js 和 gold-team-client.js 中添加降级逻辑：当外部服务不可用（超时、5xx 错误）时，系统自动降级为 AUTO 模式放行，记录审计日志，保证管线继续运行。

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. Follow INTEGRATION.md Task 2 spec and existing code patterns.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- shared/hmac_node.js — HMAC 签名工具
- lib/review-platform-client.js — ReviewPlatformClient with submitReview/queryReviewStatus
- lib/gold-team-client.js — GoldTeamClient with submitTask/getTask/waitForTask/submitTTS

### Established Patterns
- ES module export class
- native fetch + AbortSignal.timeout
- Custom Error classes (ReviewClientError, GoldTeamError)
- Constructor options with env var fallbacks

### Integration Points
- submitReview() — 需要添加降级包装
- gold-team-client.js — 需要添加 submitTaskWithDegraded 降级方法
- pipeline.js — 调用这些客户端的地方需要处理降级返回

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase. Refer to INTEGRATION.md Task 2 spec.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>
