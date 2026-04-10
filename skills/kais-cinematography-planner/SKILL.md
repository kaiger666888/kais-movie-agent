# kais-cinematography-planner — 场景类型→拍摄手法批量映射

## 触发词
`cinematography`, `拍摄手法`, `coverage map`, `镜头规划`, `手法映射`, `一致性协议`

## 定位
批量预处理器 — 一次性扫描整集剧本，为同类场景自动分配拍摄手法，生成 Coverage Map。插入在 kais-scenario-writer 之后、kais-storyboard-designer 之前。

## 核心思想
**不是"选择多次"，而是"批量映射"** — 同类场景自动应用相同拍摄手法，避免逐镜头重复决策。

## 数据流

```
kais-scenario-writer
  → 场景列表（含 scene_type 标签）
    ↓
kais-cinematography-planner  ← 本 skill
  → Coverage Map（每个场景的拍摄手法 + 一致性协议 + 成本）
  → 冲突检测报告
    ↓
kais-storyboard-designer
  → 继承拍摄手法生成具体镜头
    ↓
kais-camera
  → 执行拍摄
```

## 输入

| 字段 | 类型 | 来源 |
|------|------|------|
| scenes[] | 场景列表 | scenario-writer 产出 |
| scene_type | string | 场景类型标签（可由 writer 自动标注或手动指定） |
| art_direction | object | 美术方向（用于风格约束） |
| characters[] | 角色列表 | character-designer 产出 |

## 输出：Coverage Map

```json
{
  "type": "CoverageMap",
  "version": "1.0",
  "total_scenes": 8,
  "total_estimated_cost": "中高",
  "scenes": [
    {
      "scene_id": "SC01",
      "scene_type": "indoor_dialogue",
      "location": "客厅",
      "shooting_style": "shot_reverse_shot",
      "consistency_protocol": "high",
      "camera_positions": [
        { "angle": "过肩", "side": "left", "character": "角色A" },
        { "angle": "过肩", "side": "right", "character": "角色B" }
      ],
      "estimated_cost": "high",
      "duration_estimate": "长（多镜头覆盖）",
      "props_anchor": ["红色扶手椅", "茶几", "台灯"],
      "lighting_note": "室内暖光"
    }
  ],
  "conflicts": [
    {
      "type": "consistency_overload",
      "scenes": ["SC01", "SC03", "SC05"],
      "detail": "连续3个室内对话场景使用正反打",
      "suggestion": "建议SC03改为双人全景，降低40%算力消耗"
    }
  ]
}
```

## Coverage Library（手法库）

### 场景类型分类

| scene_type | 中文 | 默认手法 | 一致性协议 | 成本 |
|------------|------|---------|-----------|------|
| `indoor_dialogue` | 室内对话 | 正反打（shot_reverse_shot） | 高 | 高 |
| `outdoor_chase` | 室外追逐 | 手持晃动+快速剪辑（handheld_cut） | 低 | 低 |
| `emotional_monologue` | 情感独白 | 特写+浅景深（closeup_shallow） | 中 | 中 |
| `action_sequence` | 动作场面 | 全景→中景→特写序列（action_sequence） | 中 | 高 |
| `establishing` | 场景建立 | 全景横摇或航拍（establishing_pan） | 低 | 中 |
| `intimate_moment` | 亲密时刻 | 双人中景+缓慢推进（intimate_push） | 高 | 中 |
| `tension_build` | 紧张氛围 | 手持+特写交替（tension_crosscut） | 低 | 中 |
| `revelation` | 揭示/转折 | 拉远揭示（pull_back_reveal） | 中 | 中 |
| `transition` | 场景转换 | 匹配剪辑或相似体（match_cut） | 低 | 低 |
| `montage` | 蒙太奇 | 快速混剪（quick_montage） | 低 | 低 |

### 一致性协议

| 等级 | 含义 | 适用场景 |
|------|------|---------|
| **高** | 严格保持空间/角色一致性 | 室内对话、亲密时刻 |
| **中** | 保持角色一致，空间可微调 | 情感独白、动作场面 |
| **低** | 允许较大自由度 | 追逐、蒙太奇、过渡 |

## 冲突检测

### 1. 一致性过载
连续 N 个（默认 3）高一致性协议场景 → 建议降级

### 2. 180度线冲突
同空间场景的机位方向不一致 → 自动标注"越轴镜头"

### 3. 道具连续性缺口
同空间场景的道具标注不一致 → 批量提示补充

## 人工介入点

仅在以下情况需要人工确认：
1. **高成本手法审批**：环绕长镜头等高消耗手法
2. **特殊叙事需求**：剧本明确要求"一镜到底"等
3. **跨集一致性**：续集/系列剧中需匹配上集

## 工具函数

- `lib/planner.js` — `planCoverage(scenes, options)` 主函数
- `lib/planner.js` — `detectConflicts(coverageMap)` 冲突检测
- `lib/planner.js` — `estimateCost(coverageMap)` 成本估算
- `lib/planner.js` — `applyOverrides(coverageMap, overrides)` 人工修正

## 文件结构
```
kais-cinematography-planner/
├── SKILL.md
├── lib/
│   └── planner.js
└── prompts/
    └── coverage-library.md
```
