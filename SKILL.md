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
| **审核交互**（展示+等用户确认） | OpenClaw Agent | 会话回复 + inline buttons |
| **状态管理**（管线进度） | OpenClaw Agent | session 上下文 + 文件系统 |
| **GPU 渲染**（图片/视频/TTS） | gold-team 容器 | `exec curl → :8002/api/v1/tasks` |
| **文件存储**（产出物） | 文件系统 | 项目 workdir |

### 工具映射

```
创意写作 → hermes_llm(prompt, system)
图像分析 → hermes_llm_vision(prompt, images) 或 image(prompt, images)
图片生成 → exec curl → gold-team :8002/api/v1/tasks (type: image_draw)
TTS     → exec curl → gold-team :8002/api/v1/tasks (type: tts)
视频生成 → exec curl → gold-team :8002/api/v1/tasks (type: video_final)
状态查询 → exec curl → gold-team :8002/api/v1/tasks/:id
审核交互 → Telegram inline buttons / Toonflow 审核页面
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

| Phase | Stage | 3090 (推理) | 3060Ti (IO) |
|-------|-------|-----------|--------|
| 角色 | `3d_character` | TRELLIS ~18G | NVENC |
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
