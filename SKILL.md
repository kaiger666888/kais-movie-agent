---
name: kais-movie-agent
description: "AI短片/短视频/短剧全流程自动制作管线 (V6)。触发词：movie agent, 短片制作, AI短片, 视频管线, film pipeline, movie-wuji, AI视频制作, 短视频管线, AI电影, 影片制作, AI短剧, 短剧制作, 视频自动化, 全自动视频, 一键生成视频, AI拍片, 视频工厂, 批量视频, 生成短片, make video, create film, video pipeline, movie production, AI filmmaker, kais-movie, movie pipeline, V6, Seedance, audio-driven。20步管线：痛点调查→主题→大纲→剧本→主角→场景→时空剧本→种子骨架→运镜→AI风格化→一致性守护→Seedance 2.0终版视频→BGM→剪辑→质检交付。支持 Seedance 2.0 audio-driven、GPU Runtime Manager V5.1、3060Ti Combo、反馈回流机制、Git 版本管理和断点续传。"
---

# kais-movie-agent V6 — AI 短片制作全流程管线

## 触发词
`movie agent`, `短片制作`, `AI短片`, `视频管线`, `film pipeline`, `movie-wuji`, `AI视频制作`, `短视频管线`, `AI电影`, `影片制作`, `AI短剧`, `短剧制作`, `视频自动化`, `全自动视频`, `一键生成视频`, `AI拍片`, `视频工厂`, `批量视频`, `生成短片`, `make video`, `create film`, `video pipeline`, `movie production`, `AI filmmaker`, `kais-movie`, `movie pipeline`, `V6`, `Seedance`, `audio-driven`

---

## ⚠️ 强制审核门（Review Gate）

**以下 Step 完成后必须暂停，展示产出物给用户审核，收到确认后才能继续：**

| Step | 审核内容 | 展示方式 |
|------|---------|---------|
| Step 2 | 主题选择 | 当前会话 |
| Step 4 | 大纲选择 | 当前会话 |
| Step 6 | 剧本选择 | 当前会话 |
| Step 8 | 主角选择（3图一体） | 当前会话 / ReviewPlatform |
| Step 10 | 场景选择（6图一体） | 当前会话 / ReviewPlatform |
| Step 11 | 时空剧本 | 当前会话 / ReviewPlatform |
| Step 12 | 剧本锁定终审 | 当前会话 |
| Step 13 | 种子骨架（视觉+声音） | 当前会话 / ReviewPlatform |
| Step 14 | 运镜预览 | 当前会话 / ReviewPlatform |
| Step 15 | AI风格化预览 | 当前会话 / ReviewPlatform |
| Step 17 | 云端终版视频 | 当前会话 / ReviewPlatform |

**执行规则：**
1. 到达审核门时，**必须停止执行**，不要继续下一个 Step
2. 将产出物发送给用户，附上简要说明和审核选项（✅通过 / 🔄重做 / ✏️修改）
3. 使用 `message` 工具发送图片（带 inline buttons 让用户选择）
4. **只有收到用户明确的"通过"回复后，才能执行 git checkpoint 并进入下一阶段**
5. 用户要求重做时，回滚到对应 Step 重新生成
6. **禁止**：一次性跑完多个 Step 然后事后补审核

**为什么这很重要：** AI 生成结果不可预测，用户审美和预期可能与 AI 不同。跳过审核会导致大量返工和积分浪费。审核门是质量保障的核心机制，不是可选步骤。

---

## 管线流程

> **设计原则**：叙事先行 — 先立故事骨架，再匹配视觉和角色。遵循真实电影工业流程。
> **架构**：V6 采用 20 步管线，分为创意立项（Steps 1-11）和生产执行（Steps 12-20）两半。

### 上半部分：创意立项（Steps 1-11）

```
Step 1:  痛点调查 (kais-soul-radar)               → checkpoint
Step 2:  选择主题                                   → 🔒 REVIEW GATE
Step 3:  生成大纲 (kais-script-agent)               → checkpoint
Step 4:  选择大纲                                   → 🔒 REVIEW GATE
Step 5:  生成剧本 (kais-script-agent)               → checkpoint
Step 6:  选择剧本                                   → 🔒 REVIEW GATE
Step 7:  生成主角（3图一体）                        → checkpoint
Step 8:  选择主角 → soul-pack.json (DINOv2)         → 🔒 REVIEW GATE
Step 9:  生成场景（6图一体）                        → checkpoint
Step 10: 选择场景 → geometry-bed.json               → 🔒 REVIEW GATE
Step 11: 时空剧本 (kais-spatio-temporal-agent)      → 🔒 REVIEW GATE
```

