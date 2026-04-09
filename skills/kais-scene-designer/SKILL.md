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
capabilities: space_architecture, camera_map, atmosphere_timeline
```

## 触发词

"设计场景"、"scene"、"场景设计"、"布景"、"场景布局"、"机位设计"

## 输入

| 数据 | 类型 | 说明 |
|------|------|------|
| StoryDNA | StoryDNA | 故事基因（logline, beats, characters, tone） |
| ArtDirection | ArtDirection | 视觉方向（风格、配色、光线、构图） |

## 输出

**SceneDesign**（符合 movie-schema.json）：

```json
{
  "type": "SceneDesign",
  "version": "3.0.0",
  "scene_id": "scene_xxx",
  "location": "废弃的太空站控制室",
  "zones": ["主控台", "观察窗", "走廊入口", "休眠舱"],
  "camera_positions": [
    { "name": "wide_establishing", "x": 0, "y": 2, "z": -5, "look_at": "主控台", "lens": "24mm" }
  ],
  "atmosphere": "冰冷、孤立、微弱应急灯闪烁",
  "lighting": "冷蓝色主光 + 琥珀色应急灯点缀，低对比度"
}
```

## 工作流程

### 1. 分析场景需求

从 StoryDNA 提取：
- 每个 beat 对应的场景 location
- 场景所需的情感氛围（从 emotional_arc 推断）
- 角色在场景中的活动区域

从 ArtDirection 提取：
- 视觉风格约束（color_palette, texture, light_quality）
- 构图规则（composition_rules）
- 参考图片（reference_images）

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

### 5. 生成变体

调用 `lib/designer.js` 的 `generateVariants()` 生成 3 个候选方案，供进化选择。

## 提示词模板

场景设计提示词在 `prompts/scene-design.md`，变量：
- `{location}` — 场景地点
- `{era}` — 时代/时间设定
- `{mood}` — 情感氛围
- `{art_direction}` — 艺术方向描述

## lib/designer.js

ES Module，提供：
- `generateVariants(scene, artDirection, count=3)` — 生成 N 个场景变体
- `createCameraMap(sceneDesign)` — 从场景设计生成机位图
- `createAtmosphereTimeline(scene, storyBeats)` — 生成氛围时间线

## 与其他 Skill 的协作

- **上游**: 接收 StoryDNA（kais-story-dna）、ArtDirection（kais-art-director）
- **下游**: 输出 SceneDesign → Storyboard（kais-storyboard）使用
- **进化**: 场景变体通过 EvolutionState 进行适应度评估和选择
