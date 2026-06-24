# Phase 26: Data Spine Repair - Context

**Gathered:** 2026-06-24
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — user accepted all recommendations

<domain>
## Phase Boundary

V6 数据流上游真实化 — character-generation 拿到真实角色数据、scene-generation 拿到真实 sts 产物（不再退回 fallback 默认值），让后续渲染/composition 测试有真实输入可用。

本 phase 只修数据 spine（PIPE-DATA-01 + PIPE-DATA-02），不动渲染逻辑、不动 composition、不动质量门控（留给 27/28/29）。

</domain>

<decisions>
## Implementation Decisions

### PIPE-DATA-01 — Character 数据源修复
- 主数据源迁移到 `pain-report.json`（pain-discovery 已把 `requirement` 嵌入 pain-report 的 `requirement` 字段，line 1517）
- `_loadCharactersForGeneration` 改为：先读 pain-report.json 的 `requirement.characters`，再 fallback 旧 requirement.json（向后兼容老 workdir），最后 fallback pipeline.config.characters
- pipeline.config.characters 兜底保留（degraded 模式仍可运行）
- 不删除旧 requirement-bible handler（line 541）— legacy workdir 仍可能用它，仅 V6 PHASES 不再触发

### PIPE-DATA-02 — scene ↔ sts 时序修复
- 修复方式：reorder stageOrder，把 spatio-temporal-script 移到 scene-generation 之前
- 新顺序：`spatio-temporal-script` (stageOrder 8) → `scene-generation` (stageOrder 9) → `scene-selection` (stageOrder 10)
- 同步调整：scene-selection 从 stageOrder 9 后移到 10
- 不用 stub sts 路径（会让数据流更不透明）
- 不用 hard fail（会破坏 degraded 模式跑通性）

### 测试策略
- 单元测试：mock AssetBus，覆盖 pain-report.json 读取 / 旧 requirement.json fallback / pipeline.config 兜底 3 条路径
- 单元测试：scene-generation 在 sts 存在 / sts 缺失（reorder 后应该不再发生）两种情况
- 集成测试：`bin/pipeline.js run --episode EP01 --to scene-generation` 真实跑通，scene 数据含真实分场景结构
- 不破坏现有 461/461 测试基线

### Claude's Discretion
- 具体代码改动范围（仅 lib/phases/index.js 还是要动 lib/pipeline.js 的 PHASES 数组）
- V2_MIGRATION_MAP 是否需要补充映射（scene-generation 顺序变化后）
- 是否需要 deprecation warning 当走 requirement.json fallback 时

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `AssetBus` (lib/asset-bus.js) — 已有 bus.read/bus.write API，scene-generation 已使用
- `_loadCharactersForGeneration` (lib/phases/index.js:502) — 现有 reader，本 phase 改造目标
- pain-discovery handler (lib/phases/index.js:1453) — 已写 pain-report.json，内嵌 requirement 字段

### Established Patterns
- 数据读取用 try/catch + 多级 fallback 模式（见 _loadCharactersForGeneration 现有结构）
- phase handler 注册在 `phaseHandlers` 对象，按 phase id 索引
- stageOrder 在 PHASES 数组（lib/pipeline.js:50）声明，决定默认执行顺序

### Integration Points
- 改 stageOrder 影响：bin/pipeline.js 默认顺序、HermesClient.VALID_PHASES（如有同步）、interactive-review 触发顺序
- 改 _loadCharactersForGeneration 影响：character-generation handler (line 2169 调用)，以及任何其他调用该函数的地方
- 需要同步检查：scene-selection handler 是否依赖 scene-generation 在前（如果是，reorder 后仍 OK）

</code_context>

<specifics>
## Specific Ideas

- reorder 后 scene-generation 拿到 sts 时，应能直接从 sts.shots 提取 sceneDefs（line 2564-2571 现有逻辑），无需再走 line 2573-2580 的兜底默认场景
- pain-report.json 的 requirement 字段保留的是 pain-discovery 读到的 reqData 副本，应包含 characters（如果 operator 在 pipeline.config 里提供了）

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. 渲染/质量门控/composition 留给 Phase 27-29。

</deferred>
