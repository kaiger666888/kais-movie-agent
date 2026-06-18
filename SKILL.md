---
name: kais-movie-agent
description: "AI短片全流程自动制作管线 (V8.2)。OpenClaw 是唯一编排引擎，创意生成通过 ACP 调用 hermes-agent 的 20 个 movie-expert 专家。gold-team 只做 GPU 调度。20步管线，审核门不可跳过。"
---

# kais-movie-agent V8.2 — OpenClaw 编排 + hermes-agent 专家驱动架构

## 触发词
`movie agent`, `短片制作`, `AI短片`, `视频管线`, `film pipeline`, `movie-wuji`, `AI视频制作`, `短视频管线`, `AI电影`, `影片制作`, `AI短剧`, `短剧制作`, `视频自动化`, `一键生成视频`, `AI拍片`, `kais-movie`, `movie pipeline`, `V8`, `V7`

---

## 🏗️ 架构原则（V8.2 变更）

### OpenClaw 编排 + hermes-agent 专家驱动架构

- **OpenClaw 是唯一编排引擎**：调度子 Skill、走审核门、同步 Toonflow
- **创意生成走 ACP**：通过 `sessions_spawn(runtime="acp", agentId="hermes-agent")` 调用 20 个 movie-expert
- **不再依赖 movie-agent Docker 容器**（V7 已废弃）
- **Platform (gold-team) 只做 GPU 调度**：接收任务、排队、执行、返回结果
- **状态管理**：用 OpenClaw session 上下文 + 文件系统（不再用 Pipeline API）
- **审核入口**：Telegram inline buttons + Toonflow 审核页面

