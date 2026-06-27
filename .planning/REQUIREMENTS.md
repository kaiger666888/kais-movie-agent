# Requirements: v6.0 Rapid Convergence Loop

**Defined:** 2026-06-27
**Core Value:** 在 V5.0 13 步管线之上补齐「最速收敛闭环」 — 快速预览层 + 配方库 + 数据回流接口,完成情绪方程的最速收敛求解与资产化沉淀。
**Milestone:** v6.0 — Phases 40-42 (3 phases)
**Blueprint:** [gsd-v6.0-rapid-convergence.md](./gsd-v6.0-rapid-convergence.md)

## v6.0 Requirements

需求分 3 大族,覆盖 v6.0 的全部交付面。每个 REQ-ID 映射到恰好一个 phase(见 Traceability)。

### RAPID-PREVIEW — 快速预览层 (p10b rapid_preview)

- [x] **RAPID-PREVIEW-01**: 新 phase `p10b_rapid_preview.py` 插入 p10(voice) 与 p11(video_render) 之间,DAG 拓扑正确(p10 → p10b → p11),phase contract 定义清晰(input: voice_assets + keyframes + script_structure;output: rapid_preview_clips + episode_meta)
- [x] **RAPID-PREVIEW-02**: 引擎支持双轨 — LTX-Video(秒级真实生成)作为主路径,slideshow-style(关键帧 + TTS → FFmpeg 合成 < 10s)作为 fallback。引擎选择走配置 (`KAIS_PREVIEW_ENGINE=ltx|slideshow`)
- [ ] **RAPID-PREVIEW-03**: 每个 shot 生成 **2-3 个低质量极速预览变体**,每个变体只改一个结构参数(hook 位置 / emotion 序列 / turning point 时序 / ending state),遵守 Notion 红线 #6 控制变量。Variant matrix 在多 shot 剧集上 CYCLE 所有 4 个参数(`STRUCTURE_PARAMS[N mod 4], [(N+1) mod 4], [(N+2) mod 4]`),确保每个参数都被覆盖
- [x] **RAPID-PREVIEW-04**: AssetBus 新槽 `rapid-preview-clips` (JSONL 格式) 持久化预览变体,字段含 `shot_id / variant_id / structure_delta / clip_path / generation_time_ms / engine`。**槽名 renamed from v3.0-era 文档中的 `preview-clips` 以避免与 SKILL.md p06.5 future-slot 命名空间冲突**;同时新增 `episode-meta` (JSON 格式) 槽用于 episode-level metadata flags (`preview_skipped` 等)
- [x] **RAPID-PREVIEW-05**: **降级容忍** — 引擎不可达时 fallback 到直接 Seedance(跳过 p10b,正常进 p11),但必须 `WARN` 级别日志 + 在 `episode-meta` AssetBus slot 标记 `preview_skipped=true`(继承 v4.0 降级语义,不允许沉默吞错)
- [ ] **RAPID-PREVIEW-06**: V5.0 的 4 个红线门(@Audio 强制校验 / asset envelope 原子写 / consistency-guard 阻塞 / Hermes phase contract)在预览层同样生效 — p10b 失败达 max_retries 触发 episode-level fail,不沉默
- [ ] **RAPID-PREVIEW-07**: 测试覆盖 — mocked LTX-Video API + mocked FFmpeg subprocess,验证 (a) 双引擎路径都产出预览,(b) 降级路径正确报 warning 而非沉默跳过 + flag 落到 `episode-meta` slot(不是 `pipeline-state`),(c) `rapid-preview-clips` JSONL 格式合法,(d) runner 在 full DAG 中正确迭代到 p10b 且 `result["phases"]["p10b_rapid_preview"]` 输出 shape 正确

### RECIPE-LIB — 配方库 (Emotion Recipe Library)

