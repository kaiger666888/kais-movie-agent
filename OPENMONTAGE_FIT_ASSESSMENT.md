# OpenMontage 借鉴建议 Fit-Gap 评估

> 评估对象：`OpenMontage/RESEARCH_REPORT.md` §7.1–7.4 的 4 条高优先级建议
> 评估基准：kais-movie-agent **实际代码**（非研究报告引用的 V8.6 文档）
> 评估日期：2026-06-30
> 评估方法：逆向验证——以代码证据为准，不默认采信研究报告结论

---

## 0. 关键架构事实核对（评估前必须澄清）

研究报告基于 V8.6（13 步、SKILL.md L1-L2-L3-L4），但实际仓库状态已经超出该描述：

| 维度 | 研究报告（V8.6） | 实际代码（2026-06-30） |
|---|---|---|
| Phase 数量 | 13 步 | **20 phases**（`lib/pipeline.js:50-120`） |
| 编排器 | OpenClaw + hermes-agent ACP `sessions_spawn(runtime="acp")` | **Node.js Pipeline 类**（`lib/pipeline.js`），通过 HTTP 调用 Hermes `http://192.168.71.140:8080/decide` 和 `/audit`（`lib/hermes-client.js:57-72`）—**不走 ACP** |
| SKILL.md 状态 | 当前文档 | **顶部已标 HISTORICAL/superseded**（`SKILL.md:6-17`），声明 v5.0 已迁移到 `hermes-agent/skills/kais-movie-pipeline/SKILL.md`——但**该目标文件不存在**（已验证）。SKILL.md 仍是事实 SOT |
| 审核门 | 8 个（Telegram + Toonflow） | **9 个 review phase**（`lib/pipeline.js` 中 `review:` 字段），通过 `_runRemoteReview` 提交到 `192.168.71.140:8090`（`lib/pipeline.js:299-385`） |

**结论**：研究报告的"V8.6 vs OpenMontage"对比框架仍然有效，但具体引用的 phase 编号、调用方式有几处偏差。本评估以**实际代码**为准。

---

## 1. 建议 1：Delivery Promise + 静默降级阻断

### A. kais 现状（代码证据）

kais **已经有非常密集的多层降级守护**——只是没有用 "promise_type" 这个名词包装。

**已有的等价机制：**

1. **每个 phase 都强制标记降级状态**
   - 所有 phase 在 result 里写入 `_degraded: bool`、`_degradeReason: string`、`_selectionMethod: enum`（`first` / `first_degraded` / `llm` / `template`）
   - 例：`lib/phases/index.js:1715-1736` topic-selection，`2480-2533` character-generation，`2828-2876` scene-selection
   - 这是**全管线级别的降级 trail**，比 OpenMontage 的 promise_type 覆盖面更广

2. **`consistency-guard` 是真正的硬阻断**
   - `lib/phases/index.js:3121-3138`：审计未通过 → throw `CONSISTENCY_BLOCKED`，写 `consistency-blocked.json` marker，管线 fail
   - 6 维审计阈值（`lib/continuity-auditor.js:24-31`）：identity_match 0.85 / axis_compliance 1.0 / wardrobe_drift 0 / spatial_consistency 0.8 / plot_continuity 0.8 / scene_spatial_lock 0.8
   - **这正是 OpenMontage `validate_cuts()` 的等价物**——只是一个查 cuts vs promise，一个查 visuals vs L1 锚点

3. **`composition` 是质量门控阻断**
   - `lib/phases/index.js:1486-1494`：`overallScore < thresholds.overall` → throw `QUALITY_GATE_FAILED`
   - 唯一的 escape hatch 是 `degradedMode === true` 显式开关（用于 E2E 测试）

4. **`_runImmediateConsistencyAudit` 是即时重试队列**
   - `lib/phases/index.js:277-320`：每次出图后立即审，score < 0.7 推入 `retry_shots[]`
   - 比 OpenMontage edit 阶段 validate_cuts 更早介入（生成阶段就拦截）

5. **`cloud-production` 隐式承诺了"动效视频用 omni_reference"**
   - `lib/phases/index.js:144-155`：`strategy: 'omni_reference'`、`identity_weight: 0.7`、`use_omni_reference: true`、`max_retries: 3`
   - 这是配置级别的 promise，但**没有在下游 validate**

