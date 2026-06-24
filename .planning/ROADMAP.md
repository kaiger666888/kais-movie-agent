# Roadmap: kais-movie-agent 集成开发

## Milestones

- ✅ **v1.0 AIGC Integration** — Phases 1-9 (shipped 2026-05-18)
- ✅ **v2.0 Pipeline Remediation** — Phases 10-18 (shipped 2026-06-22) — [Archive](./milestones/v2.0-ROADMAP.md)
- ✅ **v3.0 Industrial Pipeline Alignment** — Phases 19-25 (shipped 2026-06-23) — [Archive](./milestones/v3.0-ROADMAP.md)
- 🚧 **v4.0 Production Pipeline Remediation** — Phases 26-30 (started 2026-06-24)

## Overview (v4.0)

修复 2026-06-23 端到端数据流审计发现的 9 项沉默失败点，让 V6 管线从"单元测试全过但成片无法产出"升级到"能产成片"。Phase 编号继续 v3.0（19-25），v4.0 从 26 起。阶段划分遵循数据流依赖链：上游 data spine → 真实渲染 → 跨系统完整性/安全 → composition 尾部 + 质量门控。前 3 个 phase 为基础修复，使 Phase 29 的 composition 端到端测试有真实输入可用。

## Phases (v4.0)

**Phase Numbering:**

- Integer phases (26-30): Planned v4.0 milestone work
- Decimal phases: Urgent insertions (marked with INSERTED)

- [ ] **Phase 26: Data Spine Repair** - 修复 V6 数据流上游断裂（requirement.json 失写 + scene↔sts 时序倒置），为下游 composition 提供真实输入
- [ ] **Phase 27: Real Render Path Restoration** - 修复真实渲染沉默失败（motion-preview Blender 字段大小写 + jimeng-client 死引用清理）
- [ ] **Phase 28: Cross-System Integrity & Safety Hardening** - canvas 双写竞态修复 + SQL 注入面修复（独立 hardening track）
- [ ] **Phase 29: Composition Tail + Quality Gate Activation** - composition phase 实现 + 文件名对齐 + consistency-guard 阻塞化 + 死代码清理（管线成片 + 质量门控统一在 composition 判定）
- [ ] **Phase 30: End-to-End Shipping Verification** - 全链路 degraded E2E 跑通产出 master.mp4，验证 9 项审计点全部闭环

<details>
<summary>✅ v3.0 Industrial Pipeline Alignment (Phases 19-25) — SHIPPED 2026-06-23</summary>

- [x] Phase 19: callLLM 重构 + GLM-4.6V 升级 (D1-01~04) — BLOCKER
- [x] Phase 20: AssetBus Schema 扩展 (SCHEMA-01~03) — keystone
- [x] Phase 21: BlacklistEngine + bad case 持久化 (B5-01~06)
- [x] Phase 22: Seedance 2.0 Audio-Visual Sync (A2-01~05)
- [x] Phase 23: CreativeHistoryTracker (B4-01~06) — flagship
- [x] Phase 24: CrossEpisodeAssetIndex (B2-01~06) — parallel track
- [x] Phase 25: FineTuningETL (B6-01~06) — highest-risk

Full details: [v3.0-ROADMAP.md](./milestones/v3.0-ROADMAP.md)

</details>

<details>
<summary>✅ v2.0 Pipeline Remediation (Phases 10-18) — SHIPPED 2026-06-22</summary>

- [x] Phase 10-18: v2.0 remediation (see archive)

</details>

<details>
<summary>✅ v1.0 AIGC Integration (Phases 1-9) — SHIPPED 2026-05-18</summary>

- [x] Phase 1-9: AIGC integration (see archive)

</details>

## Phase Details

### Phase 26: Data Spine Repair

