# kais-movie-agent 工程架构与详尽工作流

> 版本: v1.0 | 更新: 2026-05-18 | 状态: Phase 0-4A 全部完成

---

## 1. 项目概览

kais-movie-agent 是一个 AI 短片全自动生产管线，从需求输入到成片输出，覆盖编剧、角色设计、配音、场景生成、分镜、视频合成、质量评估的完整流程。

### 核心设计原则

| 原则 | 说明 |
|------|------|
| **零 npm 依赖** | 全部使用原生 fetch + Node.js 内置模块 |
| **ES Module** | 所有客户端使用 `export class` 模式 |
| **降级优先** | 外部服务不可用时系统仍可运行 |
| **HMAC-SHA256** | 回调签名验证确保安全 |
| **幂等执行** | 管线中断后可安全重跑，已完成阶段自动跳过 |

### 技术栈

- **运行时**: Node.js (ES Module)
- **版本控制**: Git + 自定义 GitStageManager（阶段级检查点）
- **外部服务**: gold-team GPU 调度、review-platform 审核、即梦 API、智谱 GLM
- **通知**: Telegram Bot
- **安全**: HMAC-SHA256 签名验证

---

## 2. 系统架构

```
┌──────────────────────────────────────────────────────────────┐
│                     kais-movie-agent                         │
│                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐      │
│  │ bin/         │    │ lib/        │    │ shared/     │      │
│  │ pipeline.js  │───▶│ pipeline.js │    │ hmac_node.js│      │
│  │ callback-    │    │ phases/     │    └──────┬──────┘      │
│  │ server.js    │    │ gold-team-  │           │              │
│  └──────┬───────┘    │ client.js   │◀──────────┘              │
│         │            │ review-     │                          │
│         │            │ platform-   │    ┌─────────────┐      │
│         │            │ client.js   │    │ lib/hooks/  │      │
│         │            │ interactive-│    │ index.js    │      │
│         │            │ review.js   │    │ 25+ hooks   │      │
│         │            │ git-stage-  │    └─────────────┘      │
│         │            │ manager.js  │                          │
│         │            └──────┬──────┘                          │
│         │                   │                                 │
└─────────┼───────────────────┼─────────────────────────────────┘
          │                   │
          ▼                   ▼
┌─────────────────┐  ┌─────────────────┐
│  Callback Server │  │  Gold-Team GPU  │
│  (HTTP :3000)    │  │  (44 task types)│
│  - /callback/    │  │  - TTS          │
│    review_result │  │  - FLUX 图像    │
│  - /callback/    │  │  - VIDEO 视频   │
│    gpu_task      │  │  - MUSIC/SFX    │
└────────┬─────────┘  │  - LIP_SYNC     │
         │            └─────────────────┘
         ▼
┌─────────────────┐
│ Review Platform  │
│ (审核平台)       │
│ - 多候选审核     │
│ - AI 评分        │
│ - 回调通知       │
└─────────────────┘
```

### 文件结构与职责

```
kais-movie-agent/
├── bin/
│   ├── pipeline.js          # 管线 CLI 入口（启动/断点续作）
│   ├── callback-server.js   # 回调 HTTP 服务器（审核+GPU）
│   └── git-stage.js         # Git 阶段管理 CLI
├── lib/
│   ├── pipeline.js          # 管线编排器（576行）
│   ├── phases/index.js      # Phase handlers + GPU 集成函数（1157行）
│   ├── gold-team-client.js  # GPU 任务调度客户端（269行）
│   ├── review-platform-client.js # 审核平台客户端（221行）
│   ├── interactive-review.js # Canvas 审核界面
│   ├── git-stage-manager.js # Git 版本管理器
│   ├── hooks/index.js       # 25+ 业务钩子函数
│   ├── quality-gate.js      # 质量门控
│   ├── llm.js               # LLM 集成
│   └── jimeng-client.js     # 即梦 API 客户端
├── shared/
│   └── hmac_node.js         # HMAC-SHA256 签名工具（49行）
├── test/
│   └── phase4a-gpu-integration.test.js  # Phase 4A 测试（16 tests）
├── .planning/               # GSD 工作流规划文档
│   ├── ROADMAP.md
│   ├── STATE.md
│   ├── PROJECT.md
│   └── REQUIREMENTS.md
└── INTEGRATION.md           # 集成开发指导
```

