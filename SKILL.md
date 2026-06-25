---
name: kais-movie-agent
description: "AI短片全流程自动制作管线 (V8.6)。dreamina CLI 唯一生成工具。hermes-agent v2 专家驱动。L1-L4 完整角色资产库。13步管线，8个审核门。OpenClaw 唯一编排引擎。"
---

> **HISTORICAL (v1.x–v4.x V8.6) — superseded by [`hermes-agent/skills/kais-movie-pipeline/SKILL.md`](../../../hermes-agent/skills/kais-movie-pipeline/SKILL.md).**
>
> This document describes the pre-v5.0 architecture when OpenClaw + Toonflow
> were the orchestration layer. As of v5.0 (2026-06-26), the pipeline is a
> native hermes-agent skill with **zero openclaw / Toonflow / Node.js runtime
> dependency**. All 13 phases are Python (Phase 36 reference port), canvas
> sync is `plugins/kais_aigc/canvas_sync.py` (Phase 37), and state/gates live
> in `plugins/pipeline_state/` and `plugins/review_gates/`.
>
> The content below is preserved as a reference for the V8.6 behavioral
> contract that Phase 36 ported to Python. It is **not** the live operational
> doc — for current operations see `hermes-agent/skills/kais-movie-pipeline/`.

# kais-movie-agent V8.6 — dreamina CLI + hermes-agent v2 + 13步精简管线

## 🆕 V8.6 更新（2026-06-18）

1. **管线精简 25→13 步** — 6组合并：选题+主题、框架+大纲、剧本+审计、运镜+终审、视觉+风格化、声音+口型
2. **审核门 12→8 个** — 用户等待轮次减半
3. **Expert 调用约 15→10 次** — 省去冗余 ACP 调用
4. **核心合并**：
   - Step 1: hook_retention 共鸣+主题一步到位（原 Step 1+2）
   - Step 2: creative_source+screenplay 框架+大纲一步到位（原 Step 2.5+3）
   - Step 3: screenplay+script_auditor 剧本+审计原子操作（原 Step 5+5B+6）
   - Step 6: screenplay+cinematographer+script_auditor 运镜+终审（原 Step 11+12）
   - Step 7: visual_executor+prompt_injector+style_genome+colorist 视觉+风格化（原 Step 13A+15）
   - Step 11: audio_pipeline BGM+音效+口型统一（原 Step 18+17B）

## 🆕 V8.5 更新（2026-06-18）

1. **dreamina CLI 取代 jimeng-client.js** — 所有图片/视频生成统一使用 dreamina CLI（text2image/image2image/multimodal2video/multiframe2video/frames2video/image_upscale）
2. **Step 7 角色资产库完整化** — L1 面部锚点 + L2 造型卡片（正+侧）+ L3 姿势包 + L4 表情标定，含生成→检测→重生成闭环
3. **Step 17 视频三种模式** — multimodal2video（全能参考）/ multiframe2video（多图故事）/ frames2video（首尾帧）
4. **image2image 最多10张参考图** — 替代 compositions API，更灵活的角色一致性方案
5. **jimeng-client.js 标记废弃** — lib/ 中保留仅做兼容参考

## 🆕 V8.4 更新（2026-06-18）

1. **专家映射全面更新** — hermes-agent v2 合并/重命名同步（drawer+animator→visual_executor, 6个音频→audio_pipeline, continuity→continuity_auditor, scene_builder/storyboard_designer→cinematographer）
2. **新增 prompt_injector 节点** — Step 13A 前，将 visual_intent+style_genome+character_assets 翻译成即梦可用的 model_prompts
3. **前置 style_genome** — Step 2.5 后全局确立 5D 风格向量，贯穿全管线
4. **前置 script_auditor** — Step 5 后 5维定量审计，给 Step 6 选剧本用
5. **新增 audio_pipeline 语音生成** — Step 13B voicer sub-step + Step 17B lip_sync
6. **前置 editor 节奏设计** — Step 14 剪辑节奏前置，决定镜头数/时长/转场

---

### 历史版本

## V8.3 更新（2026-06-18）

1. **L1/L2 双参考角色一致性系统** — 角色参考只传脸（L1），智能参考传衣服/姿势（L2），预期一致性 90%+
2. **多剧集故事容量分配** — episode_count × duration_sec_per_episode 动态计算最低节拍点，确保故事量匹配总时长
3. **Seedance 2.0 omni_reference 模式** — 视频生成支持 9图+3视频+3音频，@Image N 绑定身份锁定
4. **prompt 零面部描述策略** — 面部特征通过参考图传递，prompt 只写动作/场景/镜头

## 触发词
`movie agent`, `短片制作`, `AI短片`, `视频管线`, `film pipeline`, `movie-wuji`, `AI视频制作`, `短视频管线`, `AI电影`, `影片制作`, `AI短剧`, `短剧制作`, `视频自动化`, `一键生成视频`, `AI拍片`, `kais-movie`, `movie pipeline`, `V8`, `V7`

---

## 🏗️ 架构原则（V8.2 变更）

### OpenClaw 编排 + hermes-agent 专家驱动架构

- **OpenClaw 是唯一编排引擎**：调度子 Skill、走审核门、同步 Toonflow
- **创意生成走 ACP**：通过 `sessions_spawn(runtime="acp", agentId="hermes-agent")` 调用 16 个活跃 movie-expert + 垂直专家
- **不再依赖 movie-agent Docker 容器**（V7 已废弃）
- **Platform (gold-team) 只做 GPU 调度**：接收任务、排队、执行、返回结果
- **状态管理**：用 OpenClaw session 上下文 + 文件系统（不再用 Pipeline API）
- **审核入口**：Telegram inline buttons + Toonflow 审核页面