**Goal**: V6 数据流上游真实化 — character-generation 拿到真实角色数据、scene-generation 拿到真实 sts 产物（不再退回 fallback 默认值），让后续渲染/composition 测试有真实输入可用
**Depends on**: Nothing (first v4.0 phase — foundation for all downstream修复)
**Requirements**: PIPE-DATA-01, PIPE-DATA-02
**Success Criteria** (what must be TRUE):

  1. 运行 `bin/pipeline.js run --episode EP01 --to character-generation` 后，character-generation 读取到非空 character 列表（来自 pain-report.json 或 pipeline.config），不再走 `_loadCharactersForGeneration` 的 fallback 空数组路径
  2. 运行 `bin/pipeline.js run --episode EP01 --to scene-generation` 后，scene-generation handler 读到非 null 的 spatio-temporal-script 产物（时序倒置已修复），scene 数据含真实分场景结构而非单场景默认值
  3. V6 数据流中不存在对已废弃的 `requirement-bible` legacy handler 的依赖（要么迁移写入路径，要么显式从 pain-discovery / pipeline.config 读）
  4. 相关单元/集成测试覆盖：character 列表为空 / sts 产物缺失时不再沉默 fallback，而是显式降级标记或失败

**Plans**: 2 plans

Plans:

- [x] 26-01-PLAN.md — PIPE-DATA-01 character data source migration (pain-report.json reader tier)
- [x] 26-02-PLAN.md — PIPE-DATA-02 scene↔sts stageOrder reorder + tests

**Cross-cutting constraints:**

- Existing 461/461 test baseline is preserved (no regression)

### Phase 27: Real Render Path Restoration

**Goal**: 真实渲染路径不再沉默失败 — motion-preview 的 Blender 调用能成功提交任务并接收 taskId，jimeng-client 的 deprecated 调用要么迁移到 dreamina CLI 要么显式标注为 fallback-only（不再让 461 测试通过但渲染永远不发生）
**Depends on**: Phase 26（character/scene 真实数据流就绪，渲染才有真实输入可测）
**Requirements**: PIPE-RENDER-01, PIPE-RENDER-02
**Success Criteria** (what must be TRUE):

  1. motion-preview handler 调用 `gtClient.submitTask` 时使用 camelCase 字段（`taskType` / `taskId`），且单测断言请求体包含非空 `task_type` 字段（防回归）
  2. motion-preview handler 接收 task 返回时从 `task.taskId`（而非 `task.task_id`）读取，单测断言 taskId 正确解析
  3. character-generation / scene-generation / soul-visual 三个 handler 不再 `new JimengClient(...)` 调用 deprecated 模块；要么迁移到 dreamina CLI，要么显式 try/catch 降级并标注 deprecation 不再调用（代码中无残留 active 调用）
  4. 降级路径：jimeng-client 不可达时 handler 不抛 silent error，而是按 DEGRADE 契约返回 degraded 标记

**Plans**: 2 plans

Plans:

- [ ] 26-01-PLAN.md — PIPE-DATA-01 character data source migration (pain-report.json → requirement.json → pipeline.config fallback tiers)
- [ ] 26-02-PLAN.md — PIPE-DATA-02 PHASES array reorder (spatio-temporal-script moves before scene-generation) + sync VALID_PHASES

### Phase 28: Cross-System Integrity & Safety Hardening

**Goal**: 修复跨系统数据完整性（canvas 双写竞态）+ 安全（SQL 注入面）— 两条独立 hardening，与渲染/数据流并行，使 canvasGraph 与 kais-aigc-platform 不再互相覆盖、repair CLI 不再可被注入
**Depends on**: Nothing（独立 hardening track，不依赖 26/27 — 但顺序排在它们之后便于合并验收）
**Requirements**: PIPE-INTEGRITY-01, PIPE-INTEGRITY-02
**Success Criteria** (what must be TRUE):

  1. canvas-content-sync.js 不再直写 sqlite3 DB（`execSync('sqlite3 ... UPDATE')` 路径被替换为单一写入路径，或显式排序写入使 kais-aigc-platform 不再覆盖本仓库完整数据）
  2. 本仓库写入的完整 content/signature_shot 数据在下次平台 sync 后仍完整（不被平台 content→150 / signature_shot→200 截断覆盖）— 单测用 mock 平台 API 验证"最后写入者"语义
  3. `bin/repair-canvas-truncated-scenes.js --projectId X --episodesId Y` 的两个参数经整数校验（`\d+` 正则 + Number.isInteger），非整数输入直接退出且非零退出码，不拼入 SQL 字符串
  4. 即使输入 `--projectId "1; DROP TABLE"` 等注入串，sqlite3 CLI 不接受为多语句（校验失败前置阻断）；单测覆盖此注入向量

