---
name: kais-movie-agent
description: "AI短片全流程自动制作管线 (V7)。OpenClaw skill 架构：agent 用 hermes_llm/hermes_llm_vision/image 驱动创作，movie-agent 容器负责状态管理+GPU调度+文件存储。20步管线，审核门不可跳过。"
---

# kais-movie-agent V7 — OpenClaw Agent 驱动架构

## 触发词
`movie agent`, `短片制作`, `AI短片`, `视频管线`, `film pipeline`, `movie-wuji`, `AI视频制作`, `短视频管线`, `AI电影`, `影片制作`, `AI短剧`, `短剧制作`, `视频自动化`, `一键生成视频`, `AI拍片`, `kais-movie`, `movie pipeline`, `V7`

---

## 🏗️ 架构原则（V7 变更）

### Agent 驱动 vs 容器自驱动

| 职责 | 执行者 | 工具 |
|------|--------|------|
| **创意生成**（剧本/prompt/场景描述） | OpenClaw Agent | `hermes_llm`, `hermes_llm_vision`, `image` |
| **审核交互**（展示+等用户确认） | OpenClaw Agent | 会话回复 + inline buttons |
| **状态管理**（pipeline 状态机） | movie-agent 容器 | `POST /api/v1/pipeline/*` |
| **GPU 渲染**（图片/视频/TTS） | gold-team 容器 | `POST /api/v1/tasks` |
| **文件存储**（产出物） | movie-agent 容器 | pipeline workdir |

### LLM 扩展口

Agent 默认用 `hermes_llm` 做创意生成。如果 movie-agent 容器内也有 LLM 能力（如 core-backend 的 universalAi），可以作为 **fallback**：
- Agent 先用自己的 LLM
- 如果需要批处理或离线任务，可以调用 movie-agent 的 pipeline API（容器内部可能用自带 LLM）

### 工具映射

```
创意写作 → hermes_llm(prompt, system)
图像分析 → hermes_llm_vision(prompt, images) 或 image(prompt, images)
图片生成 → image tool / gold-team API
TTS     → gold-team API (tts-local/edge-tts)
视频生成 → gold-team API (cloud-jimeng/seedance/comfyui-local)
状态查询 → exec → curl movie-agent:8001/api/v1/pipeline/:id/status
任务提交 → exec → curl gold-team:8002/api/v1/tasks
```

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

---

## 管线流程

### 上半部分：创意立项（Steps 1-11）

```
Step 1:  痛点调查 (kais-soul-radar)               → checkpoint
Step 2:  选择主题                                   → 🔒 REVIEW GATE
Step 3:  生成大纲 (hermes_llm)                      → checkpoint
Step 4:  选择大纲                                   → 🔒 REVIEW GATE
Step 5:  生成剧本 (hermes_llm)                      → checkpoint
Step 6:  选择剧本                                   → 🔒 REVIEW GATE
Step 7:  生成主角（3图一体, image tool）            → checkpoint
Step 8:  选择主角 → soul-pack.json                  → 🔒 REVIEW GATE
Step 9:  生成场景（6图一体, image tool）            → checkpoint
Step 10: 选择场景 → geometry-bed.json               → 🔒 REVIEW GATE
Step 11: 时空剧本 (hermes_llm)                      → 🔒 REVIEW GATE
```

### 下半部分：生产执行（Steps 12-20）

```
Step 12: 剧本锁定审核                               → 🔒 REVIEW GATE
Step 13: 种子骨架（13A视觉种子 ∥ 13B声音骨架）      → 🔒 REVIEW GATE
Step 14: 运镜定稿 + 动态预览                         → 🔒 REVIEW GATE
Step 15: AI风格化预览 + Seedance生产包定稿           → 🔒 REVIEW GATE
Step 16: 一致性守护检查（DINOv2 > 0.85）            → 阻断/放行
Step 17: 云端终版视频（Seedance 2.0 audio-driven）   → 🔒 REVIEW GATE
Step 18: 本地BGM与声音闭环                          → checkpoint
Step 19: 剪辑合成（FFmpeg）                         → checkpoint
Step 20: 质检与交付                                 → PASS/FAIL
```

---

