# kais-movie-agent 工作流全景文档

> 版本: v2.0 | 生成日期: 2026-05-19 | 对应代码: `lib/pipeline.js` + `lib/phases/index.js`
> 本文档描述从需求输入到成片交付的完整自动化管线流程。

---

## 1. 执行摘要

kais-movie-agent 是一条 **11 阶段 AI 短片全自动生产管线**，核心设计原则：

| 原则 | 说明 |
|------|------|
| **零 npm 依赖** | 纯 Node.js ES Module + 原生 `fetch` |
| **幂等执行** | 中断后可安全重跑，`completed`/`approved`/`awaiting_review` 阶段自动跳过 |
| **降级优先** | 外部服务（GPU/审核/通知）不可用时，系统降级运行而非崩溃 |
| **审核驱动** | 关键视觉阶段提交远程审核，人工确认后才进入下一阶段 |
| **资产总线** | 跨阶段通过 `.pipeline-assets/` 传递结构化资产，避免数据丢失 |

---

## 2. 管线概览（11 Phase）

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              kais-movie-agent Pipeline                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   1. requirement      ──→ 需求确认                                          │
│        ↓                                                                    │
│   2. art-direction    ──→ 美术方向（FLUX GPU / 即梦）                        │
│        ↓           [审核: 3选1]                                             │
│   3. character        ──→ 角色设计 + DNA 注册                                │
│        ↓           [审核: 多选+评分]                                         │
│   4. scenario         ──→ 剧本编写 + AI 五维评分（<60 阻断）                  │
│        ↓                                                                    │
│   5. voice            ──→ 配音（TTS / 克隆 / 变声）← V2: 前置到 storyboard 前 │
│        ↓           [审核: 单选]                                             │
│   6. storyboard       ──→ 分镜板 + shot-list.json（结构化运镜）               │
│        ↓           [审核: 多选+评分]                                         │
│   7. scene            ──→ 场景图生成（按需去重）                              │
│        ↓           [审核: 多选+评分]                                         │
│   8. camera-preview   ──→ 视频预览（33帧/10步，低参快速验证）← V2 新增        │
│        ↓           [审核: 多选+评分]                                         │
│   9. camera-final     ──→ 正式视频（81帧/20步，PromptInjector 风格锁定）       │
│        ↓           [审核: 多选+评分]                                         │
│  10. post-production  ──→ 后期合成（BGM / SFX / 音频分离）                    │
│        ↓                                                                    │
│  11. quality-gate     ──→ 质量门控（综合评分 ≥65 分 PASS）                    │
│        ↓                                                                    │
│   🎬 交付 final.mp4 + qc_report.json                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Phase 定义速查

| # | Phase ID | 名称 | 审核模式 | 输出文件 |
|---|----------|------|----------|----------|
| 1 | `requirement` | 需求确认 | 无 | `requirement.json`, `brief.md`, `blueprint.json` |
| 2 | `art-direction` | 美术方向 | 3选1 | `art_direction.json`, `.pipeline-assets/art-bible.json` |
| 3 | `character` | 角色设计 | 多选+评分 | `characters.json`, `.pipeline-assets/character-assets.json` |
| 4 | `scenario` | 剧本编写 | AI评分+人工锁定 | `scenario.json`, `story_bible.json`, `story-score-report.json` |
| 5 | `voice` | 配音 | 单选 | `voice_assignments.json`, `.pipeline-assets/voice-timeline.json`, `assets/tts/` |
| 6 | `storyboard` | 分镜板 | 多选+评分 | `storyboard.json`, `.pipeline-assets/shot-list.json` |
| 7 | `scene` | 场景图生成 | 多选+评分 | `scene_design.json`, `.pipeline-assets/scene-assets.json`, `assets/scenes/` |
| 8 | `camera-preview` | 视频预览 | 多选+评分 | `video_preview_tasks.json` |
| 9 | `camera-final` | 正式视频 | 多选+评分 | `video_tasks.json`, `output/` |
| 10 | `post-production` | 后期合成 | 无 | `final.mp4`, `qc_report.json` |
| 11 | `quality-gate` | 质量门控 | 无 | `quality_report.json` |

---

## 3. 阶段详解

### 3.1 Phase 1: requirement（需求确认）

**职责**: 解析用户输入，生成四维蓝图、受众匹配、选题发散。

