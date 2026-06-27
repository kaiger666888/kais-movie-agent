# Roadmap: kais-movie-agent 集成开发

## Milestones

- ✅ **v1.0 AIGC Integration** — Phases 1-9 (shipped 2026-05-18)
- ✅ **v2.0 Pipeline Remediation** — Phases 10-18 (shipped 2026-06-22) — [Archive](./milestones/v2.0-ROADMAP.md)
- ✅ **v3.0 Industrial Pipeline Alignment** — Phases 19-25 (shipped 2026-06-23) — [Archive](./milestones/v3.0-ROADMAP.md)
- ✅ **v4.0 Production Pipeline Remediation** — Phases 26-30 (shipped 2026-06-24) — [Archive](./milestones/v4.0-ROADMAP.md)
- ✅ **v5.0 Hermes-Native Migration** — Phases 31-39 (shipped 2026-06-26) — [Archive](./milestones/v5.0-ROADMAP.md)
- 🚧 **v6.0 Rapid Convergence Loop** — Phases 40-42 (started 2026-06-27) — **ACTIVE**

## Phases

<details>
<summary>✅ v4.0 Production Pipeline Remediation (Phases 26-30) — SHIPPED 2026-06-24</summary>

- [x] Phase 26: Data Spine Repair (PIPE-DATA-01/02)
- [x] Phase 27: Real Render Path Restoration (PIPE-RENDER-01/02)
- [x] Phase 28: Cross-System Integrity & Safety Hardening (PIPE-INTEGRITY-01/02)
- [x] Phase 29: Composition Tail + Quality Gate Activation (PIPE-COMPOSE-01/02, PIPE-GUARD-01)
- [x] Phase 30: End-to-End Shipping Verification (acceptance gate)

Full details: [v4.0-ROADMAP.md](./milestones/v4.0-ROADMAP.md)

</details>

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

<details>
<summary>✅ v5.0 Hermes-Native Migration (Phases 31-39) — SHIPPED 2026-06-26 (502 tests, 25/25 REQs)</summary>