---

## 3. 管线流程 (Pipeline Flow)

### 10 阶段管线

```
 1. requirement ──▶ 2. art-direction ──▶ 3. character ──▶ 4. scenario
      (需求确认)         (美术方向)          (角色设计)       (剧本编写)
                                                                │
 8.5. quality-gate ◀── 8. post-production ◀── 7. camera ◀── 4.5. voice
     (质量门控)          (后期合成)           (视频生成)      (配音)
                                                                │
                                                                ▼
                                                         6. storyboard ◀── 5. scene
                                                          (分镜板)         (场景图)
```

### Phase 定义

| # | Phase ID | 名称 | 审核模式 | 输出文件 |
|---|----------|------|----------|----------|
| 1 | `requirement` | 需求确认 | 无 | requirement.json, brief.md, blueprint.json |
| 2 | `art-direction` | 美术方向 | 3选1 | art_direction.json, mood_board.png |
| 3 | `character` | 角色设计 | 多选 + 评分 | characters.json, assets/characters/ |
| 4 | `scenario` | 剧本编写 | 无 | scenario.json, story_bible.json |
| 4.5 | `voice` | 配音 | 单选 | voice_assignments.json, assets/tts/ |
| 5 | `scene` | 场景图生成 | 多选 + 评分 | scene_design.json, assets/scenes/ |
| 6 | `storyboard` | 分镜板 | 多选 + 评分 | storyboard.json, shots.json |
| 7 | `camera` | 视频生成 | 多选 + 评分 | video_tasks.json, output/ |
| 8 | `post-production` | 后期合成 | 无 | final.mp4, qc_report.json |
| 8.5 | `quality-gate` | 质量门控 | 无 | quality_report.json |

### Phase 执行流程

每个 Phase 的执行遵循以下模式：

```
1. 检查状态 → 已完成则跳过
2. before hook → 预处理（如恢复 DNA）
3. execute 或 after hook → 业务逻辑
4. 保存状态 → .pipeline-state.json
5. 审核检查 → 需要审核则提交 review-platform
6. Git checkpoint → 阶段快照
7. Telegram 通知 → 进度更新
```

---

## 4. Phase 详解

### 4.1 Requirement (需求确认)

**职责**: 解析用户输入，生成四维蓝图、受众匹配、选题发散

**流程**:
1. 保存 requirement.json
2. 调用 `generateBlueprint()` 生成四维蓝图（主题、风格、节奏、受众）
3. 调用 `audienceMatch()` 进行受众匹配分析
4. 调用 `generateTopics()` 发散候选选题

**输入**: `{ title, genre, duration_sec, theme, characters, style_preference }`
**输出**: requirement.json + audience-match.json + candidate-topics.json

### 4.2 Art-Direction (美术方向)

**职责**: 生成美术方向候选图，支持 FLUX GPU 引擎

**GPU 模式** (通过 `config.goldTeam.enableFluxArt` 启用):
1. 检测 gold-team 可用性（ping）
2. 提交 `image_draw` 任务（FLUX schnell, 1024x1024, 3候选）
3. 等待任务完成（轮询 5s/次，最长 10min）
4. 收集产物路径，构建审核候选

**降级**: gold-team 不可用时使用即梦 API

**候选引擎**:
| 任务类型 | 用途 |
|----------|------|
| `image_draw` | FLUX 文生图（推荐，速度快） |
| `image_refine` | FLUX 图像精修（已有草图时） |
| `image_control` | FLUX ControlNet（有参考图时） |

### 4.3 Character (角色设计)

