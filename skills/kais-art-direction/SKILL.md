---
name: kais-art-direction
description: "艺术指导与全局视觉风格系统。触发词：'艺术指导'、'art direction'、'风格定义'、'视觉风格'、'色调'、'色彩方案'、'画面风格'、'整体风格'、'视觉调性'、'mood board'、'视觉基调'、'美术风格'、'art style'、'color palette'、'visual identity'、'moodboard'、'look and feel'、'色彩搭配'、'质感定义'、'光影风格'。当用户需要定义视频/短剧的视觉风格时激活，如设置色调、光影、质感等美术方向。"
---

# kais-art-direction — 艺术指导/风格系统

## 触发词

**中文**：艺术指导、风格定义、视觉风格、色调、色彩方案、画面风格、整体风格、视觉调性、美术风格、色彩搭配、质感定义、光影风格
**英文**：art direction、art style、color palette、visual identity、moodboard、mood board、look and feel、visual tone、color scheme、visual style、aesthetic

## 触发场景

1. 用户在开始视频/短片项目时，要求先定义整体视觉风格
2. 用户说"帮我定个风格"、"这个项目用什么色调"
3. 用户要求制作 mood board 或参考图来统一视觉基调
4. 用户讨论色彩搭配、光影质感等美术层面的问题
5. 用户在已有剧本后，进入"定风格"阶段
6. 用户提到某个影视作品的画面风格并想参考

## 定位

全局风格锁 — 所有视觉层 Skill（角色设计、场景、分镜、生成）必须遵守已锁定的 ArtDirection。

## 元数据

```yaml
type: style_system
population_size: 3
aspect_orientation: "16:9"
output: ArtDirection
capabilities: color_palette, light_quality, texture, composition
```

## 输入输出

### 输入：StoryDNA
```json
{
  "tone": "dark_hopeful",
  "genre": "sci-fi",
  "theme": "孤独与连接",
  "era": "2077",
  "mood_keywords": ["废墟", "霓虹", "雨夜"]
}
```

### 输出：ArtDirection（符合 movie-schema.json 定义）
```json
{
  "type": "ArtDirection",
  "version": "1.0.0",
  "style_name": "霓虹废墟",
  "color_palette": ["#0a0e17", "#1a3a5c", "#ff6b35", "#00ff88", "#c8d6e5"],
  "light_quality": "高对比度霓虹灯+湿润路面反射",
  "texture": "金属锈蚀+玻璃+全息投影",
  "composition_rules": ["三分法", "引导线透视", "前景框架"],
  "reference_images": ["https://..."]
}
```

## 工作流程

### 1. 生成风格选项（3选1）
- 调用 `lib/stylist.js` → `generateStyleOptions(storyDNA, 3)`
- 使用 `prompts/art-direction.md` 为每个风格生成参考图（通过即梦文生图）
- 展示 3 个风格供用户选择

### 2. 锁定风格
- 用户选择后调用 `lockStyle(selectedStyle)`
- 写入 `{workspace}/.art-direction-lock.json` 作为全局状态
- 所有下游 Skill 读取此锁

### 3. 下游适配
- 其他 Skill 调用 `getStyleGuideForSkill(skillType)` 获取该 Skill 维度的风格约束
- 调用 `validateConsistency(artifact)` 检查产出是否符合锁定风格

## 内置风格库

| 风格 | 色调 | 光效 | 质感 | 构图 |
|------|------|------|------|------|
| 电影胶片感 | 暖黄+深棕+褪色蓝 | 柔和漫射+颗粒感 | 胶片颗粒+有机材质 | 经典黄金分割+浅景深 |
| 赛博朋克 | 深蓝+霓虹粉+电光绿 | 高对比霓虹+反射 | 金属+全息+玻璃 | 引导线透视+框架构图 |
| 日系清新 | 白+淡粉+薄荷绿 | 自然漫射+逆光 | 柔焦+通透空气感 | 留白+低角度 |
| 暗黑哥特 | 黑+深红+暗金 | 戏剧性明暗对比+烛光 | 石材+蕾丝+金属 | 对称+垂直线条 |
| 纪录片写实 | 自然色+低饱和 | 自然光+手持光感 | 真实材质+无滤镜 | 手持构图+抓拍感 |
| 梦幻超现实 | 渐变紫+荧光蓝+金 | 柔和发光+光晕 | 流体+水晶+星尘 | 中心对称+漂浮感 |

## 即梦参考图生成

生成参考图时使用以下参数：
- **模型**: jimeng-5.0
- **比例**: 16:9
- **Prompt**: 基于 `prompts/art-direction.md` 模板填充变量
- **数量**: 每个风格 1 张参考图

## 与其他 Skill 的协作

```
StoryDNA → [kais-art-direction] → ArtDirection (locked)
                                        ↓
                    ┌───────────────────┼───────────────────┐
                    ↓                   ↓                   ↓
            角色设计 Skill        场景设计 Skill         分镜 Skill
            (遵守风格锁)         (遵守风格锁)          (遵守风格锁)
```

## 文件结构

```
kais-art-direction/
├── SKILL.md              # 本文件
├── prompts/
│   └── art-direction.md  # 风格生成 prompt 模板
└── lib/
    └── stylist.js        # 风格引擎逻辑
```
