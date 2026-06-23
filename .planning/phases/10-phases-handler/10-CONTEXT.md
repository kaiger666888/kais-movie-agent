# Phase 10: PHASES/handler 架构对齐 - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped per autonomous smart-discuss)

<domain>
## Phase Boundary

让 `lib/pipeline.js` 的 `PHASES` 数组(20 个 V6 phase id)与 `lib/phases/index.js` 的 `phaseHandlers` 对象(当前仅 10 个 V4.1 id)100% 对齐,使 `pipeline.runPhase()` 在任意新阶段上都能命中 handler、执行业务逻辑骨架或显式降级,而非静默走 fallback 分支"假完成"。

同时清理 `V2_MIGRATION_MAP` 中的 stale 引用:任何旧 id 必须映射到 PHASES 数组中实际存在的目标 id。

本 phase 不实现深度业务逻辑(L1/L2 资产生成、一致性审计实化等留给 Phase 12/14),只确保**架构骨架闭合** —— 每个 phase id 都有可调用的 handler,即使 handler 内部只是写 stub 数据 + log。

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. Use ROADMAP phase goal, success criteria, and existing code conventions in `lib/phases/index.js` (V4.1 handlers) to guide decisions:

- **Handler 骨架风格**: 参考现有 `requirement-bible` / `spatio-temporal-script` handler 的结构(`_makeHermesClient` + `AssetBus` + `_hermesDecide` + `writeFile` + `_hermesAudit`)
- **降级策略**: 沿用 v1.0 的三层降级链(服务级 / 任务级 / Phase 级)
- **stub 数据**: 每个新 handler 至少写入对应 `outputFiles` 中声明的 JSON 文件(pipeline.js:52-114),内容可为空数组/空对象 + `"_stub": true` 标记,确保下游 phase 不因文件不存在而崩溃
- **单元测试位置**: `test/phases/handlers.test.mjs`,使用 Node 内置 `node:test`
- **V2_MIGRATION_MAP 清理**: 保留有意义的迁移映射(如 `requirement → pain-discovery`),删除指向 PHASES 中不存在 id 的 stale 条目

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/phases/index.js:206-1036` — 10 个 V4.1 handler 实现,可作为新 handler 的模板
- `lib/pipeline.js:50-115` — PHASES 数组,20 个 phase 的 single source of truth
- `lib/pipeline.js:117-136` — V2_MIGRATION_MAP,需要审计
- `lib/asset-bus.js` — AssetBus 类,所有 handler 用它读写 `.pipeline-assets/`
- `lib/hermes-client.js` — HermesClient(注:VALID_PHASES 白名单问题留给 Phase 11,不在本 phase 范围)
- `lib/hermes-adapter.js` — `callLLM` / `callLLMJson` helper
- `lib/evaluation-collector.js` — 任务评估采集器,handler 末尾应该调用

### Established Patterns
- **每个 V4.1 handler 结构**:
  1. `_makeHermesClient(pipeline)` 取 client
  2. `_hermesDecide()` 拿决策参数(失败用 HERMES_DEFAULTS)
  3. `new AssetBus(pipeline.workdir)` 读写资产
  4. 业务逻辑(GPU 提交 / 文件处理)
  5. `_hermesAudit()` 异步回写指标
  6. `_makeCollector(pipeline).record()` 采集评估数据
  7. `return { summary, metrics }`

- **降级模板**:
  ```javascript
  try { ... } catch (e) { console.warn(`[phase-x] XX 降级: ${e.message}`); }
  ```

### Integration Points
- `pipeline.runPhase()` line 411: `const handler = phaseHandlers[phaseId];` — 路由入口
- `pipeline.runPhase()` line 417: `await handler.after(this, phase, phaseConfig);` — 调用点
- HERMES_DEFAULTS 字典(phases/index.js:42-167):已包含全 20 阶段的默认参数,但 handler 没实现 → 决策参数能拿到,handler 用不上

</code_context>

<specifics>
## Specific Ideas

- **优先级**: 15 个缺失 handler 中,`character-generation` 和 `consistency-guard` 是后续 phase 12/14 的依赖,在本 phase 先写 stub(真实实现留给后续 phase),但 stub 必须暴露正确的接口签名
- **测试**: 至少 4 个测试用例 — 路由覆盖、stub 文件写入、降级日志、V2_MIGRATION_MAP 完整性
- **不做**: 不实现 L1/L2 资产生成逻辑(Phase 14)、不实现 DINOv2 评分(Phase 12)、不修改 HermesClient.VALID_PHASES(Phase 11)

</specifics>

<deferred>
## Deferred Ideas

- Hermes ID 对齐(VALID_PHASES 同步)→ Phase 11
- 一致性审计实化 → Phase 12
- character-generation 真实实现 → Phase 14
- composition handler 已存在,但内部质量门控实化 → Phase 13

</deferred>
