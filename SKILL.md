# kais-movie-agent — AI 短片制作全流程管线

## 触发词
`movie agent`, `短片制作`, `AI短片`, `视频管线`, `film pipeline`, `movie-wuji`

## ⚠️ 强制审核门（Review Gate）

**以下 Phase 完成后必须暂停，展示产出物给用户审核，收到确认后才能继续：**

| Phase | 审核内容 | 展示方式 |
|-------|---------|---------|
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
Phase 1: 需求确认                              → 🔒 REVIEW GATE
  ↓
Phase 2: 剧本大纲 (kais-scenario-writer)       → 📌 git checkpoint → 🔒 REVIEW GATE
  ↓ 产出：叙事结构 + 画面意图标注 + 旁白/对白
  ↓ 不依赖具体美术风格和角色设定，只标注视觉意图
  ↓
Phase 3: 美术方向 (kais-art-direction)         → 📌 git checkpoint → 🔒 REVIEW GATE
  ↓ 基于大纲的视觉意图，确定风格、色调、光影
  ↓ Step 3.5: 生成光影参考图 (lighting_ref.png) → 四维锚定-光影
  ↓
Phase 4: 角色设计 (kais-character-designer)     → 📌 git checkpoint → 🔒 REVIEW GATE
  ↓ 基于大纲+美术风格，设计角色并锁定一致性
  ↓
Phase 4.5: 配音 (kais-voice)                    → 📌 git checkpoint → 🔒 REVIEW GATE
  ↓ 音色推荐 + 样本生成 + 用户审核 + 批量合成
  ↓
Phase 5: 场景图生成 (kais-scene-designer)       → 📌 git checkpoint
  ↓
Phase 5.3: 线稿生成（anatomy-guard 预防）       → 📌 git checkpoint
  ↓ anatomy-guard 线稿验证（GLM-4V 检测 + 重试）
  ↓
Phase 5.4: 线稿审核 (FAIL → 回滚到 5.3)        → 🔒 REVIEW GATE
  ↓
Phase 5.5: 基于线稿渲染（四维锚定注入 + anatomy-guard 验证修复） → 📌 git checkpoint
  ↓
Phase 5.6: 渲染审核 (FAIL → 回滚到 5.5)        → 🔒 REVIEW GATE
  ↓
Phase 5.7: 拍摄手法规划 (kais-cinematography-planner) → 📌 git checkpoint
  ↓
Phase 6: 分镜板 (kais-storyboard-designer)  → 📌 git checkpoint → 🔒 REVIEW GATE
  ↓
Phase 7: 视频生成 (kais-camera + 时序锚定 + 延长链) → 📌 git checkpoint → 🔒 REVIEW GATE
  ↓ 延长链：种子片段 → 末帧桥接 → 连续延长
  ↓ 断点续传：支持从任意镜头重新延长
  ↓
Phase 8: 后期合成 + 交付（音频预绑定合并） → 📌 git checkpoint
```

### 为什么剧本先行？

| 旧顺序 | 新顺序 | 原因 |
|--------|--------|------|
| 美术→角色→剧本 | **剧本→美术→角色** | 视觉服务于叙事，不是反过来 |
| 先定风格再想故事 | **先有故事再匹配风格** | 大纲的画面意图标注让风格选择有依据 |
| 角色在剧本之前 | **角色基于剧本需求设计** | 避免设计了用不上的角色 |
| — | **大纲含画面意图** | Phase 2 产出同时标注视觉方向，下游无缝衔接 |

### Phase 2（剧本大纲）产出规范

```json
{
  "title": "片名",
  "narrative_arc": "起承转合描述",
  "voiceover_lines": [
    { "id": "VO1", "time_range": "0-5s", "text": "旁白文字", "visual_intent": "画面意图描述" }
  ],
  "shots": [
    {
      "shot_id": "S01",
      "description": "叙事描述",
      "visual_intent": "视觉意图（不绑定具体风格，只描述画面感受）",
      "camera_intent": "镜头意图（运动、角度、景别）",
      "emotion_intent": "情绪意图"
    }
  ],
  "style_hints": ["暗调工业风", "油污质感", "关键时刻金色光芒"],
  "character_hints": ["14岁少年，瘦小但眼神坚定"]
}
```

`visual_intent` / `style_hints` / `character_hints` 是给下游 Phase 3/4 的约束信号，不是最终方案。

## Git 版本管理（每个 Phase 自动 checkpoint）

每个 Phase 完成后自动创建 git checkpoint，支持回滚到任意阶段。

### 使用方式
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

// 比较两个阶段
await git.diff('art-direction', 'character');
```

