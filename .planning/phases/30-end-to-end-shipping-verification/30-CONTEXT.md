# Phase 30: End-to-End Shipping Verification - Context

**Gathered:** 2026-06-24
**Status:** Ready for planning
**Mode:** Minimal context (acceptance gate, no design decisions)

<domain>
## Phase Boundary

v4.0 验收 gate（无新 REQ）— 验证全 9 项审计点闭环 + degraded E2E 跑通 + 测试基线 + runbook 文档化。

不修复任何 bug（前 4 个 phase 已修），仅做集成验证 + 文档。

</domain>

<decisions>
## Implementation Decisions

### Acceptance scope (4 SCs from ROADMAP)
1. **degraded E2E 跑通** — `bin/pipeline.js run --episode EP01 --to delivery` 在 degraded 模式完整跑通 20 阶段并产出 master.mp4 占位文件
2. **审计 9 项 100% 闭环** — 重跑 2026-06-23 audit checklist，每项 finding 在当前 git HEAD 验证已修复
3. **测试基线 ≥ 461** — 当前 508/508 远超基线（baseline preserved + 47 new across Phases 26-29）
4. **E2E-RUNBOOK.md 文档化** — degraded + 真实 GPU 两条产出 master.mp4 路径

### Claude's Discretion
- E2E 测试用啥 workdir（新建临时 vs 复用 output/EP01）
- audit checklist 重跑方式（手动 grep + 验证 vs 写自动化脚本）
- runbook 文档结构

### 9 audit findings verification matrix
| # | Audit finding | Closed by Phase | Verification |
|---|---------------|-----------------|--------------|
| 1 | composition phase 无 handler | 29 (PIPE-COMPOSE-01) | grep master.mp4 in lib/phases/index.js |
| 2 | final.mp4 vs master.mp4 文件名错位 | 29 (PIPE-COMPOSE-02) | grep final.mp4 in handler body = 0 |
| 3 | motion-preview Blender 字段大小写错 | 27 (PIPE-RENDER-01) | grep task_type near motion-preview = 0 |
| 4 | V6 不再写 requirement.json | 26 (PIPE-DATA-01) | _loadCharactersForGeneration reads pain-report.json |
| 5 | scene↔sts 时序倒置 | 26 (PIPE-DATA-02) | stageOrder check (sts=8, sg=9, ss=10) |
| 6 | consistency-guard 非阻塞 + 死代码 | 29 (PIPE-GUARD-01) | consistency-guard throws + dead files deleted |
| 7 | jimeng-client deprecated 仍被调用 | 27 (PIPE-RENDER-02) | _warnJimengDeprecate emit at 3 sites |
| 8 | canvasGraph 双写竞态 | 28 (PIPE-INTEGRITY-01) | saveGraph no longer uses execSync UPDATE |
| 9 | repair-canvas SQL 注入面 | 28 (PIPE-INTEGRITY-02) | assertPositiveInt + injection test passes |

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 26-29 SUMMARYs + VERIFICATIONs — 已经记录每个 REQ 的修复证据
- `bin/pipeline.js run --episode X --to Y` — 现有 E2E invocation
- `npm test` — 508/508 baseline

### Established Patterns
- degraded mode E2E pattern (v2.0 Phase 17 已建立)
- runbook 文档模式（参考 v2.0 E2E-RUNBOOK 如果存在）

</code_context>

<specifics>
## Specific Ideas

- audit checklist 重跑应该走自动化（写 bin/audit-v4-acceptance.js 或 test/audit-regression.test.mjs）以避免人为遗漏
- E2E 测试新建临时 workdir（避免污染 output/）
- runbook 文档化 degraded 路径（真实 GPU 路径标注为 operator-deferred，已在 v3.0 audit 列为 W-v3-1~6）

</specifics>

<deferred>
## Deferred Ideas

None — verification-only phase.

</deferred>
