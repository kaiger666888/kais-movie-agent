# kais-movie-agent — AI 短片制作全流程管线

## 触发词
`movie agent`, `短片制作`, `AI短片`, `视频管线`, `film pipeline`, `movie-wuji`

## 管线流程

```
Phase 1: 需求确认
  ↓
Phase 2: 美术方向 (kais-art-direction)     → 📌 git checkpoint
  ↓ Step 3.5: 生成光影参考图 (lighting_ref.png) → 四维锚定-光影
  ↓
Phase 3: 角色设计 (kais-character-designer) → 📌 git checkpoint
  ↓
Phase 4: 剧本编写 (kais-scenario-writer)   → 📌 git checkpoint
  ↓
Phase 5: 场景图生成 (kais-scene-designer)   → 📌 git checkpoint
  ↓
Phase 5.3: 线稿生成（anatomy-guard 预防） → 📌 git checkpoint
  ↓ anatomy-guard 线稿验证（GLM-4V 检测 + 重试）
  ↓
Phase 5.4: 线稿审核 (FAIL → 回滚到 5.3)
  ↓
Phase 5.5: 基于线稿渲染（四维锚定注入 + anatomy-guard 验证修复） → 📌 git checkpoint
  ↓
Phase 5.6: 渲染审核 (FAIL → 回滚到 5.5)
  ↓
Phase 5.7: 拍摄手法规划 (kais-cinematography-planner) → 📌 git checkpoint
  ↓
Phase 6: 分镜板 (kais-storyboard-designer)  → 📌 git checkpoint
  ↓
Phase 7: 视频生成 (kais-camera + 时序锚定) → 📌 git checkpoint
  ↓
Phase 8: 后期合成 + 交付                     → 📌 git checkpoint
```

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
| `art-direction` | 2 | art_direction.json, mood_board.png, color_palette.json |
| `character` | 3 | characters.json, assets/characters/*.png |
| `scenario` | 4 | scenario.json, story_bible.json |
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
| kais-scenario-writer | 4 | 剧本/分镜编写 |
| kais-scene-designer | 5 | 场景图生成 |
| kais-cinematography-planner | 5.7 | 拍摄手法批量映射（Coverage Map） |
| kais-anatomy-guard | - | 肢体解剖修复守卫（三级防御） |
| kais-storyboard-designer | 6 | 分镜板设计 |
| kais-camera | 7 | 视频生成 + 合成 |
| kais-shooting-script | - | 拍摄脚本生成 |

## 共享工具

| 工具 | 路径 | 功能 |
|------|------|------|
| sketch-generator.py | lib/scripts/ | 线稿生成 |
| sketch-to-render.py | lib/scripts/ | 线稿→渲染（四维锚定融合：--style-ref/--lighting/--depth）|
| scene-evaluator.py | lib/scripts/ | 场景图评价（sketch/render/default + 肢体检查 + 深度层次检查）|
| anatomy-validator.py | lib/scripts/ | 解剖质量检测（GLM-4V，hands/face/body/full）|
| jimeng-client.js | lib/ | 即梦 API 客户端（Node.js）|
| cost-scheduler.js | lib/ | 积分/成本调度 |
| guard.js | skills/kais-anatomy-guard/lib/ | 肢体解剖修复守卫（negative_prompt + GLM-4V 检测 + 修复）|
| git-stage-manager.js | lib/ | Git 阶段版本管理（checkpoint/rollback/diff）|
- **文生图**: 即梦 API (jimeng-5.0)
- **视频生成**: Seedance 2.0
- **评价**: 智谱 GLM-4V-Flash
- **合成**: FFmpeg

## 环境变量
- `JIMENG_SESSION_ID`: 即梦 session ID
- `JIMENG_API_URL`: 即梦 API 地址（默认 http://localhost:8000）

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