**执行流程**:
1. 保存 `requirement.json`
2. 调用 `generateBlueprint()` → 四维蓝图（主题、风格、节奏、受众）
3. 调用 `audienceMatch()` → 受众匹配分析 → `audience-match.json`
4. 调用 `generateTopics()` → 候选选题发散 → `candidate-topics.json`

**输入**: `{ title, genre, duration_sec, theme, characters, style_preference }`
**输出**: `requirement.json` + `audience-match.json` + `candidate-topics.json`

---

### 3.2 Phase 2: art-direction（美术方向）

**职责**: 生成美术方向候选图，支持 FLUX GPU 引擎。

**GPU 模式** (`config.goldTeam.enableFluxArt`):
1. 检测 gold-team 可用性（`ping()`，5s 超时）
2. 提交 `image_draw` 任务（FLUX schnell, 1024×1024, 3 候选）
3. 轮询等待（5s/次，最长 10min）
4. 收集产物路径，构建审核候选

**降级**: gold-team 不可用时回退到即梦 API。

**V2 新增**: 产出 `art-bible.json` 写入资产总线，包含风格锚点、光影规则、色彩板、构图规则。

---

### 3.3 Phase 3: character（角色设计）

**职责**: 角色设计 + DNA 注册 + 姿态参考图。

**执行流程**:
1. 注册 Character DNA（参考图锚定模式，不依赖 seed）
2. 生成姿态参考图（可选，Mixamo 模式）
3. 构建审核候选

**V2 新增**: 产出 `character-assets.json`，包含 `core_prompt` / `ref_images` / `lora_path` / `seed`。

---

### 3.4 Phase 4: scenario（剧本编写）

**职责**: 剧本分析 + 受众测评 + 量化评估。

**执行流程**:
1. 深度受众分析（`deepAudienceAnalysis`）
2. 剧本量化分析（`analyzeScript` — kais-story-score）
3. 生成 5 维度评分报告（弧线、情感覆盖、TTR 等）
4. **AI 熔断**: 总分 < 60 时阻断管线

**V2 变更**: 新增 AI 五维评分，不合格直接 `QUALITY_GATE_FAILED`。

---

### 3.5 Phase 5: voice（配音）

**职责**: TTS 语音合成 + 声音克隆 + 变声。

**优先级链**:
```
gold-team TTS → ZHIPU GLM-TTS → 占位文件
```

| 模式 | 触发条件 | 说明 |
|------|----------|------|
| gold-team TTS | `ping()` 成功 | 提交 `tts_generation` 任务，轮询等待（3s/次，5min） |
| 声音克隆 | `config.goldTeam.enableVoiceClone` | 提交 `voice_clone` 任务 |
| 变声 | `config.goldTeam.enableVoiceClone` | 提交 `voice_convert` 任务 |
| 本地 ZHIPU | gold-team 不可用 | 调用 GLM-TTS API |
| 占位文件 | 都不可用 | 生成空占位，不阻断管线 |

**V2 变更**: voice 阶段从 scene 之后 **前置到 storyboard 之前**，实现音频驱动分镜。

---

### 3.6 Phase 6: storyboard（分镜板）

**职责**: 分镜生成 + 姿态参考 + 审核候选。

**V2 新增**: 产出 `shot-list.json`，包含结构化运镜指令：
- `shot_size`: `extreme_wide` / `wide` / `medium` / `medium_close_up` / `close_up` / `extreme_close_up`
- `movement`: `static` / `push_in` / `pull_out` / `pan_left` / `pan_right` / `orbit_cw` / `dolly_left` / `crane_up`
- `angle`: `eye_level` / `low_angle` / `high_angle` / `dutch_tilt`
- `lens`: `24mm` / `35mm` / `50mm` / `85mm` / `135mm`

---

### 3.7 Phase 7: scene（场景图生成）

**职责**: 场景图 DNA 注册 + 审核候选收集。

**V2 变更**: 从批量生成改为 **基于 shot-list 按需去重**，避免冗余生成。

---

### 3.8 Phase 8: camera-preview（视频预览）

**职责**: 低参快速视频预览，验证运镜和构图。

**参数**: 33帧, 10步推理, 优先级 1, `video_preview_fast`

**审核通过后**，批准的镜头列表流入 `camera-final`。