**职责**: 角色设计 + DNA 注册 + 姿态参考图

**流程**:
1. 注册 Character DNA（一致性锚定）
2. 生成姿态参考图（可选，Mixamo 模式）
3. 构建审核候选

**Character DNA**: 跨阶段角色一致性系统，通过参考图锚定而非 seed

### 4.4 Scenario (剧本编写)

**职责**: 剧本分析 + 受众测评 + 量化评估

**流程**:
1. 深度受众分析（`deepAudienceAnalysis`）
2. 剧本量化分析（`analyzeScript` — kais-story-score）
3. 生成 5 维度评分报告（弧线、情感覆盖、TTR 等）

### 4.5 Voice (配音)

**职责**: TTS 语音合成 + 声音克隆 + 变声

**三种模式**:

```
优先级: gold-team TTS > ZHIPU GLM-TTS > 占位文件
```

| 模式 | 触发条件 | 说明 |
|------|----------|------|
| gold-team TTS | `ping()` 成功 | 提交 `tts_generation` 任务，轮询等待 |
| 声音克隆 | `config.goldTeam.enableVoiceClone` | 提交 `voice_clone` 任务 |
| 变声 | `config.goldTeam.enableVoiceClone` | 提交 `voice_convert` 任务 |
| 本地 ZHIPU | gold-team 不可用 | 调用 GLM-TTS API |
| 占位文件 | 都不可用 | 生成空占位，不阻断管线 |

**对白数据来源** (按优先级):
1. `phaseConfig.data.dialogueLines`
2. `scenario.json` → `dialogues[]`
3. `scenario.json` → `scenes[].shots[].dialogue`
4. `scenario.json` → `lines[]`

### 4.6 Scene (场景图生成)

**职责**: 场景图 DNA 注册 + 审核候选收集

### 4.7 Storyboard (分镜板)

**职责**: 分镜生成 + 姿态参考 + 审核候选

### 4.8 Camera (视频生成)

**职责**: 视频片段生成，支持 GPU 引擎

**GPU 模式** (通过 `config.goldTeam.enableVideoGpu` 启用):

| 模式 | 任务类型 | 参数 |
|------|----------|------|
| 正式 | `video_final` | 81帧, 20步推理, 优先级10 |
| 预览 | `video_preview_fast` | 33帧, 10步推理, 优先级1 |
| 帧插值 | `video_interpolate` | 提升帧率 |
| 风格转换 | `video_to_video` | 视频风格化 |

**before hook**: 恢复角色 DNA + 场景 DNA，注入参考图到 config

### 4.9 Post-Production (后期合成)

**职责**: 配乐生成 + 音效生成 + 音频分离

**GPU 模式** (通过 config 开关控制):

| 功能 | 任务类型 | 开关 |
|------|----------|------|
| 配乐 | `music_final` | `config.goldTeam.enableBGM` |
| 音效 | `sfx_generation` | `config.goldTeam.enableSFX` |
| 音频分离 | `audio_separate` | — |

### 4.10 Quality-Gate (质量门控)

**职责**: 综合质量评估，判定 PASS/FAIL

**流程**:
1. 调用 `assessQuality()` 进行多维度评估
2. 注入 story-score 数据（5维度量化）
3. 对比阈值（默认 65 分）
4. 低于阈值抛出 `QUALITY_GATE_FAILED` 错误

**评分维度**: 包含 story-score 的弧线形状、情感覆盖、文本质量(TTR)

---

## 5. 外部服务集成

### 5.1 Gold-Team GPU 调度

**客户端**: `lib/gold-team-client.js` (GoldTeamClient)

**认证方式**: X-API-Key Header

**核心 API**:

| 方法 | 端点 | 说明 |
|------|------|------|
| `submitTask()` | POST /api/tasks | 提交 GPU 任务 |
| `getTask()` | GET /api/tasks/:id | 查询任务状态 |
| `listTasks()` | GET /api/tasks | 列出任务 |
| `waitForTask()` | — | 轮询等待（5s/次，10min 超时） |
| `submitTTS()` | POST /api/tasks | TTS 快捷方法 |
| `submitTaskDegraded()` | — | 带降级的提交 |
| `ping()` | GET /health | 健康检查（5s 超时） |

