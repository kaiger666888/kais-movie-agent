---
name: kais-character-designer
description: "激活条件：用户提到'设计角色'、'character'、'角色设计'、'人物设定'、'角色设定'、'角色卡'、'人物形象'、'角色建模参考'、'角色外观'、'角色造型'、'OC设定'、'虚拟人设'时激活。适用场景：短视频角色设定、AI漫剧人物设计、游戏角色概念、小说人物形象描述、品牌IP角色创建、角色参考图生成提示词编写。"
---

# kais-character-designer — AI 角色设计

激活条件：用户提到"设计角色"、"character"、"角色设计"、"人物设定"、"角色设定"、"角色卡"时激活。

## 概述

基于**转面图 + 参考图库**模式的角色设计 Skill。为电影/动画项目生成一致性角色视觉设定，核心机制是 **turnaround_image + reference_images + style_prefix + sample_strength** 确保跨场景角色一致。

```yaml
type: turnaround_sheet
turnaround_angles: [front, 3/4, side, back]
reference_library_size: 6-8
output: CharacterBible
consistency_mechanism: turnaround_image + reference_images + style_prefix + sample_strength
```

## 输入

| 字段 | 类型 | 来源 | 说明 |
|------|------|------|------|
| StoryDNA | StoryDNA | 剧本 skill | 故事 DNA，包含角色列表 |
| ArtDirection | object | 导演/用户 | 美术风格指令 |

### ArtDirection 结构
```json
{
  "style": "anime|realistic|watercolor|3d_render|ink_wash|...>",
  "color_palette": ["#hex", "..."],
  "era": "contemporary|medieval|cyberpunk|...",
  "mood": "dark|bright|melancholic|...",
  "reference_notes": "free-form style guidance"
}
```

## 输出

**CharacterBible** — 符合 `/tmp/crew-v3-build/movie-schema.json` 中 `CharacterBible` schema：

```json
{
  "type": "CharacterBible",
  "version": "2.0.0",
  "character_id": "char_wuji",
  "name": "无极",
  "appearance": "详细外貌描述",
  "personality": "性格特征描述",
  "turnaround_image": "assets/characters/char_wuji/turnaround.png",
  "reference_images": [
    "assets/characters/char_wuji/front-portrait.png",
    "assets/characters/char_wuji/3quarter-body.png",
    "assets/characters/char_wuji/side-profile.png",
    "assets/characters/char_wuji/back-view.png",
    "assets/characters/char_wuji/expression-shock.png",
    "assets/characters/char_wuji/expression-shy.png",
    "assets/characters/char_wuji/expression-calm.png",
    "assets/characters/char_wuji/action-typing.png"
  ],
  "style_prefix": "Arcane Fortiche animation style, 2D anime, oil painting on canvas texture, ...完整风格描述...",
  "sample_strength": 0.35,
  "consistency_lock": {
    "locked": true,
    "lock_version": 1,
    "frozen_fields": ["appearance", "style_prefix", "sample_strength"]
  }
}
```

## 流程

### Phase 1: 角色分析

从 StoryDNA 提取角色信息，结合 ArtDirection 构建角色 prompt：

1. 读取 StoryDNA 中的角色引用列表
2. 分析每个角色的故事定位（主角/反派/配角）
3. 根据 ArtDirection 确定视觉风格
4. 为每个角色生成结构化描述（外貌 + 性格 + 氛围）
5. 构建 **STYLE_PREFIX** — 完整的风格描述前缀，后续所有生成必须使用

### Phase 2: 转面图生成

对每个角色生成 **1 张角色转面图**（character turnaround sheet）+ **3 张独立角度图**：

1. 读取 `prompts/character-design.md` 模板
2. 构建 STYLE_PREFIX（基于 ArtDirection，固定不变）
3. 生成转面图 prompt：
   - `"$STYLE_PREFIX, character turnaround sheet, front view, 3/4 view, side view, back view, consistent character design, multiple angles, single character"`
4. 生成 3 张独立角度图：
   - 正面肖像（`front-portrait`）：`"$STYLE_PREFIX, character portrait, front view, upper body, detailed face"`
   - 3/4 全身（`3quarter-body`）：`"$STYLE_PREFIX, full body, 3/4 view, standing pose"`
   - 表情特写（`expression-calm`）：`"$STYLE_PREFIX, close-up face, calm expression, 3/4 angle"`
5. 通过即梦 API（`/v1/images/generations`）生成图片
6. 所有图保存到 `assets/characters/{character_id}/` 目录

### Phase 2.5: 多角度参考图库

基于转面图作为参考图，批量生成 6-8 张不同角度/表情的角色图：