**V2 新增**: 这是 V2 将 camera 拆分为 preview + final 的第一阶段。

---

### 3.9 Phase 9: camera-final（正式视频）

**职责**: 高参正式视频生产。

**参数**: 81帧, 20步推理, 优先级 10, `video_final`

**V2 新增**: 使用 `PromptInjector` 自动注入 `art-bible` + `character-assets` + `scene-assets` 到 prompt，确保风格一致性。

**before hook**: 恢复角色 DNA + 场景 DNA，注入参考图到 config（@引用锚定模式）。

---

### 3.10 Phase 10: post-production（后期合成）

**职责**: 配乐生成 + 音效生成 + 音频分离 + FFmpeg 合成。

**GPU 功能开关**:

| 功能 | 任务类型 | 开关 |
|------|----------|------|
| 配乐 | `music_final` | `config.goldTeam.enableBGM` |
| 音效 | `sfx_generation` | `config.goldTeam.enableSFX` |
| 音频分离 | `audio_separate` | — |

**降级**: GoldTeamError 被捕获 → warn + continue，不阻断管线。

---

### 3.11 Phase 11: quality-gate（质量门控）

**职责**: 综合质量评估，判定 PASS/FAIL。

**执行流程**:
1. 调用 `assessQuality()` 进行多维度评估
2. 注入 story-score 数据（5维度量化）
3. 对比阈值（默认 65 分）
4. 低于阈值抛出 `QUALITY_GATE_FAILED` 错误

**评分维度**: 弧线形状、情感覆盖、文本质量(TTR)、视觉一致性、音频质量。

---

## 4. 执行引擎架构

### 4.1 Pipeline 类 (`lib/pipeline.js`)

核心编排逻辑：

```
run() / resume()
    │
    ▼
for each phase in PHASES:
    ├── 检查状态 → 已完成则跳过
    ├── before hook → 预处理（如恢复 DNA）
    ├── execute / after hook → 业务逻辑
    ├── 保存状态 → .pipeline-state.json
    ├── 审核检查 → 需要审核则提交 review-platform
    │   └── awaiting_review → 管线退出，等待回调
    ├── Git checkpoint → 阶段快照
    └── Telegram 通知 → 进度更新
```

### 4.2 Phase Handler 注册表 (`lib/phases/index.js`)

```javascript
export const phaseHandlers = {
  requirement:      { after: async (pipeline, phase, phaseConfig) => {...} },
  'art-direction':  { after: async (...) => {...} },
  character:        { after: async (...) => {...} },
  scenario:         { after: async (...) => {...} },
  voice:            { after: async (...) => {...} },
  storyboard:       { before: async (...), after: async (...) => {...} },
  scene:            { after: async (...) => {...} },
  camera:           { before: async (...), after: async (...) => {...} },
  'camera-preview': { after: async (...) => {...} },
  'camera-final':   { after: async (...) => {...} },
  'post-production':{ after: async (...) => {...} },
  'quality-gate':   { after: async (...) => {...} },
};
```

### 4.3 Hooks 系统 (`lib/hooks/index.js`)

业务钩子函数库，被 Phase Handler 调用：

| 函数 | 来源 | 用途 |
|------|------|------|
| `generateBlueprint` | `blueprint-generation.js` | 四维蓝图 |
| `audienceMatch` / `deepAudienceAnalysis` | `audience-match.js` | 受众分析 |
| `registerCharacterDNA` / `registerSceneDNA` | `dna-registration.js` | DNA 锚定 |
| `generatePoseReferences` / `generateShotPoses` | `pose-reference.js` | 姿态参考 |
| `analyzeScript` / `toGateSupplement` / `summarizeReport` | `story-score.js` | 剧本评分 |
| `assessQuality` | `quality-assessment.js` | 质量评估 |

---

## 5. V2 新增核心机制

### 5.1 资产总线 (`lib/asset-bus.js`)

跨 Phase 结构化资产传递，统一目录 `.pipeline-assets/`：

```
.pipeline-assets/
├── art-bible.json        ← Phase 2 产出，Phase 9 消费
├── character-assets.json ← Phase 3 产出，Phase 7/8/9 消费
├── voice-timeline.json   ← Phase 5 产出，Phase 10 消费
├── shot-list.json        ← Phase 6 产出，Phase 7/8/9 消费
└── scene-assets.json     ← Phase 7 产出，Phase 8/9 消费
```

