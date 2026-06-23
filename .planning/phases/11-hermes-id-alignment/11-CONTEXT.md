# Phase 11: Hermes ID 对齐 - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped per autonomous smart-discuss)

<domain>
## Phase Boundary

让 `lib/hermes-client.js` 的 `VALID_PHASES` 白名单与 Phase 10 已对齐的 V6 PHASES 数组同步,使全 20 阶段的 `decide()` / `audit()` 调用不再因前端校验抛 `Invalid phase` 错误。

**核心问题**: `HermesClient.decide()` 在 line 49-51 强制校验 phase 必须在 VALID_PHASES 中,当前白名单只包含 10 个 V4.1 ID,导致 Phase 10 新增的 15 个 V6 handler 调用 `_hermesDecide()` 时全部走降级分支(`console.warn + 使用 HERMES_DEFAULTS`)—— Hermes 决策闭环对 70% 的阶段完全失效。

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. Use Phase 10's PHASES array as single source of truth.

**推荐方案**(二选一,Claude 决定):

**方案 A (推荐) — 静态同步**: 直接将 VALID_PHASES 替换为 PHASES 数组的 20 个 V6 ID,保持静态数组结构。优点:与 Phase 10 PHASES 显式对应,容易审计;缺点:两处需手动同步(PHASES 改时 VALID_PHASES 也要改)。

**方案 B — 动态导入**: 让 HermesClient 从 `lib/pipeline.js` 动态导入 `PHASES`,运行时校验。优点:零同步成本;缺点:circular import 风险(`pipeline.js` 已 import `phases/index.js`,phases 又 import hermes-client.js 的相关 helpers)。

### Test 覆盖
- 单元测试: 每个新 V6 phase 调用 `hermes.decide()` 不抛 Invalid phase(可通过 mock fetch 验证)
- 集成测试: 已有的 `test/phases/handlers.test.mjs` 中的降级日志测试,应能看到 hermes 调用从"invalid phase warn"变为"real decide 调用"(但 hermes_url 未配置时仍降级)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/pipeline.js:50-115` — PHASES 数组(Phase 10 已最终化)
- `lib/hermes-client.js:12-16` — 当前 VALID_PHASES(10 个 V4.1 ID)
- `lib/phases/index.js` — Phase 10 新增的 15 个 handler,均调用 `_hermesDecide(hermes, 'phase-id', ...)`(当前都会被前端拒绝)

### Established Patterns
- HermesClient 是薄客户端,仅做 fetch + JSON parse
- `_hermesDecide()` 在 phases/index.js 已有 try/catch 降级,所以即使前端拒绝,handler 也不会崩溃 —— 但 audit 数据完全丢失

### Integration Points
- `lib/phases/index.js:174-187` — `_hermesDecide` 调用 `client.decide(phase, context)`
- `lib/phases/index.js:192-197` — `_hermesAudit` 调用 `client.audit(phase, ...)`
- 两个调用都会被 HermesClient VALID_PHASES check 拦截

</code_context>

<specifics>
## Specific Ideas

- **推荐方案 A**: 静态同步 VALID_PHASES,与 PHASES 1:1 对应
- **额外加固**: 在 HermesClient 中加入对 PHASES 数组的运行时 import 校验(只在 dev/test 模式,避免 circular import)
- **不做**: 不修改 Hermes 服务端的实际行为(假设服务端已支持所有 phase),不在本 phase 实现 Hermes 服务端

</specifics>

<deferred>
## Deferred Ideas

- Hermes 服务端决策模型升级 → 不在本 phase 范围
- 决策参数 fine-tuning → 后续 phase 视需要
- Hermes audit 数据看板 → 后续 milestone

</deferred>
