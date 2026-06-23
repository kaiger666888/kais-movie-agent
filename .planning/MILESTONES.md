# Milestones

## v3.0 Industrial Pipeline Alignment (Shipped: 2026-06-23)

**Phases completed:** 7 phases (Phase 19-25), 35 REQs, 461 tests passing

**Key accomplishments:**
- callLLM 重构为 OpenAI multimodal content blocks(GLM-4.6V 真实"看到"图片,修 Pitfalls 陷阱 7)
- AssetBus V3 — 3 typed slots + envelope + atomic write + JSONL append
- BlacklistEngine — failed_shots 跨 run 累积 + GLM-4.6v embedding 语义匹配 + TTL + escape hatch
- Seedance 2.0 Audio-Visual Sync — getOmniReferencePack audio slot + voice 时序锁 + @Audio 强制校验
- CreativeHistoryTracker(旗舰) — DAG + reverse BFS + blast radius cap,1000-asset BFS 0.47ms
- CrossEpisodeAssetIndex — DINOv2(主) + pHash(降级)双索引 + 两阶段匹配 + human gate
- FineTuningETL — JSONL manifest + LoRA training 提交 + 4-field launch blocker + PII scrubber + poisoning 检测
- Golden-set baseline framework(50-pair vision + 60-prompt regression)
- Operator CLI bin/finetune-review.js(list-pending / approve / reject / submit-training)

**Audit status:** tech_debt (0 structural gaps, 5 PARTIAL awaiting operator real-API/GPU data)

**v3.1 backlog:**
- TD-v3-1: 上游 creative_history lineage retrofit (script→sts→shot)
- W-v3-1: GLM-4.6V 50-pair golden set real-API baseline
- W-v3-3: Seedance 2.0 audio_refs API contract + real Chinese lip sync calibration
- W-v3-4: DINOv2 threshold calibration (50+50 real cross-episode pairs)
- W-v3-5: Golden-set regression real prompts + pre/post training scores
- W-v3-6: Layer-2 real-GPU E2E (carry-forward from v2.0 B-1)

---

## v2.0 Pipeline Remediation (Shipped: 2026-06-22)

**Phases completed:** 9 phases (Phase 10-18), 19 plans, 165 tests passing

**Key accomplishments:**
- PHASES 数组与 phaseHandlers 100% 对齐(20/20 V6 handlers)
- HermesClient.VALID_PHASES 与 PHASES 同步,决策闭环解锁
- _getDINOv2Score 接入 GLM-4V 真实打分,删除假数据
- 质量门控删除 80% 兜底,null score 语义
- ShotParallelScheduler 镜头级并行 + runWithRetry 自适应重试
- CompositionEngine 改用 execFile + sanitizePath
- EvaluationCollector.aggregateForEpisode → cost-report.json
- character-generation 真实 L1(20选3) + L2(compositions API)
- 12 个 V6 stub handler 全部真实化(pain-discovery → delivery)
- E2E degraded-mode 全流程跑通(< 5s)
- QUAL-02 hardening 单元测试(12 用例)
- E2E-RUNBOOK.md 文档化真实 GPU 运行流程

**Audit status:** tech_debt (3/4 structural findings closed)

---

## v1.0 AIGC Integration (Shipped: 2026-05-18)

**Phases completed:** 9 phases (Phase 1-9)

---
