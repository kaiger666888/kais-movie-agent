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

### Active
(No active requirements — v2.0 milestone shipped, plan next milestone)

### Out of Scope
- 非 Node.js 运行时支持
- 非 GPU 任务类型
- 分布式多机部署(留给 v3.0)
- TS 迁移(留给 v3.0)
- CI/CD pipeline(留给 v3.0)
- 真实 GPU E2E 验证(留给 v3.0,需 operator 配置 gold-team)
- GLM-4V 真实 API key 验证(留给 v3.0,需 operator 配置)

## Current State (after v2.0)

**Shipped:** v2.0 Pipeline Remediation (2026-06-22)

**Coverage:** 9 phases (v1.0) + 9 phases (v2.0) = 18 phases archived

**Test suite:** 165/165 pass (62 v1.0 baseline + 103 v2.0 additions)

**Key shipped capabilities:**
- 全 20 阶段 PHASES ↔ phaseHandlers 100% 对齐
- Hermes 决策闭环对全 20 阶段开放
- 一致性审计实化 (GLM-4V 真实打分,无假数据)
- 质量门控实化 (LLM 失败 → null score,不再假通过)
- 镜头级并行调度 (ShotParallelScheduler + runWithRetry)
- CompositionEngine 工程安全 (execFile + path sanitize)
- E2E degraded-mode 全流程跑通 (< 5s)
- 单集 GPU 成本核算 (cost-report.json)

## Next Milestone Goals (v3.0+)

待规划。候选项:
- 真实 GPU E2E 验证(产出可播放 final.mp4)
- 分布式多机部署(Redis 队列 + N workers)
- TypeScript 迁移(至少 lib/ 核心模块)
- CI/CD pipeline(GitHub Actions)
- 资产指纹去重 + 跨剧集复用

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

---
*Last updated: 2026-06-22 after v2.0 milestone start*
