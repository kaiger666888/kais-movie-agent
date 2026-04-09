---
name: kais-storyboard-designer
description: "激活条件：用户提到 分镜、storyboard、镜头设计、视觉预览、分镜脚本、镜头列表 等关键词时激活。"
---

# kais-storyboard-designer — 分镜设计

激活条件：用户提到 分镜、storyboard、镜头设计、视觉预览、分镜脚本、镜头列表 等关键词时激活。

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
| SceneDesign[] | 场景设计 | 场景设计 skill 产出 |
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
  - `reference_image` — AI 生成的参考图 URL

## 核心流程

### 1. 剧本解析 → 镜头列表

调用 `lib/storyboarder.js` 的 `parseScriptToShots(script)` 将剧本拆解为镜头。

解析规则：
- 每个场景切换 = 新镜头组
- 对话场景 = 正反打或过肩镜头
- 动作场景 = 全景→中景→特写序列
- 情绪高潮 = 特写 + 缓慢推进

### 2. 参考图生成

为每个镜头调用即梦 API 生成参考图。

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