| 职责 | 执行者 | 工具 |
|------|--------|------|
| **专业创意生成**（剧本/角色/场景/分镜/运镜/BGM） | **hermes-agent 专家系统**（通过 ACP） | `sessions_spawn(runtime="acp", agentId="hermes-agent")` → `skill_invoke(expert_id, input, context)` |
| **执行落地**（图片生成、prompt 组装、产物归档） | OpenClaw Agent + 子 Skill | `hermes_llm`, `hermes_llm_vision`, `image`, `kais-jimeng-cli` |
| **图片生成**（文生图/图生图） | OpenClaw Agent | **kais-jimeng-cli（默认）** |
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
图生图   → dreamina reference2image --prompt "..." --reference-image ./ref.png --reference-strength 0.6 --model_version 5.0 --ratio 3:4 --resolution_type 2k --poll 0
3D生成  → exec curl → gold-team :8002/api/v1/tasks (type: image_to_3d)
TTS     → exec curl → gold-team :8002/api/v1/tasks (type: tts)
视频生成 → exec curl → gold-team :8002/api/v1/tasks (type: video_final)
状态查询 → exec curl → gold-team :8002/api/v1/tasks/:id
审核交互 → Telegram inline buttons / Toonflow 审核页面
```

### hermes-agent 专家 → 管线 Step 速查

通过 ACP 调用 `skill_invoke(expert_id=...)`，可用 20 个 movie-expert：

| Step | 用途 | expert_id |
|------|------|-----------|
| Step 1 | 爆款选题雷达（kais-topic-radar 10维情绪共鸣） | `hook_retention` |
| Step 2 | 主题生成（基于 Topic Kernel 共鸣公式筛选） | `hook_retention` |
| Step 2.5 | 故事框架锁定（叙事结构+人物关系+冲突+节奏） | `creative_source` + `screenplay` |
| Step 3 | 大纲生成 | `screenplay` |
| Step 5 | 剧本生成 | `screenplay` |
| Step 7 | 主角设计 | `character_designer` + `drawer` |
| Step 9 | 场景设计 | `scene_builder` + `drawer` |
| Step 11 | 时空剧本 | `screenplay` + `cinematographer` |
| Step 13A | 视觉种子 | `drawer` + `style_genome` |
| Step 13B | 声音骨架 | `composer` + `foley` |
| Step 14 | 运镜 | `cinematographer` |
| Step 15 | 风格化 | `colorist` + `style_genome` |
| Step 16 | 一致性 | `continuity` |
| Step 18 | BGM | `composer` + `mixer` |

**其他可用专家**（按需补充调用）：`animator`, `editor`, `performer`, `spatial_audio`, `production`, `compliance_marketing`, `lip_sync`, `script_auditor`, `storyboard_designer`

### 图片生成默认引擎

**所有图片生成（文生图、图生图、角色参考图、场景图）默认使用 kais-jimeng-cli（即梦 API）。**

- **不经过 gold-team** 图片生成（gold-team 仅供视频/TTS/3D）
- **不使用内置 image tool 生成图片**（仅用于分析）
- **dreamina CLI 用法**：先提交（`--poll 0`），轮询结果（`dreamina query_result --submit_id ID`），下载图片（`aria2c URL`）
- **降级**：即梦限流/超时 → gold-team `image_draw`（comfyui-local / cloud-jimeng）

---

## ⚠️ 强制审核门（Review Gate）

**以下 Step 完成后必须暂停，展示产出物给用户审核，收到确认后才能继续：**

| Step | 审核内容 | 展示方式 |
|------|---------|---------|
| Step 2 | 主题选择 | 当前会话 |
| Step 2.5 | 故事框架选择 | 当前会话 |
| Step 4 | 大纲选择 | 当前会话 |
| Step 6 | 剧本选择 | 当前会话 |
| Step 8 | 主角选择（3图一体） | 当前会话 |
| Step 10 | 场景选择（6图一体） | 当前会话 |
| Step 11 | 时空剧本 | 当前会话 |
| Step 12 | 剧本锁定终审 | 当前会话 |
| Step 13 | 种子骨架（视觉+声音） | 当前会话 |
| Step 14 | 运镜预览 | 当前会话 |
| Step 15 | AI风格化预览 | 当前会话 |
| Step 17 | 云端终版视频 | 当前会话 |

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
| Step 2.5 | 故事框架 | 🔵 极低（纯文本） | **3个** | 选1个或要求合并/修改 |
| Step 4 | 大纲 | 🔵 低（中等文本） | **6个** | 选1个或要求合并/修改 |
| Step 6 | 剧本 | 🟡 中（长文本+LLM推理） | **3个** | 选1个或要求修改 |
| Step 8 | 主角 | 🟠 高（图片生成） | 1组（正面+5侧，6视图） | 选1组或重做 |
| Step 10 | 场景 | 🟠 高（图片生成） | 1组（俯+4侧，5视图/场景） | 选1组或重做 |
| Step 11 | 时空剧本 | 🟡 中（文本） | **3个**运镜方案 | 选1个或合并 |
| Step 13 | 视觉种子 | 🔴 极高（多张图片） | 按场景数 | 逐场景审核 |
| Step 17 | 终版视频 | 🔴 极高（云端渲染） | 不冗余 | 通过/重做 |

- **所有未选中**的备选（文本/图片/视频）统一存档到项目 workdir `candidates/<step>/` 目录
- 文本存原始内容，图片/视频存文件 + 生成参数（prompt/model/score）
- 用途：分支拓展（从任意节点重新出发）、正反数据集积累、风格对比参考
- 每个备选标记元数据：`selected: true/false`、`score`、`reason`（选中/未选原因）

---

## 管线流程

### 上半部分：创意立项（Steps 1-11）

```
Step 1:  爆款选题雷达 (kais-topic-radar)               → checkpoint
         🎙️ hermes-agent expert: hook_retention
Step 2:  基于 Topic Kernel 生成×10主题 → 用户选择   → 🔒 REVIEW GATE
         🎙️ hermes-agent expert: hook_retention
         └─ 输入: Step 1 的 Topic Kernel（共鸣公式+目标人群+情绪维度）
         └─ 输出: 10个主题方案（每个带 virality_score + safety_score + hook_pattern）
         └─ 筛选: 只保留 virality_score ≥ 7 且 safety_score ≥ 8 的主题
         └─ 📡 Toonflow: 创建项目 + 同步主题信息
Step 2.5: 故事框架锁定（叙事结构+人物关系+冲突设计+节奏策略）→ 🔒 REVIEW GATE  ← 新增
         🎙️ hermes-agent expert: creative_source (故事内核/雪花法展开) + screenplay (叙事结构选择)
         └─ 生成×3框架方案（不同叙事结构/节奏策略）
         └─ 用户选择1个框架 → story-framework.json
         └─ 📡 Toonflow: 同步故事框架
Step 3:  生成×6大纲                                → checkpoint
         🎙️ hermes-agent expert: screenplay
Step 4:  选择大纲（6选1）                           → 🔒 REVIEW GATE
         └─ 📡 Toonflow: 同步大纲
Step 5:  生成×3剧本                                → checkpoint
         🎙️ hermes-agent expert: screenplay
Step 6:  选择剧本（3选1）                           → 🔒 REVIEW GATE
         └─ 📡 Toonflow: 同步剧本 (agent-sync --asset-type script)
