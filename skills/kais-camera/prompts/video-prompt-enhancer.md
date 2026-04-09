# 视频 Prompt 增强模板

用于将基础描述增强为高质量的视频生成 prompt。

## 变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `{subject}` | 主体描述 | "a young woman with long black hair" |
| `{action}` | 动作 | "slowly turns her head toward the camera" |
| `{scene}` | 场景环境 | "in a dimly lit coffee shop, rain on the window" |
| `{camera}` | 镜头描述 | "medium shot, slow dolly in" |
| `{style}` | 视觉风格 | "cinematic, film grain, anamorphic" |
| `{lighting}` | 光影 | "golden hour backlight, soft shadows" |
| `{motion}` | 运动描述 | "gentle hair movement, subtle breathing" |

## 通用模板

```
{style}. {subject}, {action}. {scene}. {camera}. {lighting}. {motion}. High quality, 4K.
```

## 按镜头类型推荐

### 特写（Close-up）
```
Extreme close-up of {subject}'s face. {action}. Shallow depth of field, eyes in focus. {lighting}. {motion}. Cinematic portrait style.
```

### 中景（Medium Shot）
```
{style}. Medium shot of {subject}. {action}. {scene}. {camera}. {lighting}. {motion}.
```

### 全景（Wide Shot）
```
{style}. Wide establishing shot. {scene}. {subject} {action} in the distance. {camera}. {lighting}. Epic scale, atmospheric haze.
```

### 运动镜头（Action）
```
{style}. {subject} {action}. Dynamic camera following. {scene}. {lighting}. Fast motion blur, energy. {motion}.
```

### 对话（Dialogue）
```
{style}. Over-the-shoulder shot. {subject} speaking. {scene}. {camera}. {lighting}. Subtle facial micro-expressions.
```

### 空镜头（B-roll）
```
{style}. {scene}. Atmospheric establishing shot. {camera}. {lighting}. Time-lapse quality. {motion}.
```

## Seedance 专用

Seedance 模型要求 prompt 中用 `@1` `@2` 引用素材文件：

```
@1 {subject} {action}. {scene}. {camera}. {style}. {lighting}. {motion}.
```

- `@1` 引用 `file_paths[0]`（第一张素材图）
- `@2` 引用 `file_paths[1]`（第二张素材图）
- 素材图片由 kais-camera 自动生成（文生图）或从拍摄脚本的 `reference_image` 获取

### Seedance Prompt 技巧

1. **@1 放在最前面**，让模型优先参考素材
2. **描述与素材一致**，不要让 prompt 和素材矛盾
3. **运动描述具体化**：`slowly walking left` > `moving`
4. **避免否定词**：`clear sky` > `not cloudy`
5. **保持简洁**：Seedance 对冗长 prompt 效果下降

## 降级 Prompt 简化规则

| 级别 | 简化方式 | 示例 |
|------|---------|------|
| L1 | 完整 prompt | 完整模板 |
| L2 | 去除 style + lighting | `{subject}, {action}. {scene}. {camera}.` |
| L3 | 仅核心 | `{subject} {action}.` |
| L4 | 静态图 | `{subject}. {scene}. {style}.` |
