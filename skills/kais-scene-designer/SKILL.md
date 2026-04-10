---
name: kais-scene-designer
description: "空间设计师。将 StoryDNA + ArtDirection 转化为 SceneDesign（场景布局、机位图、氛围时间线）。激活条件：用户提到'场景设计'、'scene design'、'场景布局'、'机位'、'镜头布局'、'场景图'、'氛围'、'scene'、'环境设计'、'空间设计'、'分场景'、'场景描述'、'场景参考'、'场景概念'、'场景搭建'时激活。"
---

# kais-scene-designer — 场景设计

空间设计师。将 StoryDNA + ArtDirection 转化为 SceneDesign（场景布局、机位图、氛围时间线）。

## 元数据

```yaml
type: spatial_designer
population_size: 3
output: SceneDesign
capabilities: space_architecture, camera_map, atmosphere_timeline, character_consistency, beat_coverage
```

## 触发词

"设计场景"、"scene"、"场景设计"、"布景"、"场景布局"、"机位设计"

## 输入

| 数据 | 类型 | 说明 |
|------|------|------|
| StoryDNA | StoryDNA | 故事基因（logline, beats, characters, tone） |
| ArtDirection | ArtDirection | 视觉方向（风格、配色、光线、构图） |

## 前置依赖

**必须先完成 kais-character-designer**，获取 CharacterBible 后才能执行本 Skill。

从 CharacterBible 中提取：
- `turnaround_image` — 角色转面图路径（正面/侧面/背面）
- `reference_images` — 角色参考图列表（含角度标签：front/side/3quarter/full-body）
- `style_prefix` — 固定风格前缀（所有生成 prompt 必须以此开头）
- `sample_strength` — 参考图影响强度（默认 0.35）

**缺少 CharacterBible 时，拒绝执行并提示先完成角色设计。**

## 输出

**SceneDesign v2.0.0**：

```json
{
  "type": "SceneDesign",
  "version": "2.0.0",
  "shots": [
    {
      "shot_id": "B01-foot-catch",
      "beat_id": "B01",
      "shot_type": "action_closeup",
      "description": "脚接杯子",
      "reference_image_used": "assets/characters/char_wuji/3quarter-body.png",
      "generated_image": "assets/scenes/B01-foot-catch.png",
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

### 1.5. 一致性参数构建

为每个镜头构建生成参数：

1. 从 CharacterBible 获取 `style_prefix`
2. 从 CharacterBible 获取 `sample_strength`（默认 0.35）
3. 选择最匹配当前 beat 角度的参考图（正面/侧面/3/4等）
4. 构建最终 prompt = `style_prefix` + 场景描述 + 角色描述 + 角度描述

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

每个机位包含：name, x, y, z, look_at, lens

### 4. 氛围时间线（atmosphere_timeline）

将场景氛围映射到故事节拍：
- 每个 beat 对应的氛围变化（光线、色彩、密度）
- 情感高潮时的氛围强化
- 过渡段的氛围渐变

### 5. 基于角色参考图生成

每张场景图必须用 multipart curl 上传角色参考图，保持角色一致性。

**参考图选择逻辑**：
- 全景镜头 → 3/4 全身参考图
- 中景镜头 → 根据角色朝向选择
- 特写镜头 → 正面肖像参考图
- 动作镜头 → 最接近动作姿态的参考图

API 调用示例：
```bash
curl -s http://localhost:8000/v1/images/generations \
  -H "Authorization: Bearer $SESSION_ID" \
  -F "prompt=$STYLE_PREFIX $SCENE_DESCRIPTION $ANGLE_DESCRIPTION" \
  -F "model=jimeng-5.0" \
  -F "ratio=9:16" \
  -F "sample_strength=$SAMPLE_STRENGTH" \
  -F "images=@$BEST_MATCH_REFERENCE_IMAGE"
```

### 6. 一致性验证（生成后）

检查生成的场景图中角色是否与参考图一致：
- 角色外貌（脸型、发型、服装）是否与 CharacterBible 一致
- 如果不一致（角色外貌明显偏差），降低 `sample_strength` 重试
- **降级策略**：0.35 → 0.25 → 0.15 → 0.05
- 4 次重试后仍不一致，保留最佳结果并标注警告

### 7. 覆盖率检查

生成完成后，逐 beat 核对：
- `coverage.total_beats` = StoryDNA 中的 beat 总数
- `coverage.covered_beats` = 已有对应镜头的 beat 数
- `coverage.missing_beats` = 缺失镜头的 beat ID 列表
- **missing_beats 必须为空，否则不能交付**

## 提示词模板

场景设计提示词在 `prompts/scene-design.md`，变量：
- `{location}` — 场景地点
- `{era}` — 时代/时间设定
- `{mood}` — 情感氛围
- `{art_direction}` — 艺术方向描述
- `{style_prefix}` — 来自 CharacterBible 的风格前缀
- `{character_description}` — 来自 CharacterBible 的角色描述

## lib/designer.js

ES Module，提供：
- `generateVariants(scene, artDirection, count=3)` — 生成 N 个场景变体
- `createCameraMap(sceneDesign)` — 从场景设计生成机位图
- `createAtmosphereTimeline(scene, storyBeats)` — 生成氛围时间线
- `buildConsistencyPrompt(stylePrefix, scene, character, angle)` — 构建一致性 prompt
- `selectReferenceImage(shotType, referenceImages)` — 根据镜头类型选择参考图

## 与其他 Skill 的协作

- **上游**: 接收 StoryDNA（kais-story-dna）、ArtDirection（kais-art-director）、CharacterBible（kais-character-designer）
- **下游**: 输出 SceneDesign → Storyboard（kais-storyboard）使用
- **进化**: 场景变体通过 EvolutionState 进行适应度评估和选择