Step 7:  生成主角·正视图 (kais-jimeng-cli)         → checkpoint
         🎙️ hermes-agent experts: character_designer (角色设定) + drawer (出图 prompt)
        └─ 7A: 正视图审核 (>=7) → 通过
        └─ 7B: 参考7A生成5张侧视图 (reference2image)
        └─ 7C: 侧视图一致性审核 (>=6)
Step 8:  选择主角 → soul-pack.json（含6视图）          → 🔒 REVIEW GATE
         └─ 📡 Toonflow: 同步角色图 (agent-sync --asset-type character_image) ×6
Step 9:  生成场景·俯视图 (kais-jimeng-cli)         → checkpoint
         🎙️ hermes-agent experts: scene_builder (空间结构) + drawer (出图 prompt)
        └─ 9A: 俯视图审核 (>=7, 空间可读性)
        └─ 9B: 参考9A生成4张侧面视图 (reference2image)
        └─ 9C: 侧视图一致性审核 (>=6)
Step 10: 选择场景 → geometry-bed.json（含5视图）        → 🔒 REVIEW GATE
         └─ 📡 Toonflow: 同步场景图 (agent-sync --asset-type scene_image) ×5/scene + 保存画布FlowGraph
Step 11: 生成×3时空剧本（不同运镜方案）→ 用户选择      → 🔒 REVIEW GATE
         🎙️ hermes-agent experts: screenplay (剧本) + cinematographer (镜头语言)
         └─ 📡 Toonflow: 同步时空剧本 + 更新画布FlowGraph
```

### 下半部分：生产执行（Steps 12-20）

```
Step 12: 剧本锁定审核                               → 🔒 REVIEW GATE
         └─ 📡 Toonflow: 最终确认画布FlowGraph完整性
Step 13: 种子骨架（13A视觉种子 ∥ 13B声音骨架）      → 🔒 REVIEW GATE
         🎙️ 13A: drawer + style_genome
         🎙️ 13B: composer + foley
         └─ 📡 Toonflow: 同步视觉种子图 (agent-sync --asset-type scene_image) + 语音 (agent-sync --asset-type voice)
Step 14: 运镜定稿 + 动态预览                         → 🔒 REVIEW GATE
         🎙️ hermes-agent expert: cinematographer
         └─ 📡 Toonflow: 同步预览视频 (agent-sync --asset-type video_preview) ×N
Step 15: AI风格化预览 + Seedance生产包定稿           → 🔒 REVIEW GATE
         🎙️ hermes-agent experts: colorist + style_genome
         └─ 📡 Toonflow: 同步风格化预览
Step 16: 一致性守护检查（DINOv2 > 0.85）            → 阻断/放行
         🎙️ hermes-agent expert: continuity
Step 17: 云端终版视频（Seedance 2.0 audio-driven）   → 🔒 REVIEW GATE
         └─ 📡 Toonflow: 同步终版视频 (agent-sync --asset-type video_final) ×N
Step 18: 本地BGM与声音闭环                          → checkpoint
         🎙️ hermes-agent experts: composer + mixer
         └─ 📡 Toonflow: 同步BGM + 音效
Step 19: 剪辑合成（FFmpeg）                         → checkpoint
Step 20: 质检与交付                                 → PASS/FAIL
         └─ 📡 Toonflow: 最终交付 + 审核评分写入
```

---

## Agent 执行模式

Agent 逐步执行每个 Step，通过 ACP 调用 hermes-agent 专家生成创意、再走子 Skill 落地、然后 GPU 渲染：

```
1. Agent 通过 ACP 调用 hermes-agent 对应 expert_id 生成专业创意内容
2. Agent 用子 Skill 执行落地（生成图片 prompt、调用 kais-jimeng-cli、归档产物）
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

OpenClaw Agent 通过 ACP 调用 hermes-agent 的 20 个 movie-expert skill：

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

`screenplay`, `drawer`, `animator`, `editor`, `colorist`, `composer`, `performer`,
`scene_builder`, `foley`, `spatial_audio`, `mixer`, `continuity`, `style_genome`,
`cinematographer`, `hook_retention`, `production`, `compliance_marketing`,
`character_designer`, `lip_sync`, `script_auditor`, `storyboard_designer`

### 调用示例

#### Step 2.5 故事框架锁定（creative_source + screenplay 协同）

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

#### Step 7 主角设计（character_designer + drawer 协同）

