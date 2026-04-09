# 输入输出 Schema

## 输入 — StoryDNA

```json
{
  "type": "StoryDNA",
  "version": "1.0.0",
  "logline": "一句话故事",
  "synopsis": "完整梗概",
  "beats": [
    { "beat_id": "b1", "name": "开场", "description": "...", "sequence": 0, "emotional_arc": "好奇" }
  ],
  "characters": ["char_protagonist", "char_antagonist"],
  "theme": "主题",
  "tone": "整体基调"
}
```

## 输出 — ScenarioScript

```json
{
  "type": "ScenarioScript",
  "version": "1.0.0",
  "variant": "A_comedic | B_dramatic",
  "source_dna": "StoryDNA hash/id",
  "scenes": [
    {
      "scene_id": "scene_001",
      "location": "场景地点",
      "time": "日/夜/黄昏",
      "atmosphere": "氛围描述",
      "beats_ref": ["b1"],
      "actions": [
        {
          "character": "char_protagonist",
          "action": "动作描述",
          "dialogue": "对白内容",
          "parenthetical": "(情感提示)",
          "camera_hint": "特写/全景/中景"
        }
      ]
    }
  ],
  "total_duration_sec": 180,
  "evaluation": {
    "rhythm": 8.5,
    "character_consistency": 9.0,
    "emotional_tension": 7.5,
    "dialogue_naturalness": 8.0,
    "overall": 8.25
  }
}
```
