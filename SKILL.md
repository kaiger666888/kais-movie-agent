---
name: kais-movie-agent
description: "AI短片/短视频/短剧全流程自动制作管线。触发词：movie agent, 短片制作, AI短片, 视频管线, film pipeline, AI视频制作, 短视频管线, AI电影, 影片制作, AI短剧, 短剧制作, 视频自动化, 全自动视频, 一键生成视频, AI拍片, 视频工厂, 批量视频, 生成短片, make video, create film, video pipeline, movie production, AI filmmaker。覆盖需求确认→调研→剧本→美术方向→角色设计→配音→场景生成→分镜板→视频生成→后期合成的完整管线，支持git版本管理和断点续传。"
---

# kais-movie-agent — AI 短片制作全流程管线

## 触发词
`movie agent`, `短片制作`, `AI短片`, `视频管线`, `film pipeline`, `movie-wuji`, `AI视频制作`, `短视频管线`, `AI电影`, `影片制作`, `AI短剧`, `短剧制作`, `视频自动化`, `全自动视频`, `一键生成视频`, `AI拍片`, `视频工厂`, `批量视频`, `生成短片`, `make video`, `create film`, `video pipeline`, `movie production`, `AI filmmaker`, `kais-movie`, `movie pipeline`

## ⚠️ 强制审核门（Review Gate）

**以下 Phase 完成后必须暂停，展示产出物给用户审核，收到确认后才能继续：**

| Phase | 审核内容 | 展示方式 |
|-------|---------|---------|
| Phase 1 | 需求确认 + 调研报告 | 发送调研摘要到当前会话，等用户确认 |
| Phase 2 | 美术方向（mood board 3选1 + 光影参考图） | 发送图片到当前会话，等用户选择/修改 |
| Phase 3 | 角色设计（转面图 + 多角度参考图） | 发送图片到当前会话，等用户确认 |
| Phase 4 | 剧本（scenario.json + 分镜描述） | 发送文本摘要到当前会话，等用户确认 |
| Phase 5/5.6 | 场景图（所有镜头的渲染图） | 发送图片到当前会话，等用户确认 |
| Phase 6 | 分镜板（完整 storyboard） | 发送分镜摘要到当前会话，等用户确认 |
| Phase 7 | 视频粗剪（rough cut） | 发送视频或截图到当前会话，等用户确认 |

**执行规则：**
1. 到达审核门时，**必须停止执行**，不要继续下一个 Phase
2. 将产出物发送给用户，附上简要说明和审核选项（✅通过 / 🔄重做 / ✏️修改）
3. 使用 `message` 工具发送图片（带 inline buttons 让用户选择）
4. **只有收到用户明确的"通过"回复后，才能执行 git checkpoint 并进入下一阶段**
5. 用户要求重做时，回滚到对应 Phase 重新生成
6. **禁止**：一次性跑完多个 Phase 然后事后补审核

**为什么这很重要：** AI 生成结果不可预测，用户审美和预期可能与 AI 不同。跳过审核会导致大量返工和积分浪费。审核门是质量保障的核心机制，不是可选步骤。

---

## 管线流程

> **设计原则**：叙事先行 — 先立故事骨架，再匹配视觉和角色。遵循真实电影工业流程：剧本 → 美术指导 → 选角 → 分镜 → 拍摄。

