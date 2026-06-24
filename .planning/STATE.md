---
gsd_state_version: 1.0
milestone: v4.0
milestone_name: Production Pipeline Remediation
status: planning
last_updated: "2026-06-24T02:28:51.997Z"
last_activity: 2026-06-24
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-22)

**Core value:** 降级优先的 GPU 任务调度 — 外部服务不可用时系统仍可运行。
**Current focus:** v4.0 Production Pipeline Remediation — 修复 V6 管线 9 项沉默失败，让成片真正端到端产出

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-06-24 — Milestone v4.0 started

## Performance Metrics

**Velocity:**

- Total plans completed (cumulative v1.0+v2.0): 19
- v3.0 plans completed: 0
- v2.0 average duration: ~2 min/plan (Phase 10 baseline)

**By Phase (v2.0 historical reference):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| Phase 10 (PHASES/handler 对齐) | 1 | 3 | 2 min |
| Phase 17 P17 | 1 | 60s | 3 tasks / 5 files |

*v3.0 metrics will populate as plans complete*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md.
Recent decisions affecting current work:

- **v3.0 Roadmap (2026-06-23):** 7 phases (19-25), research-recommended order. Critical path: 19 → 20 → 21 → 22 → 23 → 25. Phase 24 parallel (depends only on 20).
- **Phase 19 first (BLOCKER):** D1 callLLM refactor + GLM-4.6V upgrade. A2/B2/B5 all depend on trustworthy visual scoring. Pitfall 7 (content-block breakage) is most likely single failure in v3.0 — refactor callLLM BEFORE touching model name.
- **Phase 20 keystone:** AssetBus schema extension (3 typed slots: creative-history / failed-shots / finetune-dataset) is integration spine for B4/B5/B6. Must exist before any consumer.
- **Phase 21 before 22:** B5 BlacklistEngine has lower complexity than A2; cloud-production hook chain should stabilize before audio param surface added. B5 consumes persistence that B6 fine-tuning will read.
- **Phase 22 (A2) research flag HIGH:** GoldTeam API surface for Seedance 2.0 audio task type / param names is unknown — requires operator consultation BEFORE implementation begins. `/gsd:plan-phase 22 --research-phase 22` likely needed.
- **Phase 23 (B4) killer differentiator:** Git-for-AIGC-movies MVP — script edit → affected shot_id list. v3.0 ships report-only output; auto-rerender deferred to v3.1. Upstream lineage retrofit explicitly out of scope.
- **Phase 24 (B2) parallel track:** research-grade matching, needs 50+50 pair labeled validation set. Can run parallel to 21/22/23. Two-stage match (hash retrieval → DINOv2 cosine ≥0.92 confirm) + human gate on first match.
- **Phase 25 (B6) highest risk, last:** LoRA poisoning is irreversible. Human review gate + golden-set regression + PII scrubber + poisoning detection are launch blockers. v3.0 only emits manifest + submission API; actual training operator-triggered.
- **Cross-cutting DEGRADE-01/02/03:** every v3.0 phase SC #5 covers degrade contract. Degraded E2E must stay <5s. Each new module has unit-test coverage for gold-team / Hermes / GLM unreachable paths.
- v2.0 启动: 评估发现 PHASES 数组与 phaseHandlers 严重错位(实际审计:15 个 missing handler, 5 个 legacy orphan),Hermes 闭环失效,一致性审计含假数据(`return 0.85`),质量门控默认 80% 兜底
- Roadmap 拆为 8 phases (10-17),按"架构对齐 → 质量实化 → 工程安全 → E2E"依赖顺序
- Phase 编号继续 v1.0 (1-9),v2.0 从 10 开始,v3.0 从 19 开始
- **Phase 19 D1 executed (2026-06-23):** callLLM/callLLMJson 原生支持 OpenAI multimodal content blocks (text + image_url);imagePathToDataUrl helper 自动转 base64(智谱不支持 file://);5 处硬编码视觉模型名统一到 ZHIPU_VISION_MODEL env (默认 glm-4.6v);_scoreCache 按 model_version 前缀失效;50-pair golden set baseline 框架就位。Pitfalls P7 根因修复。208/208 测试通过 (+43 新增)。Operator TODO: 补 45 对真实 golden set pair + 首次真实 API baseline 运行(W-3/B-1 carry-forward)。

### Pending Todos

- [x] `/gsd:plan-phase 19` — Phase 19 plan + execute (DONE — combined task)
- [ ] **Operator: 补 45 对真实 golden set pair + 首次 baseline 运行 (Phase 19 D1-03 deferred)**
- [ ] Operator consultation needed before Phase 22 implementation (Seedance 2.0 audio API surface — task type / param names)
- [ ] 50+50 pair labeled eval set construction needed for Phase 24 (B2) — empirical threshold calibration
- [ ] LoRA training workflow / kohya-ss dataset schema alignment needed for Phase 25 (B6)

### Blockers

None. Phase 19 framework delivered. Next: `/gsd:plan-phase 20` (Seedance A2).

### Key Risks (from research SUMMARY.md)

1. **GLM-4.6V content-block breakage (Pitfall 7)** — most likely single failure in v3.0. Prevention: Phase 19 refactors callLLM BEFORE model name change.
2. **Seedance audio silently ignored (Pitfall 1)** — Phase 22 SC-3 mandates @Audio1 validation. Cannot be caught in degraded mode.
3. **Fine-tuning data poisoning (Pitfall 6)** — Phase 25 SC-3/SC-4 launch blockers (human gate + regression + PII + poisoning).
4. **Cross-episode fingerprint false-positive (Pitfall 3)** — Phase 24 SC-3 two-stage match + SC-4 human gate.
5. **Bad-case blacklist over-matching (Pitfall 5)** — Phase 21 SC-2 semantic match from day 1 + SC-4 TTL decay.
6. **Degrade-chain breakage (Pitfall 8)** — every phase SC-5 covers degrade contract.

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v3.1 | 上游 creative_history lineage retrofit (script→sts→shot) | Deferred | v3.0 roadmap |
| v3.1 | creative_history auto-rerender on script edit | Deferred | v3.0 roadmap |
| v3.1 | 预算告警 + 阻断逻辑 | Deferred | v3.0 roadmap |
| v4.0+ | 多模型 A/B 测试 (Runway/Kling/Sora) | Deferred | v3.0 roadmap |
| v4.0+ | 多平台导出 (抖音/B站/YouTube/快手) | Deferred | v3.0 roadmap |
| v4.0+ | 多语言 dubbing (HeyGen 175+) | Deferred | v3.0 roadmap |
| v4.0+ | 分布式多机部署 | Deferred | v2.0 |
| v4.0+ | TypeScript 迁移 / CI/CD pipeline | Deferred | v2.0 |

## Session Continuity

Last session: 2026-06-23 — v3.0 Roadmap created (Phases 19-25, 35 REQs mapped, 100% coverage).
Stopped at: Roadmap complete, ready for Phase 19 planning.
Resume file: `.planning/ROADMAP.md`

**Next action:**

```
/gsd:plan-phase 19
```

**Critical context to preserve across sessions:**

- Phase 19 is BLOCKER — must complete before any other v3.0 phase work begins
- Phase 22 needs operator consultation on Seedance 2.0 audio API BEFORE implementation (`--research-phase 22`)
- Phase 24 is parallel track (independent of 21/22/23, only depends on 20)
- Phase 25 is highest risk (irreversible LoRA poisoning) — 4 launch blockers are non-negotiable
- DEGRADE-01/02/03 cross-cutting — every phase SC #5 must preserve <5s degraded E2E