```python
session = sessions_spawn(runtime="acp", agentId="hermes-agent")

# 1. character_designer：角色设定
char_spec = session.skill_invoke(
    expert_id="character_designer",
    input="为剧本《...》设计主角：年龄/职业/性格/标志性视觉元素",
    context=locked_script
)

# 2. drawer：把角色设定翻译成 kais-jimeng-cli 可用的 prompt
draw_prompt = session.skill_invoke(
    expert_id="drawer",
    input="根据角色设定生成正视图文生图 prompt（含比例/光影/风格）",
    context=char_spec
)

# 3. 子 Skill kais-character-designer 落地：调用 kais-jimeng-cli 出图
character_image = kais_character_designer.generate(prompt=draw_prompt)
```

#### Step 14 运镜（cinematographer）

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
| **专业知识**（剧本结构、镜头语言、色彩理论、音乐编排） | hermes-agent 专家 | 产出"想法/设定/prompt 草稿/评分依据" |
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

#### 4. 同步语音（Step 13B, 18）
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

#### 5. 同步预览视频（Step 14）
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

#### 6. 同步终版视频（Step 17）
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

**Step 10 和 Step 12** 完成后，必须额外保存画布 FlowGraph JSON，确保 Toonflow 无限画布能正确展示项目全貌：

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
| Step 4/6 失败 | → Step 2.5 | 大纲/剧本结构性问题，回溯到框架 |
| Step 14 失败 | → Step 11 | 运镜不匹配时空剧本 |
| Step 15 失败 | → Step 13 或 Step 8 | 风格不达标 |
| Step 16 失败 | → Step 13 | 一致性 < 0.85 |
| Step 17 失败 | → Step 15 或 Wan 2.2 兜底 | 云端失败 |
| Step 19 失败 | → 视觉回 Step 17，声音回 Step 18 | 剪辑失败 |

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
| 对口型 | `lip_sync` | LatentSync ~7G | - |

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
9. **生图默认 kais-jimeng-cli**：图片生成不用 gold-team，直接用即梦 API
10. **创意必走专家**：所有专业创意步骤（剧本/角色/场景/分镜/运镜/BGM 等）必须通过 ACP 调用 hermes-agent 对应 expert_id，禁止用 `hermes_llm` 直接生成专业内容（仅限轻量拼装/汇总）

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
| 4 | kais-character-designer | 7 | 主角设计（3图一体） | `character_designer` + `drawer` |
| 5 | kais-scene-designer | 9 | 场景图生成（6图一体） | `scene_builder` + `drawer` |
| 6 | kais-spatio-temporal-agent | 11 | 时空剧本生成 | `screenplay` + `cinematographer` |
| 7 | kais-voice | 13B, 18 | 语音锁定 + 声音闭环（TTS） | `composer` + `foley` + `mixer` |
| 8 | kais-camera | 14 | 运镜定稿 + 动态预览 | `cinematographer` |
| 9 | kais-consistency-agent | 16 | 跨镜头一致性守护（DINOv2 > 0.85） | `continuity` |
| 10 | kais-movie-gate | 20 | 终版质检与交付评分 | `compliance_marketing` |

### 辅助 Skill

| Skill | Step | 功能 |
|-------|------|------|
| kais-review-platform | 审核 | 审核页面 |
| kais-anatomy-guard | 7, 9 | 肢体解剖修复守卫 |

---

> **Step 2.5 说明**：故事框架锁定为纯文本产出，直接由 hermes-agent 专家（creative_source + screenplay）通过 ACP 生成，无需子 Skill 落地执行。产出物 `story-framework.json` 作为 Step 3（大纲）和 Step 5（剧本）的强制输入。

## 外部服务

| 服务 | 用途 | Step |
|------|------|------|
| **hermes-agent（ACP）** | **专业创意生成（20 个 movie-expert）** | **1, 3, 5, 7, 9, 11, 13, 14, 15, 16, 18** |
| hermes_llm | 轻量写作（拼装/汇总/格式化） | 全流程 |
| image tool | 图像分析/生成 | 7, 9, 16 |
| 即梦 API (jimeng-5.0) | 文生图（扩展） | 7, 9 |
| Seedance 2.0 (云端) | audio-driven 视频 | 17 |
| gold-team | GPU 统一调度 | 全流程 |
| FFmpeg | 剪辑合成 | 19 |
| GLM-4V-Flash | 图像评价（扩展） | 7, 9, 16 |

## 环境变量

GPU 任务相关 API Key（即梦、Seedance 等）配置在 gold-team 容器的 `.env` 中，skill 层面无需配置。
