# Requirements: v5.0 Hermes-Native Migration

**Defined:** 2026-06-25
**Core Value:** hermes-agent 单一编排引擎 — 13 步短剧管线成为 hermes-agent 原生 skill,直连 kais-aigc-platform,openclaw 完全退出短剧创作流程。
**Milestone:** v5.0 — Phases 31-39 (9 phases)

## v5.0 Requirements

需求分 5 大族,覆盖 v5.0 的全部交付面。每个 REQ-ID 映射到恰好一个 phase(见 Traceability)。

### HERMES-SKILL — 顶层编排 skill 落地

- [ ] **HERMES-SKILL-01**: `hermes-agent/skills/kais-movie-pipeline/SKILL.md` 存在,带合法 YAML frontmatter(name/description/version/prerequisites/metadata.hermes.related_skills),正文定义 13 步 DAG + 触发词 + 与 15 个 movie-experts 的协作图
- [ ] **HERMES-SKILL-02**: Python runner(`pipeline/runner.py`)实现 13 phase 顺序执行 + checkpoint resume + episode 级并行(parallel_shots: 4 保持 v2.0 行为)
- [ ] **HERMES-SKILL-03**: 13 个 phase 模块(`pipeline/phases/p01_hook_topic.py` 到 `p13_delivery.py`)各自:从 asset bus 读输入 → 调 movie-expert(通过 `delegate_task`)→ 写输出到 asset bus → 触发审核门(如配置)
- [ ] **HERMES-SKILL-04**: skill 被 hermes-agent loader 发现,可通过 `/kais-movie-pipeline` slash command 或 `skill_view(name="kais-movie-pipeline")` 工具调用
- [ ] **HERMES-SKILL-05**: `references/` 下产出 4 篇参考文档:pipeline-dag.md(13 步依赖图)、review-gates.md(8 gate 规范)、asset-bus-schema.md(slot 类型+生命周期)、expert-mapping.md(phase ↔ movie-expert 映射表)

### GPU-DIRECT — kais-aigc-platform Python 客户端

- [ ] **GPU-DIRECT-01**: `plugins/kais_aigc/gold_team.py` 实现 GoldTeamClient — POST `:8002/api/v1/tasks` + X-API-Key 认证 + 17 task type(image_draw/image_refine/video_final/wan_i2v/tts_zh/tts_en/tts_bilingual/upscale/face_restore/image_pulid/controlnet_depth/image_to_3d/image_to_3d_mv 等) + async polling + batch + SSE events + 降级
- [x] **GPU-DIRECT-02**: `plugins/kais_aigc/review_platform.py` 实现 ReviewPlatformClient — JWT bearer 认证 + POST `/api/v1/reviews` + GET `/api/v1/reviews/{id}` 状态轮询 + HMAC-SHA256 callback 验签 + 5min timestamp window
- [x] **GPU-DIRECT-03**: `plugins/kais_aigc/canvas.py` 实现 CanvasClient — HTTP API v2(`:10588/api/canvas/v2/save-v2`)+ loadGraph 只读 + degrade-tolerant(保留 v4.0 PIPE-INTEGRITY-01 修复,无 sqlite 直写)
- [ ] **GPU-DIRECT-04**: `plugins/kais_aigc/jimeng.py` 实现 JimengClient — jimeng-free-api `:5100` + 6 subcommand(text2image/image2image/multimodal2video/multiframe2video/frames2video/image_upscale) + session rotation + exponential backoff(替代已 deprecated 的 dreamina CLI)
- [x] **GPU-DIRECT-05**: 4 个 client 都有 degrade-mode(服务不可达 → warn + 跳过/fallback,不阻塞管线),配置走 env vars(KAIS_GOLD_TEAM_URL / KAIS_REVIEW_URL / KAIS_CANVAS_URL / KAIS_JIMENG_URL + 对应 API key/JWT secret),测试覆盖 mocked HTTP
- [x] **GPU-DIRECT-06**: `kais_aigc` plugin 在 hermes-agent plugin loader 注册成功,暴露统一工具面(kais_gold_team_submit / kais_review_submit / kais_canvas_sync / kais_jimeng_call),orchestration skill 可通过 hermes-agent tool dispatch 调用

