# kais-movie-agent 集成开发

## What This Is
movie-agent 的 AIGC 集成层 — 将 gold-team GPU 调度和 review-platform 审核平台连接到电影制作流水线，实现 GPU 密集型任务（TTS、Blender、FLUX 图像、视频生成）的远程调度和人工审核工作流。

## Core Value
降级优先的 GPU 任务调度 — 外部服务不可用时系统仍可运行。

## Requirements

### Validated
- ✓ v4.0 Production Pipeline Remediation (9 silent-failure points closed) — v4.0
- ✓ GoldTeamClient GPU 任务调度 — v1.0
- ✓ ReviewClient 降级逻辑 — v1.0
- ✓ Voice Phase GoldTeam 集成 — v1.0
- ✓ 多候选审核调用 — v1.0
- ✓ V4.1 引擎对接 (13 函数: FLUX/VIDEO/VOICE/MUSIC/SFX/LIP_SYNC) — v1.0
- ✓ PHASES/handler 架构对齐 (20/20) — v2.0
- ✓ Hermes ID 对齐 + 决策闭环解锁 — v2.0
- ✓ 一致性审计实化(GLM-4V 真实打分,null fallback) — v2.0
- ✓ 质量门控实化(删除 80% 兜底,null score 语义) — v2.0
- ✓ 镜头级并行调度 (parallel_shots: 4) — v2.0
- ✓ CompositionEngine 安全重写(execFile + sanitize) — v2.0
- ✓ E2E degraded-mode 跑通(全 20 阶段) — v2.0
- ✓ character-generation 真实实现(L1 20选3 + L2 compositions) — v2.0
- ✓ 12 V6 stub handler 真实化(pain-discovery 到 delivery) — v2.0
- ✓ 成本核算 + 重试预算(cost-report.json + max_retries: 3) — v2.0
- ✓ callLLM multimodal content blocks + GLM-4.6V 升级 (D1) — v3.0
- ✓ AssetBus V3 typed slots + envelope + atomic write (SCHEMA) — v3.0
- ✓ BlacklistEngine 语义匹配 + 跨 run 累积 + TTL (B5) — v3.0
- ✓ Seedance 2.0 Audio-Visual Sync + @Audio 强制校验 (A2) — v3.0
- ✓ CreativeHistoryTracker DAG + BFS + blast radius cap (B4 flagship) — v3.0
- ✓ CrossEpisodeAssetIndex DINOv2 + pHash 双索引 + human gate (B2) — v3.0
- ✓ FineTuneETL JSONL manifest + 4-field launch blocker + PII scrubber (B6) — v3.0
- ✓ Operator CLI bin/finetune-review.js — v3.0

### Active
_(none — v6.0 shipped 2026-06-27, ready for next milestone via `/gsd:new-milestone`)_

### Recently Validated
- ✓ v6.0 Rapid Convergence Loop — 补齐「最速收敛闭环」三件套:快速预览层 + 配方库 + 数据回流接口 (Phases 40-42, 802 tests, 19/19 REQs)
- ✓ v5.0 Hermes-Native Migration — kais-movie-agent 管线整体迁入 hermes-agent 成为原生 skill,清除 openclaw 编排层 (Phases 31-39, 502 tests, 25/25 REQs)