**Plans**: TBD

### Phase 29: Composition Tail + Quality Gate Activation

**Goal**: composition phase 真实产出成片（master.mp4 + web-preview.mp4），delivery 能找到对应文件（文件名对齐），consistency-guard 在 composition 阶段阻塞化判定（fail 不再沉默吞掉）— 这一 phase 是 v4.0 的"成片真正能产出"决战点
**Depends on**: Phase 26（真实数据输入）+ Phase 27（真实渲染输出）+ Phase 28（canvas 数据完整不丢）
**Requirements**: PIPE-COMPOSE-01, PIPE-COMPOSE-02, PIPE-GUARD-01
**Success Criteria** (what must be TRUE):

  1. composition phase 有真实 handler 注册到 phaseHandlers，运行 `bin/pipeline.js run --episode EP01 --to composition` 后 `output/EP01/master.mp4` 和 `output/EP01/web-preview.mp4` 文件实际产出（degraded 模式下产出占位文件，真实 GPU 模式下产出真实 mp4）
  2. delivery phase 检查的文件名与 composition 产出的文件名一致（不再有 `final.mp4` vs `master.mp4` 错位）；`bin/pipeline.js run --episode EP01 --to delivery` 不再因文件找不到失败
  3. consistency-guard 在 composition 阶段判定 fail 时，整个 episode run 标记为 fail 并写入 fail 日志（不再被沉默吞掉），可被 operator 看到
  4. gate-constraints.js / invariant-bus.js 二选一：要么被接入到 consistency-guard 判定链路，要么从仓库删除（不再以 dead code 形式存在）

**Plans**: TBD
**UI hint**: no

### Phase 30: End-to-End Shipping Verification

**Goal**: 验证 v4.0 全 9 项审计点闭环 — degraded E2E 跑通全 20 阶段实际产出 master.mp4，单元测试 + 集成测试不退化，operator runbook 更新覆盖"真实成片产出"流程
**Depends on**: Phase 29（composition 实现就绪）+ 所有前序 phase
**Requirements**: (no new REQ-ID — this phase is the acceptance gate for all 9 audit findings; serves as v4.0 ship verification)
**Success Criteria** (what must be TRUE):

  1. `bin/pipeline.js run --episode EP01 --to delivery` 在 degraded 模式下完整跑通 20 阶段并产出 `output/EP01/master.mp4` 占位文件（端到端不再断裂）
  2. 2026-06-23 审计的 9 项 finding 在 git HEAD 的对应行号处验证已修复（重跑审计 checklist 100% pass）
  3. 测试套件 ≥ 461 通过（v3.0 baseline），新增的 v4.0 回归用例覆盖 composition 产出 / 文件名对齐 / consistency-guard 阻塞 / SQL 校验 4 项
  4. E2E-RUNBOOK.md 更新：degraded 模式 + 真实 GPU 模式两条产出 master.mp4 的路径都已文档化

**Plans**: TBD

## Progress (v4.0)

**Execution Order:**
Phases execute in numeric order: 26 → 27 → 28 → 29 → 30
（Phase 28 独立 hardening，理论上可并行于 26/27，但保守顺序排列以降低 review 负担）

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 26. Data Spine Repair | 2/2 | Complete | 2026-06-24 |
| 27. Real Render Path Restoration | 0/TBD | Not started | - |
| 28. Cross-System Integrity & Safety Hardening | 0/TBD | Not started | - |
| 29. Composition Tail + Quality Gate Activation | 0/TBD | Not started | - |
| 30. End-to-End Shipping Verification | 0/TBD | Not started | - |
