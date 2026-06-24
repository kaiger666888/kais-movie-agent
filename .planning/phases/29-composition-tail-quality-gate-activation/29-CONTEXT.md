# Phase 29: Composition Tail + Quality Gate Activation - Context

**Gathered:** 2026-06-24
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — user accepted all recommendations

<domain>
## Phase Boundary

v4.0 决战点 — composition phase 真实产出成片（master.mp4 + web-preview.mp4），delivery 能找到对应文件，consistency-guard 在 composition 阶段阻塞化判定。三个 REQ 耦合：composition 没 handler 则 guard 的"在 composition 阶段统一判定"无目标，文件名错位则即使 composition 实现也 delivery 失败。三者必须 ship together。

不动渲染（Phase 27 已修）、不动 canvas（Phase 28 已修）、不动 data spine（Phase 26 已修）。

</domain>

<decisions>
## Implementation Decisions

### PIPE-COMPOSE-01 — composition 真实运行 + 输出
- 修复 bin/pipeline.js：runCommand 传递 phasesConfig 给 phase handler（让 composition handler 真的被调用）
- composition handler 输出文件名：改为 `master.mp4` + `web-preview.mp4`（对齐 PHASES 声明）
- 当前的 `final.mp4` (lib/phases/index.js:1415) 改为 `master.mp4`
- 新增 `web-preview.mp4` 输出（低分辨率 H.264 版本，可用 ffmpeg -vf scale 转换 master.mp4）
- degraded 模式：当 FFmpeg 不可用或合成失败时，touch 占位文件 `master.mp4` + `web-preview.mp4`（0 字节或最小 mp4 header），让 delivery 能找到并不 fail

### PIPE-COMPOSE-02 — delivery 文件名对齐
- delivery handler (lib/phases/index.js:3517) 改为检查 `master.mp4`（不再检查 `final.mp4`）
- web-preview.mp4：degrade-tolerant 检查（缺失时 warn 不 fail，因 degraded 模式可能未生成）
- quality-report.json 中 `_composition.delivered_mastermp4: true/false` 标记实际产出状态

### PIPE-GUARD-01 — consistency-guard 阻塞化 + 死代码清理
- **删除 lib/gate-constraints.js**（dead code，0 生产 import）
- **删除 lib/invariant-bus.js**（dead code，0 生产 import）
- consistency-guard (lib/phases/index.js:2940) fail 时：
  - 在 quality-report.json（或新文件 consistency-blocked.json）写 `_consistencyBlocked: true`
  - 整个 episode run 标记 fail（通过 onPhaseFail callback 或 quality-report 字段）
  - console.error 级日志（不再 console.warn）
- 保留现有 consistency-pass.json 写入逻辑（success path 不变）

### 测试策略
- PIPE-COMPOSE-01：
  - 单测 mock FFmpeg 调用，断言产出 master.mp4 + web-preview.mp4 文件名
  - 单测 degraded 模式（FFmpeg 不可用）：断言占位文件被 touch
- PIPE-COMPOSE-02：
  - 单测 delivery 检查 master.mp4（不是 final.mp4）
  - 单测 web-preview 缺失时 degrade warn，不 fail
- PIPE-GUARD-01：
  - 单测 consistency-guard fail 时写 _consistencyBlocked 标记
  - 单测 consistency-guard success 时 _consistencyBlocked 不写或为 false
- 集成测试：`bin/pipeline.js run --episode EP01 --to delivery` 端到端跑通

### Claude's Discretion
- web-preview.mp4 的具体生成方式（ffmpeg transcode vs separate render）
- 占位 mp4 的具体内容（0 字节 vs 最小 valid mp4 header）
- _consistencyBlocked 标记的具体位置（quality-report.json top-level vs 单独文件）
- 删除 dead code 时是否同步删除对应 test 文件（grep test/ 看有无引用）

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `CompositionEngine` (lib/composition-engine.js) — 已有，被 composition handler 实例化（line 26 import）
- FFmpeg execFile 调用模式（Phase 18 实化）— sanitizePath 已有
- quality-report.json schema 已建立（delivery handler 写）

### Established Patterns
- phase handler 在 phaseHandlers 对象注册（lib/phases/index.js）
- 文件名常量集中在 PHASES 数组的 outputFiles 声明
- degrade warn 模式（Phase 26/27/28 已建立）
- _consistencyBlocked 类似 _degraded 字段（已有的 quality-report 字段模式）

### Integration Points
- bin/pipeline.js runCommand 当前调用 phase handler 的方式（需查具体行）
- composition handler 与 delivery handler 通过文件系统交接（output/EP01/master.mp4）
- consistency-guard 在 stageOrder 15，composition 在 stageOrder 18 — guard 在 composition 之前
- gate-constraints.js / invariant-bus.js 删除前需 grep 全仓确认 0 import（test 文件可能有引用）

</code_context>

<specifics>
## Specific Ideas

- master.mp4 命名比 final.mp4 更常规（行业惯例）— 对齐 PHASES 声明 + 提升可读性
- _consistencyBlocked 标记放在 quality-report.json top-level，operator 一眼能看到
- 占位 mp4 用 0 字节即可（delivery 只检查存在性，不播放）
- web-preview.mp4 可后期补（先 ship 主路径 master.mp4）

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