### CLI
```bash
node lib/git-stage-manager.js init <workdir>              # 初始化
node lib/git-stage-manager.js checkpoint <workdir> <phase> # 手动 checkpoint
node lib/git-stage-manager.js log <workdir>               # 查看历史
node lib/git-stage-manager.js rollback <workdir> <phase>   # 回滚
node lib/git-stage-manager.js diff <workdir> <A> <B>       # 比较
node lib/git-stage-manager.js current <workdir>            # 当前阶段
node lib/git-stage-manager.js stages                       # 列出所有阶段
```

### Phase 与 Git Stage 映射

| Stage Name | Phase | 产出文件 |
|------------|-------|---------|
| `requirement` | 1 | requirement.json, brief.md |
| `scenario` | 2 | scenario.json, story_bible.json, style_hints |
| `art-direction` | 3 | art_direction.json, mood_board.png, color_palette.json |
| `character` | 4 | characters.json, assets/characters/*.png |
| `scene` | 5 | assets/scenes/*.png, scene_design.json |
| `sketch` | 5.3 | assets/sketches/*.png |
| `render` | 5.5 | assets/scenes/*.png (渲染版) |
| `storyboard` | 6 | storyboard.json, shots.json |
| `camera` | 7 | video_tasks.json, output/*.mp4, rough_cut.mp4 |
| `delivery` | 8 | final.mp4, qc_report.json |

## 线稿控制管线（Phase 5.3-5.6）

两阶段生成策略：先线稿锁定构图，再基于线稿渲染释放风格。

### Phase 5.3: 线稿生成
```bash
python3 lib/scripts/sketch-generator.py \
  --prompt "角色坐在桌前吃面，看着面前的屏幕" \
  --space "SUBJECT:角色正面坐姿，双手持筷;PROPS:碗、筷子、屏幕;COMPOSITION:中景" \
  --ref assets/characters/char_wuji/front-source.png \
  --output assets/sketches/B03-eating.png
```

参数：
- `--sample-strength 0.35`：角色参考图影响强度
- `--model jimeng-5.0`：默认模型
- `--ratio 9:16`：竖屏视频比例

### Phase 5.4: 线稿审核
```bash
python3 lib/scripts/scene-evaluator.py --mode sketch spec.json assets/sketches/
```
检查：构图合理性、纯黑白、关键元素完整、线条清晰。FAIL 则重新生成。

### Phase 5.5: 基于线稿渲染
```bash
python3 lib/scripts/sketch-to-render.py \
  --sketch assets/sketches/B03-eating.png \
  --prompt "赛博朋克风格，霓虹灯光，暗色调" \
  --ref assets/characters/char_wuji/front-source.png \
  --output assets/scenes/B03-eating.png
```

参数：
- `--sample-strength 0.25`：线稿结构保留强度
- images 顺序：[线稿(结构), 角色参考图(外观)]
- `--style` 可额外指定风格关键词

### Phase 5.6: 渲染审核
```bash
python3 lib/scripts/scene-evaluator.py --mode render spec.json assets/scenes/
```
检查：无残留线稿、风格统一、角色一致、构图保持。

## 跳过线稿管线
对于简单场景或快速迭代，可跳过线稿阶段直接生成：
在 prompt 中添加 `--no-sketch` 或直接使用 Phase 5 的直接生成模式。

## 成本对比

| 模式 | 每场景平均调用 | 积分消耗 | 空间准确性 | 适用场景 |
|------|-------------|---------|-----------|---------|
| 快速模式（--no-sketch） | ~2次 | ~2积分 | 基准 | 简单场景、快速迭代 |
| 线稿管线（默认） | 线稿1.5次+渲染1.5次 | ~3积分 | +30-50% | 复杂场景、正式制作 |

- 线稿管线额外成本约 +50% 积分，但显著提升构图和空间准确性
- 质量不达标时，重做线稿（低成本）比重做渲染（高成本）更经济
- 建议正式制作使用线稿管线，draft/探索阶段使用快速模式

## 关键参数配置

| 参数 | 线稿生成 | 线稿→渲染 | 快速模式 |
|------|---------|----------|---------|
| model | jimeng-5.0 | jimeng-5.0 | jimeng-5.0 |
| ratio | 9:16 | 9:16 | 9:16 |
| resolution | 2k | 2k | 2k |
| sample_strength | 0.35 | 0.25 | 0.35 |
| negative_prompt | 彩色/渲染/阴影/渐变 | 线稿/草图/粗糙/黑白 | - |
| images | 角色参考图 | [线稿, 角色正面, 角色3/4, 风格/光影参考] | 角色参考图 |
| 审核 | --mode sketch | --mode render（含深度层次检查） | --mode default |
| 光影锚定 | - | --style-ref + --lighting | - |
| 深度锚定 | - | --depth | - |

## 子 Skill 列表

| Skill | Phase | 功能 |
|-------|-------|------|
| kais-art-direction | 2 | 美术方向/视觉风格定义 |
| kais-character-designer | 3 | 角色设计 + 参考图生成 |
| kais-scenario-writer | 4 | 剧本/分镜编写（对白情感注入） |
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
- **文生图**: 即梦 API (jimeng-5.0)
- **视频生成**: Seedance 2.0
- **评价**: 智谱 GLM-4V-Flash
- **合成**: FFmpeg

## 延长链引擎（Extension Chain）

即梦 Seedance **全能参考模式**，prompt 中用 `@1 @2 @3` 正确描述参考物关系：

```
段1: @1首帧 + @2目标尾帧 + @3TTS段 + @4BGM段
     prompt: "@1作为画面起点，@2作为画面终点。从@1开始，{运动}，最终过渡到@2。"

段2: @1段1视频 + @2段2目标尾帧 + @3TTS段 + @4BGM段
     prompt: "@1是上一段视频，从@1的结尾画面开始自然延续，{运动}，最终过渡到@2。"

段N: @1段N-1视频 + @2段N目标尾帧 + @3TTS段 + @4BGM段
     prompt: "@1是上一段视频，从@1的结尾画面开始{风格}，{运动}，最终过渡到@2。"
```

- **目标尾帧**来自分镜图的 `end_frame` 字段（storyboard 自动生成）
- **上一段视频**保持连续性
- **TTS/BGM** 按镜头时间切分预绑定
- **voice 集成**: executeChain 支持 `generateTTS` 回调，自动调用 kais-voice 生成 TTS

核心模块：`lib/extension-chain.js`
- `buildChainPlan()` — 构建执行计划
- `buildFilePaths()` — 构建 file_paths（顺序与 @1@2@3 对应）
- `buildSeedPrompt()` / `buildExtensionPrompt()` — 构建带参考关系描述的 prompt
- `executeChain()` / `resumeFromBreakpoint()` / `assembleFinal()`

## 管线编排器（Pipeline）

```js
import { Pipeline } from './lib/pipeline.js';

const pipeline = new Pipeline({
  workdir: '/path/to/project',
  episode: 'EP01',
  config: { title: '短片', genre: '科幻', duration_sec: 60, characters: [...] },
  onPhaseComplete: (phase, result) => { ... },
  onPhaseFail: (phase, error) => { ... },
});

// 执行全部
const result = await pipeline.run();

// 从断点恢复
const result2 = await pipeline.resume('character');

// 只执行某个阶段
const result3 = await pipeline.runPhase('camera', { execute: async (p, phase) => { ... } });
```

## Phase 8 后期合成

```js
import { PostProduction } from './lib/post-production.js';

const post = new PostProduction({ workdir, episode });

// 一站式后期
const result = await post.run({
  dialogueLines: [{ text: '你好', start_time: 0, end_time: 2, speaker: '角色A' }],
  videoPath: 'output/rough_cut.mp4',
  ttsDir: 'assets/tts/',
  bgmPath: 'assets/bgm/bgm.mp3',
  burnSubtitles: false,
});
```

## BGM 选择

```js
import { selectBGMStyle, generateBGMPrompt } from './lib/bgm-selector.js';

// 根据场景情感推荐 BGM
const recommendations = selectBGMStyle('英雄站在山顶', '史诗', 30);

// 生成音乐 AI 提示词
const prompt = generateBGMPrompt('追逐场景', '紧张', 20);
```

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
python3 lib/scripts/anatomy-validator.py render.png --mode full --threshold 0.6
```
返回 JSON 报告（`<image>.anatomy.json`），包含 score、issues、negative_boost。

### 修复层（检测失败时）
基于检测结果增强 negative_prompt + 降低 sample_strength 重试（最多 3 次）。
仍失败则降级：角度调整 / 景深模糊 / 构图裁切。

详见 `skills/kais-anatomy-guard/SKILL.md`。