- [ ] **RECIPE-LIB-01**: `plugins/pipeline_state/recipe_library.py` 实现 — 提供 RecipeLibrary 类(create_recipe / get_recipe / list_recipes / update_validation / query_by_structure 5 个核心方法)
- [ ] **RECIPE-LIB-02**: emotion-recipe JSONL 格式严格符合蓝图 schema:`recipe_id / version / genre / structure{hook_position_sec, emotion_sequence, turning_points_sec, emotion_drop_level, ending_state} / validation{platform, completion_rate, confidence_interval, sample_size, converged} / provenance{source_episode, created, last_validated}`
- [ ] **RECIPE-LIB-03**: AssetBus 新槽 `emotion-recipe` (JSONL, **追加式**,append-only 不覆盖) 持久化配方。同 recipe_id 多版本通过 version 字段区分,查询默认返回 latest version
- [ ] **RECIPE-LIB-04**: 从 V5.0 已有的 `creative-history` slot 中,把 script_auditor 5 维评分(emotion_curve / hook_strength / pacing / character_consistency / cliffhanger)结构化抽取成 emotion-recipe 配方(每集一条配方 + 结构参数 traceable 到原 creative-history 记录)
- [ ] **RECIPE-LIB-05**: 配方查询接口 — 按 genre(都市奇幻·轻喜剧等)/ by structure similarity(给定结构参数找最相似配方)/ by validation status(converged=true 的"已验证配方"优先)三种查询模式
- [ ] **RECIPE-LIB-06**: 配方溯源 — 每条配方可追溯 source_episode → creative-history record → 原 script + 5维评分。`recipe_id` 命名规则 `<genre-slug>-<seq>`(如 `urban-fantasy-001`)

### FEEDBACK-INGEST — 数据回流接口 (Feedback Ingestion)

- [ ] **FEEDBACK-INGEST-01**: `plugins/kais_aigc/feedback_ingest.py` 实现 — 提供 FeedbackIngestClient 类(submit_feedback / get_feedback / list_pending_updates 3 个核心方法)
- [ ] **FEEDBACK-INGEST-02**: HTTP endpoint `POST /api/v1/feedback` 接收平台数据,request schema:`episode_id / platform(douyin|bilibili|youtube) / metrics{completion_rate, interaction_rate, follow_rate} / measured_at`。HMAC-SHA256 签名验证(继承 V5.0 review-platform 模式)
- [ ] **FEEDBACK-INGEST-03**: AssetBus 新槽 `feedback-data` (JSONL, 追加式) 持久化原始 feedback。字段含 `feedback_id / episode_id / platform / metrics / received_at / signature_valid`
- [ ] **FEEDBACK-INGEST-04**: Feedback 接收后**触发 RecipeLibrary.update_validation()** — 更新对应配方的 completion_rate / confidence_interval(基于 sample_size 的 Wilson 区间)/ sample_size++ / converged flag(达 sample_size≥10 且置信区间收敛到 ±5% 内时 converged=true)
- [ ] **FEEDBACK-INGEST-05**: **不自动修改管线行为** — feedback 只更新配方库评分,绝不直接调用 p10b 改变 structure_delta。配方消费方(operator / 下次创作决策)读取配方库做决策,系统不自动应用 — 人决策优先
- [ ] **FEEDBACK-INGEST-06**: 数据校验 — 拒绝异常 input(metrics 超出 [0,1] 区间 / 未知 platform / episode_id 不存在 / signature 校验失败),拒绝时返回 4xx + 写入 `feedback-rejected` 日志,**绝不污染配方库**(继承 v4.0 consistency-guard 阻塞语义)

## v7.0+ Backlog (2026-06-27 v6.0 启动后重新分档)

v6.0 ship 后重新分档。当前可见候选:

### A. v7.0 结构性候选(v6.0 让它们更容易做)
- **TD-v3-1 上游 creative_history lineage retrofit** — v3.0 旗舰的最后一公里(script→sts→shot hash stamping)
- **hermes-agent dashboard 内嵌管线可视化** — 替代 :10588 canvas 部分依赖
- **配方库自动消费** — v6.0 RECIPE-LIB 跑通后,可在 p03 script_design 阶段自动推荐 converged 配方(operator 可 override)。需观察 v6.0 配方库数据沉淀质量再决定。

