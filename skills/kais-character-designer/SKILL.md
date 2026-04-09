---
name: kais-character-designer
description: "激活条件：用户提到"设计角色"、"character"、"角色设计"、"人物设定"、"角色设定"、"角色卡"时激活。"
---

# kais-character-designer — AI 角色设计

激活条件：用户提到"设计角色"、"character"、"角色设计"、"人物设定"、"角色设定"、"角色卡"时激活。

## 概述

基于**锦标赛进化**模式的角色设计 Skill。为电影/动画项目生成一致性角色视觉设定，核心机制是 **seed_lock + reference_images** 确保跨场景角色一致。

```yaml
type: tournament_evolution
population_size: 3
output: CharacterBible
consistency_mechanism: seed_lock + reference_images
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
  "version": "1.0.0",
  "character_id": "char_<name>",
  "name": "角色名",
  "appearance": "详细外貌描述",
  "personality": "性格特征描述",
  "reference_images": ["url1", "url2", "url3"],
  "seed": 123456,
  "consistency_lock": {
    "locked": true,
    "lock_version": 1,
    "frozen_fields": ["appearance", "seed"]
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

### Phase 2: 锦标赛生成（population_size=3）

对每个角色生成 **3 个视觉变体**：

1. 读取 `prompts/character-design.md` 模板
2. 替换变量生成 3 个不同角度的 prompt：
   - 变体 A：正面肖像（character portrait, front view）
   - 变体 B：全身侧面（full body, side view）
   - 变体 C：表情特写（expression close-up, 3/4 view）
3. 通过即梦 API（`/v1/images/generations`）生成图片
4. 收集所有变体的 URL + seed

### Phase 3: 导演选择

将 3 个变体展示给导演（用户）：

1. 用 `message` 工具发送 3 张变体图
2. 提供选择按钮或让用户指定编号
3. 等待用户选择

### Phase 4: 锁定一致性

用户选择后：

1. **记录选定变体的 seed** — 这是 seed_lock 核心
2. 将 seed + 参考图写入 CharacterBible
3. 设置 `consistency_lock.locked = true`
4. 冻结 `frozen_fields`：`["appearance", "seed"]`

### Phase 5: 风格变更重生成

当 ArtDirection 变更时：

1. 检查 `consistency_lock.locked` 状态
2. 如果已锁定，使用原 seed + 新风格 prompt 重新生成
3. 保留 `lock_version` 递增，记录变更历史
4. 新参考图替换旧参考图，seed 保持不变

## 即梦 API 调用

```bash
# 文生图 — 角色变体生成
curl -s --max-time 120 http://localhost:8000/v1/images/generations \
  -H "Authorization: Bearer $SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "jimeng-5.0",
    "prompt": "<角色设计prompt>",
    "ratio": "3:4",
    "resolution": "2k"
  }'

# 返回格式
# { "data": [{ "url": "https://...", "seed": 123456 }], ... }
```

**关键**：从返回结果中提取 `seed` 值，用于后续一致性锁定。

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

- **seed_lock 是核心**：一旦锁定，后续所有该角色的图片生成必须复用相同 seed
- **reference_images 至少 3 张**：正面、侧面、表情，确保后续图生图有足够参考
- **风格变更不换 seed**：只更新 prompt，seed 保持锁定
- **population_size 可调**：默认 3，复杂角色可增加到 5
