# Milestones

## v6.0 Rapid Convergence Loop (Shipped: 2026-06-27)

**Phases completed:** 3 phases (Phase 40-42), 12 plans, 19 REQs (RAPID-PREVIEW ×7, RECIPE-LIB ×6, FEEDBACK-INGEST ×6), 802 tests passing (+300 v6.0 incremental on V5.0 502 baseline)

**First-principles goal:** 在注意力经济的约束下,以趋近于零的边际成本,完成情绪方程的最速收敛求解与资产化沉淀

**Key accomplishments:**
- **快速预览层** — p10b rapid_preview phase 插入 V5.0 13 步管线 (p10→p10b→p11),PreviewEngine ABC 双轨策略 (SlideshowEngine FFmpeg + LTXVideoEngine httpx mock),每 shot 3 个 single-delta 变体 (Notion 红线 #6 控制变量),cycling matrix 覆盖 4 个结构参数
- **配方库** — RecipeLibrary 5 核心方法 (create/get/list/update_validation/query_by_structure) + emotion-recipe JSONL 16-字段 schema + Wilson 纯 stdlib CI + 3 查询模式 (genre/structure similarity/validation status)
- **数据回流接口** — FeedbackIngestClient + Starlette HTTP server (POST /api/v1/feedback) + HMAC-SHA256 验证 + 4-stage validation pipeline (signature/schema/semantic/episode) + feedback-data/feedback-rejected JSONL slots
- **最速收敛闭环** — extract_structure_from_episode → recipe_library.create_recipe → feedback_ingest HTTP POST → RecipeLibrary.update_validation (continuous-rate Wilson CI) → converged flag (sample_size≥10 AND CI spread≤10%)
- **结构性"绝不自动改管线"** — feedback_ingest.py 零 import p10b/runner/preview_engine,grep 测试在每个 commit 强制执行 (FEEDBACK-INGEST-05)
- **5 个新 AssetBus slots** (rapid-preview-clips, episode-meta, emotion-recipe, feedback-data, feedback-rejected) append-only 注册,JSONL_SLOTS frozenset 不变
- **降级容忍 + 红线门继承** — V5.0 的 4 个红线门在预览层生效,降级 WARN 不沉默 (Phase 40 CR-01 fix: runner JSONL dispatch)

**Audit status:** tech_debt (19/19 REQs satisfied, 0 blockers, 3 warnings — all documented as intentional operator-side concerns or v7.0+ deferred; mirrors v3.0/v5.0 pattern)

**Files shipped:** ~2900 LOC production code (4 new modules + 1 phase module) + 5 new AssetBus slots + 359 new tests

**Pre-existing out-of-scope failure (NOT v6.0):** `test_no_openclaw_references_in_phase_37_deliverables` — canvas_sync.py sqlite refs from V8.6 phaseIndex effort (tracked in deferred-items.md)

**v7.0+ backlog:** TD-v3-1 lineage retrofit / dashboard 内嵌可视化 / recipe auto-application to p10b / multi-model A/B / multi-platform export / multi-language dubbing

---

## v5.0 Hermes-Native Migration (Shipped: 2026-06-26)

**Phases completed:** 9 phases (Phase 31-39), 36 plans, 25 REQs (HERMES-SKILL ×5, GPU-DIRECT ×6, GATE-NATIVE ×5, CANVAS-IN-HERMES ×4, OPENCLAW-REMOVE ×5), 502 tests passing

**Key accomplishments:**
- kais-movie-agent 13 步短剧管线整体迁入 hermes-agent 成为原生 skill
- 3 个新 plugin (kais_aigc / pipeline_state / review_gates) + 1 个新 skill (kais-movie-pipeline)
- 完整 Python 重写 (~5500 LOC),无 Node.js runtime 依赖
- openclaw 彻底退出短剧创作流程（0 引用残留）
- canvas sync 迁入 hermes-agent event subscriber
- 直连 kais-aigc-platform (gold-team :8002 + review-platform :8090 + canvas :10588 + jimeng :5100)

**Audit status:** passed (25/25 REQs satisfied, 0 openclaw refs, 502 tests passing)

---

## v4.0 Production Pipeline Remediation (Shipped: 2026-06-24)

**Phases completed:** 5 phases (Phase 26-30), 12 plans, 9 REQs (PIPE-DATA/RENDER/INTEGRITY/COMPOSE/GUARD), 517 tests passing

**Key accomplishments:**
- 修复 2026-06-23 端到端数据流审计发现的 9 项沉默失败点
- Data Spine Repair: character 数据源迁移到 pain-report.json + scene↔sts stageOrder reorder
- Real Render Path Restoration: motion-preview Blender 字段 camelCase + jimeng-client deprecate warn
- Cross-System Integrity & Safety: canvas HTTP API migration (消除双写竞态) + repair-canvas SQL 注入面修复
- Composition Tail + Quality Gate: master.mp4 真实产出 + delivery 文件名对齐 + consistency-guard 阻塞化 + 746 行死代码删除
- End-to-End Shipping Verification: degraded E2E 跑通产出 master.mp4 + 9-finding audit 自动化回归 + runbook 文档化

**Audit status:** passed (9/9 REQs satisfied, 12/12 cross-phase wired, 0 blockers, 3 operator-deferred items)

**v5.0 backlog:**
- TD-v3-1: 上游 creative_history lineage retrofit (carry-forward)
- W-v3-1~6: Real GPU E2E + GLM-4.6V golden set + DINOv2 calibration + LoRA training (operator-side carry-forward)
- bin/pipeline.js CLI surface improvements (--to flag, status)
- jimeng → dreamina CLI full migration (when platform provides)

---

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