## Agent 执行模式

### 模式 A：Agent 直接驱动（默认）

Agent 逐步执行每个 Step，自己调用 LLM/图片生成/审核交互：

```
1. Agent 用 hermes_llm 生成内容
2. 展示给用户 → 等确认
3. 通过 gold-team API 提交 GPU 任务
4. 查询状态 → 展示结果 → 等确认
5. 进入下一个 Step
```

### 模式 B：Pipeline API 驱动（批量/离线）

当用户明确要求"自动跑完"或需要离线执行时，通过 movie-agent 容器的 pipeline API：

```bash
# 创建 pipeline
curl -X POST http://localhost:8001/api/v1/pipeline/create \
  -H 'Content-Type: application/json' \
  -d '{"project_id": <ID>}'

# 启动
curl -X POST http://localhost:8001/api/v1/pipeline/<id>/start

# 查状态
curl http://localhost:8001/api/v1/pipeline/<id>/status
```

---

## 服务地址

| 服务 | 地址 | 用途 |
|------|------|------|
| core-backend | localhost:8000 | 项目管理、小说存储 |
| movie-agent | localhost:8001 | Pipeline 状态机 |
| gold-team | localhost:8002 | GPU 渲染引擎 |
| review-platform | localhost:8091 | 审核界面 |
| ComfyUI | 172.17.0.1:8188 | 本地 GPU 推理 |

---

## API 速查

### movie-agent（状态管理）

```
POST /api/v1/pipeline/create          ← {project_id, config?, metadata?}
POST /api/v1/pipeline/:id/start       ← {from_phase?}
POST /api/v1/pipeline/:id/resume      ← {phase, decision?}
GET  /api/v1/pipeline/:id/status
GET  /api/v1/pipeline/:id/phases
POST /api/v1/pipeline/:id/cancel
GET  /health
```

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

| Phase | Stage | 3090 Heavy | 3060Ti |
|-------|-------|-----------|--------|
| 角色 | `3d_character` | TRELLIS ~18G | WD14 |
| 场景 | `3d_scene` | Hunyuan3D ~12G | - |
| 视觉种子 | `image_refine` | Kontext/FLUX ~16G | CosyVoice2 |
| BGM骨架 | `music_base` | ACE Step ~8G | - |
| 预览 | `video_preview` | LTX-Video ~12G | UVR5 |
| 视觉终版 | `video_final` | Wan 14B ~18G | CosyVoice2 |
| 对口型 | `lip_sync` | LatentSync ~7G | CosyVoice2 |

---

## 核心原则与禁令

1. **叙事先行**：先立故事骨架，再匹配视觉和角色
2. **审核门不可跳过**：每个 🔒 必须暂停等用户确认
3. **先线稿后渲染**：所有视觉生成必须先线稿锁定构图，再渲染，无例外
4. **积分不设限**：不考虑积分成本，质量优先
5. **反馈最多 3 次**：任何回流路径最多迭代 3 次
6. **禁止跳步**：严格执行 20 步管线
7. **验证闭环**：用户看到什么，才是真正的完成

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

## 子 Skill 列表

| Skill | Step | 功能 |
|-------|------|------|
| kais-soul-radar | 1 | 痛点调查与情感洞察 |
| kais-script-agent | 3, 5 | 大纲生成 + 剧本生成 |
| kais-spatio-temporal-agent | 11 | 时空剧本生成 |
| kais-consistency-agent | 16 | 跨镜头一致性守护 |
| kais-scene-designer | 9 | 场景图生成 |
| kais-character-designer | 7 | 主角设计 |
| kais-camera | 14 | 运镜定稿 |
| kais-voice | 13B, 18 | 语音锁定 + 声音闭环 |
| kais-review-platform | 审核 | 审核页面 |
| kais-anatomy-guard | 7, 9 | 肢体解剖修复守卫 |
| kais-story-score | 6, 12 | 剧本量化分析 |

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
- `JIMENG_SESSION_ID`: 即梦 session ID
- `JIMENG_API_URL`: 即梦 API 地址
- `ZHIPU_API_KEY`: 智谱 API Key
- `SEEDANCE_API_KEY`: Seedance 2.0 API Key
