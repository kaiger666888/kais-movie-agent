# Roadmap: kais-movie-agent 集成开发

## Milestones

- ✅ **v1.0 AIGC Integration** — Phases 1-9 (shipped 2026-05-18)
- ✅ **v2.0 Pipeline Remediation** — Phases 10-18 (shipped 2026-06-22) — [Archive](./milestones/v2.0-ROADMAP.md)
- ✅ **v3.0 Industrial Pipeline Alignment** — Phases 19-25 (shipped 2026-06-23) — [Archive](./milestones/v3.0-ROADMAP.md)
- ✅ **v4.0 Production Pipeline Remediation** — Phases 26-30 (shipped 2026-06-24) — [Archive](./milestones/v4.0-ROADMAP.md)
- 🚧 **v5.0 Hermes-Native Migration** — Phases 31-39 (started 2026-06-25) — **ACTIVE**

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

### v5.0 Hermes-Native Migration (Phases 31-39) — ACTIVE

- [x] **Phase 31: Plugin Skeleton + Hermes-Agent Wiring** — 3 plugins (kais_aigc / pipeline_state / review_gates) scaffolding + manifests + loader 注册 + smoke imports
- [ ] **Phase 32: Kais-AIGC Platform Backend (Python clients)** — 4 Python clients (gold_team/review_platform/canvas/jimeng) with auth + degrade + mocked HTTP tests + plugin tool surface
- [ ] **Phase 33: Pipeline State & Asset Bus** — Python port of PipelineStateStore + AssetBus V3 (typed slots + envelope + atomic write) + CreativeHistoryTracker DAG + BFS
- [ ] **Phase 34: Review Gate Framework** — HIL gate lifecycle (submit/wait/resolve) + 3 modes + 8 gate YAML config + delegate_task approval + max_retries fail
- [ ] **Phase 35: Orchestration Skill Skeleton (vertical slice)** — SKILL.md + runner.py + p01/p02/p03 end-to-end + delegate_task to movie-experts + asset bus I/O + gate trigger
- [ ] **Phase 36: Remaining 10 Phases Port** — p04_character_design through p13_delivery ported, each load/gather/execute/write/gate
- [ ] **Phase 37: Canvas Sync Migration** — canvas sync hook Node → Python event subscriber, fires on phase completion + gate resolution
- [ ] **Phase 38: OpenClaw Decoupling + Docs Cleanup** — 0 openclaw refs in v5.0 deliverables + DEPRECATED.md + no Node runtime dependency
- [ ] **Phase 39: E2E Validation + v5.0 Audit** — openclaw OFF degraded E2E produces master.mp4 + v5.0-MILESTONE-AUDIT.md

**Critical path:** 31 → 32 → 35 → 36 → 38 → 39 (main spine); 33 (state) ∥ 34 (gates) partial parallel after 31; 37 (canvas) follows 35.

## Phase Details

### Phase 31: Plugin Skeleton + Hermes-Agent Wiring

**Goal**: v5.0 三大新插件 (`kais_aigc` / `pipeline_state` / `review_gates`) 骨架就位,hermes-agent plugin loader 能发现并注册,smoke imports 跑通,为 Phase 32/33/34 提供可填充的外壳
**Depends on**: Nothing (first v5.0 phase — foundation for all of 32/33/34)
**Requirements**: GPU-DIRECT-06 (loader registration half — manifests valid + loader discovers plugins; client tool bodies filled in Phase 32)
**Plans**: 3 plans (31-01 scaffolding, 31-02 loader registration verification, 31-03 smoke tests)

Plans:
- [x] 31-01-PLAN.md — Scaffold 3 plugins (plugin.yaml + __init__.py + tools.py + README.md each)
- [x] 31-02-PLAN.md — Loader discovery + enable tests (PluginManager integration, 9 tests)
- [x] 31-03-PLAN.md — Per-plugin smoke tests (import + register + tool surface + stub returns, 15 tests)

