---
name: kais-storyboard-designer
description: "分镜设计系统，将剧本转化为完整分镜脚本。触发词：'分镜'、'storyboard'、'镜头设计'、'视觉预览'、'分镜脚本'、'镜头列表'、'镜头规划'、'画面分镜'、'shot design'、'shot list'、'storyboard design'、'镜头语言'、'分镜表'、'逐镜头设计'、'shot breakdown'、'分镜创作'、'镜头编排'、'画面拆解'、'visual planning'。当用户需要将剧本/故事转化为可视化镜头序列时激活。"
---

# kais-storyboard-designer — 分镜设计

## 触发词

**中文**：分镜、镜头设计、视觉预览、分镜脚本、镜头列表、镜头规划、画面分镜、镜头语言、分镜表、逐镜头设计、分镜创作、镜头编排、画面拆解
**英文**：storyboard、shot design、shot list、storyboard design、shot breakdown、visual planning、shot planning、storyboard creation

## 触发场景

1. 用户已有剧本/场景设计，需要规划具体镜头和画面
2. 用户说"帮我画分镜"、"做个分镜脚本"
3. 用户在视频/短片项目中进入"分镜"阶段
4. 用户需要将文字剧本拆解为逐镜头的视觉描述
5. 用户讨论镜头语言、景别、运镜等分镜层面的问题
6. 用户需要为每个镜头定义角色动作、机位、时长等参数

## 定位

将场景设计、角色设定、美术方向和剧本转化为完整的分镜脚本（Storyboard），每个镜头包含参考图、描述和镜头参数。

## 数据契约

输出符合 `/tmp/crew-v3-build/movie-schema.json` 中的 `Storyboard` schema：

```json
{
  "type": "Storyboard",
  "version": "1.0",
  "shots": [
    {
      "shot_id": "shot_xxx",
      "scene_ref": "scene_xxx",
      "character_refs": ["char_xxx"],
      "camera": {
        "angle": "中景",
        "movement": "缓慢推进",
        "lens": "50mm"
      },
      "action": "角色走进房间，环顾四周",
      "duration": 4.5,
      "reference_image": "https://..."
    }
  ]
}
```

## 输入

| 输入 | 类型 | 来源 |
|------|------|------|
| SceneDesign[] | 场景设计 | 场景设计 skill 产出（含 sketch_image + render_image） |
| CharacterBible[] | 角色设定 | 角色设计 skill 产出 |
| ArtDirection | 美术方向 | 美术设计 skill 产出 |
| ScenarioScript | 剧本 | 编剧 skill 产出 |

## 输出

- **Storyboard** — shots 数组，每个 shot 包含：
  - `shot_id` — 镜头唯一标识
  - `scene_ref` — 关联场景
  - `character_refs` — 出场角色
  - `camera` — 镜头参数（angle/movement/lens）
  - `action` — 动作描述
  - `duration` — 时长（秒）
  - `reference_image` — 线稿构图蓝本（来自 SceneDesign 的 sketch_image）
  - `render_image` — 渲染后的最终参考图（来自 SceneDesign 的 render_image）
  - `anchoring` — **四维锚定参数**（Render Layer 控制参数，详见下文）

## 二级工作流：结构层 + 渲染层

```
Structure Layer (S.P.A.C.E 约束)
  └── 线稿生成 → 锁定构图+空间关系
        ↓ 结构锁定
Render Layer (四维锚定注入)
  ├── 深度锚定 (Depth)    → ControlNet Depth / 空间层次
  ├── 身份锚定 (Identity)  → IP-Adapter / 角色一致性
  ├── 光影锚定 (Lighting)  → IC-Light / 氛围统一
  └── 时序锚定 (Temporal)  → AnimateDiff / 运动控制
        ↓ 分层渲染→合成输出
```

> 完整设计文档：`docs/4d-anchoring-design.md`

## 四维锚定参数（Render Layer）

每个 shot 的 `anchoring` 字段控制渲染层的四维注入：

```jsonc
{
  "anchoring": {
    "depth": {
      "enabled": true,
      "strength": 0.7,
      "foreground": "角色坐姿",
      "midground": "桌面、碗筷",
      "background": "窗外城市"
    },
    "identity": {
      "enabled": true,
      "characters": [
        { "ref": "char_wuji", "weight": 0.75 }
      ]
    },
    "lighting": {
      "enabled": true,
      "direction": "upper-left",
      "intensity": 0.7,
      "color_temp": "4500K",
      "mood": "dramatic, rim-light"
    },
    "temporal": {
      "enabled": true,
      "motion_type": "slow-push-in",
      "motion_speed": 0.3,
      "motion_strength": 0.6,
      "fps": 24
    }
  }
}
```

### 锚定维度说明

