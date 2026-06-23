# Roadmap: kais-movie-agent 集成开发

## Milestones

- ✅ **v1.0 AIGC Integration** — Phases 1-9 (shipped 2026-05-18)
- 🚧 **v2.0 Pipeline Remediation** — Phases 10-17 (in progress)

## Overview

v2.0 止血 + 工业化整改:修复 v1.0 遗留的 P0 架构断裂(PHASES 数组与 phaseHandlers 严重错位、Hermes 闭环失效、一致性审计造假、质量门控默认 80% 兜底)与 P1 工业化缺失(镜头级并行未生效、GPU 任务无阻塞、CompositionEngine shell 注入风险、无成本核算)。8 个 phase 按"架构对齐 → 质量实化 → 工程安全 → 端到端验证"的依赖顺序推进,目标是跑通首支 60s 短剧成片。

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked INSERTED)
- v1.0 占用 Phase 1-9,v2.0 从 Phase 10 开始(连续编号,不复位)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 10: PHASES/handler 架构对齐** - 补完 15 个空 handler 骨架 + 清理 V2_MIGRATION_MAP stale 引用
- [ ] **Phase 11: Hermes ID 对齐** - VALID_PHASES 与新 PHASES 同步,全 20 阶段 decide/audit 解锁
- [ ] **Phase 12: 一致性审计实化** - _getDINOv2Score 接 GLM-4V 真实打分 + auditImageVsL1 即时触发
- [ ] **Phase 13: 质量门控实化** - 删除 quality-gate.js 默认 80% 兜底,LLM 失败立即标异常
- [ ] **Phase 14: character-generation 真实实现** - CharacterAssetManager + L1 候选 20 选 3 + L2 造型卡片
- [ ] **Phase 15: 镜头级并行 + 工程安全** - parallel_shots Promise.all + waitForTask 阻塞 + CompositionEngine execFile 重写
- [x] **Phase 16: 成本核算 + 重试预算** - cost-report.json 聚合 + max_retries 自适应
- [x] **Phase 17: E2E 端到端验证** - 跑通 1 集 60s 短剧产出 final.mp4 + v1.0 回归

## Phase Details

### Phase 10: PHASES/handler 架构对齐
**Goal**: 让 pipeline 的 phaseHandlers 与 PHASES 数组 100% 对齐,每个阶段都有可执行的业务逻辑骨架
**Depends on**: Nothing (first phase of v2.0; v1.0 Phase 9 已 shipped)
**Requirements**: ARCH-01, ARCH-03
**Success Criteria** (what must be TRUE):
  1. `phaseHandlers` 的 top-level 键覆盖 PHASES 数组的全部 20 个 id(20/20 对齐)
  2. 调用 pipeline 跑到任意新阶段(pain-discovery/topic-selection/outline-generation/script-generation/character-generation/scene-generation/script-lock/consistency-guard/cloud-production/final-audio/delivery)不再因缺 handler 抛 "no handler" 错误,而是执行业务逻辑或显式降级
  3. `V2_MIGRATION_MAP` 中不再引用 PHASES 中已不存在的 legacy ID,且每个旧→新映射的目标 ID 在 PHASES 数组中能找到
  4. 单元测试覆盖 phaseHandlers 路由(对每个新 id 调用 handler 后,断言返回结构或降级日志),`npm test` 通过
**Plans**: 3 plans

Plans:
- [x] 10-01-PLAN.md — 补完 15 个 V6 stub handler (ARCH-01)
- [x] 10-02-PLAN.md — V2_MIGRATION_MAP 审计与清理 (ARCH-03) ✓ 2026-06-23
- [x] 10-03-PLAN.md — 单元测试覆盖 (ARCH-01 SC-4)

### Phase 11: Hermes ID 对齐
**Goal**: Hermes 决策/审计闭环对所有 20 个新阶段开放,不再因 VALID_PHASES 白名单缺失而静默失败
**Depends on**: Phase 10
**Requirements**: ARCH-02
**Success Criteria** (what must be TRUE):
  1. `HermesClient.VALID_PHASES`(或服务端开放枚举)包含全部 20 个新 PHASES id,任意新阶段调用 `client.decide(phase)` 不再被前端校验拒绝
  2. 跑 pipeline 时,各新阶段的 console 日志能看到 `[hermes] ✅ <phase> 决策` 或显式 "decide 失败,使用默认" 的降级日志,而不是 "invalid phase" 静默吞错
  3. Hermes audit 回调(decisionId 非 null 时)对新阶段也生效,可在 Hermes 服务端看到 20 个阶段的 audit 记录