- [x] **Phase 31: Plugin Skeleton + Hermes-Agent Wiring** — 3 plugins (kais_aigc / pipeline_state / review_gates) scaffolding + manifests + loader 注册 + smoke imports
- [x] **Phase 32: Kais-AIGC Platform Backend (Python clients)** — 4 Python clients (gold_team/review_platform/canvas/jimeng) with auth + degrade + mocked HTTP tests + plugin tool surface
- [x] **Phase 33: Pipeline State & Asset Bus** — Python port of PipelineStateStore + AssetBus V3 (typed slots + envelope + atomic write) + CreativeHistoryTracker DAG + BFS
- [x] **Phase 34: Review Gate Framework** — HIL gate lifecycle (submit/wait/resolve) + 3 modes + 8 gate YAML config + delegate_task approval + max_retries fail (4/4 plans complete)
- [x] **Phase 35: Orchestration Skill Skeleton (vertical slice)** — SKILL.md + runner.py + p01/p02/p03 end-to-end + delegate_task to movie-experts + asset bus I/O + gate trigger
- [x] **Phase 36: Remaining 10 Phases Port** — p04_character_design through p13_delivery ported, each load/gather/execute/write/gate
- [x] **Phase 37: Canvas Sync Migration** — canvas sync hook Node → Python event subscriber, fires on phase completion + gate resolution (SC#1/SC#2/SC#3 met; 495 tests pass)
- [x] **Phase 38: OpenClaw Decoupling + Docs Cleanup** — 0 openclaw refs in v5.0 deliverables + DEPRECATED.md + no Node runtime dependency
- [x] **Phase 39: E2E Validation + v5.0 Audit** — openclaw OFF degraded E2E produces master.mp4 + v5.0-MILESTONE-AUDIT.md — **SHIPPED 2026-06-26 (502 tests, v5.0 complete)**

**Critical path (v5.0):** 31 → 32 → 35 → 36 → 38 → 39 (main spine); 33 (state) ∥ 34 (gates) partial parallel after 31; 37 (canvas) follows 35.

Full v5.0 phase details preserved in git history (commit prior to 2026-06-27 v6.0 roadmap append). Audit artifacts: `v5.0-MILESTONE-AUDIT.md`.

</details>

### 🚧 v6.0 Rapid Convergence Loop (Phases 40-42) — ACTIVE

**Milestone goal:** 在 V5.0 13 步管线之上补齐「最速收敛闭环」三件套 — 快速预览层、配方库、数据回流接口,完成情绪方程的最速收敛求解与资产化沉淀。

**第一性原理公式:**
> 在注意力经济的约束下,以趋近于零的边际成本,完成情绪方程的最速收敛求解与资产化

**Data flow (per blueprint):** 调研萃取 → 配方建模 → 定向赛马 → 数据收敛 → 资产化沉淀 — strict serial, no parallel tracks.

- [ ] **Phase 40: Rapid Preview Tier** — p10b rapid_preview phase inserted between p10/p11 + dual-engine (LTX-Video / slideshow) + preview-clips AssetBus slot + 2-3 variants per shot (control-variable A/B)
- [ ] **Phase 41: Emotion Recipe Library** — recipe_library.py (5 methods) + emotion-recipe JSONL slot + script_auditor 5-dim structured extraction + query interface (genre/structure/validation) + provenance
- [ ] **Phase 42: Feedback Ingestion** — feedback_ingest.py + POST /api/v1/feedback (HMAC) + feedback-data JSONL slot + RecipeLibrary.update_validation trigger + NO auto pipeline modification + data validation

**Critical path (v6.0):** 40 → 41 → 42 (strict serial — Phase 41 needs Phase 40's structure_delta, Phase 42 needs Phase 41's recipe validation fields).

## Phase Details

### Phase 40: Rapid Preview Tier

**Goal**: 在 V5.0 13 步管线中插入 p10b rapid_preview phase — 每 shot 生成 2-3 个秒级低质量极速预览变体供结构参数 A/B 赛马,引擎不可达时降级到直接 Seedance 但必须 WARN 而非沉默吞错,V5.0 的 4 个红线门在预览层同样生效
**Depends on**: Phase 39 (V5.0 shipped — 13 phase Python 管线就位,AssetBus V3 typed slots 框架可扩展,consistency-guard 阻塞语义可用)
**Requirements**: RAPID-PREVIEW-01, RAPID-PREVIEW-02, RAPID-PREVIEW-03, RAPID-PREVIEW-04, RAPID-PREVIEW-05, RAPID-PREVIEW-06, RAPID-PREVIEW-07
**Plans**: 4 plans (4 waves, strict serial — brownfield regression safety requires each plan's tests to pass before the next plan starts)

Plans:
- [x] 40-01-PLAN.md — AssetBus preview-clips slot + PHASE_REGISTRY p10b stub insertion (low-risk scaffolding; updates V5.0 test_phase_registry_full.py 13→14)
- [ ] 40-02-PLAN.md — PreviewEngine ABC + SlideshowEngine (FFmpeg subprocess) + LTXVideoEngine (mocked httpx POST :9001/api/v1/ltx) + select_engine factory (TDD)
- [ ] 40-03-PLAN.md — p10b_rapid_preview.py full phase module (replaces 40-01 stub): 3 variants/shot, single-delta enforcement, ThreadPoolExecutor fan-out, episode-level degrade WARN
- [ ] 40-04-PLAN.md — Verification tests: dual-engine E2E + JSONL format invariants + WARN-level degrade assertion + V5.0 502-test regression guard

**Success Criteria** (what must be TRUE):
1. `p10b_rapid_preview.py` 作为新 phase 插入 p10(voice) 与 p11(video_render) 之间,DAG 拓扑正确(p10 → p10b → p11),phase contract 定义清晰(input: voice_assets + keyframes + script_structure;output: preview_clips) — 引擎双轨切换(LTX-Video 主路径 / slideshow fallback)走 `KAIS_PREVIEW_ENGINE` env var (RAPID-PREVIEW-01, RAPID-PREVIEW-02)
2. 每个 shot 生成 **2-3 个低质量极速预览变体**,每个变体只改一个结构参数(hook 位置 / emotion 序列 / turning point 时序 / ending state),遵守 Notion 红线 #6 控制变量;变体持久化到 AssetBus 新槽 `preview-clips` (JSONL,字段含 `shot_id / variant_id / structure_delta / clip_path / generation_time_ms / engine`) (RAPID-PREVIEW-03, RAPID-PREVIEW-04)
3. **降级容忍可见** — 引擎不可达时 fallback 到直接 Seedance(跳过 p10b,正常进 p11),但日志必须 `WARN` 级别报 "preview_skipped" 而非沉默,episode 级 metadata 标记 `preview_skipped=true`(继承 v4.0 降级语义,不允许沉默吞错) (RAPID-PREVIEW-05)
4. **4 个红线门继承生效** — V5.0 的 @Audio 强制校验 / asset envelope 原子写 / consistency-guard 阻塞 / Hermes phase contract 在预览层同样生效,p10b 失败达 max_retries 触发 episode-level fail(throw + 标记 episode failed),不沉默 (RAPID-PREVIEW-06)
5. **测试覆盖** — mocked LTX-Video API + mocked FFmpeg subprocess 验证:(a) 双引擎路径都产出预览,(b) 降级路径正确报 warning 而非沉默跳过,(c) preview-clips JSONL 格式合法 (RAPID-PREVIEW-07)

**UI hint**: no

---

### Phase 41: Emotion Recipe Library

**Goal**: 把 V5.0 `creative-history` 中散落的 script_auditor 5 维评分结构化为可复用的 emotion-recipe JSONL 配方库,提供 5 个核心方法 + 3 种查询模式 + 完整溯源,为 Phase 42 feedback 更新配方评分提供数据结构基础
**Depends on**: Phase 40 (p10b rapid_preview 就位 — structure_delta 字段定义了配方的结构参数空间,emotion-recipe 的 `structure{}` 字段与之对齐)
**Requirements**: RECIPE-LIB-01, RECIPE-LIB-02, RECIPE-LIB-03, RECIPE-LIB-04, RECIPE-LIB-05, RECIPE-LIB-06
**Plans**: TBD

**Success Criteria** (what must be TRUE):
1. `plugins/pipeline_state/recipe_library.py` 实现 RecipeLibrary 类,提供 **5 个核心方法**:`create_recipe / get_recipe / list_recipes / update_validation / query_by_structure`,作为 pipeline_state plugin 的新 module (RECIPE-LIB-01)
2. emotion-recipe JSONL 格式严格符合蓝图 schema:每条配方含 `recipe_id / version / genre / structure{hook_position_sec, emotion_sequence, turning_points_sec, emotion_drop_level, ending_state} / validation{platform, completion_rate, confidence_interval, sample_size, converged} / provenance{source_episode, created, last_validated}` 全字段 (RECIPE-LIB-02);AssetBus 新槽 `emotion-recipe` (JSONL,**追加式** append-only 不覆盖),同 recipe_id 多版本通过 version 字段区分,查询默认返回 latest (RECIPE-LIB-03)
3. **5 维评分结构化抽取** — 从 V5.0 已有的 `creative-history` slot 中,把 script_auditor 5 维评分(emotion_curve / hook_strength / pacing / character_consistency / cliffhanger)结构化抽取成 emotion-recipe 配方(每集一条配方 + 结构参数 traceable 到原 creative-history 记录),抽取后写入 `emotion-recipe` slot (RECIPE-LIB-04)
4. **配方查询接口** — 支持三种查询模式:by genre(都市奇幻·轻喜剧等)/ by structure similarity(给定结构参数找最相似配方)/ by validation status(converged=true 的"已验证配方"优先),operator 或下次创作决策方可调用查询接口选取配方 (RECIPE-LIB-05)
5. **配方溯源可追溯** — 每条配方可通过 `provenance.source_episode` 追溯到原 creative-history record → 原 script + 5 维评分;`recipe_id` 命名规则 `<genre-slug>-<seq>`(如 `urban-fantasy-001`),便于人读与检索 (RECIPE-LIB-06)

**UI hint**: no

---

### Phase 42: Feedback Ingestion

**Goal**: 补齐「最速收敛闭环」最后一环 — 接收平台完播率/互动率/追播率数据,写入 feedback-data JSONL 并触发 RecipeLibrary.update_validation 更新配方评分(Wilson 区间 + converged flag);**绝不自动修改管线行为**,人决策优先
**Depends on**: Phase 41 (RecipeLibrary.update_validation 方法就位 — feedback 接收后调用此方法更新 completion_rate / confidence_interval / sample_size / converged flag)
**Requirements**: FEEDBACK-INGEST-01, FEEDBACK-INGEST-02, FEEDBACK-INGEST-03, FEEDBACK-INGEST-04, FEEDBACK-INGEST-05, FEEDBACK-INGEST-06
**Plans**: TBD

**Success Criteria** (what must be TRUE):
1. `plugins/kais_aigc/feedback_ingest.py` 实现 FeedbackIngestClient 类,提供 **3 个核心方法**:`submit_feedback / get_feedback / list_pending_updates`,作为 kais_aigc plugin 的新 module (FEEDBACK-INGEST-01)
2. HTTP endpoint `POST /api/v1/feedback` 接收平台数据,request schema 含 `episode_id / platform(douyin|bilibili|youtube) / metrics{completion_rate, interaction_rate, follow_rate} / measured_at`;**HMAC-SHA256 签名验证**(继承 V5.0 review-platform 模式),签名校验失败拒绝 (FEEDBACK-INGEST-02)
3. AssetBus 新槽 `feedback-data` (JSONL,**追加式**) 持久化原始 feedback,字段含 `feedback_id / episode_id / platform / metrics / received_at / signature_valid`,写入前签名校验通过 (FEEDBACK-INGEST-03)
4. **Feedback 接收后触发 RecipeLibrary.update_validation()** — 更新对应配方的 `completion_rate / confidence_interval`(基于 sample_size 的 Wilson 区间)/ `sample_size++` / `converged` flag(达 sample_size≥10 且置信区间收敛到 ±5% 内时 converged=true);配方库与 feedback 数据形成闭环 (FEEDBACK-INGEST-04)
5. **不自动修改管线行为 + 数据校验拒绝异常输入** — feedback 只更新配方库评分,绝不直接调用 p10b 改变 structure_delta(人决策优先);异常 input(metrics 超出 [0,1] 区间 / 未知 platform / episode_id 不存在 / signature 校验失败)被拒绝时返回 4xx + 写入 `feedback-rejected` 日志,**绝不污染配方库**(继承 v4.0 consistency-guard 阻塞语义) (FEEDBACK-INGEST-05, FEEDBACK-INGEST-06)

**UI hint**: no

---

## Progress Table

### v6.0 Active Milestone

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 40. Rapid Preview Tier | 1/4 | In Progress|  |
| 41. Emotion Recipe Library | 0/TBD | Not started | - |
| 42. Feedback Ingestion | 0/TBD | Not started | - |

### Archived Milestones (v1.0-v5.0)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 31. Plugin Skeleton + Hermes-Agent Wiring | 3/3 | Complete | 2026-06-26 |
| 32. Kais-AIGC Platform Backend | 5/5 | Complete | 2026-06-26 |
| 33. Pipeline State & Asset Bus | 4/4 | Complete | 2026-06-26 |
| 34. Review Gate Framework | 4/4 | Complete | 2026-06-26 |
| 35. Orchestration Skill Skeleton | 5/5 | Complete | 2026-06-26 |
| 36. Remaining 10 Phases Port | 6/6 | Complete | 2026-06-26 |
| 37. Canvas Sync Migration | 3/3 | Complete | 2026-06-26 |
| 38. OpenClaw Decoupling + Docs | 5/5 | Complete | 2026-06-26 |
| 39. E2E Validation + v5.0 Audit | 1/1 | Complete | 2026-06-26 — 502 tests pass, v5.0 SHIPPED |

## Cross-cutting Constraints

- **Phase numbering continues from v5.0** (Phase 39) — v6.0 starts at Phase 40, do NOT reset
- **降级容忍保留** — 预览层不可用时 fallback 到直接 Seedance(但必须 WARN 级别日志,继承 v4.0/v5.0 降级语义,不允许沉默吞错)
- **不改动 V5.0 13 步结构** — p10b 是插入,不替换 p11;V5.0 的 502 tests 不能 break
- **红线门继承** — V5.0 的 4 个红线门(@Audio 强制校验 / asset envelope 原子写 / consistency-guard 阻塞 / Hermes phase contract)在 v6.0 新交付物中同样生效,不重设计
- **控制变量** — 预览赛马一次只改一个结构参数(Notion 红线 #6)
- **数据回流不自动改管线** — feedback 只更新配方库评分,绝不自动修改 handler 行为(人决策优先)
- **零 Node.js runtime 依赖延续** — v6.0 交付物继续纯 Python + hermes-agent runtime(继承 v5.0 OPENCLAW-REMOVE-03)
- **保留 v3.0/v4.0/v5.0 修复** — AssetBus V3 envelope + atomic write / canvas HTTP API v2 / consistency-guard 阻塞语义在 v6.0 新 module 中保留
- **不重写已存在资产** — V5.0 13 phase + 4 client + CreativeHistoryTracker 消费 as-is,v6.0 只增量添加 p10b / recipe_library / feedback_ingest

---

*Roadmap active milestone: v6.0 Rapid Convergence Loop (started 2026-06-27)*
*Phase numbering: continues from v5.0 Phase 39 — v6.0 spans Phase 40-42*
*Previous milestone: v5.0 Hermes-Native Migration — SHIPPED 2026-06-26 (502 tests, 25/25 REQs, 0 openclaw refs)*