| 职责 | 执行者 | 工具 |
|------|--------|------|
| **专业创意生成**（剧本/角色/场景/分镜/运镜/BGM） | **hermes-agent 专家系统**（通过 ACP） | `sessions_spawn(runtime="acp", agentId="hermes-agent")` → `skill_invoke(expert_id, input, context)` |
| **执行落地**（图片生成、prompt 组装、产物归档） | OpenClaw Agent + 子 Skill | `hermes_llm`, `hermes_llm_vision`, `image`, **dreamina CLI** |
| **图片生成**（文生图/图生图/超分） | OpenClaw Agent | **dreamina CLI（默认）** |
| **审核交互**（展示+等用户确认） | OpenClaw Agent | 会话回复 + inline buttons |
| **状态管理**（管线进度） | OpenClaw Agent | session 上下文 + 文件系统 |
| **GPU 渲染**（视频/TTS/3D） | gold-team 容器 | `exec curl → :8002/api/v1/tasks` |
| **文件存储**（产出物） | 文件系统 | 项目 workdir |

### 工具映射

```
专业创意 → ACP: sessions_spawn(runtime="acp", agentId="hermes-agent")
            → skill_invoke(expert_id=<EXPERT>, input="...", context="...")
轻量写作 → hermes_llm(prompt, system)             # 拼装、汇总、非专家场景
图像分析 → hermes_llm_vision(prompt, images) 或 image(prompt, images)
文生图   → dreamina text2image --prompt "..." --model_version 5.0 --ratio 16:9 --resolution_type 2k --poll 0
图生图   → dreamina image2image --images ./ref.png --prompt "..." --model_version 5.0 --ratio 3:4 --resolution_type 2k --poll 0
双参考   → dreamina image2image --images L1_face.png,L2_costume.png --prompt "..." --model_version 5.0 --ratio 3:4 --resolution_type 2k --poll 0
视频omni → dreamina multimodal2video --image L1_01.png --image L1_02.png --image scene.png --prompt "@Image1 provides identity..." --model_version seedance2.0fast --duration 5 --ratio 16:9 --poll 0
故事视频 → dreamina multiframe2video --images frame1.png,frame2.png,frame3.png --transition-prompt "A to B" --transition-prompt "B to C" --poll 0
首尾帧   → dreamina frames2video --first ./start.png --last ./end.png --prompt "..." --model_version seedance2.0fast --duration 5 --poll 0
超分     → dreamina image_upscale --image ./photo.png --resolution_type 4k --poll 0
积分查询 → dreamina user_credit
3D生成  → exec curl → gold-team :8002/api/v1/tasks (type: image_to_3d)
TTS     → exec curl → gold-team :8002/api/v1/tasks (type: tts)
审核交互 → Telegram inline buttons / Toonflow 审核页面
```

### hermes-agent 专家 → 管线 Step 速查

通过 ACP 调用 `skill_invoke(expert_id=...)`，可用 16 个活跃 movie-expert + 垂直专家：

| Step | 用途 | expert_id |
|------|------|-----------|
| Step 1 | 爆款选题雷达（kais-topic-radar 10维情绪共鸣） | `hook_retention` |
| Step 2 | 主题生成（基于 Topic Kernel 共鸣公式筛选） | `hook_retention` |
| Step 2 | 故事框架+大纲 | `creative_source` + `screenplay` |
| Step 3 | 大纲生成 | `screenplay` |
| Step 5 | 剧本生成 | `screenplay` |
| Step 4 | 主角设计+资产库 | `character_designer` + `visual_executor` (drawer) |
| Step 5 | 场景设计 | `cinematographer` + `style_genome` + `visual_executor` (drawer) |
| Step 6 | 时空剧本+终审 | `screenplay` + `cinematographer` + `script_auditor` |
| Step 7 | 视觉种子+风格化 | `visual_executor` + `prompt_injector` + `style_genome` + `colorist` |
| Step 7 | 视觉种子+风格化 | `visual_executor` + `prompt_injector` + `style_genome` + `colorist` |
| Step 7B | 声音骨架 | `audio_pipeline` (voicer + composer + foley) |
| Step 8 | 运镜+节奏 | `cinematographer` + `editor` |
| Step 9 | 一致性检查 | `continuity_auditor` |
| Step 11 | BGM+音效+口型 | `audio_pipeline` (composer + foley + mixer + spatial_audio + lip_sync) |

**其他可用专家**（按需补充调用）：`editor`, `production`, `compliance_marketing`, `compliance_gate`, `creative_source`, `theory_critic`, `documentary_maker`, `animation_studio`

### 图片生成默认引擎

**所有图片生成（文生图、图生图、角色参考图、场景图）默认使用 dreamina CLI。**

- **不经过 gold-team** 图片生成（gold-team 仅供视频/TTS/3D）
- **不使用内置 image tool 生成图片**（仅用于分析）
- **dreamina CLI 用法**：提交任务（`--poll 0` = 不等待），轮询结果（`dreamina query_result --submit_id ID`），下载图片（`aria2c URL`）
- **降级**：即梦限流/超时 → gold-team `image_draw`（comfyui-local / cloud-jimeng）

---

## ⚠️ 强制审核门（Review Gate）

**以下 Step 完成后必须暂停，展示产出物给用户审核，收到确认后才能继续：**

| Step | 审核内容 | 展示方式 |
|------|---------|---------|
| Step 2 | 主题选择 | 当前会话 |
| Step 2 | 故事框架+大纲选择 | 当前会话 |
| Step 4 | 大纲选择 | 当前会话 |
| Step 6 | 剧本选择 | 当前会话 |
| Step 4 | 主角选择（L1-L4资产） | 当前会话 |
| Step 5 | 场景选择（5视图） | 当前会话 |
| Step 6 | 时空剧本+终审 | 当前会话 |
| Step 6 | 时空剧本+终审 | 当前会话 |
| Step 7 | 种子骨架（视觉+声音） | 当前会话 |
| Step 8 | 运镜+节奏预览 | 当前会话 |
| Step 10 | 终版视频 | 当前会话 |