**真正的 gap：**
- 没有"跨阶段一致性校验"——`script-lock` 阶段没有显式记录 `promise_type` 字段，`cloud-production` 之前没有 validator 函数检查"如果 promise 是 motion_led 但运镜列表里 ≥50% 是静态图则阻断"
- `cloud-production` 当前在 `final-production` handler 里（`lib/phases/index.js:1270-1369`），优先走 Wan I2V，失败降级到云端——**这个降级路径没有 promise 守护**：如果原本承诺 omni_reference 但 Wan I2V 兜底成功，最终视频可能一致性不达标却仍放行

### B. Fit 评估：**中**

| 维度 | 分析 |
|---|---|
| 架构哲学 | OpenMontage 是"agent 自由创作 + 代码强约束"——必须有显式 promise 否则 agent 会自作主张。kais 是"hermes 专家配置驱动 + 守护网拦截"——`HERMES_DEFAULTS` 已经是事实 promise（如 `cloud-production` 的 `strategy: 'omni_reference'`），只是没有升格为契约 |
| 技术栈 | OpenMontage 的 `lib/delivery_promise.py` 是 Python class，依赖 dataclass。kais 是 JS，可以做成纯函数 + JSON schema，迁移成本低 |
| 运行模式 | OpenMontage agent 每次决策都要重读 promise；kais 是确定 phase 流，promise 可以在 script-lock 一次性写入并随 state.json 流转，下游 phase 直接读 |

**核心洞察**：研究报告说"kais 没有纵向贯穿 proposal→edit→compose 的契约"——**部分正确**。kais 有 `HERMES_DEFAULTS` 横向配置，但确实没有"用户期望 → 渲染前验证"的纵向契约。然而，**kais 的 `consistency-guard` BLOCKING + `composition` QUALITY_GATE_FAILED 已经覆盖了 OpenMontage validate_cuts 80% 的实际效果**。剩下的 20% 是"防止用户要动效视频但管线默默退化成图片轮播"——这个 specific gap 真实存在。

### C. 引入成本

| 项 | 改动 |
|---|---|
| 新增文件 | `lib/delivery-promise.js`（~80 行，定义 promise_type 枚举 + validatePromise(shots, promise)） |
| 修改 `script-lock` handler | `lib/phases/index.js:2898-2981`，增加 `promise_type` 字段写入（5 行） |
| 修改 `cloud-production` handler | `lib/phases/index.js:1270` 之前增加 `validatePromise()` 调用（10 行） |
| 依赖 | 无新依赖 |
| 架构冲突 | 无——可以完全不动现有 _degraded/CONSISTENCY_BLOCKED 机制，纯叠加 |

总改动：约 100 行，1-2 天工作量。

### D. 最终判定：**⚠️ 有条件引入**

**条件：**
1. **不要引入 OpenMontage 的 8 种 promise_type 全集**——多数（data_explainer / avatar_presenter / localization 等）对短剧不适用。**只引入 3 种**：`motion_led`（终版视频 multimodal2video）/ `story_led`（multiframe2video 多图故事）/ `hybrid`。这正好对应 SKILL.md L263-266 的 Step 10 三模式。
2. **不要新建独立的 validator phase**——把 `validatePromise()` 调用塞进 `consistency-guard` 即可（已经是 BLOCKING 性质的 phase）
3. **promise_type 由 hermes 决定，不是用户手选**——通过 `_hermesDecide(hermes, 'script-lock', ...)` 已有的流（`lib/phases/index.js:2907`）让 hermes 在 script-lock 阶段自动分类

**收益**：填补"动效承诺被偷偷降级"这个 20% 的真实 gap，与现有 `CONSISTENCY_BLOCKED` 形成两道防线。

---

## 2. 建议 2：Decision Log（决策审计日志）

### A. kais 现状（代码证据）

kais **已经有 decision trail，只是不叫这个名字**。

**已有的等价机制：**

1. **Hermes `/decide` + `/audit` HTTP 流（核心）**
   - `lib/phases/index.js:233-257`：`_hermesDecide()` 调 `client.decide(phase, context)` 返回 `{ decision_id, params, confidence, experts_consulted }`
   - `_hermesAudit()` 异步调 `client.audit(phase, decisionId, metrics, parametersUsed)` 上报结果
   - **每个 phase 都走这条流**——`requirement-bible`（L574）、`soul-visual`（L645）、`composition`（L1390）、`consistency-guard`（L2993）、`script-lock`（L2907）、`cloud-production`（L1281）等 20+ 处
   - 决策数据已经持久化到 Hermes 后端，带 `decision_id`、`experts_consulted`、`confidence`、`metrics`、`parameters_used`——**这几乎就是 OpenMontage decision_log 的 schema**