**Plans**: TBD

Plans:
- [ ] 11-01: TBD

### Phase 12: 一致性审计实化
**Goal**: 一致性守护从"假数据 `return 0.85`"变成真实视觉模型打分,并在场景图/分镜首帧生成后即时触发审计
**Depends on**: Phase 10 (consistency-guard handler 存在)
**Requirements**: QUAL-01, QUAL-03, QUAL-04
**Success Criteria** (what must be TRUE):
  1. `_getDINOv2Score` 调用智谱 GLM-4V 或 gold-team DINOv2 接口返回真实分数,源码中不再出现硬编码 `return 0.85`(或等价假数据)
  2. `consistency-guard` 阶段实际调用 `auditContinuity()`,当 shot 一致性分数低于阈值时阻断该 shot 进入下一阶段,不再 silent pass
  3. `auditImageVsL1` 在场景图生成(scene-generation)与分镜首帧生成(seed-skeleton)完成后即时触发,分数 < 0.7 的资产标记并触发重试
  4. 跑一次包含明显不一致资产(如换装/换脸)的样本 pipeline,能在 `consistency-pass.json` 中看到非空的不通过项与重试记录
**Plans**: TBD

Plans:
- [ ] 12-01: TBD

### Phase 13: 质量门控实化
**Goal**: 质量门控拒绝"假通过"——LLM 评分失败时立即标记异常,不再用 `Math.round(max * 0.8)` 兜底伪造分数
**Depends on**: Phase 10 (composition handler 存在)
**Requirements**: QUAL-02
**Success Criteria** (what must be TRUE):
  1. `quality-gate.js` 中 `Math.round(meta.max * 0.8)`(或等价兜底)被删除,LLM 评分失败时 score 字段为 null 或抛 `QUALITY_GATE_FAILED`,而不是伪造一个 80% 分数
  2. 跑一次故意让 LLM 评分接口超时/报错的 pipeline,能在质量报告中看到"评分异常"标记,而不是 80 分通过
  3. 正常 LLM 评分路径不受影响,合格资产的分数仍在 quality-report.json 中正确产出
**Plans**: TBD

Plans:
- [ ] 13-01: TBD

### Phase 14: character-generation 真实实现
**Goal**: character-generation 阶段实际产出可用的角色资产(L1 身份锚点 20 选 3 + L2 造型卡片),不再只是空 handler
**Depends on**: Phase 10 (character-generation handler 骨架存在)
**Requirements**: ARCH-04
**Success Criteria** (what must be TRUE):
  1. `character-generation` handler 调用 `CharacterAssetManager` 生成 L1 身份锚点候选(默认 20 张),并按 `l1_quality_threshold` 筛选保留前 3 张
  2. L2 造型卡片(compositions API)在 L1 锚点基础上生成多视角/多服装参考图,产物写入 `assets/characters/`
  3. 角色资产包含 golden standard 检测字段(如 face_embedding_hash、costume_fingerprint),可供 Phase 12 一致性审计比对
  4. 跑 character-generation 阶段后,`character-candidates.json` 包含真实图像路径而非空数组
**Plans**: TBD

Plans:
- [ ] 14-01: TBD