**Success Criteria** (what must be TRUE):
1. `hermes-agent/plugins/kais_aigc/`、`pipeline_state/`、`review_gates/` 三目录均含合法 `plugin.yaml` manifest(name/version/description/provides_tools 字段齐全) — **research correction**: hermes-agent loader only scans for `plugin.yaml`/`plugin.yml`, NOT `plugin.json`; see CONTEXT.md CRITICAL-FINDING-01 — **MET (31-01)**
2. hermes-agent plugin loader 启动时三个插件注册成功(无 import error,日志可见"plugin loaded"),可在 hermes-agent session 中通过 tool registry 列出 plugin 暴露的 tool name — **MET (31-02)**: 9 loader-discovery integration tests pass against real `PluginManager.discover_and_load()`; `HERMES_PLUGINS_DEBUG=1` shows 3 "Parsed manifest" log lines; tools==4 per plugin when added to `plugins.enabled`
3. 三个 plugin 的 entry module 可被 `python -c "import ..."` smoke-import(无 syntax error、无 missing dependency) — **MET (31-03)**: 15 per-plugin smoke tests pass (5 per plugin × 3 plugins) in 0.22s; the literal SC#3 check (`subprocess.run([sys.executable, "-c", "from plugins.<name> import register; print(callable(register))"])` exits 0 with stdout `True`) is encoded as `test_python_dash_c_import_succeeds` in each smoke file
4. Phase 32/33/34 三个交付 phase 各自的 plan 可在此基础上独立填充(骨架目录结构与 v5.0 仓库 layout target 一致) — **MET (31-01 interface-first schemas)**

**UI hint**: no

---

### Phase 32: Kais-AIGC Platform Backend (Python clients)