**支持的 44 种任务类型** (Phase 4A 已接入):

| 类别 | 任务类型 | Phase |
|------|----------|-------|
| 图像 | `image_draw`, `image_refine`, `image_control` | art-direction |
| 视频 | `video_final`, `video_preview_fast`, `video_interpolate`, `video_to_video` | camera |
| 语音 | `tts_generation`, `voice_clone`, `voice_convert` | voice |
| 音频 | `music_final`, `sfx_generation`, `audio_separate` | post-production |
| 口型 | `lip_sync_rt` | lip-sync |

**回调机制**: 任务完成后 gold-team 调用 `/callback/gpu_task`，携带 HMAC-SHA256 签名

### 5.2 Review Platform 审核

**客户端**: `lib/review-platform-client.js` (ReviewPlatformClient)

**认证方式**: JWT Token（自动管理，含安全边际刷新）

**核心 API**:

| 方法 | 说明 |
|------|------|
| `submitReview()` | 提交审核（含 candidates, scoring, feedback） |
| `queryReviewStatus()` | 查询审核状态 |

**审核请求结构**:
```javascript
{
  type: 'pipeline_phase',
  contentRef: 'EP01:camera',
  metadata: {
    phase_name: '视频生成',
    candidates: [{ id, label, image_url }],
    select_mode: 'single' | 'multi',
    enable_scoring: true,
    enable_feedback: true,
    preview_images: [base64...]  // 最多3张
  },
  callbackUrl: 'http://host:port/callback/review_result',
  riskScore: 0.5
}
```

**降级策略**: 服务不可用时自动放行（DEGRADED_AUTO + APPROVED）

---

## 6. 回调服务器

**入口**: `bin/callback-server.js` (HTTP Server)

### 路由

| 路由 | 来源 | 功能 |
|------|------|------|
| `POST /callback/review_result` | review-platform | 处理审核结果 |
| `POST /callback/gpu_task` | gold-team | 处理 GPU 任务完成 |

### 审核回调流程

```
review-platform 回调
    │
    ▼
1. HMAC 签名验证
    │
    ▼
2. 解析 payload (action, selected, scores, feedback)
    │
    ├─ action=approved → 恢复管线执行（spawn detached process）
    │
    └─ action=rejected → Git rollback + Telegram 通知
```

### GPU 任务回调流程

```
gold-team 回调
    │
    ▼
1. HMAC 签名验证
    │
    ▼
2. 解析 payload (task_id, state, artifacts)
    │
    ▼
3. 保存产物信息到管线状态
```

### 安全机制

- **HMAC-SHA256**: 所有回调使用 `shared/hmac_node.js` 签名验证
- **时序安全比较**: `crypto.timingSafeEqual` 防止时序攻击
- **开发模式**: `REVIEW_CALLBACK_SECRET=dev` 时跳过验证（仅限本地开发）

---

## 7. 降级策略

### 设计原则: 降级优先

外部服务不可用时系统仍可运行，每个集成点都有降级路径。

### 降级层级

```
Layer 1: 服务级降级
├── gold-team 不可用 → 回退本地 API（ZHIPU/即梦）或跳过
├── review-platform 不可用 → 自动放行 (DEGRADED_AUTO)
└── Telegram 不可用 → 静默跳过

Layer 2: 任务级降级
├── submitTaskDegraded() → 返回 DEGRADED_SKIPPED，不抛错
└── submitTTSDegraded() → 同上

Layer 3: Phase 级降级
├── Phase handler 中 GoldTeamError 被捕获 → warn + continue
└── 质量评估异常 → 直接标记失败
```

### 降级审计