**执行规则：**
1. 到达审核门时，**必须停止执行**，展示产出物
2. 附上审核选项（✅通过 / 🔄重做 / ✏️修改）
3. **只有收到用户确认后才能继续下一步**
4. **禁止一次性跑多步然后事后补审核**
5. **用户通过后，必须先同步到 Toonflow，同步成功后才进入下一 Step**
6. **同步失败时暂停管线，不跳过同步步骤**

---

## 🎲 生成冗余策略（成本越低冗余越多）

**原则**：消耗越小的创意产出，一次性生成越多备选，加速创作并方便挑选最优。

| Step | 产出类型 | 消耗级别 | 生成数量 | 用户操作 |
|------|---------|---------|---------|---------|
| Step 2 | 主题 | 🔵 极低（纯文本） | **10个** | 选1个或修改方向
| Step 2 | 故事框架+大纲 | 🔵 极低（纯文本） | **3个** | 选1个或要求合并/修改 |
| Step 4 | 大纲 | 🔵 低（中等文本） | **6个** | 选1个或要求合并/修改 |
| Step 6 | 剧本 | 🟡 中（长文本+LLM推理） | **3个** | 选1个或要求修改 |
| Step 4 | 主角 | 🟠 高（图片生成） | L1正面×6选1 → 6造型各正面+侧面×3变体 = 6+36+L3/L4按需 | 选角色/选造型/重做 |
| Step 5 | 场景 | 🟠 高（图片生成） | 俯视×3选1 → 4侧面每角度×3变体 = 3+12/场景 | 选俯视/选变体/重做 |
| Step 6 | 时空剧本 | 🟡 中（文本） | **3个**运镜方案（含审计） | 审计≥阈值放行 |
| Step 7 | 视觉种子+风格化 | 🔴 极高（多张图片） | 按场景数 | 逐场景审核 |
| Step 10 | 终版视频 | 🔴 极高（云端渲染） | 三种模式按需 | 通过/重做 |

- **所有未选中**的备选（文本/图片/视频）统一存档到项目 workdir `candidates/<step>/` 目录
- 文本存原始内容，图片/视频存文件 + 生成参数（prompt/model/score）
- 用途：分支拓展（从任意节点重新出发）、正反数据集积累、风格对比参考
- 每个备选标记元数据：`selected: true/false`、`score`、`reason`（选中/未选原因）

---

## 管线流程

### 上半部分：创意立项（Steps 1-6）

```
Step 1:  选题+共鸣+主题×10 (kais-topic-radar + hook_retention) → 🔒 REVIEW GATE  ← V8.6: 合并原 Step 1+2
         🎙️ hermes-agent expert: hook_retention（共鸣10维扫描 + 主题生成 + virality/safety 评分）
         └─ 输入: 用户一句话（"做个30秒职场短片"）
         └─ 输出: 10个主题方案（每个带 virality_score + safety_score + hook_pattern + topic_kernel）
         └─ 筛选: 只保留 virality_score ≥ 7 且 safety_score ≥ 8
         └─ 📐 故事容量根据 episode_count × duration_sec_per_episode 动态分配
         └─ 📡 Toonflow: 创建项目 + 同步主题信息
Step 2:  故事框架+大纲×3 (creative_source + screenplay) → 🔒 REVIEW GATE  ← V8.6: 合并原 Step 2.5+3
         🎙️ hermes-agent expert: creative_source (故事内核/雪花法) + screenplay (叙事结构+大纲展开)
         └─ 输入: 锁定主题
         └─ 输出: 3个框架方案（每个含叙事结构+冲突+人物弧线+大纲200字）
         └─ 📡 Toonflow: 同步框架+大纲
Step 2B: 全局风格确立                              → checkpoint
         🎙️ hermes-agent expert: style_genome
         └─ 基于 Step 2 框架生成 5D 风格向量（genre/mood/aesthetic/pace/color）
         └─ 输出 style-genome.json → 贯穿全管线所有视觉生成
Step 3:  剧本×3 + 定量审计 (screenplay + script_auditor) → 🔒 REVIEW GATE  ← V8.6: 合并原 Step 5+5B+6
         🎙️ hermes-agent expert: screenplay (剧本生成) + script_auditor (5维审计)
         └─ 输入: 锁定大纲 + 风格向量
         └─ 输出: 3个剧本，每个带5维评分（叙事/情绪/钩子/角色/完播预测）
         └─ 高分剧本自动排序，全部<阈值才要求人工选
         └─ 📡 Toonflow: 同步剧本 (agent-sync --asset-type script)
Step 4:  主角·L1/L2/L3/L4 资产库 (dreamina CLI)  → 🔒 REVIEW GATE  ← V8.6: 原 Step 7+8 合并编号
         🎙️ hermes-agent experts: character_designer (角色设定) + visual_executor (drawer sub-step, 出图 prompt)
        └─ 4A: L1 身份锚点 — dreamina text2image × 6（面部特写，黄金标准检测，不合格重生≤3轮）
        └─ 4B: L1 审核 (≥7) → 通过，注册到 CharacterAssetManager（永不更换）
        └─ 4C: L2 造型卡片×6 — dreamina image2image（L1参考），每个造型生成正面+侧面各3个变体（共36张），用户逐造型选最优变体
        └─ 4D: L2 一致性审核 (≥6, 与L1面部一致+服装正确)
        └─ 4E: L3 姿势包（按需）— dreamina image2image（L1+对应L2, 从剧本提取动作列表）
        └─ 4F: L4 表情标定（按需）— dreamina image2image（L1, 从剧本提取表情列表）
        └─ 4G: 资产库快照 → CharacterAssetManager.getAssetSnapshot() → character-asset-manifest.json
        └─ 🔒 用户确认角色 + 资产 → soul-pack.json
        └─ 📡 Toonflow: 同步角色图 (agent-sync --asset-type character_image)
Step 5:  场景·俯视+4侧 (dreamina CLI)              → 🔒 REVIEW GATE  ← V8.6: 原 Step 9+10 合并编号
         🎙️ hermes-agent experts: cinematographer (空间结构) + style_genome (视觉风格) + visual_executor (drawer sub-step)
        └─ 5A: 俯视图生成×3 + 审核 (≥7) → 用户选1个确认方向
        └─ 5B: 参考确认的俯视图，4个侧面角度各生成3个变体（共12张），用户逐角度选最优变体
        └─ 5C: 一致性审核 (≥6)
        └─ 🔒 用户确认场景 → geometry-bed.json
        └─ 📡 Toonflow: 同步场景图 (agent-sync --asset-type scene_image) ×5/scene
Step 6:  时空剧本×3 含终审 (screenplay + cinematographer + script_auditor) → 🔒 REVIEW GATE  ← V8.6: 合并原 Step 11+12
         🎙️ hermes-agent expert: screenplay + cinematographer + script_auditor (终审)
         └─ 生成3个运镜方案，同步附带审计评分
         └─ 审计≥阈值才放行，全部<阈值需重做
         └─ 📡 Toonflow: 同步时空剧本 + 更新画布FlowGraph
```