### Out of Scope
- 保留 Node.js lib/* 作为长期生产路径(v5.0 完成后归档,kais-movie-agent 不再演进)
- 非 GPU 任务类型
- 分布式多机部署 / TS 迁移 / CI/CD(留给 v6.0+)
- 真实 GPU E2E 验证 + GLM-4.6V API key 验证 + DINOv2 threshold 校准(operator 侧,继承自 v3.0/v4.0)

## Current State (after v4.0)

**Shipped:** v4.0 Production Pipeline Remediation (2026-06-24)

**Coverage:** 9 (v1.0) + 9 (v2.0) + 7 (v3.0) + 5 (v4.0) = 30 phases archived

**Test suite:** 517/517 pass (62 v1.0 + 103 v2.0 + 296 v3.0 + 56 v4.0 additions)

**Key v4.0 shipped capabilities:**
- 9 silent-failure points from 2026-06-23 audit all closed (PIPE-DATA/RENDER/INTEGRITY/COMPOSE/GUARD)
- Pipeline now produces master.mp4 end-to-end in degraded mode (verified by test/e2e/degraded-shipping.test.mjs)
- 9-finding audit regression suite (test/audit-v4-acceptance.test.mjs) — prevents recurrence
- composition handler outputs master.mp4 + web-preview.mp4 with degraded placeholders
- delivery filename alignment + _composition.delivered_mastermp4 marker
- consistency-guard blocking fail (throws CONSISTENCY_BLOCKED + marks episode failed)
- canvas-content-sync migrated to HTTP API (eliminates double-write race)
- repair-canvas CLI hardened against SQL injection (assertPositiveInt)
- 746 lines of dead code deleted (gate-constraints.js + invariant-bus.js)
- E2E-RUNBOOK.md §0 documents Path A (degraded, CI-verifiable) + Path B (real GPU, operator-deferred)

## Current State (after v3.0)

**Shipped:** v3.0 Industrial Pipeline Alignment (2026-06-23)

**Coverage:** 9 (v1.0) + 9 (v2.0) + 7 (v3.0) = 25 phases archived

**Test suite:** 461/461 pass (62 v1.0 + 103 v2.0 + 296 v3.0 additions)

**Key v3.0 shipped capabilities:**
- callLLM 重构为 multimodal content blocks(GLM-4.6V 真实"看到"图片,修 Pitfalls 陷阱 7)
- AssetBus V3 envelope + atomic write + 3 typed slots (creative-history / failed-shots / finetune-dataset)
- BlacklistEngine 跨 run 累积 + 语义匹配 (GLM-4.6v embedding ≥0.92) + TTL 30d + escape hatch
- Seedance 2.0 audio_refs + voice 时序锁 + @Audio 强制校验(防 Pitfalls 陷阱 1 静默失败)
- CreativeHistoryTracker(旗舰)— Git-for-AIGC-movies MVP,改剧本自动定位受影响镜头,1000-asset BFS 0.47ms
- CrossEpisodeAssetIndex DINOv2 + pHash 双索引 + 两阶段匹配 + human gate
- FineTuneETL JSONL manifest + LoRA training 提交 + 4-field launch blocker + PII scrubber + poisoning 检测
- Operator CLI bin/finetune-review.js

## Current State (after v6.0)

**Shipped:** v6.0 Rapid Convergence Loop (2026-06-27)

**Coverage:** 9 (v1.0) + 9 (v2.0) + 7 (v3.0) + 5 (v4.0) + 9 (v5.0) + 3 (v6.0) = 42 phases archived

**Test suite:** 802/802 pass (V5.0 502 baseline + 300 v6.0 incremental across Phases 40/41/42)

**Key v6.0 shipped capabilities:**
- p10b rapid_preview phase (between p10_voice and p11_video_render) + PreviewEngine strategy (SlideshowEngine + LTXVideoEngine)
- RecipeLibrary (5 methods + emotion-recipe JSONL + Wilson CI + 3 query modes) + extract_structure_from_episode helper
- FeedbackIngestClient + Starlette HTTP server + HMAC-SHA256 verification + 4-stage validation pipeline
- 5 new AssetBus slots (rapid-preview-clips, episode-meta, emotion-recipe, feedback-data, feedback-rejected)
- 最速收敛闭环: extract → recipe → feedback → Wilson CI → converged flag
- Structural "no auto-modify pipeline" enforcement (feedback_ingest.py zero forbidden imports)

## Previous Milestone: v6.0 Rapid Convergence Loop (SHIPPED 2026-06-27)

**Was:** 补齐「最速收敛闭环」三件套 — 快速预览层 + 配方库 + 数据回流接口

**Shipped:** 3 phases (40-42), 12 plans, 802 tests, 19/19 REQs, ~2900 LOC production code

## Next Milestone Goals (v7.0+)

v6.0 ship 后重新分档。当前可见候选:

### 结构性候选(v6.0 让它们更容易做)
- **TD-v3-1 上游 creative_history lineage retrofit** — v3.0 旗舰的最后一公里(script→sts→shot hash stamping)
- **hermes-agent dashboard 内嵌管线可视化** — 替代 :10588 canvas 部分依赖
- **Recipe auto-application to p10b** — v6.0 RECIPE-LIB 跑通后,可在 p03 script_design 阶段自动推荐 converged 配方(operator 可 override)。需观察 v6.0 配方库数据沉淀质量再决定。

### 待需求触发 — 技术上不难,但要看实际分发场景
- 多模型 A/B(Runway/Kling/Sora) — 真做对比评测时
- 多平台导出(抖音 9:16 / B站 16:9 / YouTube 横屏) — 真发多平台时
- 多语言 dubbing(HeyGen) — 真做出海时
- 字幕生成 + 烧录 + 多语言 SRT — 真需要字幕时

### 已砍掉(v5.0 后冗余或归属错误)
- ~~独立 lip sync phase~~ — Seedance 2.0 在 p11 内建,冗余
- ~~分布式多机部署~~ — 归 kais-aigc-platform 仓库,不挂 movie-agent

## Principles
- 零 npm 依赖 — 使用原生 fetch + Node.js 内置模块
- 所有客户端跟随现有 ES module 模式 (export class)
- 降级优先 — 外部服务不可用时系统仍可运行
- HMAC-SHA256 回调签名验证
- 参考 INTEGRATION.md 契约层规范

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

## Context
Shipped v1.0 with 6,742 LOC in lib/, 103 files changed.
Tech stack: Node.js ES modules, native fetch, HMAC-SHA256.
9 phases, 13 V4.1 engine functions, full degradation coverage.

**v2.0 启动背景** (2026-06-22): 评估发现 v1.0 PHASES 数组与 phaseHandlers 严重错位(20 阶段中 14 个无业务逻辑),Hermes 闭环失效,一致性审计含假数据(`return 0.85`),质量门控默认 80% 兜底,从未端到端跑通成片。v2.0 旨在止血并达到工业化可执行标准。

**v3.0 启动背景** (2026-06-23): v2.0 代码底盘扎实但产品形态落后工业产线 1 年。基于 2026 AIGC 工业产线评估(AniShort / Kino视界 / SkyReels V4 / Kling O1 / Seedance 2.0),用户甄选 5 核心 + D1 API 升级。v3.0 补齐 Seedance 2.0 原生音画同步、跨剧集资产复用、creative history 可追溯(旗舰)、bad case 黑名单、数据回流 fine-tuning 5 大能力。

---
*Last updated: 2026-06-27 — v6.0 Rapid Convergence Loop SHIPPED (802 tests, 19/19 REQs, ~2900 LOC)*