### 5.2 Prompt 自动注入 (`lib/prompt-injector.js`)

`camera-final` 阶段自动拼接前缀：

```javascript
const enhancedPrompt = await injector.inject(shot.description, {
  character: shot.character,
  scene: shot.scene_id,
  shotId: shot.id,
});
// 输出: [art-bible 风格前缀] + [character-assets 角色描述] + [scene-assets 场景描述] + 原始描述
```

### 5.3 Shot-List 解析器 (`lib/shot-list-parser.js`)

将结构化运镜指令解析为 GPU 参数：
- `parseShotToGpuParams(shot)` → `{ width, height, num_frames, ... }`
- `deduplicateSceneNeeds(shots)` → 按场景去重，减少冗余生成

### 5.4 AI 评分器 (`lib/ai-scorer.js`)

剧本五维评分（弧线、情感、文本、节奏、冲突），< 60 分触发熔断。

---

## 6. 审核与回调工作流

### 6.1 远程审核数据流

```
Phase 业务逻辑完成
    │
    ▼
构建 reviewCandidates（含 imagePath / label / description）
    │
    ▼
_runRemoteReview() → ReviewPlatformClient.submitReview()
    │  ← candidates, preview_images(base64, 最多3张), scoring config
    │
    ▼
保存状态: status = "awaiting_review", review_id = "rev-xxx"
    │
    ▼
管线 EXIT（等待外部回调）
    │
    ▼
审核人操作 (approve / reject)
    │
    ▼
POST /callback/review_result
    │  ← HMAC-SHA256 签名验证
    │
    ├─ action=approved → spawn detached `pipeline resume`
    │                      → Git checkpoint → 继续下一阶段
    │
    └─ action=rejected → Git rollback → Telegram 通知
```

### 6.2 GPU 任务回调数据流

```
gold-team 任务完成
    │
    ▼
POST /callback/gpu_task
    │  ← HMAC-SHA256 签名验证
    │
    ▼
解析 payload: { task_id, state, artifacts[] }
    │
    ▼
保存产物路径到管线状态 / 磁盘
```

### 6.3 回调服务器 (`bin/callback-server.js`)

| 路由 | 来源 | 功能 |
|------|------|------|
| `POST /callback/review_result` | review-platform | 处理审核结果 |
| `POST /callback/gpu_task` | gold-team | 处理 GPU 任务完成 |

**安全**: 所有回调使用 `shared/hmac_node.js` 签名验证，`crypto.timingSafeEqual` 防止时序攻击。

---

## 7. 状态管理与断点续作

### 7.1 状态文件: `.pipeline-state.json`

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

### 7.2 幂等执行规则

| 状态 | 行为 |
|------|------|
| `completed` | `run()` / `resume()` 自动跳过 |
| `approved` | 自动跳过 |
| `awaiting_review` | 自动跳过（等待回调，重复执行会重复提交） |
| `failed` | 重新执行 |
| `pending` / 无记录 | 执行 |

### 7.3 Git 检查点

每阶段完成后自动创建 Git checkpoint：

```bash
git commit -m "checkpoint: requirement (Phase 1)"
git commit -m "checkpoint: art-direction (Phase 2)"
...
```

支持回滚到任意阶段：

```bash
node bin/git-stage.js rollback camera
```

---

## 8. 质量保障体系

### 8.1 四层质量关卡

| 层级 | 机制 | 触发阶段 | 失败行为 |
|------|------|----------|----------|
| **剧本熔断** | AI 五维评分 | scenario | <60 分 → `QUALITY_GATE_FAILED` |
| **预览熔断** | camera-preview 低参验证 | camera-preview | 未通过预览的镜头不进入 final |
| **场景审核** | 线稿审核 + 渲染审核 | scene（线稿管线） | FAIL → 重新生成（最多2次） |
| **综合门控** | 多维度评分 | quality-gate | <65 分 → 抛出错误，管线失败 |

### 8.2 场景图自动评价 (`lib/scripts/scene-evaluator.py`)

使用智谱 `glm-4v-flash` 免费视觉模型：