2. **`selection_method` 是 choice point 审计**
   - 每个 selection phase（topic/outline/script/character/scene）都记录 `first` / `first_degraded` / `llm` / `template`
   - 例：`lib/phases/index.js:1715` topic-selection，`2480-2520` character-generation
   - 这覆盖了 OpenMontage "selected + reason" 字段

3. **ReviewPlatformClient 是用户决策审计**
   - `lib/pipeline.js:299-385`：每个 review gate 提交到外部审核平台，写入 `review_id`、`routing`、`riskScore: 0.5`
   - state.json 里保留 `awaiting_review` + `review_id`（如 `.pipeline-state.json` 多处可见）

4. **candidates 全归档**
   - SKILL.md L186-189：所有未选中备选存档到 `candidates/<step>/`，标记 `selected`、`score`、`reason`

5. **EvaluationCollector（GPU/任务级审计）**
   - 每个 phase 调用 `collector.record({ phase, task_type, gpu_time_sec, success, retry_count, hermes_decision_id, parameters_used })`
   - 例：`lib/phases/index.js:1255-1266` ai-preview，`1357-1368` final-production

**真正的 gap：**
- **没有集中的、文件级、人可读的 `decision-log.json`**——审计数据分散在三处：(a) Hermes 后端数据库，(b) `.pipeline-state.json` 各 phase result，(c) `candidates/` 文件夹
- **没有 `options_considered[]` 数组结构**——selection phase 只记 `selection_method`，不显式列出"考虑过的其他选项"
- **没有"前端可视化查询界面"**——回溯失败时必须 grep 多个 JSON

### B. Fit 评估：**中**

| 维度 | 分析 |
|---|---|
| 架构哲学 | OpenMontage 的 `options_considered ≥ 2` 是为了防止 agent 偷懒只产 1 个候选——**kais 用 hermes 专家，专家本身已经被 prompt 强制产出多候选**（topic×10、outline×3、script×3、character 6 选 1、scene 12 选 4 等，见 SKILL.md L174-184）。强制 ≥2 options_considered 在 kais 是**冗余约束** |
| 技术栈 | OpenMontage 用 JSON Schema 强制校验。kais 可以用同方式（lib/state/ 已有目录），低复杂度 |
| 运行模式 | OpenMontage agent 每阶段读 decision_log 做下游决策。kais phase 间通过 AssetBus + .pipeline-state.json 传递，**不需要 decision_log 作为运行时依赖**——它纯粹是观测/审计用途 |

**核心洞察**：研究报告说"kais 没有统一决策审计 trail"——**表述不准确**。Hermes `/decide` + `/audit` 流就是 trail，而且比 OpenMontage 更细粒度（带 experts_consulted、confidence）。真正的 gap 是**"没有把分散数据聚合为人可读的视图"**，这是 UX 问题，不是 schema 问题。

### C. 引入成本

| 项 | 改动 |
|---|---|
| 新增 schema | `lib/state/decision-log.json`（schema 定义 + 累积写入函数，~150 行） |
| 改 20 个 phase handler | 每个 phase 在 `_hermesAudit` 调用旁追加 `_appendDecisionLog(phase, decisionId, options, selected, reason)`（每处 3-5 行，共 ~100 行） |
| 集中查询脚本 | `bin/decision-log.js`（输出某次 run 的所有决策，~80 行） |
| 依赖 | 无新依赖 |
| 架构冲突 | **中等冲突**：现有 `selection_method` + scorer 流是"机器选 + 用户审"，强制 ≥2 options_considered 会要求改写 scorer 输出结构 |

总改动：约 330 行，3-5 天工作量。

### D. 最终判定：**⚠️ 有条件引入**

**条件：**
1. **不要照搬 OpenMontage 的 15 类决策**——精简为 kais 适用的 6 类：`topic_selection` / `outline_selection` / `script_selection` / `character_selection` / `scene_selection` / `degradation_approval`
2. **不要强制 `options_considered ≥ 2`**——kais 的 character-generation 是"6 候选 → scorer 选 top-3"模式（`lib/phases/index.js:383-444` `_generateL1Anchors`），不是 OpenMontage 的"≥2 options_considered"模式。强制改写会破坏现有 scorer 闭环。改为"`options_considered` 字段可空，但 selection_method 必填"
3. **优先做查询界面，而非重新落 schema**——决策数据已经在 Hermes 后端。最高 ROI 是写一个 `bin/decision-log.js <traceId>` CLI 聚合 Hermes API + .pipeline-state.json + candidates/ 三处数据，输出 Markdown 报告
4. **decision_log.json 作为派生产物**——在每个 phase 完成后由 `_hermesAudit` 顺手追加，**不做强 schema 校验**，避免给已经稳定的 20 phase 增加复杂度

