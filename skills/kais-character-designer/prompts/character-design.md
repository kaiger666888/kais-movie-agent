# 角色设计 Prompt 模板

## 变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `{character_name}` | 角色名称 | 林小雨 |
| `{appearance}` | 外貌描述 | 黑色短发，戴圆框眼镜，穿白色实验室大褂 |
| `{personality}` | 性格关键词 | 聪明但社恐，眼神温暖 |
| `{style}` | 美术风格 | anime, realistic, watercolor |
| `{art_direction}` | 导演美术指令 | 赛博朋克风格，冷色调，霓虹灯光 |
| `{view_angle}` | 视角 | front, side, 3/4, close-up |
| `{style_prefix}` | 多视角风格前缀 | anime, cyberpunk era, dark mood, palette: #111/#222 |

## 变体 A: 正面肖像

```
Character design sheet, front view portrait of {character_name}. 
{appearance}. {personality} reflected in expression.
Art style: {style}. {art_direction}.
Clean white background, professional character concept art, 
high detail, sharp focus on face, studio lighting.
Character turnaround sheet style, front angle.
```

## 变体 B: 全身侧面

```
Character design, full body side view of {character_name}. 
{appearance}. Standing in a neutral pose showing full silhouette.
Art style: {style}. {art_direction}.
Clean white background, character concept art, 
full body visible from head to toe, consistent proportions with portrait.
Side profile, 3/4 body turn.
```

## 变体 C: 表情特写

```
Character expression sheet, close-up 3/4 view of {character_name}. 
{appearance}. Three expressions: neutral, happy, determined.
{personality} visible in micro-expressions.
Art style: {style}. {art_direction}.
Clean white background, expression study, 
detailed facial features, consistent with previous views.
3/4 angle close-up on face and shoulders.
```

## 一致性重生成（风格变更）

```
Character design of {character_name}, maintaining exact same face,
body proportions, and features. {appearance}.
NEW art style: {new_style}. {new_art_direction}.
Same character, different artistic interpretation.
Consistent with reference images provided.
```

## 多视角参考图模板（4D 身份锚定）

用于 `generateMultiViewReference()` 生成 3 张身份锚定参考图。

### 视角 1: 正面 (front-source)

```
{style_prefix}, front view portrait of {character_name},
{appearance}, {personality} mood,
front-facing, eyes looking at camera, symmetrical composition,
upper body, clean white background, professional character reference sheet,
high detail, studio lighting, identity anchor view
```

### 视角 2: 3/4 视角 (3q-source)

```
{style_prefix}, 3/4 view of {character_name},
{appearance}, {personality} mood,
head turned 45 degrees, showing depth and volume of face and body,
upper body, clean white background, professional character reference sheet,
high detail, soft lighting, identity anchor view
```

### 视角 3: 侧面 (side-source)

```
{style_prefix}, side profile view of {character_name},
{appearance}, {personality} mood,
perfect side profile, head and shoulders,
clean outline showing nose bridge and jawline,
clean white background, professional character reference sheet,
high detail, silhouette clear, identity anchor view
```

## 使用说明

1. 从 StoryDNA 提取角色信息填入变量
2. 三个变体使用相同变量，仅视角不同
3. 生成时使用 `ratio: "3:4"`（适合角色肖像）
4. 从 API 返回中提取 seed 并记录
