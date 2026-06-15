---
name: kais-movie-agent
description: "AI短片全流程自动制作管线 (V8)。OpenClaw 是唯一 LLM 调用者与编排引擎，无 movie-agent 容器依赖。gold-team 只做 GPU 调度。20步管线，审核门不可跳过。"
---

# kais-movie-agent V8 — OpenClaw Agent 纯驱动架构

## 触发词
`movie agent`, `短片制作`, `AI短片`, `视频管线`, `film pipeline`, `movie-wuji`, `AI视频制作`, `短视频管线`, `AI电影`, `影片制作`, `AI短剧`, `短剧制作`, `视频自动化`, `一键生成视频`, `AI拍片`, `kais-movie`, `movie pipeline`, `V8`, `V7`

---

## 🏗️ 架构原则（V8 变更）

### OpenClaw 纯驱动架构

- **Agent 驱动架构**：OpenClaw 是唯一 LLM 调用者与编排引擎
- **不再依赖 movie-agent Docker 容器**（V7 已废弃）
- **Platform (gold-team) 只做 GPU 调度**：接收任务、排队、执行、返回结果
- **状态管理**：用 OpenClaw session 上下文 + 文件系统（不再用 Pipeline API）
- **审核入口**：Telegram inline buttons + Toonflow 审核页面

| 职责 | 执行者 | 工具 |
|------|--------|------|
| **创意生成**（剧本/prompt/场景描述） | OpenClaw Agent | `hermes_llm`, `hermes_llm_vision`, `image` |
| **图片生成**（文生图/图生图） | OpenClaw Agent | **kais-jimeng-cli（默认）** |
| **审核交互**（展示+等用户确认） | OpenClaw Agent | 会话回复 + inline buttons |
| **状态管理**（管线进度） | OpenClaw Agent | session 上下文 + 文件系统 |
| **GPU 渲染**（视频/TTS/3D） | gold-team 容器 | `exec curl → :8002/api/v1/tasks` |
| **文件存储**（产出物） | 文件系统 | 项目 workdir |

### 工具映射

```
创意写作 → hermes_llm(prompt, system)
图像分析 → hermes_llm_vision(prompt, images) 或 image(prompt, images)
文生图   → dreamina text2image --prompt "..." --model_version 5.0 --ratio 16:9 --resolution_type 2k --poll 0
图生图   → dreamina reference2image --prompt "..." --reference-image ./ref.png --reference-strength 0.6 --model_version 5.0 --ratio 3:4 --resolution_type 2k --poll 0
3D生成  → exec curl → gold-team :8002/api/v1/tasks (type: image_to_3d)
TTS     → exec curl → gold-team :8002/api/v1/tasks (type: tts)
视频生成 → exec curl → gold-team :8002/api/v1/tasks (type: video_final)
状态查询 → exec curl → gold-team :8002/api/v1/tasks/:id
审核交互 → Telegram inline buttons / Toonflow 审核页面
```

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

## 管线流程

### 上半部分：创意立项（Steps 1-11）

```
Step 1:  痛点调查 (kais-soul-radar)               → checkpoint
Step 2:  选择主题                                   → 🔒 REVIEW GATE
         └─ 📡 Toonflow: 创建项目 + 同步主题信息
Step 3:  生成大纲 (hermes_llm)                      → checkpoint
Step 4:  选择大纲                                   → 🔒 REVIEW GATE
         └─ 📡 Toonflow: 同步大纲
Step 5:  生成剧本 (hermes_llm)                      → checkpoint
Step 6:  选择剧本                                   → 🔒 REVIEW GATE
         └─ 📡 Toonflow: 同步剧本 (agent-sync --asset-type script)
Step 7:  生成主角·正视图 (image tool)               → checkpoint
        └─ 7A: 正视图审核 (>=7) → 通过
        └─ 7B: 参考7A生成5张侧视图 (reference2image)
        └─ 7C: 侧视图一致性审核 (>=6)
Step 8:  选择主角 → soul-pack.json（含6视图）          → 🔒 REVIEW GATE
         └─ 📡 Toonflow: 同步角色图 (agent-sync --asset-type character_image) ×6
Step 9:  生成场景·俯视图 (image tool)               → checkpoint
        └─ 9A: 俯视图审核 (>=7, 空间可读性)
        └─ 9B: 参考9A生成4张侧面视图 (reference2image)
        └─ 9C: 侧视图一致性审核 (>=6)
Step 10: 选择场景 → geometry-bed.json（含5视图）        → 🔒 REVIEW GATE
         └─ 📡 Toonflow: 同步场景图 (agent-sync --asset-type scene_image) ×5/scene + 保存画布FlowGraph
Step 11: 时空剧本 (hermes_llm)                      → 🔒 REVIEW GATE
         └─ 📡 Toonflow: 同步时空剧本 + 更新画布FlowGraph
```