```
Phase 1: 需求确认 + 深度调研                     → 🔒 REVIEW GATE
  └─ 四维蓝图生成（1st-director）                   → checkpoint (自动)
  └─ Phase 1.5a: 选题发散 (kais-topic-selector + 约束聚合) → checkpoint (自动)
  └─ Phase 1.5: 品牌与背景深度调研 (deep-research) → checkpoint (自动)
  └─ Phase 1.6: 选题投票筛选 (kais-audience)       → checkpoint (自动)
Phase 2: 剧本大纲 (kais-scenario-writer)           → 🔒 REVIEW GATE
  └─ 剧本预测试 (kais-audience 深度测评)            → checkpoint (自动)
Phase 3: 美术方向 (kais-art-direction)             → 🔒 REVIEW GATE
Phase 4: 角色设计 (kais-character-designer)         → 🔒 REVIEW GATE
Phase 4.5: 配音 (kais-voice)                       → 🔒 REVIEW GATE
Phase 5: 场景图生成 (kais-scene-designer)           → checkpoint
Phase 5.3: 线稿生成（anatomy-guard 预防）           → checkpoint
Phase 5.5: 基于线稿渲染                            → checkpoint
Phase 5.6: 渲染审核                                → 🔒 REVIEW GATE
Phase 5.7: 拍摄手法规划                            → checkpoint
Phase 6: 分镜板 (kais-storyboard-designer)          → 🔒 REVIEW GATE
Phase 7: 视频生成 (kais-camera + 延长链)            → 🔒 REVIEW GATE
Phase 8: 后期合成 + 交付                           → checkpoint
```

> 📖 完整 Phase 流程图（含子步骤）见 [`references/pipeline-flow.md`](references/pipeline-flow.md)

### 四维蓝图（1st-director 元层）

Phase 1 完成后自动生成四维约束蓝图（`blueprint.json`），作为元层注入整个管线：

| 尺度 | 时间粒度 | 关注点 |
|------|---------|--------|
| 神经尺度 | 0.1-1s | 预测误差、注意力锚点、归因闭环 |
| 情绪尺度 | 3-10s | 锯齿循环、张力递进、无平淡期 |
| 叙事尺度 | 10-30s | 价值缺口、身份投射、价值兑现 |
| 社交尺度 | 30-60s | 截图时刻、引用候选、模因密度 |

蓝图自动影响：约束注入（Phase 2+）、熵注入（Phase 7）、质量门控权重（Phase 8.5）。无蓝图时系统行为与集成前完全一致。

### Phase 1.5a（选题发散 — kais-topic-selector + 约束聚合）

**触发条件**：Phase 1 完成后自动执行。无需人工触发。

**约束来源**（多系统聚合）：
- 🧠 1st-director 四维尺度 → 选题必须满足神经/情感/叙事/社会层标准
- 🚦 quality-gate 6维度 → 每个候选选题预打分（hook/structure/realism/title/duration/engagement）
- 🗳️ kais-audience 受众匹配 → 选题符合目标人群偏好
- 📱 平台约束 → 最佳时长/格式/避免元素
- 🎨 四维蓝图（如有）→ 额外的认知走查约束

**输入**：Phase 1 需求确认结果 + 四维蓝图（如有）
**输出**：3-5 个候选选题（每个带 6 维度预评分 + 总分排名），保存为 `candidate-topics.json`

**与 Phase 1.6 的关系**：候选选题自动进入投票筛选，排名最高者进入 Phase 2。Phase 1.6 的 `placement_options` 改为从 `candidateTopics` 读取。

**容错**：LLM 调用失败只 warn 不阻断管线，后续阶段可手动提供选题。

### Phase 1.5（品牌与背景深度调研）

> 📖 完整调研流程见 [`references/research-workflow.md`](references/research-workflow.md)

**触发条件**：品牌植入、真实人物/事件、特定行业/圈层时自动启用。纯虚构题材可跳过。

| 维度 | 输出 |
|------|------|
| 品牌深度 | `research/brand_profile.md` |
| 人物背景 | `research/character_profile.md` |
| 目标受众 | `research/audience_persona.md` |
| 竞品案例 | `research/competitor_cases.md` |
| 圈层文化 | `research/subculture_notes.md` |
| 植入策略 | `research/placement_strategy.md` |

### Phase 1.6（选题投票筛选 — kais-audience）

**触发条件**：Phase 1.5 产出 3+ 个选题方向时自动启用。单选题或用户已明确指定方向时跳过。

**执行方式**：调用 `kais-audience` 的「快速投票」模式，让虚拟评审团对候选选题进行排名。