### 下半部分：生产执行（Steps 12-20）

```
Step 12: 剧本锁定审核                               → 🔒 REVIEW GATE
Step 13: 种子骨架（13A视觉种子 ∥ 13B声音骨架）      → 🔒 REVIEW GATE
Step 14: 运镜定稿 + 动态预览（14A Camera Lock + 14B Preview） → 🔒 REVIEW GATE
Step 15: AI风格化预览 + Seedance生产包定稿           → 🔒 REVIEW GATE
Step 16: 一致性守护检查（DINOv2 > 0.85）            → 阻断/放行
Step 17: 云端终版视频（Seedance 2.0 audio-driven）   → 🔒 REVIEW GATE
         17A: 对白生产 | 17B: 视频生产
Step 18: 本地BGM与声音闭环                          → checkpoint
Step 19: 剪辑合成（FFmpeg）                         → checkpoint
Step 20: 质检与交付                                 → PASS/FAIL
```

---

## 反馈回流机制

**最大 3 次迭代**，超出则升级汇报用户决策：

| 失败 Step | 回流目标 | 说明 |
|-----------|---------|------|
| Step 14 失败 | → 回 Step 11 | 运镜不匹配时空剧本，重新调整剧本 |
| Step 15 失败 | → 回 Step 13 或 Step 8 | 风格不达标：调种子骨架 或 换主角 |
| Step 16 失败 | → 回 Step 13 | 一致性 < 0.85：重新生成视觉种子 |
| Step 17 失败 | → 回 Step 15 或 Wan 2.2 兜底 | 云端失败：重试风格化 或 降级本地生成 |
| Step 19 失败 | → 视觉回 Step 17，声音回 Step 18 | 剪辑失败：按类型回溯对应阶段 |

**执行规则：**
- 每次回流记录迭代次数到 `feedback-loop.json`
- 3 次迭代后仍失败 → 暂停管线，向用户汇报并请求指示
- 回流时不跳过中间的审核门（如 Step 13→Step 8 需重新经过 Step 8 审核门）

---

## GPU Runtime Manager V5.1 对接

### Stage 映射表

| Phase | Stage | 3090 Heavy | 3090 Light | 3060Ti |
|-------|-------|-----------|-----------|--------|
| 角色 | `3d_character` | TRELLIS ~18G | Whisper+Moondream+Seed-VC ~5.5G | WD14 |
| 场景 | `3d_scene` | Hunyuan3D ~12G | CosyVoice2+... ~11.5G | - |
| 视觉种子 | `image_refine` | Kontext/FLUX ~16G | Whisper+... ~5.5G | CosyVoice2 |
| BGM骨架 | `music_base` | ACE Step base ~8G | CosyVoice2+... ~13.5G | - |
| 预览 | `video_preview` | LTX-Video ~12G | CosyVoice2+... ~11.5G | UVR5 |
| 视觉终版 | `video_final` | Wan 14B ~18G | Whisper+Moondream ~5G | CosyVoice2 |
| 标志性BGM | `music_final` | ACE Step xl-sft ~17G | Whisper+Moondream ~5G | CosyVoice2 |
| 对口型 | `lip_sync` | LatentSync ~7G | Whisper+... ~5.5G | CosyVoice2 |

### Step 与 Stage 映射

| Step | Stage (Primary) | 说明 |
|------|----------------|------|
| Step 7 | `3d_character` | 主角3图一体生成 |
| Step 9 | `3d_scene` | 场景6图一体生成 |
| Step 13A | `image_refine` | 视觉种子精炼 |
| Step 13B | `music_base` | 声音骨架（BGM基础） |
| Step 14 | `video_preview` | 运镜动态预览 |
| Step 15 | `video_preview` | AI风格化预览 |
| Step 17B | `video_final` | 云端终版视频（Seedance 2.0） |
| Step 17A | `lip_sync` | 对白/对口型 |
| Step 18 | `music_final` | 标志性BGM + 声音闭环 |

---

## 3060Ti Combo 配置

3060Ti (8GB) 作为辅助 GPU，采用 Combo 模式常驻或按需串行切换：

