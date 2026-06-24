# Phase 27: Real Render Path Restoration - Context

**Gathered:** 2026-06-24
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — user accepted all recommendations

<domain>
## Phase Boundary

修复真实渲染路径沉默失败 — motion-preview 的 Blender 调用字段大小写修复 + jimeng-client deprecated 模块的处理（让 461 测试通过但渲染永远不发生的现状终结）。

不动数据流（Phase 26 已修）、不动 canvas（Phase 28）、不动 composition / consistency-guard（Phase 29）。

</domain>

<decisions>
## Implementation Decisions

### PIPE-RENDER-01 — motion-preview Blender 字段大小写修复
- 修复范围：最小化 — 只动 3 个已知 bug 点（lib/phases/index.js:1074, 1078, 1115）
- 字段修复：
  - `task_type: 'blender_render'` → `taskType: 'blender_render'` (line 1074, 1115)
  - `task.task_id` → `task.taskId` (line 1078)
- 保留现有 motion-preview handler 其他逻辑（degrade warn、try/catch）
- 不做全量扫描其他 submitTask 调用（其他已经是 camelCase，无 bug）

### PIPE-RENDER-02 — jimeng-client 处理（fallback-only）
- 处理方式：fallback-only marking — 不删除、不迁移，保留 3 处 `new JimengClient(...)` 调用
- 在每个调用点添加 `console.warn('[deprecate] jimeng-client fallback-only — migrate to dreamina CLI when available')` 一次性 warn（用 module-level flag 避免日志洪水）
- 确保 degrade 路径严格：无 JIMENG_API_KEY 时直接走 placeholder 路径，不调用真实 API
- 验证 3 处调用点（character-generation line 638, soul-visual line 2171, scene-generation line 2591）的 try/catch + degrade 逻辑完整
- 不在 lib/jimeng-client.js 模块层加 deprecation（避免每个 import 触发）

### 测试策略
- 单测：mock GoldTeamClient.submitTask，断言 motion-preview 调用时使用 camelCase（taskType / taskId）
- 单测：mock JimengClient 无 API key 场景，断言 placeholder 路径触发 + deprecate warn emit
- 不破坏 474/474 测试基线（Phase 26 + 当前新加测试）

### Claude's Discretion
- deprecate warn 的去重机制（module-level Set vs once-per-handler）
- 是否在 lib/jimeng-client.js 顶部加 JSDoc `@deprecated` 标注（提升代码可读性）
- 是否同时给 bin/repair-canvas-truncated-scenes.js 留 hint（不属本 phase）

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `_makeGtClient(pipeline)` helper (lib/phases/index.js 现有) — 创建 GoldTeamClient
- mock 模式测试范例：test/phases/character-generation.test.mjs 已用 `import { Pipeline } from '../../lib/pipeline.js'` 模式
- Phase 26 新加的 warn-spy 测试模式可复用（console.warn spy + restore）

### Established Patterns
- gtClient.submitTask 接受 `{ taskType, priority, params, description }` (camelCase) — 见 lib/goldteam-client.js contract
- gtClient.submitTask 返回 `{ taskId, status, ... }` (camelCase)
- 已有 try/catch + degrade warn 模式（lib/phases/index.js motion-preview 现有结构）
- JimengClient 现有 ping 模式（line 2593-2615）— 1s timeout 验证可用性

### Integration Points
- 改 motion-preview Blender 调用影响：previewResults.push 的 taskId 字段（line 1078）
- 改 jimeng 调用点影响：character-generation / soul-visual / scene-generation 三个 handler 的真实图像生成路径
- Phase 26 已经修了 character 数据源 + sts 时序，本 phase 修渲染调用字段，互不冲突

</code_context>

<specifics>
## Specific Ideas

- motion-preview 的 Blender 调用目前沉默失败 — gtClient.submitTask 解构 `{ taskType }` 拿到 undefined（因为传的是 `task_type`），请求体丢字段，gold-team 拒绝或忽略，task.task_id 读 undefined。修复后 motion-preview 真能提交 Blender 任务。
- jimeng-client 三处调用在 Phase 18 已经实化（有 ping + degrade），本 phase 主要是补 deprecation warn 和验证 degrade 路径严格性，不重写真实生成逻辑。

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