```
输入：Phase 1.5 产出的 placement_options（3-5 个植入方案/选题方向）
      + research/audience_persona.md（目标受众画像）
执行：kais-audience 快速投票模式（12人评审团，兴趣度+完播意愿+互动意愿）
输出：选题排名表 + 推荐选题 + 各选题一句话优缺点
保存：research/audience_vote_result.md
```

**与 Phase 2 的关系**：排名最高的选题自动进入 Phase 2 剧本创作。用户也可从排名中选择非第一的选题。

### Phase 2 审核增强（kais-audience 深度测评）

Phase 2 剧本完成后、用户审核前，**自动运行** `kais-audience` 的「深度测评」模式：

```
输入：Phase 2 产出的 scenario.json + story_bible.json
执行：kais-audience 深度测评模式
输出：
  - 完播率预测（校准后 + 置信区间）
  - 毒点检测（6大类，每类风险等级）
  - 情绪曲线预测
  - 分群反馈
  - 优化建议
保存：research/audience_deep_test.md
```

**审核门行为**：将深度测评结果作为审核依据之一展示给用户，标注高风险毒点和完播率预测。用户决定是否通过或修改后重新测评。

---

### 为什么剧本先行？

| 旧顺序 | 新顺序 | 原因 |
|--------|--------|------|
| 美术→角色→剧本 | **剧本→美术→角色** | 视觉服务于叙事，不是反过来 |
| 先定风格再想故事 | **先有故事再匹配风格** | 大纲的画面意图标注让风格选择有依据 |
| 角色在剧本之前 | **角色基于剧本需求设计** | 避免设计了用不上的角色 |
| — | **大纲含画面意图** | Phase 2 产出同时标注视觉方向，下游无缝衔接 |

### Phase 2（剧本大纲）产出规范

> 📖 完整 JSON schema 见 [`references/scenario-schema.md`](references/scenario-schema.md)

关键字段：`visual_intent`（视觉意图）、`style_hints`（风格提示）、`character_hints`（角色提示）— 给下游 Phase 3/4 的约束信号。

## Git 版本管理（每个 Phase 自动 checkpoint）

每个 Phase 完成后自动创建 git checkpoint，支持回滚到任意阶段。

### 使用方式

> 📖 完整 API 用法见 [`references/api-usage.md`](references/api-usage.md)

```js
import { GitStageManager } from './lib/git-stage-manager.js';

const git = new GitStageManager('/path/to/project');
await git.init();  // 首次调用初始化

// Phase 完成后
await git.checkpoint('art-direction', {
  description: '赛博朋克风格，霓虹色调',
  metrics: { moodBoardCount: 5 }
});

// 查看历史
await git.log();

// 回滚到指定阶段（如审核不通过）
await git.rollback('art-direction');
```

### CLI
```bash
node lib/git-stage-manager.js init <workdir>              # 初始化
node lib/git-stage-manager.js checkpoint <workdir> <phase> # checkpoint
node lib/git-stage-manager.js log <workdir>               # 查看历史
node lib/git-stage-manager.js rollback <workdir> <phase>   # 回滚
```

### Phase 与 Git Stage 映射

