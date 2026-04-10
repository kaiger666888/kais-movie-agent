# Coverage Library — 场景类型→拍摄手法映射规则

## 使用方式

在 kais-scenario-writer 阶段为每个场景打上 `scene_type` 标签，后续自动继承拍摄手法。

## 场景类型映射表

| scene_type | 中文 | 默认手法 | 一致性协议 | 成本 | 默认机位 |
|------------|------|---------|-----------|------|---------|
| `indoor_dialogue` | 室内对话 | 正反打 | 高 | 高 | 过肩左/过肩右/双人全景 |
| `outdoor_chase` | 室外追逐 | 手持晃动+快速剪辑 | 低 | 低 | 跟拍/脚步特写 |
| `emotional_monologue` | 情感独白 | 特写+浅景深 | 中 | 中 | 面部特写/环境衬托 |
| `action_sequence` | 动作场面 | 全景→中景→特写序列 | 中 | 高 | 空间建立/动作主体/关键瞬间 |
| `establishing` | 场景建立 | 全景横摇或航拍 | 低 | 中 | 横摇建立环境 |
| `intimate_moment` | 亲密时刻 | 双人中景+缓慢推进 | 高 | 中 | 双人画面/表情交替 |
| `tension_build` | 紧张氛围 | 手持特写交替 | 低 | 中 | 交叉剪辑 |
| `revelation` | 揭示/转折 | 拉远揭示 | 中 | 中 | 聚焦细节→揭示全貌 |
| `transition` | 场景转换 | 匹配剪辑 | 低 | 低 | 匹配剪辑 |
| `montage` | 蒙太奇 | 快速混剪 | 低 | 低 | 快速混剪 |

## 自动推断规则

当场景未标注 `scene_type` 时，planner 会根据描述关键词自动推断：

- 包含"追逐/跑/追" → `outdoor_chase`
- 包含"打/战斗/爆炸" → `action_sequence`
- 包含"独白/回忆" → `emotional_monologue`
- 包含"拥抱/亲吻" → `intimate_moment`
- 包含"紧张/恐惧" → `tension_build`
- 包含"揭示/真相" → `revelation`
- 包含"蒙太奇/时间流逝" → `montage`
- 位置含"室内/客厅/办公室" → `indoor_dialogue`
- 位置含"室外/街道/公园" → `establishing`
- 默认 → `establishing`

## 冲突检测规则

### 一致性过载
连续 3+ 个高一致性协议场景 → 建议将中间场景降级为双人全景

### 180度线冲突
同空间场景机位方向（left/right）不一致 → 自动标注越轴镜头

### 道具连续性缺口
同空间中某道具在某些场景标注但其他场景遗漏 → 批量提示补充