| 文件名 | 角度/表情 | Prompt 后缀 |
|--------|-----------|-------------|
| `front-portrait.png` | 正面肖像 | `character portrait, front view, upper body, detailed face` |
| `3quarter-body.png` | 3/4 全身 | `full body, 3/4 view, standing pose` |
| `side-profile.png` | 侧面轮廓 | `side profile, head and shoulders, clean outline` |
| `back-view.png` | 背面 | `full body, back view, standing pose` |
| `expression-shock.png` | 震惊表情 | `close-up face, shocked expression, wide eyes, open mouth` |
| `expression-shy.png` | 社恐表情 | `close-up face, shy expression, averted gaze, slight blush` |
| `expression-calm.png` | 平静表情 | `close-up face, calm expression, gentle smile, 3/4 angle` |
| `action-typing.png` | 打字动作 | `upper body, typing on laptop, focused expression` |

生成方式：
- 全部使用转面图作为参考图（`images=@turnaround.png`）
- 统一使用 STYLE_PREFIX + 角度特定 prompt
- 统一 `sample_strength=0.35`
- 存入 `assets/characters/{character_id}/` 目录

### Phase 3: 导演确认转面图

将转面图 + 3 张独立角度图展示给导演（用户）：

1. 用 `message` 工具发送转面图（主图）
2. 发送 3 张独立角度图作为补充
3. 提供确认按钮或让用户反馈修改意见
4. 等待用户确认

### Phase 4: 锁定一致性

用户确认后：

1. **锁定 STYLE_PREFIX** — 后续所有该角色的图片生成必须使用此前缀
2. **记录转面图路径** — `turnaround_image_path`
3. **收集所有参考图路径** — `reference_images` 列表
4. **固定 sample_strength** — 默认 0.35
5. 将所有锁定信息写入 CharacterBible
6. 设置 `consistency_lock.locked = true`
7. 冻结 `frozen_fields`：`["appearance", "style_prefix", "sample_strength"]`

### Phase 5: 风格变更重生成

当 ArtDirection 变更时：

1. 检查 `consistency_lock.locked` 状态
2. 如果已锁定，使用新 STYLE_PREFIX + 原转面图作为参考重新生成
3. 保留 `lock_version` 递增，记录变更历史
4. 新参考图替换旧参考图，转面图重新生成

## 即梦 API 调用

### 文生图 — 转面图生成

```bash
# 转面图（纯文生图）
curl -s --max-time 120 http://localhost:8000/v1/images/generations \
  -H "Authorization: Bearer $SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "jimeng-5.0",
    "prompt": "$STYLE_PREFIX, character turnaround sheet, front view, 3/4 view, side view, back view, consistent character design, multiple angles, single character",
    "ratio": "3:4",
    "resolution": "2k"
  }'
```

### 图生图 — 参考图库生成（multipart 上传参考图）

```bash
# 用转面图作为参考，生成一致的多角度角色图
curl -s --max-time 120 http://localhost:8000/v1/images/generations \
  -H "Authorization: Bearer $SESSION_ID" \
  -F "prompt=$STYLE_PREFIX $ANGLE_SPECIFIC_PROMPT" \
  -F "model=jimeng-5.0" \
  -F "ratio=9:16" \
  -F "sample_strength=0.35" \
  -F "images=@$REFERENCE_IMAGE_PATH"
```

**关键参数说明**：
- `STYLE_PREFIX`：固定风格前缀，所有生成必须使用，确保风格一致
- `sample_strength`：参考图影响强度，默认 0.35（值越高越接近参考图，越低越自由）
- `images`：参考图路径，使用转面图确保多角度一致性
- `ANGLE_SPECIFIC_PROMPT`：当前角度/表情的特定描述（见 Phase 2.5 表格）

**返回格式**：
```json
{ "data": [{ "url": "https://...", "seed": 123456 }], ... }
```

## 文件结构

```
kais-character-designer/
├── SKILL.md              # 本文件
├── prompts/
│   └── character-design.md  # 角色设计 prompt 模板
└── lib/
    └── designer.js       # 核心逻辑 ES Module
```

## 注意事项

- **转面图是核心**：一旦生成并确认，所有后续该角色的图片都以转面图为参考
- **STYLE_PREFIX 不可变**：锁定后，所有生成必须使用相同的风格前缀
- **sample_strength 控制一致性**：默认 0.35，可在 0.2-0.5 之间微调
- **reference_images 至少 6 张**：覆盖主要角度和表情，确保后续图生图有足够参考
- **风格变更需重生成转面图**：STYLE_PREFIX 变更时，转面图和参考图库都需要重新生成
- **所有图片存入统一目录**：`assets/characters/{character_id}/`，便于管理
