---
name: kais-scene-designer
description: "空间设计师。将 StoryDNA + ArtDirection 转化为 SceneDesign（场景布局、机位图、氛围时间线）。支持线稿控制管线（默认启用）。激活条件：用户提到'场景设计'、'scene design'、'场景布局'、'机位'、'镜头布局'、'场景图'、'氛围'、'scene'、'环境设计'、'空间设计'、'分场景'、'场景描述'、'场景参考'、'场景概念'、'场景搭建'时激活。"
---

# kais-scene-designer — 场景设计（含线稿控制管线）

空间设计师。将 StoryDNA + ArtDirection 转化为 SceneDesign（场景布局、机位图、氛围时间线）。

**默认启用线稿控制管线**：先文生线稿锁定构图 → 线稿审核 → 基于线稿渲染 → 渲染审核 → 交付。

## 元数据

```yaml
type: spatial_designer
population_size: 3
output: SceneDesign
capabilities: space_architecture, camera_map, atmosphere_timeline, character_consistency, beat_coverage, lineart_pipeline
pipeline_modes: [lineart(default), direct(--no-sketch)]
```

## 触发词

"设计场景"、"scene"、"场景设计"、"布景"、"场景布局"、"机位设计"

## 输入

| 数据 | 类型 | 说明 |
|------|------|------|
| StoryDNA | StoryDNA | 故事基因（logline, beats, characters, tone） |
| ArtDirection | ArtDirection | 视觉方向（风格、配色、光线、构图） |
| CharacterBible | CharacterBible | 角色圣经（参考图、风格前缀） |

## 前置依赖

**必须先完成 kais-character-designer**，获取 CharacterBible 后才能执行本 Skill。

从 CharacterBible 中提取：
- `turnaround_image` — 角色转面图路径（正面/侧面/背面）
- `reference_images` — 角色参考图列表（含角度标签：front/side/3quarter/full-body）
- `style_prefix` — 固定风格前缀（所有生成 prompt 必须以此开头）
- `sample_strength` — 参考图影响强度（默认 0.35）

**缺少 CharacterBible 时，拒绝执行并提示先完成角色设计。**

## 输出

**SceneDesign v3.0.0**：

```json
{
  "type": "SceneDesign",
  "version": "3.0.0",
  "pipeline": "lineart",
  "shots": [
    {
      "shot_id": "B01-foot-catch",
      "beat_id": "B01",
      "shot_type": "action_closeup",
      "description": "脚接杯子",
      "sketch_image": "assets/sketches/B01-foot-catch.png",
      "render_image": "assets/scenes/B01-foot-catch.png",
      "reference_image_used": "assets/characters/char_wuji/3quarter-body.png",
      "prompt_used": "完整prompt记录",
      "sample_strength": 0.35
    }
  ],
  "character_consistency": {
    "style_prefix": "Arcane Fortiche...",
    "sample_strength": 0.35,
    "reference_source": "CharacterBible.char_wuji"
  },
  "coverage": {
    "total_beats": 10,
    "covered_beats": 10,
    "missing_beats": []
  }
}
```

## 工作流程

### 0. 模式选择

- **默认：线稿管线模式**（推荐）— 文生线稿 → 审核 → 渲染 → 审核
- **`--no-sketch`：快速模式** — 直接文生图 → 审核（跳过线稿，适合简单场景或快速迭代）

### 1. Beat → 镜头映射（强制步骤）

读取 StoryDNA 的所有 beats，为每个 beat 设计镜头：

1. 遍历所有 beats，列出每个 beat 所需镜头（角度/景别/关键动作）
2. 去重合并（多个 beat 可共用同一镜头）
3. **必须展示完整镜头清单给导演确认后再生成**

输出格式：
```
镜头清单（共N张）：
B01 泡面危机 → 动作特写：脚接杯子
B02 破烂实验室 → 全景：鸟瞰俯拍
B03 日常实验 → 中景：侧面吃面
...
```

**禁止**：只生成"全景/中景/特写"三个固定角度就认为完成。必须根据 beat 内容设计具体镜头。

### 2. 空间架构（space_architecture）

为每个场景设计：
- **zones**: 3-6 个功能区域（角色活动、视觉焦点、通道）
- **空间关系**: 区域之间的相对位置和连接方式
- **道具暗示**: 从叙事需要推断的空间道具

### 3. 机位设计（camera_map）

为每个场景设计 3-5 个机位：
- **establishing**: 全景建立镜头
- **medium**: 中景叙事镜头
- **close_up**: 特写情绪镜头
- **dynamic**: 运动/特殊角度镜头

### 4. 氛围时间线（atmosphere_timeline）

将场景氛围映射到故事节拍。

---

### 5. 线稿生成（Phase 5.3）

对每个镜头生成黑白漫画风格线稿，锁定构图和空间关系。

**S.P.A.C.E 约束格式**：
```
SUBJECT: 角色正面坐姿，双手持筷
PROPS: 碗、筷子、电脑屏幕
COMPOSITION: 中景，三分法构图
ENVIRONMENT: 简约实验室，凌乱桌面
```

```bash
python3 lib/scripts/sketch-generator.py \
  --prompt "$SCENE_DESCRIPTION" \
  --space "SUBJECT:$SUBJECT;PROPS:$PROPS;COMPOSITION:$COMPOSITION;ENVIRONMENT:$ENV" \
  --ref $BEST_MATCH_REFERENCE_IMAGE \
  --output assets/sketches/$SHOT_ID.png \
  --sample-strength 0.35
```

**关键参数**：
- `sample_strength=0.35`：角色参考图影响强度
- `negative_prompt`：自动添加"彩色, 上色, 渲染, 阴影, 光影, gradient..."排除渲染类
- 输出：纯黑白线稿，无色无阴影