### GATE-NATIVE — HIL 审核门框架

- [ ] **GATE-NATIVE-01**: `plugins/review_gates/gate.py` 定义 Gate 生命周期(submit → wait → resolve),支持 blocking(pipeline 暂停等待)/ webhook(HMAC callback)/ polling(主动拉)三种模式
- [ ] **GATE-NATIVE-02**: V8.6 管线的 8 个审核门定义为 YAML/JSON 配置(gate_id / phase / asset-bus slots to lock / reviewer role / timeout_sec / callback_url / retry_policy)
- [ ] **GATE-NATIVE-03**: Gate 框架与 hermes-agent delegate_task approval callback 集成 — blocking gate 暂停 pipeline runner,webhook gate 通过 review-platform HMAC 回调驱动 resume
- [ ] **GATE-NATIVE-04**: Gate 决议(approve / reject / contest)写回 asset bus(`review-outcomes` slot),触发下一 phase 或回滚到指定 phase(reject with suggested_action)
- [ ] **GATE-NATIVE-05**: Gate 失败达 max_retries 触发 episode-level fail(继承 v4.0 PIPE-GUARD-01 的 CONSISTENCY_BLOCKED 阻塞语义,不再沉默吞错)

### CANVAS-IN-HERMES — Canvas sync 迁入 hermes

- [ ] **CANVAS-IN-HERMES-01**: canvas sync hook 从 Node.js `lib/canvas-sync-hook.js` 迁移到 hermes-agent event subscriber(Python),发布/订阅通过 hermes-agent 内部 event bus
- [ ] **CANVAS-IN-HERMES-02**: canvas sync 在两个时机触发:(a) phase 完成(asset bus 写入新 slot),(b) gate 决议(approve 后写入正式节点)— 不再走 openclaw Toonflow
- [x] **CANVAS-IN-HERMES-03**: canvas client 仅走 HTTP API v2(`:10588/api/canvas/v2/save-v2`),不直读 sqlite(保留 v4.0 PIPE-INTEGRITY-01 修复),不可达时 degrade warn
- [ ] **CANVAS-IN-HERMES-04**: E2E 验证 — openclaw 进程未运行时,phase 完成 / gate 通过后 :10588 仍能收到 canvas 更新(证明完全脱离 openclaw)

### OPENCLAW-REMOVE — 彻底解耦 + 清理

- [ ] **OPENCLAW-REMOVE-01**: `grep -ri "openclaw\|OpenClaw\|sessions_spawn(runtime=\"acp\")\|Toonflow"` 在 `hermes-agent/skills/kais-movie-pipeline/`、`hermes-agent/plugins/kais_aigc/`、`hermes-agent/plugins/pipeline_state/`、`hermes-agent/plugins/review_gates/` 下 0 命中
- [ ] **OPENCLAW-REMOVE-02**: `kais-movie-agent/DEPRECATED.md` 更新为 v5.0 final deprecation notice,指向 hermes-agent 新位置 + 迁移指南
- [ ] **OPENCLAW-REMOVE-03**: v5.0 所有交付物无 Node.js runtime 依赖(纯 Python + hermes-agent runtime),`package.json` 不再被新代码引用
- [ ] **OPENCLAW-REMOVE-04**: E2E 测试 — openclaw 进程 OFF + gold-team/review/jimeng 服务 mock,跑通 13 phase 产出 `master.mp4`(degraded mode,继承 v4.0 PIPE-COMPOSE-01)
- [ ] **OPENCLAW-REMOVE-05**: `.planning/milestones/v5.0-MILESTONE-AUDIT.md` 文档化 0 openclaw 引用 + 解耦验证清单 + 9 phase 验收 trace