| Combo 名称 | 模式 | 加载模型 | 说明 |
|-----------|------|---------|------|
| Combo-Understand | 常驻 | WD14 Tagger | 图像理解/标签，支撑 Step 7/9 选择 |
| Combo-Audio-Gen | 串行切换 | CosyVoice2 | 语音生成，与 3090 Light 串行调度 |
| Combo-Sync | 常驻 | LatentSync (共享) | 对口型同步，Step 17A |
| Combo-SFX | 常驻 | UVR5 | 音源分离，Step 18 声音处理 |
| Combo-Virtual | 常驻 | Seed-VC | 音色转换，辅助 Step 13B |

**调度原则：**
- Combo-Understand 和 Combo-Sync 常驻，优先级最高
- Combo-Audio-Gen 与 3090 Light 串行，避免显存冲突
- Combo-Virtual 需要时加载，用完释放

---

## 核心原则与禁令

1. **叙事先行**：先立故事骨架（Steps 1-6），再匹配视觉和角色（Steps 7-11）
2. **审核门不可跳过**：每个 🔒 REVIEW GATE 必须暂停等用户确认
3. **先线稿后渲染**：所有视觉生成必须先线稿锁定构图，再渲染释放风格，无例外
4. **一致性阈值**：Step 16 DINOv2 相似度必须 > 0.85，低于则阻断回流
5. **积分不设限**：不考虑积分成本，质量优先
6. **反馈最多 3 次**：任何回流路径最多迭代 3 次，超出升级汇报
7. **Seedance 2.0 为终版引擎**：Step 17 使用 Seedance 2.0 audio-driven 模式
8. **Wan 2.2 兜底**：Seedance 失败时降级到本地 Wan 2.2 生成
9. **禁止跳步**：严格执行 20 步管线，不主动建议跳过任何步骤
10. **GPU Stage 调度**：每个 Step 必须通过 GPU Runtime Manager V5.1 申请对应 Stage
11. **soul-pack 不可变**：Step 8 选定的 soul-pack.json 在下游只读，修改需回 Step 8
12. **geometry-bed 不可变**：Step 10 选定的 geometry-bed.json 在下游只读，修改需回 Step 10
13. **时空剧本是生产基准**：Step 11 时空剧本锁定后作为 Steps 12-20 的唯一执行依据
14. **禁止一次性跑多步**：每完成一步即 checkpoint + 审核，禁止批量执行
15. **验证闭环**：验证要走到"最后一公里"——用户看到什么，才是真正的完成

---

## Git 版本管理（每 Step 自动 checkpoint）

每个 Step 完成后自动创建 git checkpoint，支持回滚到任意阶段。

### Step 与 Git Stage 映射（V6 20步）

| Stage Name | Step | 产出文件 |
|------------|------|---------|
| `pain-point` | 1 | pain-point-report.json, soul-radar-output.md |
| `theme` | 2 | theme-selection.json |
| `outline` | 3 | outline.json, outline-options.md |
| `outline-selection` | 4 | selected-outline.json |
| `script` | 5 | script.json, story_bible.json |
| `script-selection` | 6 | selected-script.json |
| `protagonist` | 7 | protagonist-candidates/ (3图一体) |
| `soul-pack` | 8 | soul-pack.json, selected-protagonist/ |
| `scene` | 9 | scene-candidates/ (6图一体) |
| `geometry-bed` | 10 | geometry-bed.json, selected-scenes/ |
| `spatio-temporal` | 11 | spatio-temporal-script.json |
| `script-lock` | 12 | locked-script.json (最终版) |
| `seed-skeleton` | 13 | visual-seeds/ + audio-skeleton/ |
| `motion-preview` | 14 | camera-lock.json + preview-videos/ |
| `ai-preview` | 15 | stylized-previews/ + seedance-production-pack.json |
| `consistency-check` | 16 | consistency-report.json (DINOv2 scores) |
| `final-video` | 17 | final-video.mp4 (Seedance 2.0) |
| `final-audio` | 18 | bgm-final.mp3 + voice-final/ + sfx/ |
| `composition` | 19 | composed-video.mp4 (FFmpeg) |
| `delivery` | 20 | final-delivery.mp4, qc-report.json, archive/ |

### CLI
```bash
node lib/git-stage-manager.js init <workdir>              # 初始化
node lib/git-stage-manager.js checkpoint <workdir> <step>  # checkpoint
node lib/git-stage-manager.js log <workdir>                # 查看历史
node lib/git-stage-manager.js rollback <workdir> <step>    # 回滚
```

---

## Hermes 集成

V6 管线通过 Hermes 采集决策、审计和评估数据，支持持续进化：