| Stage Name | Phase | 产出文件 |
|------------|-------|---------|
| `requirement` | 1 | requirement.json, brief.md, research-report.md |
| `research` | 1.5 | research/*.md, research_summary.json |
| `audience-vote` | 1.6 | research/audience_vote_result.md |
| `audience-test` | 2 | research/audience_deep_test.md |
| `scenario` | 2 | scenario.json, story_bible.json, style_hints |
| `art-direction` | 3 | art_direction.json, mood_board.png, color_palette.json |
| `character` | 4 | characters.json, CHARACTERS_DIR/*.png |
| `scene` | 5 | PROJECT_ASSETSscenes/*.png, scene_design.json |
| `sketch` | 5.3 | `PROJECT/PROJECT_ASSETSsketches/*.png` |
| `render` | 5.5 | PROJECT_ASSETSscenes/*.png (渲染版) |
| `storyboard` | 6 | storyboard.json, shots.json |
| `camera` | 7 | video_tasks.json, output/*.mp4, rough_cut.mp4 |
| `delivery` | 8 | final.mp4, qc_report.json |

## 线稿控制管线（Phase 5.3-5.6）

> ⚠️ **强制规则：所有镜头必须先线稿后渲染，无例外。** 不考虑积分成本，质量优先。
> 线稿是构图和比例的保险锁，跳过线稿直接渲染会导致比例失调、构图崩坏。

两阶段生成：先线稿锁定构图（Phase 5.3），再基于线稿渲染释放风格（Phase 5.5）。

| 模式 | 每场景调用 | 积分 | 空间准确性 | 适用 |
|------|----------|------|----------|------|
| 快速（--no-sketch） | ~2次 | ~2 | 基准 | 简单/快速迭代 |
| 线稿（默认） | ~3次 | ~3 | +30-50% | 正式制作 |

## 通用调研能力（全管线可用）

> deep-research skill 可在管线任意阶段按需调用。典型场景：Phase 1 人物背景调研、Phase 2 美术风格参考、Phase 3 角色原型参考、Phase 5 场景光影技法、Phase 7 视频生成技术方案。

## 子 Skill 列表

| Skill | Phase | 功能 |
|-------|-------|------|
| deep-research | 1.5 | 品牌/人物/受众深度调研 |
| kais-topic-selector | 1.5a | 选题发散（多约束聚合 → 3-5 候选选题 + 6维度预评分） |
| kais-audience | 1.6, 2 | 选题投票筛选 + 剧本预测试（完播率/毒点检测） |
| kais-scenario-writer | 2 | 剧本/分镜编写（对白情感注入） |
| kais-art-direction | 3 | 美术方向/视觉风格定义 |
| kais-character-designer | 4 | 角色设计 + 参考图生成 |
| kais-voice | 4.5 | 语音合成（GLM-TTS 多音色 + 审核选择） |
| kais-scene-designer | 5 | 场景图生成 |
| kais-cinematography-planner | 5.7 | 拍摄手法批量映射（Coverage Map） |
| kais-anatomy-guard | - | 肢体解剖修复守卫（三级防御） |
| kais-storyboard-designer | 6 | 分镜板设计 |
| kais-camera | 7 | 视频生成 + 合成 |
| kais-shooting-script | - | 拍摄脚本生成 |
| kais-review-page | - | 审核页面构建（HTML 交互式预览） |

## 共享工具

| 工具 | 路径 | 功能 |
|------|------|------|
| sketch-generator.py | lib/scripts/ | 线稿生成 |
| sketch-to-render.py | lib/scripts/ | 线稿→渲染（四维锚定融合：--style-ref/--lighting/--depth）|
| scene-evaluator.py | lib/scripts/ | 场景图评价（sketch/render/default + 肢体检查 + 深度层次检查）|
| anatomy-validator.py | lib/scripts/ | 解剖质量检测（GLM-4V，hands/face/body/full）|
| jimeng-client.js | lib/ | 即梦 API 客户端（Node.js）|
| cost-scheduler.js | lib/ | 积分/成本调度 |
| extension-chain.js | lib/ | 延长链引擎（buildChainPlan/executeChain/assembleFinal）|
| pipeline.js | lib/ | 管线编排器（串行执行 Phase 1→8，checkpoint/断点恢复）|
| post-production.js | lib/ | 后期合成（字幕生成+音频混流+最终合成）|
| bgm-selector.js | lib/ | BGM 选择（10种风格库，场景情感自动匹配）|
| guard.js | skills/kais-anatomy-guard/lib/ | 肢体解剖修复守卫（negative_prompt + GLM-4V 检测 + 修复）|
| git-stage-manager.js | lib/ | Git 阶段版本管理（checkpoint/rollback/diff）|
| 1st-director.js | lib/ | 四维蓝图生成 + 认知走查 + 模因提取 + 熵注入 + 因果闭环（元层）|
| topic-selector-adapter.js | lib/ | 选题发散适配器（聚合四维尺度/6维度门控/受众匹配约束 → LLM生成候选选题）|
- **文生图**: 即梦 API (jimeng-5.0)
- **视频生成**: Seedance 2.0
- **评价**: 智谱 GLM-4V-Flash
- **调研**: deep-research skill（品牌/受众/竞品深度调研）
- **合成**: FFmpeg

## 延长链引擎（Extension Chain）

> 📖 完整 API 见 [`references/api-usage.md`](references/api-usage.md)

即梦 Seedance **全能参考模式**，prompt 中用 `@1 @2 @3 @4` 描述参考物关系：

- **段1**: `@1`首帧 + `@2`目标尾帧 + `@3`TTS + `@4`BGM
- **段N**: `@1`段N-1视频 + `@2`段N尾帧 + `@3`TTS + `@4`BGM
- 目标尾帧来自分镜 `end_frame` 字段，TTS/BGM 按镜头时间切分

核心函数：`buildChainPlan()` / `buildFilePaths()` / `buildSeedPrompt()` / `executeChain()` / `assembleFinal()`

## 管线编排器（Pipeline）

> 📖 完整 API 见 [`references/api-usage.md`](references/api-usage.md)

```js
import { Pipeline } from './lib/pipeline.js';
const pipeline = new Pipeline({ workdir, episode, config, onPhaseComplete, onPhaseFail });
await pipeline.run();           // 执行全部
await pipeline.resume('character'); // 从断点恢复
await pipeline.runPhase('camera', { execute }); // 只执行某阶段
```

## Phase 8 后期合成

```js
import { PostProduction } from './lib/post-production.js';
const post = new PostProduction({ workdir, episode });
const result = await post.run({
  dialogueLines: [...], videoPath: 'output/rough_cut.mp4',
  ttsDir: 'WORKDIR_ASSETS/tts/', bgmPath: 'WORKDIR_ASSETS/bgm/bgm.mp3',
});
```

## BGM 选择

```js
import { selectBGMStyle, generateBGMPrompt } from './lib/bgm-selector.js';
const recommendations = selectBGMStyle('英雄站在山顶', '史诗', 30);
```

> 📖 完整 API 用法（Pipeline / PostProduction / BGM / ExtensionChain）见 [`references/api-usage.md`](references/api-usage.md)

## 环境变量
- `JIMENG_SESSION_ID`: 即梦 session ID
- `JIMENG_API_URL`: 即梦 API 地址（默认 http://localhost:8000）
- `ZHIPU_API_KEY`: 智谱 API Key（GLM-TTS 语音合成）

## 肢体解剖守卫（kais-anatomy-guard）

三级防御机制，从线稿阶段（Phase 5.3）即开始工作，贯穿渲染阶段（Phase 5.5）：

### 预防层（已集成）
`sketch-generator.py` 和 `sketch-to-render.py` 的 negative_prompt 已追加 anatomy 排除词：
```
bad anatomy, deformed, mutated hands, missing/extra/fused fingers,
extra/missing limbs, bad proportions, distorted/asymmetric face, ...
```

### 检测层（按需调用）
渲染完成后使用 GLM-4V-Flash 检测解剖问题：
```bash
python3 LIB_SCRIPTS/anatomy-validator.py render.png --mode full --threshold 0.6
```
返回 JSON 报告（`<image>.anatomy.json`），包含 score、issues、negative_boost。

### 修复层（检测失败时）
基于检测结果增强 negative_prompt + 降低 sample_strength 重试（最多 3 次）。
仍失败则降级：角度调整 / 景深模糊 / 构图裁切。

详见 `skills/kais-anatomy-guard/SKILL.md`。
