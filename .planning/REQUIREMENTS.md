# Requirements — kais-movie-agent

> **v4.0 milestone: Production Pipeline Remediation** — started 2026-06-24.
> Scope source: 2026-06-23 端到端数据流审计（见 [memory](../) project_pipeline-audit_2026-06-23.md）— 9 项沉默失败点。
> 修复目标：v3.0 框架已对齐但实际无法产出成片，本 milestone 让"测试通过"升级到"能产成片"。

## Active Requirements (v4.0)

### PIPE-COMPOSE — 管线尾部断裂（成片根本无法产出）

- [ ] **PIPE-COMPOSE-01**: composition phase 获得真实 handler，产出 `master.mp4` + `web-preview.mp4`（当前 PHASES 声明 outputFiles 但 `lib/phases/index.js` 无对应 entry，bin/pipeline.js 也不传 phasesConfig）
- [ ] **PIPE-COMPOSE-02**: delivery phase 读取文件名与 composition 产出对齐（当前 delivery 检查 `final.mp4`，composition 声明产出 `master.mp4`，命名错位即使 composition 实现也无法交接）

### PIPE-RENDER — 真实渲染沉默失败

- [x] **PIPE-RENDER-01**: motion-preview 的 Blender 调用字段大小写修复（`gtClient.submitTask({ task_type })` 应为 `taskType`，`task.task_id` 应为 `task.taskId`；当前真实渲染路径沉默失败）
- [x] **PIPE-RENDER-02**: jimeng-client.js 死引用清理（已 @deprecated "被 dreamina CLI 取代"，但 character-generation / scene-generation / soul-visual 仍 `new JimengClient(...)`；要么迁移到 dreamina CLI，要么显式标注不再调用并走 fallback）

### PIPE-DATA — 数据管道断裂

- [x] **PIPE-DATA-01**: V6 角色/需求数据流修复（V6 PHASES 用 `pain-discovery` 取代 legacy `requirement-bible`，但 `_loadCharactersForGeneration` 仍读 `requirement.json` → 永远走 fallback；要么恢复 requirement.json 写入，要么迁移到从 pain-report.json / pipeline.config 读）
- [x] **PIPE-DATA-02**: scene-generation ↔ spatio-temporal-script 时序修复（scene-generation stageOrder=8 读 sts 产物，但 sts stageOrder=10 才写；默认顺序下 sts 必为 null，scene 退化为单场景默认值）

### PIPE-GUARD — 质量门控失效

- [ ] **PIPE-GUARD-01**: consistency-guard 阻塞化 + 死代码清理（当前注释"让质量门控在 composition/Phase 13 阶段统一判定"但 composition 无 handler，fail 被沉默吞掉；同时 `gate-constraints.js` / `invariant-bus.js` 在生产代码中从未被 import — 要么接入要么删除）

### PIPE-INTEGRITY — 跨系统数据完整性 + 安全

- [x] **PIPE-INTEGRITY-01**: canvasGraph 双写竞态修复（`lib/canvas-content-sync.js` 用 `execSync('sqlite3 ... UPDATE')` 直写 DB 与 kais-aigc-platform HTTP API 写同一 cell 互相覆盖，平台侧截断 content→150/signature_shot→200 会覆盖本仓库完整数据；统一到单一写入路径）
- [x] **PIPE-INTEGRITY-02**: repair-canvas-truncated-scenes.js SQL 注入面修复（`--projectId` / `--episodesId` 未做整数校验直接拼进 sqlite3 CLI SQL 字符串；execFileSync 绕过 shell 但 sqlite3 CLI 接受 `;` 分隔多语句，需在 CLI 入口校验）

## Validated

See [PROJECT.md](./PROJECT.md) § "Validated" for the full list of shipped v1.0 + v2.0 + v3.0 requirements.

## Out of Scope (carry-forward to v4.1+)

- 上游 creative_history lineage retrofit(script→sts→shot hash stamping) — 原 v3.1 backlog
- 真实 GPU E2E 验证(产出可播放 final.mp4) — operator 侧
- GLM-4.6V 50-pair golden set real-API baseline 校准 — operator 侧
- Seedance 2.0 audio_refs API contract 验证 + 中文 lip sync 校准 — operator 侧
- DINOv2 threshold calibration (50+50 real cross-episode pairs) — operator 侧
- LoRA training operator workflow(实际训练,v3.0 只产 manifest) — operator 侧
- 跨 workdir manifest 合并 / Multi-LoRA composition
- 多模型 A/B 测试(Runway/Kling/Sora) / 多平台导出 / 多语言 dubbing / 字幕烧录
- 分布式多机部署 / TypeScript 迁移 / CI-CD

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PIPE-DATA-01 | Phase 26 | Complete |
| PIPE-DATA-02 | Phase 26 | Complete |
| PIPE-RENDER-01 | Phase 27 | Complete |
| PIPE-RENDER-02 | Phase 27 | Complete |
| PIPE-INTEGRITY-01 | Phase 28 | Complete |
| PIPE-INTEGRITY-02 | Phase 28 | Complete |
| PIPE-COMPOSE-01 | Phase 29 | Pending |
| PIPE-COMPOSE-02 | Phase 29 | Pending |
| PIPE-GUARD-01 | Phase 29 | Pending |

**Coverage:** 9/9 v4.0 requirements mapped ✓ (no orphans, no duplicates)
**Acceptance gate:** Phase 30 (no new REQ-ID — verifies all 9 audit findings closed)
