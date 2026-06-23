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

### Active
- 🚧 PHASES/handler 架构对齐 — v2.0 (14 个新阶段缺 handler)
- 🚧 Hermes ID 对齐 + 决策闭环解锁 — v2.0
- 🚧 一致性审计实化(DINOv2/GLM-4V 真实打分) — v2.0
- 🚧 质量门控实化(删除默认 80% 兜底) — v2.0
- 🚧 镜头级并行调度 — v2.0
- 🚧 CompositionEngine 安全重写(execFile) — v2.0
- 🚧 端到端 E2E 验证(跑通 1 集) — v2.0

### Out of Scope
- 非 Node.js 运行时支持
- 非 GPU 任务类型
- 分布式多机部署(留给 v3.0)
- TS 迁移(留给 v3.0)
- CI/CD pipeline(留给 v3.0)

## Current Milestone: v2.0 Pipeline Remediation

**Goal:** 修复评估发现的 P0 架构断裂 + P1 工业化缺失,让 20 阶段 workflow 端到端可执行并产出首支成片

**Target features:**
- PHASES 数组与 phaseHandlers 完全对齐(20/20)
- Hermes 决策闭环对全 20 阶段开放
- 一致性审计使用真实视觉模型打分(DINOv2 / GLM-4V)
- 质量门控拒绝假通过(删除默认 80% 兜底)
- 镜头级并行(parallel_shots: 4 真正生效)
- CompositionEngine 使用 execFile 防注入
- 至少 1 集 60s 短剧从 requirement 跑到 final.mp4

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