### 下半部分：生产执行（Steps 7-13）

```
Step 7:  视觉种子+风格化 (visual_executor + prompt_injector + style_genome + colorist) → 🔒 REVIEW GATE  ← V8.6: 合并原 Step 13A+15
         🎙️ hermes-agent experts: visual_executor (drawer sub-step) + prompt_injector + style_genome + colorist
         └─ prompt_injector: 把 visual_intent + style_genome + character_assets 翻译成即梦可用的 model_prompts
         └─ 一步输出风格化视觉种子（风格向量在 Step 2B 已确立）
         └─ 📡 Toonflow: 同步视觉种子图 (agent-sync --asset-type scene_image)
Step 7B: 声音骨架 (audio_pipeline)                      → checkpoint  ← 原 Step 13B
         🎙️ hermes-agent expert: audio_pipeline (voicer sub-step TTS旁白 + composer sub-step BGM骨架 + foley sub-step)
         └─ 📡 Toonflow: 同步语音 (agent-sync --asset-type voice)
Step 8:  运镜+节奏+预览 (cinematographer + editor)    → 🔒 REVIEW GATE  ← V8.6: 原 Step 14
         🎙️ hermes-agent experts: cinematographer + editor (节奏前置)
         └─ editor: FxRxT矩阵 + Murch Rule of Six 决定镜头数/时长/转场
         └─ 📡 Toonflow: 同步预览视频 (agent-sync --asset-type video_preview) ×N
Step 9:  一致性守护检查（L1锚点基准 > 0.85）      → 阻断/放行  ← V8.6: 原 Step 16
         🎙️ hermes-agent expert: continuity_auditor
         └─ 以 L1 身份锚点为基准对比，auditImageVsL1() 逐图检查
Step 10: 终版视频（三种模式）                    → 🔒 REVIEW GATE  ← V8.6: 原 Step 17
         └─ 模式A: dreamina multiframe2video — 多帧故事视频（分镜帧已就绪，2-20图连贯过渡）
         └─ 模式B: dreamina multimodal2video — 全能参考（L1锚点+场景图，最强一致性）
         └─ 模式C: dreamina frames2video — 首尾帧（明确起止状态）
         └─ 📡 Toonflow: 同步终版视频 (agent-sync --asset-type video_final) ×N
Step 11: BGM+音效+口型闭环                      → checkpoint  ← V8.6: 合并原 Step 18+17B
         🎙️ hermes-agent expert: audio_pipeline (composer + foley + mixer + spatial_audio + lip_sync 按需)
         └─ 📡 Toonflow: 同步BGM + 音效
Step 12: 剪辑合成（FFmpeg）                       → checkpoint  ← V8.6: 原 Step 19
Step 13: 质检与交付                              → PASS/FAIL  ← V8.6: 原 Step 20
         └─ 📡 Toonflow: 最终交付 + 审核评分写入
```

---

## Agent 执行模式

Agent 逐步执行每个 Step，通过 ACP 调用 hermes-agent 专家生成创意、再走子 Skill 落地、然后 GPU 渲染：

```
1. Agent 通过 ACP 调用 hermes-agent 对应 expert_id 生成专业创意内容
2. Agent 用子 Skill 执行落地（生成图片 prompt、调用 dreamina CLI、归档产物）
3. 展示给用户 → 等确认（Telegram inline buttons / Toonflow）
4. 通过 exec curl 提交 GPU 任务到 gold-team :8002
5. 轮询状态 → 展示结果 → 等确认
6. 进入下一个 Step
```

> **V8 变更**：不再有 Pipeline API 模式，Agent 直接通过 exec curl 调用 gold-team。
> 状态保存在 session 上下文和项目 workdir 文件中。
>
> **V8.1 变更**：创意生成从直连 `hermes_llm` 升级为通过 ACP 调用 `hermes-agent` 的 movie-expert 专家系统，
> 每个创意步骤都有对应领域的专家（screenplay、character_designer、cinematographer 等）把关。
> `hermes_llm` 仍保留用于轻量任务（拼装/汇总/格式化/非专家场景）。

---

## 🔌 ACP 调用模板（hermes-agent 专家系统）

OpenClaw Agent 通过 ACP 调用 hermes-agent 的 16 个活跃 movie-expert + 垂直专家 skill：

```
OpenClaw Agent
  → sessions_spawn(runtime="acp", agentId="hermes-agent")
    → skill_invoke(expert_id="<EXPERT>", input="<任务描述>", context="<上下文>")
    → 返回专家结果（JSON / Markdown / prompt 字符串）
  → 子 Skill 用专家输出做执行（生成图片/调 GPU/归档）
  → 继续管线
```

### 注册信息

- **hermes-agent 二进制**：`/data/workspace/hermes-agent/.venv/bin/hermes-acp`
- **注册 agent id**：`hermes-agent`
- **核心 tool**：`skill_invoke`
- **参数**：
  - `expert_id`（enum，20 选 1）
  - `input`（string，任务描述）
  - `context`（optional string，管线上下文/前序产物）

