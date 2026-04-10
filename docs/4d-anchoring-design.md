# 四维锚定架构设计文档

> S.P.A.C.E + 四维锚定：从空间占位到电影级动态成片

## 1. 问题定义

当前 kais-movie-agent 的渲染管线是**单层控制**：
- S.P.A.C.E 约束锁定结构（Subject/Props/Composition/Environment）
- 线稿→渲染 两阶段生成

**核心缺陷**：渲染阶段无法独立控制身份、光影、运动，导致：
- 角色跨镜头不一致（IP 漂移）
- 光影氛围不统一（同一场景冷暖混杂）
- 运动风格随机（无法指定"缓慢"vs"急促"）
- 空间深度丢失（前后景层次模糊）

## 2. 架构设计：二级工作流

```
┌─────────────────────────────────────────────────────────┐
│  Structure Layer (结构层) — S.P.A.C.E 约束              │
│  Phase 5.3: 线稿生成 → 锁定构图+空间关系               │
└──────────────────────┬──────────────────────────────────┘
                       ↓ 结构锁定
┌─────────────────────────────────────────────────────────┐
│  Render Layer (渲染层) — 四维锚定注入                   │
│                                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │ 深度锚定 │ │ 身份锚定 │ │ 光影锚定 │ │ 时序锚定 │  │
│  │ Depth    │ │ IP-Ada   │ │ IC-Light │ │ Animate  │  │
│  │ Control  │ │ pter     │ │ Relight  │ │ Diff     │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
│       ↓            ↓            ↓            ↓          │
│  分层渲染 → 合成输出                                     │
└─────────────────────────────────────────────────────────┘
```

## 3. 四维锚定详解

### 3.1 深度锚定（Depth Anchoring）

**目标**：控制场景前后景层次，保持空间深度一致

| 项目 | 说明 |
|------|------|
| 技术方案 | ControlNet Depth / MiDaS 深度图 |
| 输入 | 线稿 → 深度图提取 → 作为 ControlNet 条件 |
| 输出 | 生成图保持与线稿一致的空间层次 |
| 参数 | `depth_strength: 0.6-0.8`（控制深度影响强度）|
| 适用 | 所有含前景/中景/远景的场景 |

**Prompt 模板**：
```
DEPTH: foreground=[角色], midground=[桌面道具], background=[窗户远景]
DEPTH_MAP: near=0.2, mid=0.5, far=0.9
```

### 3.2 身份锚定（Identity Anchoring）

**目标**：同一角色在所有镜头中保持外观一致

| 项目 | 说明 |
|------|------|
| 技术方案 | IP-Adapter（FaceID/Plus）+ 角色参考图 |
| 输入 | 角色设计阶段的参考图（front/source）|
| 输出 | 生成图中角色面部/体型与参考一致 |
| 参数 | `ip_weight: 0.6-0.8`（身份影响强度）|
| 适用 | 所有含角色的镜头 |

**Prompt 模板**：
```
IDENTITY: character=char_wuji, ref=assets/characters/char_wuji/front-source.png
IDENTITY_WEIGHT: 0.75
```

### 3.3 光影锚定（Lighting Anchoring）

**目标**：统一场景光影氛围，确保同一场景色调一致

| 项目 | 说明 |
|------|------|
| 技术方案 | IC-Light（文本引导重光照）/ 光照参考图 |
| 输入 | ArtDirection 定义的光照风格 + 场景描述 |
| 输出 | 生成图的光影方向/强度/色温与定义一致 |
| 参数 | `light_direction: "upper-left"`, `light_color: "warm-neon"` |
| 适用 | 所有镜头（尤其是跨场景切换时）|

**Prompt 模板**：
```
LIGHTING: direction=upper-left, intensity=0.7, color=4500K(neon-warm)
LIGHTING_MOOD: dramatic, rim-light, volumetric
LIGHTING_REF: assets/art-direction/lighting_ref.png (optional)
```

### 3.4 时序锚定（Temporal Anchoring）

**目标**：控制镜头内运动风格和帧间一致性

| 项目 | 说明 |
|------|------|
| 技术方案 | AnimateDiff / WAN 2.1 Motion Module |
| 输入 | 首帧（渲染图）+ 运动描述 |
| 输出 | 动态视频，帧间一致、运动可控 |
| 参数 | `motion_strength: 0.5-0.9`, `fps: 24` |
| 适用 | Phase 7 视频生成阶段 |

**Prompt 模板**：
```
MOTION: type=slow-push-in, speed=0.3, target=character_face
MOTION_STRENGTH: 0.6
TEMPORAL_CONSISTENCY: high (cross-frame attention)
```

## 4. 集成到 kais-storyboard-designer

### 4.1 Shot Schema 扩展

在现有 shot schema 中增加四维锚定参数：

```jsonc
{
  "shot_id": "shot_001",
  // ... 现有字段 ...

  // 四维锚定参数（Render Layer）
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
      "mood": "dramatic, rim-light",
      "ref_image": "assets/art-direction/lighting_ref.png"
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

### 4.2 渲染管线改造

```
线稿 (S.P.A.C.E 结构锁定)
  ↓
[Phase 5.5 改造] 分层渲染：
  1. 基础渲染（线稿→彩色，sample_strength=0.25）
  2. 深度锚定注入（ControlNet Depth，depth_strength）
  3. 身份锚定注入（IP-Adapter，ip_weight）
  4. 光影锚定注入（IC-Light relighting）
  ↓
渲染审核 (Phase 5.6 增强)
  - 深度一致性检查（前后景层次）
  - 身份一致性检查（角色面部对比）
  - 光影一致性检查（色温/方向）
  ↓
[Phase 7 改造] 视频生成：
  5. 时序锚定注入（AnimateDiff/WAN motion module）
  ↓
最终输出
```

### 4.3 渐进式降级策略

不是所有锚定都需要同时启用。按需求级别选择：

| 级别 | 启用锚定 | 适用场景 | 成本 |
|------|---------|---------|------|
| **Draft** | 无 | 快速原型、概念验证 | 最低 |
| **Standard** | 身份 | 角色一致的短片 | 中 |
| **Cinematic** | 深度+身份+光影 | 正式制作 | 高 |
| **Premium** | 全部四维 | 电影级成片 | 最高 |

### 4.4 即梦 API 适配

即梦 API 支持 images 参数传入参考图，可用于：
- **深度锚定**：传入深度图作为 ControlNet 输入（需 API 支持）
- **身份锚定**：传入角色参考图作为 images[0]（已支持）
- **光影锚定**：传入光照参考图 + style prompt（部分支持）
- **时序锚定**：Seedance 视频生成 API 的 motion 参数（部分支持）

## 5. 实现路径

### Phase A：身份锚定（已有基础）
- 即梦 API 的 `images` + `sample_strength` 已实现角色一致性
- 增强：引入 IP-Adapter 权重参数到 shot schema
- 优先级：**P0**（直接影响角色一致性）

### Phase B：深度锚定
- 在 sketch-to-render.py 中集成 ControlNet Depth
- 从线稿提取深度图 → 作为渲染条件
- 优先级：**P1**（解决空间层次问题）

### Phase C：光影锚定
- 集成 IC-Light 到渲染后处理管线
- ArtDirection 中定义全局光照风格
- 优先级：**P1**（解决氛围不统一）

### Phase D：时序锚定
- 在视频生成阶段集成运动控制参数
- 与 Seedance API 的运动参数对齐
- 优先级：**P2**（视频阶段的精细控制）