**收益**：失败回溯体验显著提升，但**不是 kais 当前最痛的 gap**——优先级排第 3。

---

## 3. 建议 3：三层知识架构（tools/skills/.agents 分离）

### A. kais 现状（代码证据）

1. **单一 SKILL.md（868 行）确实是知识大杂烩**
   - `SKILL.md:1-868` 混合了：(a) OpenClaw/ACP 编排合约（已过时），(b) dreamina CLI 6 个命令用法（L95-106），(c) 13 步管线流程图（L195-274），(d) hermes-agent 16 个 expert 调用模板（L300-410），(e) 多剧集容量计算（L422-451），(f) L1-L4 角色资产库原理（L454-509），(g) Toonflow 同步合约（L511-685），(h) gold-team API（L688-764）……

2. **hermes-agent 已经做了"专家知识分离"**
   - `/home/kai/workspace/hermes-agent/skills/` 目录按领域分（apple / creative / media / research / ...）
   - 但**目标文件 `hermes-agent/skills/kais-movie-pipeline/SKILL.md` 不存在**（已验证）——v5.0 迁移公告是"未兑现的承诺"

3. **lib/ 已经有工具级模块化**
   - `lib/shot-list-parser.js`、`lib/prompt-injector.js`、`lib/reference-prompt-builder.js`、`lib/continuity-auditor.js` 等都是独立的"工具契约 + 知识"模块
   - 这已经是 Layer 1（工具契约）的雏形

4. **dreamina CLI 没有独立的工具契约文档**
   - 用法散落在 SKILL.md L95-106（6 行）+ L486-507（代码示例）+ `lib/jimeng-client.js`（deprecated 注释 L479）
   - 真正的"dreamina CLI 怎么写好 prompt"知识在 expert `prompt_injector` 里（hermes-agent 侧），不在 kais-movie-agent 侧

### B. Fit 评估：**高（但已被 v5.0 公告预先消化）**

| 维度 | 分析 |
|---|---|
| 架构哲学 | 三层架构（工具/惯例/技术）的分离原则 universally 正确。**kais 的 hermes-agent + lib/ 拆分天然就是 Layer 1+Layer 2**，只是缺 Layer 3（外部技术知识包，如"中文短剧创作理论 SOTA 论文"） |
| 技术栈 | OpenMontage Layer 3 用 `.agents/skills/` 装 skills.sh 下载的 47 个外部包。kais 没有等价机制，但 hermes-agent 的 skills 体系已经具备类似能力（只是没有 kais 专属包） |
| 运行模式 | OpenMontage agent 按需读 Layer 3，**kais 不依赖 agent 主动读文档**——phase handler 是确定性代码，expert 调用通过 HTTP，**文档只对人/调试有用，不参与运行时决策** |

**核心洞察**：研究报告的建议**方向正确但已经 in flight**——SKILL.md 顶部明确写了 v5.0 迁移到 hermes-agent/skills/kais-movie-pipeline/，只是目标文件还没建。**这条建议的本质是"完成已经开始的迁移"**，而非"引入新设计"。

### C. 引入成本

| 项 | 改动 |
|---|---|
| 新建目录 | `hermes-agent/skills/kais-movie-pipeline/`（按 OpenMontage 结构建 `director/` + `expert/` + `tool/` 子目录） |
| 拆分 SKILL.md | 把 868 行拆为：(a) `tool/dreamina-cli.md`（~80 行），(b) `tool/hermes-experts.md`（~100 行），(c) `director/step-01-topic.md` 等 13 个 step director（每个 50-100 行），(d) `index.md` 总入口（~50 行） |
| 新增 Layer 3 | `hermes-agent/skills/kais-movie-pipeline/theory/`（中文短剧创作理论、共鸣点公式、L1-L4 一致性算法 SOTA 摘要） |
| 改动代码 | 0 行（纯文档重构） |
| 依赖 | 无 |
| 架构冲突 | **低**——纯文档；但需要决定历史 SKILL.md 是删除还是保留为 V8.6 reference（目前是保留） |

总改动：约 1500-2000 行 Markdown，2-3 天工作量（纯写作）。

### D. 最终判定：**⚠️ 有条件引入**

