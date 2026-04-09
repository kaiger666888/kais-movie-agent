---
name: kais-shooting-script
description: "将分镜脚本转换为视频生成参数，对接即梦API。触发词：拍摄脚本/shooting script/生成参数/视频参数/视频prompt/prompt工程/prompt生成/镜头参数/video prompt/生成配置/即梦参数/API参数/prompt拼接/画面生成参数/shot parameter/prompt engineering for video。"
---

# kais-shooting-script — 拍摄脚本生成器

将分镜脚本转换为完整的视频生成参数，对接即梦 API。

## 触发词

**中文**：拍摄脚本、生成参数、视频参数、视频prompt、prompt工程、prompt生成、镜头参数、生成配置、即梦参数、API参数、prompt拼接、画面生成参数
**英文**：shooting script、video prompt、shot parameter、prompt engineering for video、generation config、API parameters、prompt generation

## 触发场景

1. 用户已完成分镜设计，需要将分镜转化为可执行的生成参数
2. 用户提到"把分镜转成prompt"、"生成视频参数"
3. 用户需要为即梦API准备 prompt、seed 等参数
4. 用户讨论视频生成的 prompt 拼接和参数调优
5. 用户在 AI 漫剧/短片工作流中，处于分镜→生成环节

## 数据契约

遵循 `/tmp/crew-v3-build/movie-schema.json` 中 `ShootingScript` 和 `VideoShot` 定义。

### 输入
- **Storyboard** — 分镜脚本（含 shots 数组，每个 shot 有 shot_id, scene_ref, character_refs, camera, action, duration）
- **CharacterBible[]** — 角色圣经（appearance 字段用于角色描述拼接）
- **ArtDirection** — 美术方向（style_name, color_palette, light_quality, texture 用于风格拼接）
- **SceneDesign[]** — 场景设计（可选，location/atmosphere/lighting 用于场景描述）

### 输出
- **ShootingScript** — 拍摄脚本（每个 VideoShot 含 prompt, seed, aspect_ratio, motion_strength）

## 执行流程

### Step 1: 加载输入数据
读取 Storyboard、CharacterBible、ArtDirection、SceneDesign，构建角色/场景查找表。

### Step 2: 为每个 Shot 构建 VideoPrompt
调用 `buildVideoPrompt()`，自动拼接：
```
{角色外观描述} + {动作} + {场景环境} + {摄影机角度/运动} + {美术风格} + {光影质感}
```

详见 `prompts/video-generation.md`。

### Step 3: 分配 Seed
- 每个角色使用 CharacterBible 中的 seed 作为基础值
- 同一角色在不同 shot 中保持 seed 一致
- 多角色 shot 使用主角色 seed + shot 索引偏移
- seed 锁定后写入 consistency_lock

### Step 4: 计算运动强度
根据镜头类型自动设置 motion_strength（0-10）：

| 镜头类型 | motion_strength | 说明 |
|---------|----------------|------|
| 静态特写 | 1-2 | 微表情、眼神 |
| 中景对话 | 2-3 | 轻微身体语言 |
| 全景站立 | 3-4 | 呼吸感、风吹 |
| 走动/跑动 | 5-7 | 明显运动 |
| 战斗/追逐 | 7-9 | 高强度运动 |
| 爆炸/特效 | 8-10 | 剧烈变化 |

camera.movement 会进一步调节：推拉摇移 +1~2，固定不变。

### Step 5: 设置画面比例
- 默认 16:9（横屏）
- 短视频场景使用 9:16
- 社交媒体图文使用 1:1

### Step 6: 输出 ShootingScript JSON
```json
{
  "type": "ShootingScript",
  "version": "1.0.0",
  "shots": [
    {
      "shot_id": "shot_001",
      "prompt": "A young woman with long black hair...",
      "seed": 12345,
      "aspect_ratio": "16:9",
      "motion_strength": 3
    }
  ]
}
```

## 失败降级策略

当视频生成失败时，按顺序降级：

1. **Attempt 1**: 完整 prompt，目标 motion_strength
2. **Attempt 2**: 简化 prompt（去除次要修饰），motion_strength -2
3. **Attempt 3**: 极简 prompt（仅角色+核心动作），motion_strength = 2
4. **Attempt 4**: 降级为静态图（文生图），保留 seed 和构图

调用 `applyRetryStrategy(shot, attempt)` 获取降级参数。

## 成本估算

- 视频生成：每个 shot 约 0.05 积分（即梦）
- 降级重试成本：累加每次尝试
- 调用 `estimateTotalCost(shootingScript)` 获取预估总成本

## 即梦 API 对接

使用 kais-jimeng skill 的视频生成端点：
- 纯文本视频：`/v1/videos/generations`（jimeng-video-3.5-pro）
- Seedance 视频：`/v1/videos/generations/async`（需素材）
- 降级文生图：`/v1/images/generations`

## 工具文件
- `lib/shooter.js` — 核心转换逻辑
- `prompts/video-generation.md` — Prompt 模板和变量说明
