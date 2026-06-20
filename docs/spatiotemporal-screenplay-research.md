# 时空剧本（Spatiotemporal Screenplay）深度调查报告

> 调查日期：2026-06-19
> 调查范围：电影理论、AI 视频管线实践、hermes-agent 专家系统、kais-movie-agent 13步管线
> 调查目的：诊断"时空剧本"概念在管线中的定义清晰度、功能边界、重叠/断裂问题

---

## 目录

1. [学术/行业定义](#一学术行业定义)
2. [与传统分镜/场面调度的区别](#二与传统分镜场面调度的本质区别)
3. [AI 视频管线中的类似实践](#三ai-视频管线中的类似实践)
4. [hermes-agent 现有专家能力分析](#四hermes-agent-现有专家能力分析)
5. [问题诊断](#五问题诊断)
6. [优化建议](#六优化建议)

---

## 一、学术/行业定义

### 1.1 "时空剧本"在传统电影理论中并非标准术语

经过对中外电影理论文献的广泛搜索，**"时空剧本"（spatiotemporal screenplay / space-time screenplay）在主流电影理论中并非一个独立的标准术语**。它更接近一个**复合实践概念**，融合了以下传统理论维度：

| 传统概念 | 核心关注 | 代表理论家 |
|----------|---------|-----------|
| **电影时空性** | 电影是时间与空间融合的艺术，非"时间+空间"的简单相加 | Deleuze（《电影1: 运动-影像》《电影2: 时间-影像》）、Bordwell（认知电影学）|
| **场面调度（Mise-en-scène）** | 画面内一切可见元素的安排：布景、灯光、角色位置、构图 | 弗朗索瓦·特吕弗、帕拉斯玛（《肌肤之目》）|
| **蒙太奇理论** | 通过剪辑创造时空关系——不仅是叙事工具，更是思维工具 | 爱森斯坦（碰撞蒙太奇）、巴赞（长镜头时空连续性）|
| **剧本格式（Screenplay）** | 标准电影剧本：场景标题（INT./EXT.）、动作描述、对白、转场标记 | 菲尔德、麦基（《故事》）、斯奈德（《救猫咪》）|

### 1.2 "时空剧本"在中文语境下的用法

中文电影学界（北京电影学院、符号学论坛等）讨论"电影时空"时，指的是：

> "电影的时空并非独立时间和独立空间的相加，而是具有渗透融合了时间性和空间性的时空性的独立范畴。" —— 符号学论坛

这更多是**理论分析框架**（分析已完成电影中的时空表达），而**不是创作工具**（不是一种剧本格式或预制作文档类型）。

### 1.3 kais-movie-agent 中的自定义概念

在 kais-movie-agent 管线中，"时空剧本"被**自定义为一个结构化中间产物**，其实质是：

> **在基础剧本（文字对白+场景描述）之上，为每个场景附加精确的时间轴（秒级 beat 分配）、空间关系（角色位置/运动/朝向）、镜头列表（景别/运动/机位）、因果链（场景间事件依赖）和情绪曲线（强度/效价/主导情绪）的五维结构化 JSON。**

这一定义**不在任何标准电影理论文献中存在**，而是 AI 制作管线特有的产物——因为传统电影制作中，这些维度分散在多个角色（导演、分镜师、场记、摄影指导）的工作中，不需要统一为一个机器可读的中间文档。

### 1.4 结论

"时空剧本"是 kais-movie-agent 的**自创术语**，融合了传统电影制作中多个角色的职能。它在 AI 管线中有工程合理性，但命名为"时空剧本"容易与传统电影理论概念混淆。

---

## 二、与传统分镜/场面调度的本质区别

### 2.1 四维度对比

| 维度 | 传统剧本 (Screenplay) | 分镜板 (Storyboard) | 场面调度 (Mise-en-scène) | 时空剧本 (Spatiotemporal Script) |
|------|----------------------|--------------------|-----------------------|-------------------------------|
| **核心载体** | 文字（对白+动作描述）| 图像（逐镜头手绘/数字）| 现场执行（导演+摄影+美术）| 结构化 JSON（时间+空间+因果+情绪）|
| **时间精度** | 场景级（不精确到秒）| 镜头级（估算时长）| 实时（拍摄当下决定）| **秒级/0.5秒级**（beat 级精度）|
| **空间信息** | 文字描述（INT. 办公室 - 夜）| 画面构图（2D 静帧）| 现场布局（3D 物理）| **结构化坐标**（zone/movement/facing）|
| **角色位置** | 进出场提示 | 静态构图中的位置 | 演员走位（blocking）| **时间序列位置变化**（at_sec → zone + movement）|
| **镜头信息** | 无 | **每镜头一张图**（景别+构图+角度）| 不涉及（摄影指导现场决定）| **镜头列表 JSON**（shot_type/movement/position/focus）|
| **因果链** | 隐含在叙事中 | 不涉及 | 不涉及 | **显式标注**（cause→effect, 强度 0-1）|
| **情绪标注** | 隐含在台词/动作中 | 不涉及 | 演员表演传递 | **数值化曲线**（intensity/valence/dominant_emotion）|
| **谁产出** | 编剧 | 分镜师（与导演协商）| 导演（现场）| **LLM 一次性生成** |
| **谁消费** | 导演/制片/全剧组 | 摄影/美术/特效 | 演员/摄影 | **下游 AI 子 Skill**（场景设计/运镜/一致性）|

### 2.2 本质区别

**时空剧本 vs 传统分镜板：**
- 分镜板是**视觉产物**（每镜头一张图），时空剧本是**结构化数据**（JSON）
- 分镜板解决"画面长什么样"，时空剧本解决"时间怎么分配、空间怎么组织、角色怎么移动"
- 分镜板依赖人类画师的经验和审美，时空剧本依赖 LLM 的空间推理能力

**时空剧本 vs 场面调度：**
- 场面调度是**现场执行层面的美学决策**（灯放哪、演员站哪、摄影机怎么动）
- 时空剧本是**预制作层面的结构化规划**，为 AI 生成提供机器可读的约束
- 场面调度的核心是"美学判断"，时空剧本的核心是"数据结构化"

**时空剧本 vs 运镜列表（Shot List）：**
- 运镜列表关注**镜头本身**（景别、运动方式、焦段）
- 时空剧本包含镜头列表，但还额外包含时间轴、因果链、情绪曲线
- 时空剧本是运镜列表的超集

### 2.3 定位

"时空剧本"在传统电影制作流程中没有精确对应物。它最接近的类比是：

**导演 Notebook + 场记时间表 + 镜头清单 + 情绪板 的融合体，被压缩为一个机器可读的 JSON 文件。**

这在传统制作中是不需要的（因为这些信息分散在多个人的脑子里和笔记本上），但在 AI 制作管线中是必需的（因为 LLM 需要一次性接收所有上下文才能生成连贯的视觉/音频产出）。

---

## 三、AI 视频管线中的类似实践

### 3.1 主流 AI 视频模型的 Workflow 调查

| 模型/平台 | 是否有"时空剧本"步骤 | 实际做法 |
|-----------|---------------------|---------|
| **Sora 2** | 无独立步骤 | 支持 60s 多镜头序列生成，但镜头编排完全在 prompt 文本中描述，无结构化中间层 |
| **Kling O3** | 有"多镜头故事板"概念 | 支持 4-6 镜头故事板模式（multi-shot storyboard），自动生成 blocking + camera setups，但仅限镜头级，无因果链/情绪曲线 |
| **Runway Gen-4.5** | 无 | 提供 Director Mode（镜头运动控制），但无场景级时空规划 |
| **Veo 3.1** | 无 | 声画同步生成，但无预制作结构化规划层 |
| **Seedance 2.0** | 无 | 多帧驱动视频生成，帧间时空连贯性由模型内部保证 |

### 3.2 AI 视频管线的典型 Workflow

基于搜索和行业实践，2026 年主流 AI 视频制作管线通常包含以下步骤：

```
1. 剧本/故事概念 → text prompt
2. 角色一致性参考图 → IP-Adapter / LoRA
3. 场景参考图 → ControlNet / img2img
4. 分镜帧生成 → text2image（每镜头首帧）
5. 视频生成 → image2video / text2video（逐镜头）
6. 剪辑 → 拼接 + 转场
7. 音频 → TTS + BGM + SFX
```

**关键发现：主流 AI 视频管线中，步骤 1→4 之间没有独立的"时空剧本"层。** 大多数管线是 prompt → 直接生成，跳过了时空规划。

### 3.3 为什么 kais-movie-agent 需要时空剧本层

尽管主流管线没有这一步，kais-movie-agent 引入它有合理的工程理由：

1. **多角色一致性** — 需要明确每个角色在每个时间点位于何处，避免 LLM 生成冲突
2. **场景去重** — 时间轴让场景图生成系统知道哪些镜头共享同一场景
3. **情绪驱动视觉** — 情绪曲线驱动下游色彩/光影/音乐风格
4. **因果链验证** — 检查叙事逻辑是否自洽（因果倒置、断裂）
5. **审核门结构化** — 给用户提供结构化的审核材料，而非纯文字

### 3.4 Kling 多镜头故事板 vs 时空剧本对比

Kling O3 的 multi-shot storyboard 是目前行业最接近"时空剧本"的概念：

| 维度 | Kling Storyboard | kais 时空剧本 |
|------|-----------------|--------------|
| 格式 | 平台内嵌（非开放 JSON）| 开放 JSON |
| 时间精度 | 镜头级（3-15s/镜头）| beat 级（0.5s）|
| 角色位置 | 自动 blocking（不暴露给用户）| 显式 JSON（zone/movement/facing）|
| 因果链 | 无 | 有 |
| 情绪曲线 | 无 | 有 |
| 镜头设计 | AI 自动 + 用户微调 | LLM 生成 + 用户审核 |
| 目标用户 | 快速预览（pre-viz）| 完整制作管线中间层 |

**结论：kais 时空剧本在功能上是 Kling Storyboard 的超集，但也因此承担了更多的"中间件"复杂度。**

---

## 四、hermes-agent 现有专家能力分析

### 4.1 相关专家清单与职责

| 专家 | expert_id | 核心职责 | 输出格式 |
|------|-----------|---------|---------|
| **剧本专家** | `screenplay` | 场景级剧本生成、对白设计、情感弧线构建 | `script.json`（scenes[] + dialogue[] + emotion_curve + hooks/payoffs/cliffhangers）|
| **镜头专家** | `cinematographer` | shot intent 层（景别+构图+轴线+运镜+叙事动机）| `shot_intent.json` + `shot_list.json` + `vertical_framing_intent.json` + 4 个 handoff JSON |
| **剧本审计** | `script_auditor` | 5维定量审计（叙事/情绪/Hook/角色/完播率预测）| `audit_report.json`（5维度×20分 + 完播率预测等级）|
| **剪辑专家** | `editor` | FxRxT 三维剪辑矩阵 + Murch Rule of Six | edit decision list + axis compliance report |
| **场景建构（已废弃）** | `scene_builder` *(deprecated)* | ~~3D 场景建构、camera blocking、空间可行性验证~~ | 已折叠入 cinematographer 的 composition_lock 子任务 |
| **分镜设计（已废弃）** | `storyboard_designer` *(deprecated)* | ~~场景→镜头分解、4D anchoring~~ | 已折叠入 cinematographer |

### 4.2 screenplay 专家输出

`script.json` 包含：
- `scenes[]`：每个场景有 `shot_count`、`emotion_curve`、`dialogue[]`、`sound_mood`、`lighting_mood`、`beat_count`、`value_shifts[]`
- `emotion_curve`：anchor-based 采样（beat transitions / value shifts / hook-pin / 爽点 payoff / 卡点 cliffhanger）
- `hooks[]` / `payoffs[]` / `cliffhangers[]`：HOOK-09 合同闭环

### 4.3 cinematographer 专家输出

`shot_intent.json` + 4 个 handoff：
- 每个 shot 有：shot_scale（8级）、composition（9:16 power points）、axis_line（180° + screen direction）、camera_move（12种 + 4模型 prompt token）、narrative motivation
- composition_lock 子任务（吸收了废弃的 scene_builder 空间可行性验证）

### 4.4 script_auditor 专家输出

`audit_report.json`：
- 5 维度（叙事结构/情绪弧线/Hook 强度/角色网络/完播率预测）各 20 分
- 每个扣分项指向具体场景 + 时间戳 + 改进建议
- 可与发布后真实完播率做 Pearson 验证

### 4.5 时空剧本与各专家的功能矩阵

| 信息维度 | screenplay | cinematographer | script_auditor | editor | **kais 时空剧本** |
|---------|-----------|-----------------|---------------|--------| ---------------|
| 场景对白 | ✅ 核心 | ❌ | 审计 | ❌ | ❌（消费上游）|
| 情绪弧线 | ✅ emotion_curve | ❌ | 审计 | 参考 | ⚠️ **重复**（emotion.curve）|
| 时间轴 | 场景级（beat_count）| ❌ | ❌ | 镜头级（duration）| ✅ **秒级 beat** |
| 镜头列表 | shot_count 估算 | ✅ shot_intent + shot_list | ❌ | 审计 axis | ⚠️ **重复**（camera.shot_list）|
| 角色位置 | ❌ | composition_lock 子任务 | ❌ | ❌ | ✅ character_positions |
| 空间布局 | lighting_mood | composition（构图）| ❌ | ❌ | ✅ location.type/dimensions |
| 因果链 | value_shifts[] | ❌ | 审计 narrative | ❌ | ✅ **独有**（causality.chains）|
| 转场 | ❌ | ❌ | ❌ | FxRxT transition | ✅ **重复**（transitions）|
| 轴线 | ❌ | axis_line + screen_direction | ❌ | 审计 180°/30° | ❌ |
| 完播率预测 | ❌ | ❌ | ✅ 独有 | ❌ | ❌ |

---

## 五、问题诊断

### 5.1 Step 6（时空剧本）与 Step 3（剧本）、Step 8（运镜节奏）的功能重叠

**这是核心问题。** V8.6 管线将"时空剧本"放在 Step 6，其上下游关系是：

```
Step 3: screenplay + script_auditor → 剧本×3 + 5维审计
Step 4: character_designer → 角色资产库
Step 5: cinematographer + style_genome → 场景设计
Step 6: screenplay + cinematographer + script_auditor → 时空剧本+终审  ← 问题步骤
Step 7: visual_executor + prompt_injector → 视觉种子
Step 8: cinematographer + editor → 运镜+节奏
```

#### 5.1.1 Step 3 vs Step 6 的重叠

| 信息 | Step 3 screenplay 输出 | Step 6 时空剧本输出 | 重叠度 |
|------|----------------------|-------------------|--------|
| 场景列表 | ✅ scenes[] | ✅ timeline.scenes[] | **100%** |
| 对白 | ✅ dialogue[] | ❌（不重新生成）| 0% |
| 情绪弧线 | ✅ emotion_curve (anchor-based) | ✅ emotion.curve (scene-level) | **~70%**（粒度不同但数据源相同）|
| 时间分配 | shot_count 估算 | start_sec/end_sec 精确分配 | Step 6 更细 |
| 音/光氛围 | ✅ sound_mood + lighting_mood | ❌ | 0% |

**诊断：Step 3→6 之间存在情绪弧线的重复定义。** screenplay 的 emotion_curve 已经是 anchor-based 精细采样（含 hooks/payoffs/cliffhangers），而时空剧本的 emotion.curve 是 scene-level 粗粒度。两者数据源相同（同一个剧本），只是粒度不同，不构成新增信息。

#### 5.1.2 Step 6 vs Step 8 的重叠

| 信息 | Step 6 时空剧本输出 | Step 8 运镜+节奏输出 | 重叠度 |
|------|-------------------|--------------------|----|
| 镜头列表 | ✅ camera.shot_list（景别/运动/机位/焦点）| ✅ cinematographer shot_intent（8级景别+12运镜+轴线）| **~80%** |
| 节奏/时长 | beat 时间分配 | editor cut-density + duration distribution | **~60%** |
| 转场 | ✅ transitions（into/out_of）| ✅ FxRxT transition mode | **重复** |
| 轴线 | ❌ | ✅ axis_line + screen_direction | Step 8 独有 |

**诊断：Step 6→8 之间存在镜头列表和转场的严重重复。** Step 6 的 `camera.shot_list` 与 Step 8 的 `shot_intent.json` 在功能上高度重叠，但格式和精度不同。Step 8（hermes-agent 专家）的镜头设计远比 Step 6 的 LLM 自由生成更专业（8级景别+12运镜+180°轴线+30°规则+4模型prompt token）。

### 5.2 "时空剧本"概念定义不清晰

**问题 1：命名混淆**
- "时空剧本"暗示这是一种"剧本"格式，但实际上它是一个**结构化中间数据文件**，不包含对白和动作描述
- 更准确的命名应为"时空规划表"或"场景调度数据"

**问题 2：职责边界模糊**
- V8.6 SKILL.md 中 Step 6 标注为"时空剧本+终审"，调用 `screenplay + cinematographer + script_auditor` 三个专家
- 但 `screenplay` 的职责是"写剧本"（Step 3 已完成），`cinematographer` 的职责是"设计镜头"（Step 8 还要做），`script_auditor` 的职责是"审计剧本"（Step 3 已做过）
- 三个专家在 Step 6 中各自做什么，SKILL.md **没有明确定义**

**问题 3：V8.6 合并导致的概念压缩**
- V8.6 将原来的 Step 11（时空剧本）+ Step 12（审核）合并为新的 Step 6
- 原来的 Step 11 使用 `kais-spatio-temporal-agent`（独立子 Skill），有完整的输入输出 schema
- 合并后，Step 6 改为调用 hermes-agent 专家，但 kais-spatio-temporal-agent 的 schema 与 hermes-agent 专家的 schema **不对齐**
  - kais-spatio-temporal-agent 输出 5 个顶层 key（meta/timeline/spatial/causality/emotion）
  - hermes-agent screenplay 输出 script.json（scenes/dialogue/emotion_curve/hooks/payoffs/cliffhangers）
  - hermes-agent cinematographer 输出 shot_intent.json + 4 handoff
  - hermes-agent script_auditor 输出 audit_report.json
  - **三个专家的输出如何组合成"时空剧本"？没有定义。**

### 5.3 kais-spatio-temporal-agent vs hermes-agent 专家的能力差距

| 能力 | kais-spatio-temporal-agent | hermes-agent 专家组合 |
|------|---------------------------|---------------------|
| 时间轴 | ✅ 精确 beat 级（0.5s）| ⚠️ screenplay 有 beat_count 但无精确时间 |
| 空间关系 | ✅ character_positions + location | ⚠️ cinematographer 有 composition 但无角色动线 |
| 因果链 | ✅ causality.chains（跨场景依赖）| ❌ 无任何专家输出因果链 |
| 镜头列表 | ✅ camera.shot_list | ✅ 更专业（8级+12运镜+轴线）|
| 自审核 | ✅ 10项时空一致性检查 | ⚠️ script_auditor 只审叙事/情绪/Hook/角色/完播率 |
| 降级策略 | ✅ 骨架生成 + 字段缺失处理 | ❌ 无时空相关降级 |

**诊断：hermes-agent 专家组合无法完整覆盖 kais-spatio-temporal-agent 的能力**，特别是**因果链**和**角色动线**两个维度在 hermes-agent 中没有任何专家负责。

### 5.4 问题汇总

| # | 问题 | 严重度 | 影响范围 |
|---|------|--------|---------|
| P1 | Step 3 和 Step 6 情绪弧线重复定义 | 🟡 中 | 数据冗余，可能导致不一致 |
| P2 | Step 6 和 Step 8 镜头列表重复定义 | 🔴 高 | 两个步骤产出冲突的镜头设计，下游不知道消费哪个 |
| P3 | "时空剧本"命名不当 | 🟡 中 | 认知混淆，以为是一种剧本格式 |
| P4 | Step 6 中三个 hermes 专家的职责未定义 | 🔴 高 | 执行时无法确定各自产出什么 |
| P5 | 因果链能力在 hermes-agent 中缺失 | 🟠 中高 | 叙事逻辑验证无法执行 |
| P6 | 角色动线在 hermes-agent 中缺失 | 🟠 中高 | 角色位置一致性无法保证 |
| P7 | V8.6 合并后 schema 不对齐 | 🔴 高 | kais-spatio-temporal-agent 输出与 hermes 专家输出格式冲突 |
| P8 | 转场方式在 Step 6 和 Step 8 重复 | 🟡 中 | 数据冗余 |

---

## 六、优化建议

### 6.1 方案 A：重定位——将 Step 6 改为"时空规划+审核门"（推荐）

**核心思路：** 承认"时空剧本"不是剧本，而是**管线中间件**，将其职责重新定义为：

> **Step 6 = 时空一致性验证 + 运镜预审 + 终审放行**

具体做法：

| 子步骤 | 执行者 | 输入 | 输出 | 与现有专家的关系 |
|--------|--------|------|------|----------------|
| 6a. 时间轴分配 | LLM（轻量）| Step 3 剧本的 scenes[] | 秒级时间轴 JSON | **新增能力**，现有专家都不做 |
| 6b. 角色动线规划 | LLM（轻量）| 时间轴 + Step 4 角色列表 | character_positions JSON | **新增能力**，hermes-agent 无覆盖 |
| 6c. 因果链验证 | LLM（轻量）| 时间轴 + 剧本 | causality.chains JSON | **新增能力**，hermes-agent 无覆盖 |
| 6d. 镜头预审 | `cinematographer` | 时间轴 + 场景（Step 5）+ 剧本 | shot_intent.json（初版）| **= cinematographer 正常输出** |
| 6e. 终审 | `script_auditor` | 完整产出包 | audit_report.json | **= script_auditor 正常输出** |

**与 Step 8 的关系：** Step 8 不再从零设计镜头，而是**精化** Step 6d 的 shot_intent 初版——补充轴线合规、prompt token 映射、竖屏 framing 等执行细节。

**优点：**
- 消除了 Step 6/8 镜头列表的重复（6d 是初版，8 是精化版）
- 消除了 Step 3/6 情绪弧线的重复（Step 6 不再重新生成 emotion_curve，直接消费 Step 3 的）
- 因果链和角色动线这两个独特能力得到保留
- "时空"概念回归本质——时间和空间的规划，而非"又写一遍剧本"

### 6.2 方案 B：重命名——改称"场景调度表"（Scene Blocking Sheet）

如果保持现有管线结构不变，至少应该**重命名**以减少混淆：

| 现名 | 建议新名 | 理由 |
|------|---------|------|
| 时空剧本 | **场景调度规划** (Scene Blocking Plan) | 更准确反映内容（时间+空间+动线），不暗示是"剧本"|
| kais-spatio-temporal-agent | kais-blocking-planner | 与新名对齐 |

### 6.3 方案 C：拆分——将因果链和角色动线作为独立维度

**核心思路：** 因果链和角色动线是"时空剧本"真正独有的能力（hermes-agent 没有覆盖），应该作为独立维度强化：

1. **因果链 → 并入 script_auditor** 作为第 6 维度（当前 5 维：叙事/情绪/Hook/角色/完播率），增加"叙事逻辑因果性"维度
2. **角色动线 → 并入 cinematographer** 的 composition_lock 子任务（角色在哪里、怎么移动 = 空间 blocking）
3. **时间轴 → 作为 screenplay 的附加输出**（screenplay 已有 beat_count，扩展为秒级时间分配）
4. **镜头列表 → 完全交给 cinematographer**（Step 8），Step 6 不再生成

**优点：** 每个维度的归属清晰，无重复。
**缺点：** 需要 hermes-agent 专家升级，开发量较大。

### 6.4 综合推荐

| 短期（立即可做） | 中期（1-2周） | 长期（V9 考虑） |
|-----------------|--------------|----------------|
| ① 重命名 Step 6 为"场景调度规划" | ① 实施方案 A（重定位 Step 6）| ① 实施方案 C（因果链并入 script_auditor）|
| ② 在 SKILL.md 中明确 Step 6 三个专家各自的具体子任务 | ② 将 kais-spatio-temporal-agent 的因果链/动线能力保留为 Step 6 的 LLM 轻量调用（不走 hermes-agent）| ② 评估 hermes-agent 是否需要新增 `spatial_planner` 专家 |
| ③ Step 6 不再生成 emotion.curve（消费 Step 3 的）| ③ 定义 Step 6 输出 → Step 8 输入的明确 schema 映射 | ③ 研究因果链是否可以用 script_auditor 的完播率预测模型替代 |

---

## 附录 A：各步骤与"时空剧本"的数据流关系

```
Step 3 (screenplay)
  ├─ script.json
  │   ├─ scenes[] ────────────────────→ Step 6 消费（时间轴分配）
  │   ├─ emotion_curve ───────────────→ Step 6 应直接消费（不重新生成）
  │   ├─ hooks/payoffs/cliffhangers ──→ Step 6 不涉及
  │   └─ sound_mood/lighting_mood ────→ Step 6 不涉及
  └─ script_auditor.audit_report ─────→ Step 6 终审参考

Step 4 (character_designer)
  └─ character-asset-manifest.json ───→ Step 6 消费（角色动线规划需要知道有哪些角色）

Step 5 (scene design)
  └─ geometry-bed.json ───────────────→ Step 6 消费（空间布局需要知道场景长什么样）

Step 6 (时空剧本/场景调度规划)  ← 问题步骤
  ├─ timeline.json ───────────────────→ Step 7 消费（视觉种子需要知道时间分配）
  ├─ character_positions.json ────────→ Step 8/9 消费（运镜/一致性需要角色位置）
  ├─ causality.json ──────────────────→ 审核门用（叙事逻辑验证）
  ├─ camera.shot_list ────────────────→ ⚠️ 应删除（Step 8 cinematographer 更专业）
  ├─ emotion.curve ───────────────────→ ⚠️ 应删除（直接消费 Step 3 的）
  └─ audit_report.json ───────────────→ 终审放行

Step 8 (cinematographer + editor)
  ├─ shot_intent.json ────────────────→ 精化 Step 6 的镜头初版
  ├─ shot_list.json ──────────────────→ 最终镜头列表
  └─ editor_handoff.json ─────────────→ 剪辑节奏
```

## 附录 B：行业对比速查

| 管线 | 步骤数 | 有无时空规划层 | 时间精度 | 因果链 | 角色动线 |
|------|--------|--------------|---------|--------|---------|
| kais-movie-agent V8.6 | 13 步 | ✅ Step 6 | 0.5s beat | ✅ | ✅ |
| Kling O3 storyboard | 内嵌 | ⚠️ 镜头级 | 镜头级 | ❌ | ⚠️ 自动（不暴露）|
| Sora 2 workflow | 无 | ❌ | ❌ | ❌ | ❌ |
| Runway Gen-4.5 | 无 | ❌ | ❌ | ❌ | ❌ |
| 传统电影制作 | ~20+ 步 | 分散在多角色 | 场记级（分钟）| 导演脑中 | 场记本 |

---

## 总结

"时空剧本"在 kais-movie-agent 管线中是一个**工程上有合理性但定义不清晰**的中间层。它的核心价值在于：

1. **因果链验证** — hermes-agent 无任何专家覆盖此能力
2. **角色动线规划** — hermes-agent 无任何专家覆盖此能力
3. **秒级时间轴** — 比所有 hermes-agent 专家更细

但存在三个需要解决的核心问题：

1. **Step 6/8 镜头列表重复**（最严重）— 需要明确 Step 6 只做初版，Step 8 做精化
2. **Step 3/6 情绪弧线重复** — Step 6 应直接消费 Step 3 的 emotion_curve
3. **命名不当** — "时空剧本"应改名为更准确的术语

**推荐路径：短期重命名+明确职责边界 → 中期实施方案 A 重定位 → 长期考虑因果链并入 script_auditor。**
