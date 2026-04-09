---
name: kais-scenario-writer
description: "A/B双版本剧本生成 × 专业格式 × 场景对白动作三位一体"
---

# kais-scenario-writer - 剧本写作技能

> A/B双版本剧本生成 × 专业格式 × 场景对白动作三位一体

```yaml
type: ab_test
population_size: 2
variants:
  A_comedic: "喜剧风格，轻松幽默"
  B_dramatic: "戏剧风格，紧张悬疑"
selection: "导演选择或自动对比评估"
output: ScenarioScript
convergence_threshold: 1
```

## 激活条件

当用户提到以下关键词时激活：
- "写剧本"、"scenario"、"剧本"、"对白"
- "场景描写"、"动作描写"、"剧本格式"
- "scenario writer"、"script writing"
- "写对白"、"写场景"、"剧本创作"

## 输入

接收上游 **StoryDNA** artifact：

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

## 输出

**ScenarioScript**（完整剧本），格式：

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

## 核心流程

```
解析 StoryDNA → 并行生成 A/B 两版 → 各版自评估 → 输出对比报告 → 导演选择/自动择优
```

---

## Step 1: 解析 StoryDNA

从 StoryDNA 中提取：
- **logline** → 剧本核心冲突锚点
- **beats** → 场景划分依据（每个 beat 对应 1-2 个场景）
- **characters** → 对白分配表
- **tone/theme** → 风格基调约束

## Step 2: 并行生成 A/B 两版

### Variant A — 喜剧风格 (Comedic)
- 对白：机智、双关、反转笑点
- 动作：夸张但合理，肢体喜剧元素
- 节奏：快节奏，密集包袱，每 30 秒一个笑点
- 场景：明亮色调优先，日常场景陌生化
- 提示词模板：见 `prompts/scenario-writer.md` A版

### Variant B — 戏剧风格 (Dramatic)
- 对白：克制、潜台词丰富、留白
- 动作：细腻、象征性、服务于主题
- 节奏：张弛有度，蓄力-爆发循环
- 场景：氛围感强，光影对比
- 提示词模板：见 `prompts/scenario-writer.md` B版

## Step 3: 自评估

每版生成后立即执行 `evaluate()`，5 维度打分（0-10）：

| 维度 | 权重 | 评估要点 |
|------|------|---------|
| 节奏感 (rhythm) | 25% | 场景时长分配、情绪起伏曲线、是否有拖沓或过快 |
| 角色一致性 (character_consistency) | 25% | 对白是否符合角色设定、行为是否连贯 |
| 情感张力 (emotional_tension) | 20% | 高潮点是否有爆发力、情感递进是否自然 |
| 对白自然度 (dialogue_naturalness) | 15% | 口语化程度、信息密度、潜台词层次 |
| 主题契合度 (theme_alignment) | 15% | 整体是否服务于主题、有无跑偏 |

综合分 = 各维度加权平均。低于 7.0 分则重写该版。

## Step 4: 输出与选择

- 两版均输出完整 ScenarioScript JSON
- 附带评估对比表
- 选择策略：导演手动选择 > 自动取高分版 > 两版融合

## 使用方式

```
# 从 StoryDNA 生成剧本
给定 StoryDNA，调用 lib/writer.js 的 generateVariantA/B

# 自评估
evaluate(script) 返回评分对象
```

## 依赖

- 上游：`kais-story-outline`（产出 StoryDNA）
- 下游：`kais-storyboard` / `kais-shooting-script`（消费 ScenarioScript）
- 提示词模板：`prompts/scenario-writer.md`
- 评估逻辑：`lib/writer.js`