**条件：**
1. **先确认 v5.0 迁移是否仍在进行**——如果 hermes-agent 团队已经在做 `kais-movie-pipeline/` 目录，本建议与之协调避免重复劳动
2. **不要照搬 OpenMontage 的 Layer 3 概念（.agents/skills/ 外部包）**——kais 是垂直短剧系统，外部技术包（remotion/gsap/lottie 等）不需要；改为把中文短剧特有知识（共鸣点 10 维、L1 锚点黄金标准、对话密度阈值）作为 Layer 3 内容
3. **dreamina CLI 工具契约必须分离**——这是当前 SKILL.md 最大痛点。`tool/dreamina-cli.md` 应该包含 6 个命令的 input/output schema、超时、重试、失败模式，让 phase handler 代码可独立查阅
4. **保留 V8.6 SKILL.md 作为 reference**——按现有顶部 HISTORICAL 标注的方式，不删除

**收益**：长期可维护性提升，**但短期没有立即价值**——管线运行不依赖文档。优先级排第 4（最后做）。

---

## 4. 建议 4：Slideshow Risk 评分

### A. kais 现状（代码证据）

**这是 4 条建议中 gap 最大的。**

kais 已有的评分体系：

| 评分系统 | 维度 | 评分对象 | 文件 |
|---|---|---|---|
| `quality-gate.js` | hook / structure / realism / title_cover / duration / engagement（6 维） | **剧本文本** | `lib/quality-gate.js:16-23` |
| `script-auditor.js` | plot_coherence / dialogue_quality / character_arc / pacing / three_act_compliance + consistency_violations（5+1 维） | **剧本文本** | `lib/script-auditor.js:18-24` |
| `continuity-auditor.js` | identity_match / axis_compliance / wardrobe_drift / spatial_consistency / plot_continuity / scene_spatial_lock（6 维） | **生成图 vs L1 锚点** | `lib/continuity-auditor.js:24-31` |
| `murch-scoring.js` | emotion / story / rhythm / eye_trace / plane_2d / space_3d（Murch Rule of Six） | **成品视频帧** | `lib/murch-scoring.js:22-29` |
| `_runImmediateConsistencyAudit` | 单图 identity_match（一维） | **每张生成图** | `lib/phases/index.js:277-320` |

**真正的 gap——"分镜列表层面的视觉多样性评分"完全缺失：**
- `shot_size_diversity`（全片中/近/特写比例）——**不存在**。`SHOT_SIZE_CN` 字典在 `lib/phases/index.js:4266` 只是显示用，没有统计
- `scene_location_diversity`（场景切换频率）——**不存在**
- `character_screen_time_balance`——**不存在**
- `emotion_arc_coverage`——剧本层有（script-auditor character_arc），但**分镜层无**
- `dialogue_density`——**不存在**
- `establishing_shot_presence`——**不存在**

**核心洞察**：研究报告这条建议完全 fit——kais 现有评分都在"文本"或"图/视频帧"维度，**没有任何机制守卫"分镜列表看起来丰富但实际剪出来视觉单调"这种失败模式**。这是短剧最常见的失败：剧本通过 + 一致性通过 + 但成片全是中景对话，观众 30 秒划走。

### B. Fit 评估：**高（最干净的 fit）**

| 维度 | 分析 |
|---|---|
| 架构哲学 | OpenMontage slideshow_risk 输入 cuts 列表输出 6 维评分。kais 的 `spatio-temporal-script` phase（`lib/pipeline.js:82-84`）已经产出 `sts-script.json` 含完整 shots 数组——**输入数据已就绪** |
| 技术栈 | OpenMontage 用 Python dataclass。kais 用 JS 纯函数即可，零依赖 |
| 运行模式 | kais 有 `consistency-guard`（BLOCKING）作为现成的集成点——把 slideshow_risk 评分塞进同一 phase，复用 BLOCKING 机制，零额外架构 |

**核心洞察**：这是 4 条建议中**架构匹配度最高**的。输入（sts-script.shots）已有，输出（评分 + verdict）格式有先例（continuity-auditor），集成点（consistency-guard BLOCKING）现成。

### C. 引入成本

| 项 | 改动 |
|---|---|
| 新增 `lib/slideshow-risk.js` | ~180 行（6 维评分函数 + verdict 阈值） |
| 集成到 `consistency-guard` handler | `lib/phases/index.js:3046-3091`，在 `auditContinuity` 后追加 `assessSlideshowRisk(stsScript.shots)`（15 行） |
| 阈值配置 | `lib/phases/index.js:138-143` `HERMES_DEFAULTS['consistency-guard']` 加 slideshow 阈值（5 行） |
| 测试 | `tests/slideshow-risk.test.js`（~80 行，构造单调 shots 列表验证阻断） |
| 依赖 | 无新依赖 |
| 架构冲突 | 无 |