### Phase 15: 镜头级并行 + 工程安全
**Goal**: parallel_shots 真正生效,GPU 任务同步阻塞,CompositionEngine 防注入
**Depends on**: Phase 10 (cloud-production handler 存在)
**Requirements**: PERF-01, PERF-02, SAFE-01, SAFE-02, SAFE-03
**Success Criteria** (what must be TRUE):
  1. `parallel_shots: 4` 在 cloud-production 阶段实际发起 4 个 `Promise.all` 并发 GPU 任务,可在日志看到 4 个 task_id 几乎同时提交(而非串行)
  2. GPU 任务通过 `waitForTask` 阻塞 pipeline(轮询间隔 5s,超时 10min),"提交即 completed" 的虚假同步被删除
  3. `CompositionEngine.compose()` 使用 `execFile(file, args[])`,源码中不再出现 shell 字符串拼接
  4. FFmpeg 输入路径与 filter_complex 字段经 sanitize,包含 `"`, `` ` ``, `$`, `;` 的路径被拒绝并报错(单元测试覆盖)
  5. CompositionEngine fallback 中的二次字符串拼接降级链被删除,失败即抛错
**Plans**: TBD

Plans:
- [ ] 15-01: TBD

### Phase 16: 成本核算 + 重试预算
**Goal**: 单集 GPU 成本可量化,镜头级失败有自适应重试预算
**Depends on**: Phase 15 (并行与阻塞基础设施就绪)
**Requirements**: PERF-03, PERF-04
**Success Criteria** (what must be TRUE):
  1. `evaluation-collector` 聚合单集所有 GPU 任务的 gpu_time_sec / peak_vram_gb,产出 `cost-report.json`(按阶段、按 task_type 分组)
  2. 跑完一集 pipeline 后 `cost-report.json` 存在且非空,包含总 GPU-分钟数
  3. 镜头级失败重试预算从硬编码 `max_retries: 1` 改为自适应(默认 3,可按 phase 配置),连续失败的镜头在重试耗尽后被跳过并标记
**Plans**: TBD

Plans:
- [x] 16-01: cost-retry (4 commits — aggregateForEpisode + runWithRetry + delivery real + HERMES upgrade)

### Phase 17: E2E 端到端验证
**Goal**: 至少 1 集 60s 短剧从 requirement 阶段跑到 final.mp4 产出,且 v1.0 的 9 phases 不被破坏
**Depends on**: Phase 10, Phase 11, Phase 12, Phase 13, Phase 14, Phase 15, Phase 16 (整改全部就绪)
**Requirements**: E2E-01, E2E-02, E2E-03, E2E-04
**Success Criteria** (what must be TRUE):
  1. 跑通 1 集 60s 短剧:从 pain-discovery 到 delivery 全 20 阶段无 fatal error,pipeline 退出码 0
  2. `projects/<new-project>/final.mp4` 存在、可播放、时长 ≈ 60s,且包含 wav 音轨
  3. 一致性审计在 E2E 中实际触发并产出非空 `consistency-pass.json`(不是空对象,不是 silent pass)
  4. 回归测试:v1.0 的 9 个 legacy phase(requirement-bible, soul-visual, soul-voice, geometry-bed, spatio-temporal-script, seed-skeleton, motion-preview, ai-preview, final-production)仍能跑通,相关测试套件通过
**Plans**: TBD

Plans:
- [x] 17-01: E2E degraded-mode test + runbook (3 commits — 7 E2E tests + 3 Rule-1 bug fixes + E2E-RUNBOOK.md)

## Progress

**Execution Order:**
Phases execute in numeric order: 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17
(Phase 12/13/14 可在 Phase 11 后部分并行,但建议按编号顺序执行以降低集成风险)

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 10. PHASES/handler 架构对齐 | v2.0 | 3/3 | Complete   | 2026-06-23 |
| 11. Hermes ID 对齐 | v2.0 | 0/? | Not started | - |
| 12. 一致性审计实化 | v2.0 | 0/? | Not started | - |
| 13. 质量门控实化 | v2.0 | 0/? | Not started | - |
| 14. character-generation 真实实现 | v2.0 | 0/? | Not started | - |
| 15. 镜头级并行 + 工程安全 | v2.0 | 0/? | Not started | - |
| 16. 成本核算 + 重试预算 | v2.0 | 1/1 | Complete | 2026-06-23 |
| 17. E2E 端到端验证 | v2.0 | 0/? | Not started | - |

---

<details>
<summary>✅ v1.0 AIGC Integration (Phases 1-9) — SHIPPED 2026-05-18</summary>

- [x] Phase 1: GoldTeamClient 创建
- [x] Phase 2: Review Client 降级逻辑
- [x] Phase 3: Voice Phase 集成 GoldTeamClient
- [x] Phase 4: 多候选审核调用改造
- [x] Phase 5: art-direction FLUX 图像生成 (4A.2)
- [x] Phase 6: camera VIDEO_FINAL 视频生成 (4A.5)
- [x] Phase 7: voice VOICE_CLONE/CONVERT (4A.6)
- [x] Phase 8: post-production MUSIC/SFX (4A.7)
- [x] Phase 9: lip-sync LIP_SYNC_RT (4A.8)

</details>
