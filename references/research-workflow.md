# 调研流程（Phase 1.5）

## 触发条件
品牌植入、真实人物/事件、特定行业/圈层时自动启用。纯虚构题材可跳过。

## Step 1-4 流程

### Step 1: 问题分解
将调研需求拆分为 6 个维度：
- 品牌深度 → `research/brand_profile.md`
- 人物背景 → `research/character_profile.md`
- 目标受众 → `research/audience_persona.md`
- 竞品案例 → `research/competitor_cases.md`
- 圈层文化 → `research/subculture_notes.md`
- 植入策略 → `research/placement_strategy.md`

### Step 2: 搜索
使用 `web_search` 对每个维度进行多轮搜索（至少 3 轮），收集一手信息。

### Step 3: 抓取
使用 `web_fetch` 对关键页面进行深度抓取，提取结构化信息。

### Step 4: 分析整合
将搜索结果整合为各维度的 Markdown 文档，写入 `research/` 目录。

## 何时跳过
- 纯虚构题材（无真实品牌/人物/事件）
- 用户明确表示不需要调研
- 题材为常见类型（爱情/搞笑/日常）且无特殊背景

## 调研结果 JSON 格式
```json
{
  "triggered": true,
  "dimensions": ["brand", "character", "audience", "competitor", "subculture", "placement"],
  "outputs": {
    "brand_profile": "research/brand_profile.md",
    "character_profile": "research/character_profile.md",
    "audience_persona": "research/audience_persona.md",
    "competitor_cases": "research/competitor_cases.md",
    "subculture_notes": "research/subculture_notes.md",
    "placement_strategy": "research/placement_strategy.md"
  },
  "summary": "调研摘要文本"
}
```