### 下半部分：生产执行（Steps 12-20）

```
Step 12: 剧本锁定审核                               → 🔒 REVIEW GATE
         └─ 📡 Toonflow: 最终确认画布FlowGraph完整性
Step 13: 种子骨架（13A视觉种子 ∥ 13B声音骨架）      → 🔒 REVIEW GATE
         └─ 📡 Toonflow: 同步视觉种子图 (agent-sync --asset-type scene_image) + 语音 (agent-sync --asset-type voice)
Step 14: 运镜定稿 + 动态预览                         → 🔒 REVIEW GATE
         └─ 📡 Toonflow: 同步预览视频 (agent-sync --asset-type video_preview) ×N
Step 15: AI风格化预览 + Seedance生产包定稿           → 🔒 REVIEW GATE
         └─ 📡 Toonflow: 同步风格化预览
Step 16: 一致性守护检查（DINOv2 > 0.85）            → 阻断/放行
Step 17: 云端终版视频（Seedance 2.0 audio-driven）   → 🔒 REVIEW GATE
         └─ 📡 Toonflow: 同步终版视频 (agent-sync --asset-type video_final) ×N
Step 18: 本地BGM与声音闭环                          → checkpoint
         └─ 📡 Toonflow: 同步BGM + 音效
Step 19: 剪辑合成（FFmpeg）                         → checkpoint
Step 20: 质检与交付                                 → PASS/FAIL
         └─ 📡 Toonflow: 最终交付 + 审核评分写入
```

---

## Agent 执行模式

Agent 逐步执行每个 Step，自己调用 LLM / GPU 任务 / 审核交互：

```
1. Agent 用 hermes_llm 生成内容
2. 展示给用户 → 等确认（Telegram inline buttons / Toonflow）
3. 通过 exec curl 提交 GPU 任务到 gold-team :8002
4. 轮询状态 → 展示结果 → 等确认
5. 进入下一个 Step
```

> **V8 变更**：不再有 Pipeline API 模式，Agent 直接通过 exec curl 调用 gold-team。
> 状态保存在 session 上下文和项目 workdir 文件中。

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
| # | Skill | Step | 功能 |
|---|-------|------|------|
| 1 | kais-soul-radar | 1 | 痛点调查与情感洞察 |
| 2 | kais-script-agent | 3, 5 | 大纲生成 + 剧本生成 |
| 3 | kais-story-score | 6, 12 | 剧本量化分析 + 质量门控 |
| 4 | kais-character-designer | 7 | 主角设计（3图一体） |
| 5 | kais-scene-designer | 9 | 场景图生成（6图一体） |
| 6 | kais-spatio-temporal-agent | 11 | 时空剧本生成 |
| 7 | kais-voice | 13B, 18 | 语音锁定 + 声音闭环（TTS） |
| 8 | kais-camera | 14 | 运镜定稿 + 动态预览 |
| 9 | kais-consistency-agent | 16 | 跨镜头一致性守护（DINOv2 > 0.85） |
| 10 | kais-movie-gate | 20 | 终版质检与交付评分 |

### 辅助 Skill

| Skill | Step | 功能 |
|-------|------|------|
| kais-review-platform | 审核 | 审核页面 |
| kais-anatomy-guard | 7, 9 | 肢体解剖修复守卫 |

---

## 外部服务

| 服务 | 用途 | Step |
|------|------|------|
| hermes_llm | 创意生成（默认） | 全流程 |
| image tool | 图像分析/生成 | 7, 9, 16 |
| 即梦 API (jimeng-5.0) | 文生图（扩展） | 7, 9 |
| Seedance 2.0 (云端) | audio-driven 视频 | 17 |
| gold-team | GPU 统一调度 | 全流程 |
| FFmpeg | 剪辑合成 | 19 |
| GLM-4V-Flash | 图像评价（扩展） | 7, 9, 16 |

## 环境变量

GPU 任务相关 API Key（即梦、Seedance 等）配置在 gold-team 容器的 `.env` 中，skill 层面无需配置。
