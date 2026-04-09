# 分镜参考图提示词模板

## 变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `{shot_description}` | 镜头动作描述 | "一个穿黑色风衣的男人推门而入" |
| `{character}` | 角色外观描述 | "30岁亚洲男性，短发，深色西装，眼神锐利" |
| `{scene}` | 场景环境描述 | "深夜的咖啡馆，暖黄色灯光，雨滴打在窗户上" |
| `{camera_angle}` | 镜头角度 | "中景，正面，略微仰拍" |
| `{art_style}` | 美术风格 | "电影质感，低调光，色彩饱和度低，胶片颗粒" |
| `{emotion}` | 情绪氛围 | "紧张，悬疑" |
| `{time_of_day}` | 时间 | "深夜" |
| `{weather}` | 天气 | "雨天" |

## 基础模板

```
电影分镜参考图。{camera_angle}。{shot_description}。角色：{character}。场景：{scene}。时间：{time_of_day}，{weather}。情绪：{emotion}。风格：{art_style}。高画质，电影级构图，专业灯光。
```

## 镜头类型专用模板

### 全景 (Wide Shot)

```
电影分镜参考图，大全景。{scene}。{shot_description}。角色：{character}。环境细节丰富，景深大，{time_of_day}，{weather}。风格：{art_style}。史诗感构图，高画质。
```

### 中景 (Medium Shot)

```
电影分镜参考图，中景。{character}，{shot_description}。场景：{scene}。{camera_angle}。{time_of_day}。风格：{art_style}。自然光，景深适中，高画质。
```

### 特写 (Close-up)

```
电影分镜参考图，面部特写。{character}，{shot_description}。浅景深，背景虚化。{emotion}氛围。风格：{art_style}。皮肤细节丰富，眼神光，高画质。
```

### 过肩 (Over-the-shoulder)

```
电影分镜参考图，过肩镜头。前景：{character} 的肩膀和后脑。焦点：{shot_description}。场景：{scene}。{camera_angle}。风格：{art_style}。自然对话构图，高画质。
```

### 跟拍 (Tracking Shot)

```
电影分镜参考图，跟拍镜头。{character}，{shot_description}。场景：{scene}，运动模糊。{time_of_day}。风格：{art_style}。动态构图，高画质。
```

### 俯拍 (High Angle)

```
电影分镜参考图，高角度俯拍。{scene}。{character}，{shot_description}。从上方45度俯视。风格：{art_style}。空间纵深感，高画质。
```

### 仰拍 (Low Angle)

```
电影分镜参考图，低角度仰拍。{character}，{shot_description}。从下方30度仰视，威慑感。场景：{scene}。风格：{art_style}。英雄式构图，高画质。
```

## 风格修饰词库

### 色调
- 低调光 (Low-key lighting)
- 高调光 (High-key lighting)
- 暖色调 (Warm tones)
- 冷色调 (Cool tones)
- 去饱和 (Desaturated)

### 质感
- 胶片颗粒 (Film grain)
- 数码锐利 (Digital sharp)
- 柔焦 (Soft focus)
- 高对比 (High contrast)

### 电影风格
- 赛博朋克 (Cyberpunk)
- 新黑色电影 (Neo-noir)
- 写实主义 (Realism)
- 表现主义 (Expressionism)
- 浪漫主义 (Romanticism)

## 使用方式

```javascript
import { buildPrompt } from './lib/storyboarder.js';

const prompt = buildPrompt({
  shotDescription: "一个穿黑色风衣的男人推门而入",
  character: "30岁亚洲男性，短发，深色西装，眼神锐利",
  scene: "深夜的咖啡馆，暖黄色灯光，雨滴打在窗户上",
  cameraAngle: "中景",
  artStyle: "电影质感，低调光，去饱和，胶片颗粒",
  emotion: "紧张",
  timeOfDay: "深夜",
  weather: "雨天"
});
```