| 模式 | 检查项 |
|------|--------|
| `--mode sketch` | 构图、纯黑白、关键元素、线条质量 |
| `--mode render` | 无残留线稿、风格统一、角色一致 |
| 默认模式 | 物品重复、道具缺失、物理合理性、表情验证 |

---

## 9. 完整数据流图

```
用户输入 (requirement.json)
    │
    ▼
requirement ────→ blueprint.json, audience-match.json, candidate-topics.json
    │
    ▼
art-direction ──→ art_direction.json, .pipeline-assets/art-bible.json (FLUX/即梦)
    │
    ▼
character ──────→ characters.json, .pipeline-assets/character-assets.json, 姿态参考图
    │
    ▼
scenario ───────→ scenario.json, story_bible.json, audience-analysis.json, story-score-report.json
    │
    ▼
voice ──────────→ voice_assignments.json, .pipeline-assets/voice-timeline.json, assets/tts/*.wav
    │
    ▼
storyboard ─────→ storyboard.json, .pipeline-assets/shot-list.json
    │
    ▼
scene ──────────→ scene_design.json, .pipeline-assets/scene-assets.json, assets/scenes/*
    │
    ▼
camera-preview ─→ video_preview_tasks.json (33f/10step)
    │        [审核通过后]
    ▼
camera-final ───→ video_tasks.json, output/*.mp4 (81f/20step, PromptInjector)
    │
    ▼
post-production ─→ final.mp4, assets/audio/* (gold-team BGM/SFX)
    │
    ▼
quality-gate ───→ quality_report.json, story-score-report.json
    │
    ▼
交付成品 (final.mp4 + qc_report.json)
```

---

## 10. CLI 使用指南

### 10.1 启动管线

```bash
# 全新运行
node bin/pipeline.js run --workdir ./output --episode EP01

# 断点续作（自动检测未完成阶段）
node bin/pipeline.js resume --workdir ./output

# 从指定阶段恢复
node bin/pipeline.js resume --phase camera --workdir ./output
```

### 10.2 查看状态

```bash
node bin/pipeline.js status --workdir ./output
```

输出示例：
```
Episode: EP01
Started: 2026-05-18T10:00:00.000Z
Completed: not completed

Phases:
  [done] 1    requirement        需求确认
  [review]2   art-direction      美术方向
  [ ]   3    character          角色设计
  ...

Progress: 1/11 phases completed
```

### 10.3 启动回调服务器

```bash
node bin/callback-server.js
# 默认监听 0.0.0.0:3000
# 路由: /callback/review_result, /callback/gpu_task
```

---

## 11. 降级策略

### 11.1 三层降级

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

### 11.2 降级审计日志

```json
{
  "ts": "2026-05-18T10:00:00.000Z",
  "event": "gpu_task_degraded",
  "taskType": "image_draw",
  "reason": "请求超时: POST /api/tasks"
}
```

---

## 12. 外部依赖

| 服务 | 用途 | 客户端 | 认证 |
|------|------|--------|------|
| **gold-team GPU** | FLUX 图像 / 视频 / TTS / BGM / SFX | `lib/gold-team-client.js` | X-API-Key |
| **review-platform** | 多候选人工审核 | `lib/review-platform-client.js` | JWT Token |
| **即梦 API** | 文生图 / 视频（降级回退） | `lib/jimeng-client.js` | Session Cookie |
| **智谱 GLM** | TTS 回退 / 视觉评价 | `lib/llm.js` | API Key |
| **Telegram Bot** | 进度通知 | 内置 `notifyTelegram` | Bot Token |
| **FFmpeg** | 后期合成 | 外部调用 | — |

---

## 附录 A: 术语表

| 术语 | 说明 |
|------|------|
| **DNA** | 角色/场景一致性锚定系统，通过参考图而非 seed 实现 |
| **S.P.A.C.E** | 空间约束标记法: SUBJECT / PROPS / ACTION / COMPOSITION / ENVIRONMENT |
| **PromptInjector** | 自动将 art-bible / character-assets 前缀注入生成 prompt |
| **GoldTeam** | 内部 GPU 调度集群，支持 44 种任务类型 |
| **Review Platform** | 人工审核平台，支持多候选选择 + 评分 + 反馈 |
| **Fail-open** | 审核服务不可用时自动放行，不阻断管线 |

---

*本文档基于代码库实时分析生成，如有变更请同步更新。*