## v6.0+ Requirements (Out of Current Scope)

继承自 PROJECT.md `Next Milestone Goals (v6.0+)`,v5.0 不实现:
- 上游 creative_history lineage retrofit(TD-v3-1)
- 多模型 A/B 测试(Runway/Kling/Sora)
- 多平台导出(抖音/B站/YouTube)
- 多语言 dubbing(HeyGen)
- 字幕生成 + 烧录 + 多语言 SRT
- 独立 lip sync phase(sync.so / HeyGen)
- 分布式多机部署
- hermes-agent dashboard 内嵌管线可视化

## Out of Scope (v5.0)

| Feature | Reason |
|---------|--------|
| 保留 Node.js lib/* 作为长期生产路径 | v5.0 完成后 kais-movie-agent 归档,不再演进 |
| Node.js subprocess 桥接(混合方案) | 用户明确选择全部 Python 重写,避免双运行时维护成本 |
| 真实 GPU E2E 验证(operator 侧) | 继承自 v3.0/v4.0,degraded E2E 已足够验证编排正确性 |
| 重写 15 个 movie-experts | 已存在于 hermes-agent/skills/movie-experts/,无需迁移 |
| TypeScript 迁移 / CI/CD | v5.0 范围已满,留给 v6.0+ |
| 重写 kais-aigc-platform 服务本身 | 平台保持现状,v5.0 只重写客户端 |

## Traceability

每个 requirement 恰好映射到一个 phase。Phase 31-39 共 9 个 phase。

| Requirement | Phase | Status |
|-------------|-------|--------|
| HERMES-SKILL-01 | 35 | Pending |
| HERMES-SKILL-02 | 35 | Pending |
| HERMES-SKILL-03 | 35 (p01-p03) + 36 (p04-p13) | Pending |
| HERMES-SKILL-04 | 35 | Pending |
| HERMES-SKILL-05 | 35 (dag+gates skeleton) + 36 (refined per phase) | Pending |
| GPU-DIRECT-01 | 32 | Pending |
| GPU-DIRECT-02 | 32 | Complete |
| GPU-DIRECT-03 | 32 | Complete |
| GPU-DIRECT-04 | 32 | Pending |
| GPU-DIRECT-05 | 32 | Complete |
| GPU-DIRECT-06 | 31 (loader) + 32 (clients wired) | Complete |
| GATE-NATIVE-01 | 34 | Pending |
| GATE-NATIVE-02 | 34 | Pending |
| GATE-NATIVE-03 | 34 | Pending |
| GATE-NATIVE-04 | 34 | Pending |
| GATE-NATIVE-05 | 34 | Pending |
| CANVAS-IN-HERMES-01 | 37 | Pending |
| CANVAS-IN-HERMES-02 | 37 | Pending |
| CANVAS-IN-HERMES-03 | 32 (client) + 37 (hook) | Complete |
| CANVAS-IN-HERMES-04 | 39 (E2E verify) | Pending |
| OPENCLAW-REMOVE-01 | 38 | Pending |
| OPENCLAW-REMOVE-02 | 38 | Pending |
| OPENCLAW-REMOVE-03 | 38 | Pending |
| OPENCLAW-REMOVE-04 | 39 | Pending |
| OPENCLAW-REMOVE-05 | 39 | Pending |

**Coverage:**
- v5.0 requirements: 25 total
- Mapped to phases: 25
- Unmapped: 0 ✓
- Phase coverage: 31 (foundation) → 32 (backend) → 33 (state) → 34 (gates) → 35 (skill skeleton) → 36 (full port) → 37 (canvas) → 38 (decouple) → 39 (audit)

---
*Requirements defined: 2026-06-25*
*Last updated: 2026-06-25 after initial v5.0 milestone definition*