总改动：约 280 行，2-3 天工作量。

### D. 最终判定：**✅ 推荐引入**

**实施要点：**
1. **维度短剧特化**（不要照搬 OpenMontage 通用维度）：
   - `shot_size_diversity`： shots 中 shot_size 枚举分布熵，阈值 > 0.6（参考短剧黄金分布：近景 40% / 中景 30% / 特写 20% / 远景 10%）
   - `scene_location_diversity`：location 去重数 / 总 shot 数，阈值 > 0.3（每 3 镜换场景）
   - `character_screen_time_balance`：主角出场时长 / 总时长，阈值 0.4-0.7（过低无主角感，过高单调）
   - `dialogue_density`：dialogue line 数 / 总时长（秒），阈值 0.5-2.0 line/sec
   - `establishing_shot_presence`：每个 scene_id 切换处是否有 establishing shot 标记
   - `motion_hint_coverage`： shots 中带 motion_hint（推/拉/摇/移）的比例，阈值 > 0.4（呼应建议 1 的 promise_type）
2. **集成方式**：在 `consistency-guard` 已有的 BLOCKING 流里追加 slideshow 评分，verdict < 2.0（strong）放行，< 3.0（acceptable）警告，≥ 4.0（fail）throw `SLIDESHOW_RISK_BLOCKED`
3. **score 由 hermes 决定**：维度权重通过 `_hermesDecide(hermes, 'consistency-guard', ...)` 已有流，让 hermes 根据短剧类型（职场/情感/悬疑）动态调权

**收益**：填补 4 条建议中**最真实的 gap**。现有 quality-gate（文本）+ continuity-auditor（视觉一致性）+ slideshow-risk（分镜多样性）将形成完整的"文本 → 视觉 → 节奏"三层质量守护。

---

## 5. 优先级总结

| 建议 | Fit | 真实 gap | 成本 | 判定 | 优先级 |
|---|---|---|---|---|---|
| 4. Slideshow Risk | 高 | **大**（分镜多样性完全无守护） | 280 行 / 2-3 天 | ✅ 推荐引入 | **P0** |
| 1. Delivery Promise | 中 | 中（20% gap，现有守护已覆盖 80%） | 100 行 / 1-2 天 | ⚠️ 有条件引入 | **P1** |
| 2. Decision Log | 中 | 小（已有 trail，只是无聚合视图） | 330 行 / 3-5 天 | ⚠️ 有条件引入 | **P2** |
| 3. 三层知识架构 | 高（已 in flight） | 中（文档分散，但 v5.0 迁移已规划） | 1500-2000 行 Markdown / 2-3 天 | ⚠️ 有条件引入 | **P3** |

## 6. 关键架构判断（超脱单条建议）

研究报告在结语中说"OpenMontage 把质量、可审计性、防止降级这些软性概念编码为可执行规则"——**这个总结方向正确，但低估了 kais 已经做了多少**。

**实际差距**：
- 防止降级：kais 已经有 `CONSISTENCY_BLOCKED` + `QUALITY_GATE_FAILED` + `_runImmediateConsistencyAudit` 三层阻断（`lib/phases/index.js:3121`、`1486`、`277`），不输 OpenMontage
- 可审计性：kais 通过 Hermes `/decide` + `/audit` 流（`lib/hermes-client.js:57-72`）+ EvaluationCollector 已经有完整的决策+性能 trail，**只是缺前端聚合视图**
- 质量守护：kais 在文本（quality-gate + script-auditor）+ 视觉一致性（continuity-auditor）+ 视频（murch-scoring）三层都有评分，**唯一缺口是分镜多样性**（slideshow risk）

**给 kais 团队的建议**：不要把这份研究报告当作"kais 缺很多东西"的诊断——它是"从外部看 kais 没看到内部守护网"的视角偏差。**真正值得引入的只有建议 4（slideshow risk）**，其他三条要么已有等价机制（建议 1、2），要么已经在迁移路上（建议 3）。

中文短剧的垂直专业化（L1-L4 资产库、共鸣点 10 维、hermes 专家系统）是 kais 的护城河——这些是 OpenMontage 没有的，也不需要为了"通用化"放弃。
