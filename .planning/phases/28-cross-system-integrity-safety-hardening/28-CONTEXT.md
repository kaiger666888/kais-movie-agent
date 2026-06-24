# Phase 28: Cross-System Integrity & Safety Hardening - Context

**Gathered:** 2026-06-24
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — user accepted all recommendations

<domain>
## Phase Boundary

修复跨系统数据完整性（canvas 双写竞态）+ 安全（SQL 注入面）。两条独立 hardening track，与渲染/数据流无依赖。

不动渲染（Phase 27 已修）、不动数据流（Phase 26 已修）、不动 composition/guard（Phase 29）。

</domain>

<decisions>
## Implementation Decisions

### PIPE-INTEGRITY-01 — canvas 双写竞态修复
- 修复方式：统一到 HTTP API — 删除 `lib/canvas-content-sync.js` 的 `execSync('sqlite3 ... UPDATE/SELECT ...')` 直写路径
- write 路径全迁：`saveGraph` 改为调用 kais-aigc-platform HTTP API（fetch + PUT/POST 到 canvasGraph endpoint）
- read 路径保留：`loadGraph` 保留 sqlite 直读（read-only 不破坏数据，性能好，且 API 路径未知时也能工作）
- HTTP API 不可达时：degrade 标记 + `console.warn('[canvas-sync] HTTP API unreachable, skipping canvas write: <reason>')`，不抛错（保 pipeline 继续跑）
- 不加 mutex 串行化（HTTP API 已经是单一写入路径，天然避免竞态）

### PIPE-INTEGRITY-02 — repair-canvas SQL 注入面修复
- 校验方式：CLI 入口加 `\d+` 正则 + Number.isInteger 校验
- 校验时机：parseArgs 后立即校验，失败时 stderr 输出 `Invalid --projectId: must be positive integer (got: <value>)` + usage 提示 + exit code 1
- 校验范围：`--projectId` 和 `--episodesId` 两个参数
- 不切换到 sqlite3 `.param`（CLI 的 .param 命令在脚本中调用复杂，整数校验已足够阻断注入向量）
- 不引入 better-sqlite3 npm 依赖（违反零依赖原则）

### 测试策略
- PIPE-INTEGRITY-01：
  - 单测 mock fetch，断言 saveGraph 调用正确的 HTTP endpoint + body
  - 单测 mock fetch 不可达（reject/500），断言 degrade warn 触发，pipeline 不抛错
- PIPE-INTEGRITY-02：
  - 单测 5 路径：正常整数（通过）、负数（拒绝）、字符串（拒绝）、注入串 `1; DROP TABLE`（拒绝）、浮点 5.5（拒绝）
  - 用 child_process.spawnSync 调用真实 CLI 入口，断言 exit code + stderr

### Claude's Discretion
- HTTP API endpoint 路径（需在 plan-phase 研究中查 kais-aigc-platform 代码或文档）
- canvas-content-sync 是否同步更新 bin/canvas-sync-hook.js（如果它也有 sqlite 直写）
- saveGraph 是否保留 readfile(tmpFile) 模式（HTTP API 用 JSON body 不需要）

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `fetch` + `AbortSignal.timeout` — Phase 27 / lib/pipeline.js notifyTelegram 已用此模式
- 平台 HTTP API base URL 应该可从环境变量或 pipeline.config 读（待确认具体 endpoint）
- parseArgs helper 已在 bin/repair-canvas-truncated-scenes.js 现有（line 32-46）

### Established Patterns
- 零 npm 依赖原则（PROJECT.md principles）
- degrade 优先（core value）— 任何外部 API 调用都需 degrade 路径
- console.warn degrade 模式（Phase 26 + 27 已建立）

### Integration Points
- canvas-content-sync.js 被 lib/canvas-sync-hook.js 调用（同步 phase 状态到画布）
- canvas-content-sync.js 也被 bin/canvas-* CLI 可能调用（需 grep 确认）
- repair-canvas-truncated-scenes.js 是 operator 手动调用的修复 CLI，不在 pipeline 自动流中

</code_context>

<specifics>
## Specific Ideas

- HTTP API 路径需要查 kais-aigc-platform 仓库或问 operator（如果未在 plan 时确认，可以让 plan 先用假设的 endpoint，实现时再确认）
- repair-canvas CLI 的整数校验应放在 parseArgs 之后、loadGraph 之前，最早的拦截点
- bin/repair-canvas-truncated-scenes.js 已经用 `execFileSync('sqlite3', [DB, sql])` 数组形式（绕过 shell）— 这是好的，但仍需校验参数防止 sqlite3 CLI 接受 `;` 分隔的多语句

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