### 完整专家清单（20）

`screenplay`, `visual_executor`, `editor`, `colorist`, `audio_pipeline`,
`continuity_auditor`, `style_genome`, `cinematographer`, `hook_retention`,
`production`, `compliance_marketing`, `character_designer`, `prompt_injector`,
`script_auditor`, `creative_source`, `compliance_gate`

### 调用示例

#### Step 2 故事框架+大纲（creative_source + screenplay 协同）

```python
session = sessions_spawn(runtime="acp", agentId="hermes-agent")

# 1. creative_source：提炼故事内核（如适用现实主义题材）
story_kernel = session.skill_invoke(
    expert_id="creative_source",
    input="为选定主题《{theme}》提炼故事内核 + 雪花法展开（Step 1-4）",
    context=json.dumps({"theme": locked_theme, "target_audience": target_audience})
)

# 2. screenplay：基于故事内核设计3个叙事框架方案
frameworks = session.skill_invoke(
    expert_id="screenplay",
    input="基于以下故事内核，设计3个不同叙事框架方案（每个含：叙事结构/核心冲突/人物关系网/角色弧线/节奏策略）",
    context=json.dumps({"story_kernel": story_kernel, "theme": locked_theme})
)
# frameworks → [{structure, conflicts, relationships, arcs, pacing}, ...]

# 3. 用户选择1个 → 锁定为 story-framework.json
```

#### Step 3 生成大纲（screenplay）

```python
session = sessions_spawn(runtime="acp", agentId="hermes-agent")
result = session.skill_invoke(
    expert_id="screenplay",
    input="基于以下痛点生成 3 个不同风格的故事大纲（每个 200 字）：\n痛点：30-40 岁男性职场焦虑",
    context=json.dumps({"theme": "职场焦虑", "target_audience": "30-40 男性"})
)
# result.outlines → ["大纲A...", "大纲B...", "大纲C..."]
```

#### Step 4 主角设计+资产库（character_designer + visual_executor drawer sub-step 协同）

```python
session = sessions_spawn(runtime="acp", agentId="hermes-agent")

# 1. character_designer：角色设定
char_spec = session.skill_invoke(
    expert_id="character_designer",
    input="为剧本《...》设计主角：年龄/职业/性格/标志性视觉元素",
    context=locked_script
)

# 2. visual_executor (drawer sub-step)：把角色设定翻译成 dreamina CLI 可用的 prompt
draw_prompt = session.skill_invoke(
    expert_id="visual_executor",
    input="根据角色设定生成正视图文生图 prompt（含比例/光影/风格）",
    context=char_spec
)

# 3. 子 Skill kais-character-designer 落地：调用 dreamina CLI 出图
character_image = kais_character_designer.generate(prompt=draw_prompt)
```

#### Step 8 运镜+节奏（cinematographer + editor 协同）

```python
session = sessions_spawn(runtime="acp", agentId="hermes-agent")
camera_plan = session.skill_invoke(
    expert_id="cinematographer",
    input="为以下场景设计运镜（机位/焦段/运动/时长）",
    context=json.dumps({"spatio_temporal_script": st_script, "scene_geometry": geom})
)
```

### 专家 vs 子 Skill 协作关系

| 角色 | 提供方 | 职责 |
|------|--------|------|
| **专业知识**（剧本结构、镜头语言、色彩理论、音乐编排、prompt 工程、角色一致性） | hermes-agent 专家（v2） | 产出"想法/设定/prompt/评分依据" |
| **执行能力**（调即梦、调 GPU、归档、Toonflow 同步、审核门交互） | kais-* 子 Skill | 把专家输出落地为实际产物 |

二者必须配合：**专家只生成创意，子 Skill 才能产出文件**。专家不能直接调 GPU/即梦，子 Skill 不能跳过专家凭空生成。

---

## 服务地址

| 服务 | 地址 | 用途 |
|------|------|------|
| gold-team | localhost:8002 | GPU 渲染引擎 |
| Toonflow | localhost:3000 | 前端展示+审核 |
| ComfyUI | 172.17.0.1:8188 | 本地 GPU 推理（gold-team 内部调度） |

---

## 📐 多剧集故事容量系统（V8.3 新增）

### 需求模板新增字段

```json
{
  "episode_count": 1,              // 剧集数（默认1=单集短片）
  "duration_sec_per_episode": 60   // 每集时长（秒），默认60
}
```

向后兼容：`duration_sec` 自动计算为 `episode_count × duration_sec_per_episode`。

### 容量计算规则

| 总时长 | 最低节拍点 | 说明 |
|--------|-----------|------|
| 1分钟（1×60s） | 2个 | 单集短片 |
| 3分钟（3×60s） | 6个 | 3集系列 |
| 5分钟（5×60s） | 10个 | 5集系列 |
| 10分钟（10×60s） | 20个 | 10集系列 |

- 计算：`总分钟数 × 2 = 最低节拍点数`
- 多集要求：全局主线 + 每集独立梗概 + 集间关联（悬念/伏笔/角色弧线）
- 验证：`validateStoryCapacity(outline, targetSec)` 检查大纲容量 ±20%

### 关键文件

- `lib/story-synopsis-builder.js` — calculateStoryCapacity / buildTopicPrompt / buildOutlinePrompt / validateStoryCapacity

---

## 🎭 L1/L2 双参考角色一致性系统（V8.3 新增）

### 分层资产库

| 层级 | 名称 | 内容 | API入口 | 用途 |
|------|------|------|---------|------|
| **L1** | 身份锚点 | 1-3张面部特写 | 角色参考 | 锁定五官/骨相/发型，**永不更换** |
| **L2** | 造型卡片 | 每套服装正+侧面 | 智能参考 | 锁定服装/道具 |
| L3 | 姿势包 | 坐/站/走/跑 | 智能参考 | 动作参考 |
| L4 | 表情标定 | 微笑/怒/惊/泪 | 智能参考 | 表情戏时 |