所有降级事件通过 JSON 结构化日志记录：
```json
{
  "ts": "2026-05-18T10:00:00.000Z",
  "event": "gpu_task_degraded",
  "taskType": "image_draw",
  "reason": "请求超时: POST /api/tasks"
}
```

---

## 8. 状态管理与断点续作

### 状态文件: `.pipeline-state.json`

```json
{
  "episode": "EP01",
  "traceId": "uuid",
  "startedAt": "2026-05-18T10:00:00.000Z",
  "completedAt": null,
  "currentPhaseId": "camera",
  "phases": {
    "requirement": { "status": "completed", "completedAt": "..." },
    "art-direction": { "status": "awaiting_review", "review_id": "rev-123" },
    "camera": { "status": "failed", "error": "质量门控未通过" }
  }
}
```

### 幂等执行

`run()` 和 `resume()` 自动跳过已完成的阶段：
- `completed` → 跳过
- `approved` → 跳过
- `awaiting_review` → 跳过（等待回调）

### Git 检查点

每个 Phase 完成后自动创建 Git checkpoint：
```
git commit -m "checkpoint: requirement (Phase 1)"
git commit -m "checkpoint: art-direction (Phase 2)"
...
```

支持回滚到任意阶段：
```bash
node bin/git-stage.js rollback camera
```

---

## 9. 配置与环境变量

### 环境变量

```bash
# gold-team GPU 调度
GOLD_TEAM_URL=http://192.168.71.140:8900
GOLD_TEAM_API_KEY=gt-movie-agent-secret-key
HMAC_SECRET_MA_GT=shared-hmac-secret-ma-gt

# review-platform 审核
REVIEW_PLATFORM_URL=http://192.168.71.140:8090
REVIEW_PLATFORM_API_KEY=rp-movie-agent-secret-key
HMAC_SECRET_MA_RP=shared-hmac-secret-ma-rp

# 回调服务器
CALLBACK_BASE_URL=http://192.168.71.140:3000
CALLBACK_PORT=3000

# Telegram 通知
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_CHAT_ID=your-chat-id

# 本地 TTS 回退
ZHIPU_API_KEY=your-zhipu-key
ZHIPU_API_URL=https://open.bigmodel.cn/api/paas/v4/audio/speech
```

### GPU 功能开关

通过 `pipeline.config.goldTeam` 控制：

```javascript
{
  goldTeam: {
    baseUrl: 'http://192.168.71.140:8900',
    apiKey: 'gt-movie-agent-secret-key',
    enableFluxArt: true,       // art-direction FLUX 图像生成
    enableVideoGpu: true,      // camera GPU 视频生成
    enableVoiceClone: true,    // voice 声音克隆/变声
    enableBGM: true,           // post-production 配乐生成
    enableSFX: true,           // post-production 音效生成
  }
}
```

---

## 10. 测试

### 测试框架

使用 Node.js 内置 `node:test` — 零 npm 依赖。

### 测试文件

| 文件 | 覆盖范围 |
|------|----------|
| `test/phase4a-gpu-integration.test.js` | 16 tests 覆盖全部 Phase 4A 函数 |

### 测试策略

- **Mock HTTP Server**: 使用 `createServer` 模拟 gold-team API
- **任务参数验证**: 验证每个函数提交的 task_type, params, priority
- **模式切换验证**: preview/final 模式参数差异
- **降级测试**: 指向不存在的端口验证 GoldTeamError 抛出
- **元数据验证**: callback_url, description, HMAC 签名

### 运行测试

```bash
node --test test/phase4a-gpu-integration.test.js
```

### 测试覆盖率

| 模块 | 测试函数数 | 覆盖任务类型 |
|------|-----------|-------------|
| art-direction (4A.2) | 3 | image_draw, image_refine, image_control |
| camera (4A.5) | 4 | video_final, video_preview_fast, video_interpolate, video_to_video |
| voice (4A.6) | 2 | voice_clone, voice_convert |
| post-production (4A.7) | 3 | music_final, sfx_generation, audio_separate |
| lip-sync (4A.8) | 1 | lip_sync_rt |
| 元数据/降级 | 3 | callback_url, API-Key, 错误处理 |

