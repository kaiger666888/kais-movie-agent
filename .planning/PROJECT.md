# kais-movie-agent 集成开发

## What This Is
movie-agent 的 AIGC 集成层 — 将 gold-team GPU 调度和 review-platform 审核平台连接到电影制作流水线，实现 GPU 密集型任务（TTS、Blender、FLUX 图像、视频生成）的远程调度和人工审核工作流。

## Core Value
降级优先的 GPU 任务调度 — 外部服务不可用时系统仍可运行。

## Requirements

### Validated
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

### Active (v4.0 Production Pipeline Remediation)
9 audit-identified silent-failure points in V6 production data flow. See REQUIREMENTS.md for full REQ-IDs.
- composition phase 无 handler (PIPE-COMPOSE-01)
- master.mp4 ↔ final.mp4 文件名不一致 (PIPE-COMPOSE-02)
- motion-preview Blender 调用字段大小写错 (PIPE-RENDER-01)
- V6 不再写 requirement.json (PIPE-DATA-01)
- scene ↔ spatio-temporal-script 时序倒置 (PIPE-DATA-02)
- consistency-guard 非阻塞 + 死引用 (PIPE-GUARD-01)
- jimeng-client.js 已 @deprecated 仍被调用 (PIPE-RENDER-02)
- canvasGraph 双写竞态 (PIPE-INTEGRITY-01)
- repair-canvas-truncated-scenes.js SQL 注入面 (PIPE-INTEGRITY-02)

### Out of Scope
- 非 Node.js 运行时支持
- 非 GPU 任务类型
- 分布式多机部署 / TS 迁移 / CI/CD(留给 v4.0+)
- 真实 GPU E2E 验证 + GLM-4.6V API key 验证 + DINOv2 threshold 校准(operator 侧)

## Current Milestone: v4.0 Production Pipeline Remediation

**Goal:** 修复 V6 生产管线 9 项沉默失败，让成片真正端到端产出 — 从"测试通过"升级到"能产成片"。

**Target features (9 audit findings, see REQUIREMENTS.md for REQ-IDs):**
- 管线尾部断裂：composition phase 实现 + 文件名对齐 (PIPE-COMPOSE)
- 真实渲染沉默失败：motion-preview Blender 字段 + jimeng-client 死引用清理 (PIPE-RENDER)
- 数据管道断裂：requirement.json 失写 + scene↔sts 时序倒置 (PIPE-DATA)
- 质量门控失效：consistency-guard 阻塞化 + 死代码清理 (PIPE-GUARD)
- 跨系统完整性 + 安全：canvas 双写竞态 + SQL 注入面 (PIPE-INTEGRITY)

**Key context:** 2026-06-23 端到端数据流审计发现：461/461 单元测试通过但生产工序在 5 处断裂。修复前 v3.0 框架虽然就绪但实际无法产出任何成片。Phase 编号继续 v3.0 (19-25)，v4.0 从 26 起。

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

## Next Milestone Goals (v3.1+)

待规划。候选项:
- 上游 creative_history lineage retrofit(TD-v3-1,unblock full Git-for-AIGC-movies)
- 多模型 A/B 测试(Runway/Kling/Sora 同镜头并跑选优)
- 多平台导出(抖音 9:16 / B站 16:9 / YouTube 横屏)
- 多语言 dubbing(HeyGen 175+ 语言)
- 字幕生成 + 烧录 + 多语言 SRT
- 独立 lip sync phase(sync.so / HeyGen,作为 Seedance fallback)
- 分布式多机部署
- TypeScript 迁移 / CI/CD

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
*Last updated: 2026-06-24 — started v4.0 Production Pipeline Remediation milestone*