### 核心原则

- **角色参考只传脸，智能参考传衣服/姿势，不要混放！**
- **prompt 零面部描述** — 面部特征通过参考图传递，prompt 只写动作/场景/镜头
- 一造型一卡片，不混放多套服装

### 参考图黄金标准

光线柔和均匀 / 正面微侧<30° / 中性表情 / 浅灰背景(#D3D3D3) / 高清无滤镜 / 无遮挡

### 关键文件

- `lib/character-asset-manager.js` — L1-L4 分层资产管理器
- `lib/reference-prompt-builder.js` — 定妆照/造型卡片/场景首帧 prompt 模板
- `lib/jimeng-client.js` — **@deprecated** (已被 dreamina CLI 取代，保留仅做兼容参考)
- `lib/invariant-bus.js` — L1/L2 快捷访问（getIdentityAnchors/getReferencePack）
- `lib/prompt-injector.js` V3 — 零面部描述策略 + injectVideoPrompt() @Image 绑定
- `lib/continuity-auditor.js` V3 — auditImageVsL1() 单图 vs L1 锚点对比

### 下游消费

```javascript
// 图片生成（场景图/分镜首帧）
const refPack = await assetManager.getReferencePack(charId, costumeId);
const prompt = buildCompositionPrompt({ action, scene, camera });  // 零面部描述
// dreamina CLI image2image（替代 jimengClient.compositions）
const result = await exec(
  `dreamina image2image --images ${refPack.images.join(',')} ` +
  `--prompt "${prompt}" --model_version 5.0 --ratio 3:4 --resolution_type 2k --poll 0`
);
const submitId = parseSubmitId(result);
const imageResult = await exec(`dreamina query_result --submit_id ${submitId}`);
const imageUrl = JSON.parse(imageResult).image_url;

// 视频生成（Seedance 2.0 multimodal2video）
const omniPack = await assetManager.getOmniReferencePack(charId, { costumeId, sceneFrame });
const videoResult = await exec(
  `dreamina multimodal2video ` +
  omniPack.identityImages.map(p => `--image ${p}`).join(' ') +
  ` --image ${sceneFrame}` +
  ` --prompt "${prompt}" --model_version seedance2.0fast --duration 5 --ratio 16:9 --poll 0`
);
```

---

## 🔄 产出物同步到 Toonflow（强制集成）

**每个审核门 Step 完成且用户确认后，必须调用 agent-sync.js 同步产出物到 Toonflow，同步成功后才能继续下一步。这是管线不可跳过的内置步骤。**

### 同步位置
```bash
/home/kai/workspace/kais-aigc-platform/scripts/agent-sync.js
```

### 同步脚本位置
```bash
/home/kai/workspace/kais-aigc-platform/scripts/agent-sync.js
```

### 同步方式（通过 exec 调用）

#### 1. 同步剧本（Step 5, 6）
```bash
node /home/kai/workspace/kais-aigc-platform/scripts/agent-sync.js \
  --project-name "${PROJECT_NAME}" \
  --step 6 \
  --asset-type script \
  --file-path "${SCRIPT_FILE}" \
  --metadata '{"name":"第1集剧本","episode":1}'
```

#### 2. 同步角色图片（Step 7, 8）
```bash
node /home/kai/workspace/kais-aigc-platform/scripts/agent-sync.js \
  --project-name "${PROJECT_NAME}" \
  --step 8 \
  --asset-type character_image \
  --file-path "${CHARACTER_IMAGE_FILE}" \
  --metadata '{
    "name": "主角名字",
    "prompt": "角色生成 prompt...",
    "description": "角色描述..."
  }'
```

#### 3. 同步场景图片（Step 9, 10）
```bash
node /home/kai/workspace/kais-aigc-platform/scripts/agent-sync.js \
  --project-name "${PROJECT_NAME}" \
  --step 10 \
  --asset-type scene_image \
  --file-path "${SCENE_IMAGE_FILE}" \
  --metadata '{
    "name": "室内场景",
    "prompt": "场景生成 prompt...",
    "description": "场景描述..."
  }'
```

#### 4. 同步语音（Step 7B, 11)
```bash
node /home/kai/workspace/kais-aigc-platform/scripts/agent-sync.js \
  --project-name "${PROJECT_NAME}" \
  --step 13 \
  --asset-type voice \
  --file-path "${VOICE_FILE}" \
  --metadata '{
    "name": "旁白_第1句",
    "prompt": "语音内容",
    "description": "旁白声音"
  }'
```

#### 5. 同步预览视频（Step 8）
```bash
node /home/kai/workspace/kais-aigc-platform/scripts/agent-sync.js \
  --project-name "${PROJECT_NAME}" \
  --step 14 \
  --asset-type video_preview \
  --file-path "${VIDEO_FILE}" \
  --metadata '{
    "shotIndex": 5,
    "duration": 3.5,
    "prompt": "镜头描述"
  }'
```

#### 6. 同步终版视频（Step 10）
```bash
node /home/kai/workspace/kais-aigc-platform/scripts/agent-sync.js \
  --project-name "${PROJECT_NAME}" \
  --step 17 \
  --asset-type video_final \
  --file-path "${FINAL_VIDEO_FILE}" \
  --metadata '{
    "shotIndex": 5,
    "duration": 3.5,
    "prompt": "最终镜头"
  }'
```

### 支持的 asset_type

| 类型 | 说明 | 对应 Step | API 端点 |
|------|------|-----------|----------|
| `script` | 剧本内容 | 5, 6 | `/api/v1/script` |
| `character_image` | 角色图片 | 7, 8 | `/api/v1/assets/addAssets` |
| `scene_image` | 场景图片 | 9, 10 | `/api/v1/assets/addAssets` |
| `voice` | 语音文件 | 13B, 18 | `/api/v1/assets/addAudioAssets` |
| `video_preview` | 预览视频 | 14 | `/api/v1/pipeline/ingest/videos` |
| `video_final` | 终版视频 | 17 | `/api/v1/pipeline/ingest/videos` |

### 同步时机（强制）

- **用户通过审核后 → 立即同步**（同步是进入下一个 Step 的前置条件）
- **失败重做时** → 同步新的产出物并覆盖旧版本
- **同步失败 → 暂停管线，汇报用户，等待修复**

### 管线执行流程（含同步）

```
Agent 生成产出物 → 展示给用户审核
  ├─ 用户通过 → agent-sync.js 同步到 Toonflow
  │   ├─ 同步成功 → 进入下一个 Step ✅
  │   └─ 同步失败 → 暂停管线，汇报用户 ❌
  ├─ 用户要求重做 → 回到对应 Step 重新生成
  └─ 用户要求修改 → 调整后重新展示
```

### 画布 FlowGraph 同步

**Step 5 和 Step 6** 完成后，必须额外保存画布 FlowGraph JSON，确保 Toonflow 无限画布能正确展示项目全貌：

```bash
# 通过 curl 直接调用 Toonflow canvas/save API
curl -s -X POST http://localhost:8000/api/canvas/save \
  -H 'Content-Type: application/json' \
  -d '{
    "projectId": <PROJECT_ID>,
    "episodesId": 1,
    "graph": <FLOWGRAPH_JSON>
  }'
```

FlowGraph JSON 格式：
```json
{
  "nodes": [
    {"id": "step-6-script", "type": "script", "position": {"x": 100, "y": 100}, "data": {"label": "22场景剧本"}},
    {"id": "asset-linjian", "type": "asset", "position": {"x": 100, "y": 350}, "data": {"label": "林建·50岁", "type": "role"}},
    {"id": "asset-gobi", "type": "asset", "position": {"x": 100, "y": 550}, "data": {"label": "戈壁公路", "type": "scene"}}
  ],
  "edges": [
    {"id": "e-step6-linjian", "source": "step-6-script", "target": "asset-linjian"}
  ]
}
```

节点类型：
| type | label 前缀 | 说明 |
|------|-----------|------|
| `script` | 步骤名 | 剧本/大纲/时空剧本 |
| `asset` | 资产名 | 角色(type=role)/场景(type=scene)/工具(type=tool) |
| `storyboard` | 分镜名 | 分镜板 |
| `video` | 镜头名 | 视频 |
| `audio` | 音频名 | BGM/音效/旁白 |

### 验证同步成功

同步脚本会返回以下信息：
- ✅ 项目查找/创建成功
- ✅ 产出物同步成功
- 📊 返回同步结果（ID、路径等）

如果同步失败，检查：
1. Toonflow 服务是否运行（localhost:8000）
2. API 路由是否正确
3. 文件路径是否存在
4. metadata JSON 格式是否正确

---

## API 速查

### gold-team（GPU 任务）

```
POST /api/v1/tasks                    ← {task_id, type, params, priority?, callback_url?}
GET  /api/v1/tasks/:task_id
GET  /api/v1/engines
GET  /api/v1/files/:task_id/:filename
GET  /health
```

### 任务类型

| type | 说明 | 引擎 |
|------|------|------|
| `image_draw` | 文生图 | comfyui-local / cloud-jimeng / mock |
| `image_refine` | 图片精炼 | comfyui-local |
| `image_to_3d` | 图生3D (GLB) | hunyuan3d-local / comfyui-local (TRELLIS2) |
| `tts` | 语音合成 | tts-local (edge-tts) |
| `video_final` | 终版视频 | cloud-jimeng / comfyui-local |
| `video_preview` | 预览视频 | comfyui-local |
| `music` | BGM 生成 | cloud-jimeng |
| `sfx` | 音效生成 | mock |

### 提交任务示例

```bash
# 文生图
curl -X POST http://localhost:8002/api/v1/tasks \
  -H 'Content-Type: application/json' \
  -d '{
    "task_id": "ma-$(date +%s)",
    "type": "image_draw",
    "params": {"prompt": "...", "width": 1344, "height": 768, "steps": 20},
    "priority": "normal"
  }'

# 图生3D（Hunyuan3D）
curl -X POST http://localhost:8002/api/v1/tasks \
  -H 'Content-Type: application/json' \
  -d '{
    "task_id": "ma-$(date +%s)",
    "type": "image_to_3d",
    "params": {
      "input_image": "/mnt/agents/output/scene_001.png",
      "output_path": "/mnt/agents/output/ma-xxx/model.glb",
      "model": "full",
      "steps": 50
    },
    "priority": "normal"
  }'

# TTS
curl -X POST http://localhost:8002/api/v1/tasks \
  -H 'Content-Type: application/json' \
  -d '{
    "task_id": "ma-$(date +%s)",
    "type": "tts",
    "params": {"text": "旁白内容", "voice": "default", "backend": "edge-tts"},
    "priority": "normal"
  }'
```

### 3D 引擎选择策略

| 场景 | 引擎 | 说明 |
|------|------|------|
| 角色建模（`3d_character`） | TRELLIS2 (comfyui-local) | 高精度纹理，VRAM ~18G |
| 场景建模（`3d_scene`） | Hunyuan3D (hunyuan3d-local) | 大场景几何，VRAM ~12G |
| 两者都不可用 | 拒绝并汇报 | 不降级到 mock |

选择逻辑：
- `image_to_3d` 类型默认路由到 `hunyuan3d-local`（executor 已硬编码优先匹配）
- 如需指定 TRELLIS2，通过 ComfyUI workflow 方式提交（`type: image_draw` + ComfyUI Trellis2 workflow）
- 3090 串行保证：gold-team executor 单 worker loop，任务排队执行

---

## 反馈回流机制

**最大 3 次迭代**，超出升级汇报用户：

| 失败 Step | 回流目标 | 说明 |
|-----------|---------|------|
| Step 4/6 失败 | → Step 2 | 大纲/剧本结构性问题，回溯到框架 |
| Step 8 失败 | → Step 6 | 运镜不匹配时空剧本 |
| Step 9 失败 | → Step 7 | 一致性 < 0.85 |
| Step 10 失败 | → Step 7 | 云端视频失败，回视觉种子 |

---

## GPU Runtime Manager V5.1 对接

### Stage 映射表

| Phase | Stage | 3090 (推理) | 3060Ti (IO) |
|-------|-------|-----------|--------|
| 角色 | `3d_character` | TRELLIS2 (comfyui) ~18G | NVENC |
| 场景 | `3d_scene` | Hunyuan3D ~12G | - |
| 视觉种子 | `image_refine` | Kontext/FLUX ~16G | - |
| BGM骨架 | `music_base` | ACE Step ~8G | - |
| 预览 | `video_preview` | LTX-Video ~12G | NVENC/ffmpeg |
| 视觉终版 | `video_final` | Wan 14B ~18G | NVENC/ffmpeg |
| 对口型 | `audio_pipeline` (lip_sync) | LatentSync ~7G | - |

---

## 核心原则与禁令

1. **叙事先行**：先立故事骨架，再匹配视觉和角色
2. **审核门不可跳过**：每个 🔒 必须暂停等用户确认
3. **先线稿后渲染**：所有视觉生成必须先线稿锁定构图，再渲染，无例外
4. **积分不设限**：不考虑积分成本，质量优先
5. **反馈最多 3 次**：任何回流路径最多迭代 3 次
6. **禁止跳步**：严格执行 20 步管线
7. **验证闭环**：用户看到什么，才是真正的完成
8. **Toonflow 同步不可跳过**：每个审核门通过后必须同步，同步是进入下一 Step 的前置条件
9. **生图默认 dreamina CLI**：图片生成不用 gold-team，直接用 dreamina CLI（text2image / image2image / image_upscale）
10. **创意必走专家**：所有专业创意步骤（剧本/角色/场景/分镜/运镜/BGM/prompt 工程等）必须通过 ACP 调用 hermes-agent 对应 expert_id（16 个活跃专家 + prompt_injector / script_auditor），禁止用 `hermes_llm` 直接生成专业内容（仅限轻量拼装/汇总）

---

## Git 版本管理

每个 Step 完成后自动 git checkpoint：

```bash
node lib/git-stage-manager.js init <workdir>
node lib/git-stage-manager.js checkpoint <workdir> <step>
node lib/git-stage-manager.js log <workdir>
node lib/git-stage-manager.js rollback <workdir> <step>
```

---

## 子 Skill 列表（管线核心 10/10 ✅）\n
> **V8.2 协作模式**：子 Skill 提供"执行能力"（调即梦、调 GPU、归档、同步），hermes-agent 专家提供"专业知识"（剧本/分镜/运镜/色彩）。
> 每个 Step 的标准流程是：**专家先产出创意 → 子 Skill 拿创意去执行落地**。
> 子 Skill 列表与职责保持不变，专家调用通过 ACP 注入到对应 Step。

| # | Skill | Step | 功能 | 协作的 hermes-agent 专家 |
|---|-------|------|------|--------------------------|
| 1 | kais-topic-radar | 1 | 爆款选题雷达（10大情绪共鸣维度） | `hook_retention` |
| 2 | kais-script-agent | 3, 5 | 大纲生成 + 剧本生成 | `screenplay` |
| 3 | kais-story-score | 6, 12 | 剧本量化分析 + 质量门控 | `script_auditor` |
| 4 | kais-character-designer | 7 | 主角设计（3图一体） | `character_designer` + `visual_executor` (drawer) |
| 5 | kais-scene-designer | 9 | 场景图生成（6图一体） | `cinematographer` + `style_genome` + `visual_executor` (drawer) |
| 6 | kais-spatio-temporal-agent | 11 | 时空剧本生成 | `screenplay` + `cinematographer` |
| 7 | kais-voice | 13B, 18 | 语音锁定 + 声音闭环（TTS） | `audio_pipeline` (voicer + composer + foley + mixer) |
| 8 | kais-camera | 14 | 运镜定稿 + 动态预览 | `cinematographer` |
| 9 | kais-consistency-agent | 16 | 跨镜头一致性守护（DINOv2 > 0.85） | `continuity_auditor` |
| 10 | kais-movie-gate | 20 | 终版质检与交付评分 | `compliance_marketing` |

### 辅助 Skill

| Skill | Step | 功能 |
|-------|------|------|
| kais-review-platform | 审核 | 审核页面 |
| kais-anatomy-guard | 7, 9 | 肢体解剖修复守卫 |

---

> **Step 2 说明**：故事框架+大纲锁定为纯文本产出，直接由 hermes-agent 专家（creative_source + screenplay）通过 ACP 生成，无需子 Skill 落地执行。产出物 `story-framework.json` 作为 Step 3（剧本）的强制输入。

## 外部服务

| 服务 | 用途 | Step |
|------|------|------|
| **hermes-agent（ACP）** | **专业创意生成（16 个活跃 movie-expert + 垂直专家）** | **1, 2.5, 2.5B, 3, 5, 5B, 7, 9, 11, 12, 13, 14, 15, 16, 17B, 18** |
| hermes_llm | 轻量写作（拼装/汇总/格式化） | 全流程 |
| image tool | 图像分析/生成 | 7, 9, 16 |
| 即梦 API (jimeng-5.0) | 文生图（扩展） | 7, 9 |
| Seedance 2.0 (云端) | audio-driven 视频 | 17 |
| gold-team | GPU 统一调度 | 全流程 |
| FFmpeg | 剪辑合成 | 19 |
| GLM-4V-Flash | 图像评价（扩展） | 7, 9, 16 |

## 环境变量

GPU 任务相关 API Key（即梦、Seedance 等）配置在 gold-team 容器的 `.env` 中，skill 层面无需配置。