### 6. 线稿审核（Phase 5.4）

```bash
python3 lib/scripts/scene-evaluator.py --mode sketch spec.json assets/sketches/
```

**检查维度**：
- 纯黑白（无灰度/渐变/彩色）
- 线条清晰（无模糊/断裂）
- 构图合理性（透视/比例）
- 空间关系（前/中/远景层次）
- 元素完整性（角色/道具/环境齐备）
- 角色姿态（与描述一致）

**FAIL 处理**：重新生成线稿，最多 2 次。

### 7. 基于线稿渲染（Phase 5.5）

```bash
python3 lib/scripts/sketch-to-render.py \
  --sketch assets/sketches/$SHOT_ID.png \
  --prompt "$SCENE_DESCRIPTION $STYLE_PREFIX" \
  --style "$ART_DIRECTION_STYLE" \
  --ref $BEST_MATCH_REFERENCE_IMAGE \
  --output assets/scenes/$SHOT_ID.png \
  --sample-strength 0.25
```

**关键参数**：
- `sample_strength=0.25`：线稿结构保留强度（低于线稿生成阶段）
- `images` 顺序：[线稿(主要结构), 角色参考图(外观一致性)] — 双重控制
- `negative_prompt`：自动添加"线稿, sketch, lineart, 草图, draft, 线条, 粗糙..."排除线稿类
- 渲染 prompt 在场景描述基础上添加风格/氛围描述

### 8. 渲染审核（Phase 5.6）

```bash
python3 lib/scripts/scene-evaluator.py --mode render spec.json assets/scenes/
```

**检查维度**：
- 无残留线稿（不应有黑色线条痕迹）
- 风格一致性（色彩/光影/质感协调）
- 角色一致性（与参考图一致）
- 构图保持（与线稿布局一致）
- 美感质量（无AI生成瑕疵）

**FAIL 处理**：调整 sample_strength 重试，最多 1 次。

### 9. 一致性验证（降级策略）

检查角色一致性：
- 角色外貌（脸型、发型、服装）是否与 CharacterBible 一致
- **降级策略**：0.25 → 0.15 → 0.05
- 3 次重试后仍不一致，保留最佳结果并标注警告

### 10. 覆盖率检查

生成完成后，逐 beat 核对：
- `coverage.total_beats` = StoryDNA 中的 beat 总数
- `coverage.covered_beats` = 已有对应镜头的 beat 数
- `coverage.missing_beats` = 缺失镜头的 beat ID 列表
- **missing_beats 必须为空，否则不能交付**

---

### 快速模式（--no-sketch）

跳过线稿阶段，直接文生图：

```bash
curl -s http://localhost:8000/v1/images/generations \
  -H "Authorization: Bearer $SESSION_ID" \
  -F "prompt=$STYLE_PREFIX $SCENE_DESCRIPTION $ANGLE_DESCRIPTION" \
  -F "model=jimeng-5.0" \
  -F "ratio=9:16" \
  -F "sample_strength=$SAMPLE_STRENGTH" \
  -F "images=@$BEST_MATCH_REFERENCE_IMAGE"
```

然后执行通用评价（`scene-evaluator.py --mode default`）。

## 参考图选择策略

- 全景镜头 → 3/4 全身参考图
- 中景镜头 → 根据角色朝向选择
- 特写镜头 → 正面肖像参考图
- 动作镜头 → 最接近动作姿态的参考图

## 提示词模板

场景设计提示词在 `prompts/scene-design.md`，变量：
- `{location}` — 场景地点
- `{era}` — 时代/时间设定
- `{mood}` — 情感氛围
- `{art_direction}` — 艺术方向描述
- `{style_prefix}` — 来自 CharacterBible 的风格前缀
- `{character_description}` — 来自 CharacterBible 的角色描述

### 线稿阶段 Prompt 模板（S.P.A.C.E 约束）

```
黑白漫画风格线稿，简洁干净的线条，无阴影无渐变。
{场景描述}
空间约束：SUBJECT:{角色姿态};PROPS:{道具列表};COMPOSITION:{景别构图};ENVIRONMENT:{环境描述}
纯黑白线稿，清晰轮廓线，漫画分镜风格，没有颜色，没有灰度
```

### 渲染阶段 Prompt 模板

```
{style_prefix}, {场景描述}, {角度描述}
风格要求：{art_direction的style/light_quality/color_palette描述}
{光影描述}, {氛围描述}, 电影级质感，高画质
```

## lib/designer.js

ES Module，提供：
- `generateSketch(prompt, spaceConstraints, refImage, options)` — 生成线稿
- `evaluateSketch(spec, sketchDir)` — 线稿审核
- `renderFromSketch(sketchPath, prompt, refImages, options)` — 基于线稿渲染
- `evaluateRender(spec, renderDir)` — 渲染审核
- `generateDirect(prompt, refImage, options)` — 快速模式直接生成
- `generateVariants(scene, artDirection, count=3)` — 生成 N 个场景变体
- `createCameraMap(sceneDesign)` — 从场景设计生成机位图
- `createAtmosphereTimeline(scene, storyBeats)` — 生成氛围时间线
- `buildConsistencyPrompt(stylePrefix, scene, character, angle)` — 构建一致性 prompt
- `selectReferenceImage(shotType, referenceImages)` — 根据镜头类型选择参考图

## 与其他 Skill 的协作

- **上游**: 接收 StoryDNA（kais-scenario-writer）、ArtDirection（kais-art-direction）、CharacterBible（kais-character-designer）
- **下游**: 输出 SceneDesign（含线稿+渲染图）→ Storyboard（kais-storyboard-designer）使用
- **线稿管线**: sketch-generator.py → scene-evaluator.py --mode sketch → sketch-to-render.py → scene-evaluator.py --mode render