### B. 待需求触发 — 技术上不难,但要看实际分发场景
- 多模型 A/B(Runway/Kling/Sora) — 真做对比评测时
- 多平台导出(抖音 9:16 / B站 16:9 / YouTube 横屏) — 真发多平台时
- 多语言 dubbing(HeyGen) — 真做出海时
- 字幕生成 + 烧录 + 多语言 SRT — 真需要字幕时

> 不要现在画饼。等"我真的需要发 B 站 / 做英文版 / 对比 Kling"那天再各开一个 phase。

### C. 已砍掉(v5.0 后冗余或归属错误)
- ~~独立 lip sync phase~~ — Seedance 2.0 在 p11 内建,冗余
- ~~分布式多机部署~~ — 归 kais-aigc-platform 仓库

## Out of Scope (v6.0)

| Feature | Reason |
|---------|--------|
| 改动 V5.0 13 步结构(p10b 是插入,不替换 p11) | 蓝图约束 #2 — 不破坏已 ship 的 502 tests |
| 配方库自动应用到管线 | 蓝图约束 — feedback 只更新评分,人决策优先 |
| 真实平台 OAuth 集成(抖音/B站 API) | v6.0 只定义 feedback 接收接口,真实平台对接走 operator 手工导入或 v7.0+ |
| Real-GPU LTX-Video 评测 + 阈值校准 | operator 侧,degraded mocked API 已足够验证编排正确性 |
| 多平台多账号分发系统 | v6.0 只做"数据回流"侧,不做"发布"侧 |
| 重新设计 4 个红线门 | 蓝图约束 #3 — 直接继承 V5.0,不重设计 |
| 预览变体的人工选择 UI | 走 operator CLI(继承 V5.0 bin/finetune-review.js 模式),不做 web UI |

## Traceability

每个 requirement 恰好映射到一个 phase。Phase 40-42 共 3 个 phase。

| Requirement | Phase | Status |
|-------------|-------|--------|
| RAPID-PREVIEW-01 | 40 | Complete |
| RAPID-PREVIEW-02 | 40 | Complete |
| RAPID-PREVIEW-03 | 40 | Pending |
| RAPID-PREVIEW-04 | 40 | Complete |
| RAPID-PREVIEW-05 | 40 | Complete |
| RAPID-PREVIEW-06 | 40 | Pending |
| RAPID-PREVIEW-07 | 40 | Pending |
| RECIPE-LIB-01 | 41 | Pending |
| RECIPE-LIB-02 | 41 | Pending |
| RECIPE-LIB-03 | 41 | Pending |
| RECIPE-LIB-04 | 41 | Pending |
| RECIPE-LIB-05 | 41 | Pending |
| RECIPE-LIB-06 | 41 | Pending |
| FEEDBACK-INGEST-01 | 42 | Pending |
| FEEDBACK-INGEST-02 | 42 | Pending |
| FEEDBACK-INGEST-03 | 42 | Pending |
| FEEDBACK-INGEST-04 | 42 | Pending |
| FEEDBACK-INGEST-05 | 42 | Pending |
| FEEDBACK-INGEST-06 | 42 | Pending |

**Coverage:**
- v6.0 requirements: 19 total (RAPID-PREVIEW ×7, RECIPE-LIB ×6, FEEDBACK-INGEST ×6)
- Mapped to phases: 19
- Unmapped: 0 ✓
- Phase coverage: 40 (rapid preview) → 41 (recipe library) → 42 (feedback ingestion) — 串行依赖,无 parallel track

**Slot Naming Decisions (Phase 40, locked 2026-06-27):**
- `rapid-preview-clips` (JSONL) — renamed from v3.0-era documented `preview-clips` to avoid collision with SKILL.md p06.5 future-slot. Used for per-shot variant records.
- `episode-meta` (JSON) — new slot for episode-level metadata flags (`preview_skipped`). NOT `pipeline-state`, which is a separate `.pipeline-state.json` file managed by PipelineStateStore (NOT an AssetBus slot).

---
*Requirements defined: 2026-06-27*
*Blueprint source: [gsd-v6.0-rapid-convergence.md](./gsd-v6.0-rapid-convergence.md)*