**Goal**: 4 个 Python 客户端(gold_team / review_platform / canvas / jimeng)实现完整 auth + degrade + mocked HTTP tests,kais_aigc plugin 暴露统一 tool surface 供 orchestration skill 通过 hermes-agent tool dispatch 调用 — 取代 Node.js lib/* + openclaw 中间层
**Depends on**: Phase 31（plugin 骨架就位,客户端填入 tool body）
**Requirements**: GPU-DIRECT-01, GPU-DIRECT-02, GPU-DIRECT-03 (client half — CanvasClient HTTP v2 + loadGraph read-only + degrade), GPU-DIRECT-04, GPU-DIRECT-05, GPU-DIRECT-06 (wiring half — tool bodies filled + dispatch verified)
**Plans**: TBD

**Success Criteria** (what must be TRUE):
1. `gold_team.py` 能对 mocked `:8002/api/v1/tasks` 提交 17 类 task(image_draw / video_final / wan_i2v / tts_zh 等)、async polling 拿到结果、batch 多任务聚合、SSE events 接收,X-API-Key 认证头正确
2. `review_platform.py` 能对 mocked `/api/v1/reviews` 提交审核、轮询 `/api/v1/reviews/{id}` 状态、验证 HMAC-SHA256 callback 签名(5min timestamp window 内接受,超窗拒绝)
3. `canvas.py` 走 HTTP API v2(`:10588/api/canvas/v2/save-v2`)saveGraph,loadGraph 只读,服务不可达时 degrade warn(保留 v4.0 PIPE-INTEGRITY-01 修复,无 sqlite 直写)
4. `jimeng.py` 支持 6 subcommand(text2image / image2image / multimodal2video / multiframe2video / frames2video / image_upscale),session rotation + exponential backoff 生效
5. 4 个 client 都有 degrade-mode(不可达 → warn + fallback,不阻塞),配置走 env vars(KAIS_GOLD_TEAM_URL / KAIS_REVIEW_URL / KAIS_CANVAS_URL / KAIS_JIMENG_URL + API key / JWT secret),orchestration skill 可通过 hermes-agent tool dispatch 调用 kais_gold_team_submit / kais_review_submit / kais_canvas_sync / kais_jimeng_call

**UI hint**: no

---

### Phase 33: Pipeline State & Asset Bus

**Goal**: 将 Node.js lib/* 中的 PipelineStateStore + AssetBus V3 + CreativeHistoryTracker 端口到 Python(pipeline_state plugin),为 HERMES-SKILL-02/03 提供 state 层基础 — 不在 v5.0 REQ 中显式列出(基础设施,隐式支撑 HERMES-SKILL-02/03)
**Depends on**: Phase 31（pipeline_state plugin 骨架就位）
**Requirements**: NONE explicit (foundation for HERMES-SKILL-02 checkpoint resume + HERMES-SKILL-03 phase read/write; design note: derived from v3.0 SCHEMA/B4 capability porting)
**Plans**: TBD

**Success Criteria** (what must be TRUE):
1. `pipeline_state/store.py` 实现 PipelineStateStore — checkpoint save/load,episode 状态可在 phase 间持久化,resume 能从最近 checkpoint 续跑
2. `pipeline_state/asset_bus.py` 实现 AssetBus V3 — 3 typed slots(creative-history / failed-shots / finetune-dataset)+ envelope + atomic write(JSONL append,无半写)
3. `pipeline_state/creative_history.py` 实现 CreativeHistoryTracker DAG + reverse BFS + blast radius cap(行为对齐 v3.0 旗舰:1000-asset BFS < 1ms 量级,改剧本能定位受影响镜头)
4. Python 单元测试覆盖三种数据结构的核心操作(checkpoint resume / slot typed write / DAG BFS traversal),测试基线 ≥ v3.0 对应 Node.js 实现的等价 case 数

**UI hint**: no

---

### Phase 34: Review Gate Framework

**Goal**: HIL 审核门框架就位 — 8 个 V8.6 gate 定义为 YAML 配置,Gate 生命周期(submit → wait → resolve)支持 blocking / webhook / polling 三模式,与 hermes-agent delegate_task approval callback 集成,max_retries 触发 episode fail
**Depends on**: Phase 31（review_gates plugin 骨架）+ Phase 32（review_platform.py 提供 webhook callback 客户端,blocking gate 的 HMAC 驱动 resume）
**Requirements**: GATE-NATIVE-01, GATE-NATIVE-02, GATE-NATIVE-03, GATE-NATIVE-04, GATE-NATIVE-05
**Plans**: TBD

**Success Criteria** (what must be TRUE):
1. `review_gates/gate.py` 实现 Gate 生命周期(submit → wait → resolve),三种模式可切换:blocking(pipeline runner 暂停等待)/ webhook(HMAC callback 驱动 resume)/ polling(主动拉 `/api/v1/reviews/{id}`)
2. V8.6 管线的 8 个审核门定义为 YAML 配置,每 gate 含 gate_id / phase / asset-bus slots to lock / reviewer role / timeout_sec / callback_url / retry_policy 字段齐全
3. blocking gate 暂停 pipeline runner,webhook gate 通过 review-platform HMAC 回调驱动 runner resume;两种路径都有可观察的"暂停 → 等待 → 唤醒"行为(mocked review-platform 即可验证)
4. Gate 决议(approve / reject / contest)写回 asset bus `review-outcomes` slot,approve 触发下一 phase,reject(with suggested_action)触发回滚到指定 phase
5. Gate 失败达 max_retries 触发 episode-level fail(throw + 标记 episode failed,继承 v4.0 PIPE-GUARD-01 CONSISTENCY_BLOCKED 阻塞语义,不再沉默吞错)

**UI hint**: no

---

### Phase 35: Orchestration Skill Skeleton (vertical slice)

**Goal**: 顶层编排 skill 骨架就位 — SKILL.md 合法 + runner.py + 前 3 phase(p01_hook_topic / p02_outline / p03_script_audit)端到端跑通,wired 到 movie-experts via delegate_task,读写 asset bus,触发 gate;hermes-agent loader 发现 skill,可通过 slash command / skill_view 调用
**Depends on**: Phase 32（4 个 client 就位）+ Phase 33（state/asset bus 就位）+ Phase 34（gate 框架就位）
**Requirements**: HERMES-SKILL-01, HERMES-SKILL-02 (runner.py 顺序执行 + checkpoint resume + parallel_shots 4), HERMES-SKILL-03 (p01-p03 only — load expert / gather inputs / execute / write outputs / trigger gate), HERMES-SKILL-04, HERMES-SKILL-05 (skeleton — pipeline-dag.md + review-gates.md + asset-bus-schema.md + expert-mapping.md 初版)
**Plans**: TBD

**Success Criteria** (what must be TRUE):
1. `hermes-agent/skills/kais-movie-pipeline/SKILL.md` 存在,YAML frontmatter 合法(name / description / version / prerequisites / metadata.hermes.related_skills),正文定义 13 步 DAG + 触发词 + 与 15 个 movie-experts 的协作图
2. `pipeline/runner.py` 实现 13 phase 顺序执行 + checkpoint resume(中断后续跑)+ episode 级并行(parallel_shots: 4 保持 v2.0 行为)
3. p01_hook_topic / p02_outline / p03_script_audit 三个 phase 模块各自完成完整生命周期:从 asset bus 读输入 → delegate_task 调对应 movie-expert → 写输出到 asset bus → 触发对应 gate(如配置),三个 phase 在 mocked 环境跑通
4. skill 被 hermes-agent loader 发现,可通过 `/kais-movie-pipeline` slash command 或 `skill_view(name="kais-movie-pipeline")` 工具调用,返回 SKILL.md 元信息
5. `references/` 下 4 篇文档初版存在(pipeline-dag.md / review-gates.md / asset-bus-schema.md / expert-mapping.md),为 Phase 36 完整化奠定结构

**UI hint**: no

---

### Phase 36: Remaining 10 Phases Port

**Goal**: p04_character_design 到 p13_delivery 共 10 个 phase 模块全部 ported,每个 phase 完成完整生命周期(load expert / gather inputs / execute / write outputs / trigger gate),完整 13 步管线在 Python 运行
**Depends on**: Phase 35（p01-p03 模板就位,runner 已能调度 phase）
**Requirements**: HERMES-SKILL-03 (p04-p13 — 剩余 10 phase 各自完成生命周期), HERMES-SKILL-05 (refined per-phase docs — references/ 4 篇文档根据实际 port 经验完整化)
**Plans**: TBD

**Success Criteria** (what must be TRUE):
1. p04_character_design / p05_pain_discovery / p06_spatio_temporal_script / p07_scene_generation / p08_scene_selection / p09_shot_breakdown / p10_voice / p11_video_render / p12_composition / p13_delivery 十个 phase 模块各自存在且实现完整生命周期(读 asset bus → delegate expert → 写 asset bus → 触发 gate)
2. 行为对齐 Node.js lib/* V8.6 handler — 每个 phase 的输入读取、expert 调用参数、输出 slot 名、gate 触发时机与 kais-movie-agent 现有 Node.js 实现等价(reference port,非 re-design)
3. runner.py 能顺序调度 p01-p13 全 13 phase(mocked client 环境),中间任意 phase 后 checkpoint,kill runner 重启后能 resume 到正确 phase
4. references/ 4 篇文档完整化 — pipeline-dag.md(13 步依赖图)、review-gates.md(8 gate 规范含实际触发 phase)、asset-bus-schema.md(slot 类型 + 生命周期 + 各 phase 读写契约)、expert-mapping.md(13 phase ↔ movie-expert 完整映射表)

**UI hint**: no

---

### Phase 37: Canvas Sync Migration

**Goal**: canvas sync hook 从 Node.js `lib/canvas-sync-hook.js` 迁移到 hermes-agent Python event subscriber,phase 完成 / gate 决议两时机触发,完全脱离 openclaw Toonflow
**Depends on**: Phase 35（skill 就位,有 phase completion 事件可订阅;gate 决议事件来自 Phase 34）
**Requirements**: CANVAS-IN-HERMES-01, CANVAS-IN-HERMES-02, CANVAS-IN-HERMES-03 (hook half — canvas.py HTTP-only 在 Phase 32 已就位,本 phase 实现 event subscriber 触发逻辑)
**Plans**: TBD

**Success Criteria** (what must be TRUE):
1. canvas sync hook 从 Node.js 迁移到 hermes-agent Python event subscriber,发布/订阅通过 hermes-agent 内部 event bus(无 Node.js 运行时依赖)
2. canvas sync 在两个时机触发:(a) phase 完成(asset bus 写入新 slot),(b) gate 决议 approve 后写入正式节点 — 两个触发点都有可观察的 HTTP `:10588` save-v2 调用(mocked canvas 即可验证)
3. canvas client 仅走 HTTP API v2,不直读 sqlite(保留 v4.0 PIPE-INTEGRITY-01 修复),canvas 不可达时 degrade warn(不阻塞 phase 推进)

**UI hint**: no

---

### Phase 38: OpenClaw Decoupling + Docs Cleanup

**Goal**: v5.0 所有交付物 0 openclaw 引用残留,DEPRECATED.md 更新,新代码无 Node.js runtime 依赖
**Depends on**: Phase 36（全 13 phase port 完成,代码定型）+ Phase 37（canvas 已迁完,不再有 openclaw 依赖路径）
**Requirements**: OPENCLAW-REMOVE-01, OPENCLAW-REMOVE-02, OPENCLAW-REMOVE-03
**Plans**: TBD

**Success Criteria** (what must be TRUE):
1. `grep -ri "openclaw\|OpenClaw\|sessions_spawn(runtime=\"acp\")\|Toonflow"` 在 `hermes-agent/skills/kais-movie-pipeline/`、`plugins/kais_aigc/`、`plugins/pipeline_state/`、`plugins/review_gates/` 四个 v5.0 交付目录下 0 命中
2. `kais-movie-agent/DEPRECATED.md` 更新为 v5.0 final deprecation notice — 指向 hermes-agent 新位置 + 迁移指南(skill 路径 / plugin 路径 / 行为等价性说明)
3. v5.0 所有交付物(4 目录)无 Node.js runtime 依赖(纯 Python + hermes-agent runtime),`package.json` 不再被新代码 import / require / subprocess 调用

**UI hint**: no

---

### Phase 39: E2E Validation + v5.0 Audit

**Goal**: openclaw 进程 OFF + 服务 mock 环境下,13 phase degraded E2E 产出 master.mp4,v5.0-MILESTONE-AUDIT.md 文档化完整解耦验证 + 9 phase 验收 trace — v5.0 ship 决策点
**Depends on**: Phase 38（解耦完成,代码冻结）
**Requirements**: CANVAS-IN-HERMES-04, OPENCLAW-REMOVE-04, OPENCLAW-REMOVE-05
**Plans**: TBD

**Success Criteria** (what must be TRUE):
1. E2E 验证 — openclaw 进程未运行时,phase 完成 / gate 通过后 :10588 仍能收到 canvas 更新(证明完全脱离 openclaw)
2. E2E 验证 — openclaw 进程 OFF + gold-team / review / jimeng 服务 mock,跑通全 13 phase 产出 `master.mp4`(degraded mode,继承 v4.0 PIPE-COMPOSE-01)
3. `.planning/milestones/v5.0-MILESTONE-AUDIT.md` 文档化:0 openclaw 引用 grep 结果 + 解耦验证清单(4 目录 × 多种 openclaw 关键词)+ 9 phase 验收 trace(每 phase SC 验证证据)+ 测试基线

**UI hint**: no

---

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 31. Plugin Skeleton + Hermes-Agent Wiring | 2/3 | In Progress|  |
| 32. Kais-AIGC Platform Backend | 0/TBD | Not started | - |
| 33. Pipeline State & Asset Bus | 0/TBD | Not started | - |
| 34. Review Gate Framework | 0/TBD | Not started | - |
| 35. Orchestration Skill Skeleton | 0/TBD | Not started | - |
| 36. Remaining 10 Phases Port | 0/TBD | Not started | - |
| 37. Canvas Sync Migration | 0/TBD | Not started | - |
| 38. OpenClaw Decoupling + Docs | 0/TBD | Not started | - |
| 39. E2E Validation + v5.0 Audit | 0/TBD | Not started | - |

## Cross-cutting Constraints

- **Phase numbering continues from v4.0** (Phase 30) — v5.0 starts at Phase 31, do NOT reset
- **零 Node.js runtime 依赖** in v5.0 deliverables (纯 Python + hermes-agent runtime per OPENCLAW-REMOVE-03)
- **降级优先** contracts preserved — every external call (gold-team / review / canvas / jimeng) has degrade path (GPU-DIRECT-05)
- **行为对齐** — Phase 36 port 必须与 Node.js lib/* V8.6 行为等价(reference port,非 re-design)
- **保留 v4.0 修复** — canvas HTTP API v2(PIPE-INTEGRITY-01)+ consistency-guard 阻塞语义(PIPE-GUARD-01)在 Python port 中保留
- **不重写已存在资产** — `hermes-agent/skills/movie-experts/` 15 expert skills 消费 as-is,`kais-aigc-platform` 微服务栈保持现状,v5.0 只写新客户端

---

*Roadmap active milestone: v5.0 Hermes-Native Migration (started 2026-06-25)*
*Phase numbering: continues from v4.0 Phase 30 — v5.0 spans Phase 31-39*
