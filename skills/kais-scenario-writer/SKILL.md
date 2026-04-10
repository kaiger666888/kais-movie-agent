---
name: kais-scenario-writer
description: "A/B双版本剧本生成 × 专业格式 × 场景对白动作三位一体。Use when user mentions '写剧本'、'剧本写作'、'剧本创作'、'对白'、'台词'、'场景对话'、'场景描写'、'动作描写'、'剧本格式'、'脚本'、'编剧'、'scenario'、'script'、'screenplay'、'dialogue'、'writer'、'script writing'。"
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
- "写剧本"、"scenario"、"剧本"、"对白"、"台词"、"场景对话"
- "场景描写"、"动作描写"、"剧本格式"、"剧本创作"、"剧本写作"
- "编剧"、"脚本"、"写对白"、"写场景"
- "scenario writer"、"script writing"、"screenplay"、"dialogue"

## 输入与输出

接收上游 **StoryDNA** artifact，产出 **ScenarioScript** 完整剧本。
详细 Schema 见 → [references/input-output-schema.md](references/input-output-schema.md)

核心字段概要：
- **输入**: logline, beats, characters, tone, theme
- **输出**: scenes（含 actions/dialogue/camera_hint）, evaluation（5维评分）

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

### Variant B — 戏剧风格 (Dramatic)
- 对白：克制、潜台词丰富、留白
- 动作：细腻、象征性、服务于主题
- 节奏：张弛有度，蓄力-爆发循环
- 场景：氛围感强，光影对比

## Step 3: 自评估

每版生成后立即执行 5 维度打分（0-10）：

| 维度 | 权重 | 评估要点 |
|------|------|---------|
| 节奏感 | 25% | 场景时长分配、情绪起伏曲线 |
| 角色一致性 | 25% | 对白是否符合角色设定、行为连贯 |
| 情感张力 | 20% | 高潮爆发力、情感递进自然度 |
| 对白自然度 | 15% | 口语化程度、潜台词层次、**去AI味** |
| 主题契合度 | 15% | 整体是否服务于主题 |

### 对白情感注入（kais-emotion 集成）

对白生成后，按以下规则注入情感温度：

1. **去 AI 味**：禁用"总而言之/综上所述/值得注意的是/毫无疑问/客观来说"
2. **口语化**：用"这个实至名归"替代"这具有重大意义"，用"说实话"替代"不可否认"
3. **情感真实**：角色说话要有破绽、有犹豫、有不完整句
4. **场景适配**：安慰场景先共情再陪伴，批评场景敢说不行给理由，日常场景随意可吐槽
5. **验证**：可用 `python3 kais-emotion/scripts/ai_pattern_checker.py script.md --scene <场景类型>` 检测评分

详见 `kais-emotion/SKILL.md` 中的 12 种场景映射和注入规则。

综合分 = 各维度加权平均。低于 7.0 分则重写该版。

## Step 4: 输出与选择

- 两版均输出完整 ScenarioScript JSON
- 附带评估对比表
- 选择策略：导演手动选择 > 自动取高分版 > 两版融合

## 依赖

- 上游：`kais-story-outline`（产出 StoryDNA）
- 下游：`kais-storyboard` / `kais-shooting-script`（消费 ScenarioScript）