| 维度 | 技术 | 作用 | 即梦 API 适配 |
|------|------|------|-------------|
| **深度** (Depth) | ControlNet Depth | 锁定前后景空间层次 | 深度图作为参考图传入 |
| **身份** (Identity) | IP-Adapter / images | 角色跨镜头一致性 | `images` + `sample_strength`（已支持）|
| **光影** (Lighting) | IC-Light | 统一光照方向/色温/氛围 | style prompt + 光照参考图 |
| **时序** (Temporal) | AnimateDiff / WAN | 控制运动风格和帧间一致性 | Seedance motion 参数 |

### 渐进式降级策略

| 级别 | 启用锚定 | 适用场景 | 成本 |
|------|---------|---------|------|
| **Draft** | 无 | 快速原型 | 最低 |
| **Standard** | 身份 | 角色一致短片 | 中 |
| **Cinematic** | 深度+身份+光影 | 正式制作 | 高 |
| **Premium** | 全部四维 | 电影级成片 | 最高 |

## 核心流程

### 1. 剧本解析 → 镜头列表

调用 `lib/storyboarder.js` 的 `parseScriptToShots(script)` 将剧本拆解为镜头。

解析规则：
- 每个场景切换 = 新镜头组
- 对话场景 = 正反打或过肩镜头
- 动作场景 = 全景→中景→特写序列
- 情绪高潮 = 特写 + 缓慢推进

### 2. 使用线稿作为构图蓝本

**线稿管线集成**：SceneDesign 现在包含两阶段输出（线稿 + 渲染图），分镜板使用线稿作为构图蓝本：

- **`reference_image`**：指向 SceneDesign 中的 `sketch_image`（线稿），作为分镜的构图参考
- **`render_image`**：指向 SceneDesign 中的 `render_image`（渲染图），作为最终画面参考
- 线稿的优势：清晰展示构图、空间关系、角色位置，不受色彩/光影干扰
- 分镜评审时优先看线稿确认构图，再看渲染图确认最终效果

### 3. 补充分镜参考图（可选）

对于线稿管线未覆盖的额外镜头，可单独生成参考图：

**关键约束**：
- **角色一致性**：同一角色在所有镜头中使用相同 seed 和角色描述
- **场景一致性**：同一场景使用相同的环境描述和色调
- **风格一致性**：所有镜头遵循 ArtDirection 定义的统一风格

```bash
# 参考图生成示例
curl -s http://localhost:8000/v1/images/generations \
  -H "Authorization: Bearer $SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "jimeng-5.0",
    "prompt": "<从 prompts/storyboard.md 构建的提示词>",
    "ratio": "16:9"
  }'
```

提示词模板见 `prompts/storyboard.md`。

### 3. 验证 & 成本估算

- `validateStoryboard(storyboard)` — 检查数据完整性和一致性
- `estimateProductionCost(storyboard)` — 估算实际制作成本

## 镜头类型参考

| 镜头 | 英文 | 用途 | 情绪 |
|------|------|------|------|
| 全景 | Wide Shot | 建立环境、展示关系 | 宏大、孤寂 |
| 中景 | Medium Shot | 对话、日常动作 | 中性、自然 |
| 特写 | Close-up | 情感、细节 | 紧张、亲密 |
| 过肩 | Over-the-shoulder | 对话场景 | 互动、代入 |
| 跟拍 | Tracking Shot | 运动、追逐 | 动感、紧迫 |
| 俯拍 | High Angle | 展示全局、弱化角色 | 压抑、渺小 |
| 仰拍 | Low Angle | 强化角色、威慑感 | 力量、威胁 |
| 荷兰角 | Dutch Angle | 不安、失衡 | 焦虑、混乱 |
| 鸟瞰 | Bird's Eye | 上帝视角、地图 | 超然、全知 |

## 镜头运动参考

| 运动 | 效果 |
|------|------|
| 推进 (Push-in) | 引导注意力，增加紧张感 |
| 拉远 (Pull-out) | 揭示全貌，释放情绪 |
| 横摇 (Pan) | 展示环境，跟随运动 |
| 俯仰 (Tilt) | 展示高度，揭示信息 |
| 跟拍 (Tracking) | 沉浸式，与角色同行 |
| 手持 (Handheld) | 纪实感，紧张不安 |
| 固定 (Static) | 观察，稳定，仪式感 |

## 质量标准

1. 每个镜头必须有完整的 camera + action + duration
2. 角色在连续镜头中外观一致
3. 场景在连续镜头中环境一致
4. 镜头衔接符合电影语法（180度法则、动势匹配）
5. 时长分布合理（全景稍长、特写稍短）
6. 情绪节奏有起伏（紧张→释放→再紧张）

## 文件结构

```
kais-storyboard-designer/
├── SKILL.md              # 本文件
├── prompts/
│   └── storyboard.md     # 提示词模板
└── lib/
    └── storyboarder.js   # 工具函数
```