---

## 11. 开发工作流 (GSD)

### 工作流状态

| Phase | 状态 | 说明 |
|-------|------|------|
| Phase 1: GoldTeamClient 创建 | ✅ 完成 | lib/gold-team-client.js |
| Phase 2: Review Client 降级 | ✅ 完成 | review-platform-client.js + gold-team-client.js |
| Phase 3: Voice Phase 集成 | ✅ 完成 | phases/index.js voice handler |
| Phase 4: 多候选审核 | ✅ 完成 | pipeline.js _runRemoteReview |
| Phase 5: art-direction FLUX | ✅ 完成 | generateArtDirectionViaGoldTeam + 2 备选 |
| Phase 6: camera VIDEO_FINAL | ✅ 完成 | generateVideoViaGoldTeam + 2 备选 |
| Phase 7: voice CLONE/CONVERT | ✅ 完成 | cloneVoice + convertVoice |
| Phase 8: post-production MUSIC/SFX | ✅ 完成 | generateBGM + generateSFX + separateAudio |
| Phase 9: lip-sync LIP_SYNC_RT | ✅ 完成 | lipSync |

### 待开发 (Phase 4B)

| 任务 | 优先级 | 说明 |
|------|--------|------|
| quality-gate → AI 评分 | P1 | 接入 review-platform AI Scoring |
| character → 3D 生成 | P2 | 3D 角色生成 |

### 开发测试环境

```bash
# 1. 启动 mock servers
python3 /path/to/kais-aigc-integration/mocks/mock-gold-team.py &
python3 /path/to/kais-aigc-integration/mocks/mock-review-platform.py &

# 2. 设置环境变量
export GOLD_TEAM_URL=http://localhost:8901
export GOLD_TEAM_API_KEY=gt-mock-test-key
export REVIEW_PLATFORM_URL=http://localhost:8091
export REVIEW_PLATFORM_API_KEY=rp-mock-test-key

# 3. 运行测试
node --test test/phase4a-gpu-integration.test.js

# 4. 启动管线
node bin/pipeline.js run --workdir ./output --episode EP01
```

---

## 12. 导出 API 速查

### GPU 集成函数 (Phase 4A)

| 函数 | 任务类型 | Phase | 优先级 |
|------|----------|-------|--------|
| `generateArtDirectionViaGoldTeam(pipeline, prompt, style)` | `image_draw` | art-direction | P0 |
| `refineArtDirectionViaGoldTeam(pipeline, sourceImagePath, prompt)` | `image_refine` | art-direction | P0 |
| `controlArtDirectionViaGoldTeam(pipeline, referenceImagePath, prompt)` | `image_control` | art-direction | P0 |
| `generateVideoViaGoldTeam(pipeline, shot)` | `video_final`/`video_preview_fast` | camera | P0 |
| `interpolateVideoViaGoldTeam(pipeline, videoPath, targetFps)` | `video_interpolate` | camera | P0 |
| `styleTransferVideoViaGoldTeam(pipeline, videoPath, stylePrompt)` | `video_to_video` | camera | P0 |
| `cloneVoice(pipeline, referenceAudio, text, language)` | `voice_clone` | voice | P1 |
| `convertVoice(pipeline, sourceAudio, targetVoice)` | `voice_convert` | voice | P1 |
| `generateBGM(pipeline, prompt, duration)` | `music_final` | post-production | P0 |
| `generateSFX(pipeline, prompt)` | `sfx_generation` | post-production | P0 |
| `separateAudio(pipeline, audioPath)` | `audio_separate` | post-production | P0 |
| `lipSync(pipeline, characterImage, audioPath)` | `lip_sync_rt` | lip-sync | P2 |

### GoldTeamClient 方法

