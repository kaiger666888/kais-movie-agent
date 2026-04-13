# Phase 2 产出 JSON Schema（scenario.json）

```json
{
  "title": "短片标题",
  "genre": "类型（剧情/喜剧/科幻等）",
  "duration_seconds": 120,
  "logline": "一句话概述",
  "visual_intent": "整体视觉意图描述",
  "style_hints": ["风格提示1", "风格提示2"],
  "character_hints": ["角色提示1"],
  "acts": [
    {
      "act_id": 1,
      "name": "第一幕",
      "purpose": "幕的目的",
      "emotional_arc": "情感走向",
      "scenes": [
        {
          "scene_id": "s1",
          "location": "场景地点",
          "time": "时间",
          "characters": ["角色A"],
          "visual_intent": "场景视觉意图",
          "action": "动作描写",
          "dialogue": [
            { "character": "角色A", "line": "台词", "emotion": "情感" }
          ]
        }
      ]
    }
  ],
  "story_bible": {
    "core_conflict": "核心冲突",
    "character_arcs": "角色弧光",
    "thematic_elements": "主题元素"
  }
}
```

### 关键字段说明
- `visual_intent` — 视觉意图，给下游 Phase 3/4 的约束信号
- `style_hints` — 风格提示，指导美术方向选择
- `character_hints` — 角色提示，指导角色设计
- `action` — 动作描写，指导分镜设计
- `emotion` — 情感标注，指导配音和BGM选择
