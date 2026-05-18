# kais-movie-agent 集成开发

## Vision
将 movie-agent 与 gold-team GPU 调度和 review-platform 审核平台集成，实现 GPU 密集型任务（TTS、Blender）的远程调度和人工审核工作流。

## Principles
- 零 npm 依赖 — 使用原生 fetch + Node.js 内置模块
- 所有客户端跟随现有 ES module 模式 (export class)
- 降级优先 — 外部服务不可用时系统仍可运行
- HMAC-SHA256 回调签名验证
- 参考 INTEGRATION.md 契约层规范

## Non-Negotiables
- GoldTeamClient 必须支持 submitTask/getTask/waitForTask/submitTTS
- ReviewClient 必须有降级逻辑（服务不可用时自动放行）
- 回调验证使用 shared/hmac_node.js