| 方法 | 参数 | 返回 |
|------|------|------|
| `submitTask({taskType, params, assets, priority, description, callbackPath})` | 任务配置 | `{taskId, state, createdAt}` |
| `getTask(taskId)` | 任务 ID | 任务详情 |
| `waitForTask(taskId, {pollIntervalMs, timeoutMs})` | 任务 ID + 超时 | 完成后的任务详情 |
| `submitTTS(text, {voiceId, language, outputFormat})` | TTS 参数 | `{taskId, state, createdAt}` |
| `submitTaskDegraded(options)` | 同 submitTask | `{taskId\|null, state, degraded}` |
| `ping(timeoutMs)` | 超时 | `boolean` |
| `verifyCallback(body, headerValue)` | 请求体+签名 | `boolean` |

---

## 13. 数据流图

### 完整管线数据流

```
用户输入 (requirement.json)
    │
    ▼
requirement ──── blueprint.json, audience-match.json, candidate-topics.json
    │
    ▼
art-direction ── art_direction.json, mood_board.png (FLUX/即梦)
    │
    ▼
character ────── characters.json, character-dna.json, 姿态参考图
    │
    ▼
scenario ─────── scenario.json, story_bible.json, audience-analysis.json, story-score-report.json
    │
    ▼
voice ────────── voice_assignments.json, assets/tts/*.wav (gold-team/ZHIPU)
    │
    ▼
scene ────────── scene_design.json, scene-dna.json, assets/scenes/*
    │
    ▼
storyboard ───── storyboard.json, shots.json
    │
    ▼
camera ───────── video_tasks.json, output/*.mp4 (gold-team/即梦)
    │
    ▼
post-production ─ final.mp4, assets/audio/* (gold-team BGM/SFX)
    │
    ▼
quality-gate ─── quality_report.json, story-score-report.json
    │
    ▼
交付成品 (final.mp4 + qc_report.json)
```

### 审核数据流

```
Phase 完成
    │
    ▼
构建审核候选 (reviewCandidates)
    │
    ▼
提交 review-platform (submitReview)
    │  ← candidates, preview_images, scoring config
    │
    ▼
管线挂起 → 等待回调
    │
    ▼
审核人操作 (approve/reject)
    │
    ▼
callback-server 收到回调
    │  ← HMAC 验证
    │
    ├─ approved → spawn detached pipeline resume
    └─ rejected → git rollback + Telegram 通知
```

---

## 14. 安全设计

### HMAC-SHA256 签名

- **签名**: `shared/hmac_node.js` → `sign(body, secret)` 生成 `sha256=<hex>` 格式
- **验证**: `verify(body, secret, headerValue)` 使用 `timingSafeEqual` 防止时序攻击
- **密钥来源**: 环境变量 `HMAC_SECRET_MA_GT` (gold-team) 和 `HMAC_SECRET_MA_RP` (review)

### API 认证

| 服务 | 认证方式 | Header |
|------|----------|--------|
| gold-team | API Key | `X-API-Key: <key>` |
| review-platform | JWT Token | `Authorization: Bearer <jwt>` |
| gold-team 追踪 | Trace ID | `X-Trace-Id: <uuid>` |

---

## 15. 可观测性

### 结构化日志

所有关键事件使用 JSON 格式输出：

```json
{
  "traceId": "uuid",
  "phase": "camera",
  "event": "phase_started|phase_completed|phase_failed|review_submitted",
  "phaseName": "视频生成",
  "duration": 45000,
  "ts": "2026-05-18T10:00:00.000Z"
}
```

### Telegram 通知

| 事件 | 消息 |
|------|------|
| 管线启动 | 🎬 管线启动: EP01 |
| Phase 完成 | ✅ 视频生成 完成 (1m30s) |
| 等待审核 | ⏳ 视频生成 等待审核 (review #123) |
| 审核拒绝 | 通过回调处理 |
| 管线完成 | 🎉 管线完成! 总耗时 15m30s |
| 管线失败 | ❌ 管线失败 @ 视频生成: ... |