| 采集点 | 数据类型 | 说明 |
|--------|---------|------|
| Step 2/4/6/8/10 | 决策记录 | 用户选择记录（主题/大纲/剧本/主角/场景） |
| Step 12 | 审计快照 | 剧本锁定前的完整资产快照 |
| Step 16 | 评估报告 | 一致性检查 DINOv2 分数 + 通过/阻断决策 |
| Step 17 | 生产审计 | Seedance 2.0 API 调用日志 + 结果 |
| Step 20 | 质检报告 | 最终 QC 报告（PASS/FAIL + 分项评分） |
| 反馈回流 | 迭代日志 | 每次回流的 Step、原因、次数 |

**使用方式：**
- 管线关键节点自动调用 `hermes-cognitive__hermes_reflect` 进行反思
- 决策记录通过 `hermes-cognitive__hermes_memory` 写入项目记忆
- 可通过 `hermes-cognitive__hermes_learn` 生成学习提案，持续优化管线参数

---

## 子 Skill 列表

| Skill | Step | 功能 |
|-------|------|------|
| kais-soul-radar | 1 | 痛点调查与情感洞察 |
| kais-script-agent | 3, 5 | 大纲生成 + 剧本生成 |
| kais-spatio-temporal-agent | 11 | 时空剧本生成（镜头级时空映射） |
| kais-consistency-agent | 16 | 跨镜头一致性守护（DINOv2） |
| kais-scene-designer | 9 | 场景图生成（6图一体） |
| kais-character-designer | 7 | 主角设计（3图一体） |
| kais-camera | 14 | 运镜定稿 + 动态预览 |
| kais-voice | 13B, 18 | CosyVoice2 语音锁定 + 声音闭环 |
| kais-review-platform | 8, 10, 13-17 | 审核页面构建（HTML 交互式预览） |
| kais-anatomy-guard | 7, 9 | 肢体解剖修复守卫（三级防御） |
| kais-story-score | 6, 12 | 剧本量化分析 + 质量门控 |
| deep-research | 按需 | 品牌/人物/受众深度调研 |

---

## 共享工具

| 工具 | 路径 | 功能 |
|------|------|------|
| git-stage-manager.js | lib/ | Git 阶段版本管理（20步 checkpoint/rollback/diff） |
| pipeline.js | lib/ | 管线编排器（V6 20步串行，断点恢复） |
| extension-chain.js | lib/ | 延长链引擎（Seedance 2.0 audio-driven） |
| post-production.js | lib/ | 后期合成（Step 19 FFmpeg） |
| bgm-selector.js | lib/ | BGM 选择（10种风格库，场景情感自动匹配） |
| cost-scheduler.js | lib/ | 积分/成本调度 |
| sketch-generator.py | lib/scripts/ | 线稿生成 |
| sketch-to-render.py | lib/scripts/ | 线稿→渲染（四维锚定融合） |
| scene-evaluator.py | lib/scripts/ | 场景图评价 |
| anatomy-validator.py | lib/scripts/ | 解剖质量检测 |
| jimeng-client.js | lib/ | 即梦 API 客户端 |

---

## 外部服务

| 服务 | 用途 | Step |
|------|------|------|
| 即梦 API (jimeng-5.0) | 文生图 | 7, 9 |
| Seedance 2.0 (云端) | audio-driven 视频生成 | 17 |
| Wan 2.2 (本地) | 视频生成兜底 | 17 (fallback) |
| CosyVoice2 (本地) | 语音锁定 | 13B, 18 |
| ACE Step (本地) | BGM 生成 | 13B, 18 |
| TRELLIS (本地) | 3D 角色生成 | 7 |
| Hunyuan3D (本地) | 3D 场景生成 | 9 |
| LTX-Video (本地) | 动态预览 | 14 |
| Kontext/FLUX (本地) | 视觉种子精炼 | 13A |
| DINOv2 (本地) | 一致性检测 | 16 |
| FFmpeg (本地) | 剪辑合成 | 19 |
| GLM-4V-Flash (API) | 图像评价 | 7, 9, 16 |

## 环境变量
- `JIMENG_SESSION_ID`: 即梦 session ID
- `JIMENG_API_URL`: 即梦 API 地址（默认 http://localhost:8000）
- `ZHIPU_API_KEY`: 智谱 API Key（GLM-TTS / GLM-4V）
- `SEEDANCE_API_KEY`: Seedance 2.0 API Key（云端）
- `SEEDANCE_API_URL`: Seedance 2.0 API 地址
