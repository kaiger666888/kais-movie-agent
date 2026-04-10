# 四维锚定融合方案 — 调研报告

> 基于 kais-movie-agent 现有架构 + 即梦 API 实际能力的深度调研
> 2026-04-10

---

## 一、现有架构能力盘点

### 即梦 API 实际支持的控制参数

| 参数 | API 支持 | 当前使用位置 | 说明 |
|------|---------|-------------|------|
| `images[]` | ✅ 1-10 张 | sketch-to-render.py | 多图输入，按顺序引用 |
| `sample_strength` | ✅ 0-1 | sketch-to-render.py | 参考图影响强度 |
| `negative_prompt` | ✅ | sketch-to-render.py | 排除项 |
| `seed` | ✅ | jimeng-client.js | 可复现性 |
| `ratio` / `resolution` | ✅ | 全局 | 画面比例/分辨率 |
| `model` | ✅ | 全局 | 模型选择 |
| `@1 @2` 占位符 | ✅ (Seedance) | kais-camera | 视频素材引用 |
| `motion_strength` | ⚠️ Seedance 隐式 | kais-camera | prompt 中描述 |
| ControlNet Depth | ❌ | — | API 不直接支持 |
| IP-Adapter weight | ❌ | — | API 不直接支持（images = 隐式 IP-Adapter）|
| IC-Light | ❌ | — | 需独立部署 |

### 关键发现

1. **即梦 images[] 本身就是隐式 IP-Adapter**：多张参考图按顺序影响生成，第一张影响最大
2. **sample_strength 控制结构保留程度**：本质上是"结构锚定强度"
3. **即梦 5.0 内置了 ControlNet 能力**：images 传入的图会自动提取构图/深度/边缘特征
4. **API 层面无法显式控制 Depth/IP-Adapter/Lighting**：需要通过 prompt engineering + images 顺序模拟

---

## 二、融合策略：不依赖外部工具，纯 API 层实现

### 核心思路

即梦 5.0 的 `images[]` 参数本质上已经集成了多维度控制：
- **images[0]** = 主结构锚定（线稿/构图）
- **images[1]** = 身份锚定（角色参考）
- **images[2+]** = 风格/光影参考

我们只需要**规范化 images 顺序 + 增强 prompt 描述**就能实现四维锚定。

### 2.1 身份锚定（✅ 已有，需规范化）

**现状**：sketch-to-render.py 已经用 images[0]=线稿, images[1+]=角色参考

**优化**：
```python
# images 顺序标准化
images = [
    sketch_image,           # [0] 结构锚定（线稿）
    character_ref_front,    # [1] 身份锚定（正面参考，权重最高）
    character_ref_3q,       # [2] 身份锚定（3/4 视角）
    style_ref,              # [3] 光影/风格参考
]
```

**即梦 API 特性**：images[0] 的 `sample_strength` 控制整体结构保留，后续 images 的角色特征会被自动融合。这是即梦内置的 IP-Adapter 行为。

**改动点**：
- `sketch-to-render.py`：标准化 images 顺序，加入 style_ref
- `kais-character-designer`：输出多视角参考图（front/3q/side）
- `kais-art-direction`：输出风格参考图（用于 images 最后一位）

### 2.2 深度锚定（⚠️ 通过线稿 + prompt 模拟）

**现状**：线稿阶段 S.P.A.C.E 约束已锁定空间关系

**优化**：在线稿 prompt 中显式标注深度层次
```
SUBJECT: 角色正面坐姿，双手持筷
PROPS: 碗、筷子、电脑屏幕
COMPOSITION: 中景，三分法构图
ENVIRONMENT: 简约实验室，凌乱桌面
+ 新增 DEPTH: foreground=角色; midground=桌面道具; background=窗外城市灯光
```

**原理**：即梦从线稿自动提取深度信息。S.P.A.C.E 的 DEPTH 扩展让线稿中的前后景关系更明确，渲染时自动保持。

**改动点**：
- `kais-scene-designer/SKILL.md`：S.P.A.C.E 约束增加 DEPTH 字段
- `sketch-generator.py`：prompt 模板加入 DEPTH 信息
- `scene-evaluator.py`：sketch 模式增加深度层次检查

### 2.3 光影锚定（⚠️ 通过 prompt + 参考图模拟）

**现状**：ArtDirection 定义了全局光影风格，但未传递到渲染阶段

**优化**：三步走
1. **ArtDirection 输出光影参考图**：生成一张"标准光照场景"作为参考
2. **渲染 prompt 注入光影参数**：
   ```
   光照要求：方向=左上方，强度=0.7，色温=4500K（暖色霓虹），氛围=戏剧性轮廓光
   ```
3. **参考图放入 images 最后一位**：作为风格锚定

**改动点**：
- `kais-art-direction/lib/stylist.js`：新增 `generateLightingRef()` 方法
- `sketch-to-render.py`：prompt 模板注入 lighting 参数
- `ArtDirection` schema 增加 `lighting_ref` 字段

### 2.4 时序锚定（✅ Seedance 已支持）

**现状**：kais-camera 的 4 级降级策略已覆盖运动控制

**优化**：将 motion 参数从 prompt 中提取为结构化字段
```json
{
  "temporal": {
    "motion_type": "slow-push-in",
    "motion_strength": "3",  // Seedance 1-5 scale
    "camera_movement": "缓慢推进，聚焦角色面部",
    "fps": 24
  }
}
```

**改动点**：
- `kais-storyboard-designer`：shot schema 增加 temporal 字段
- `kais-camera/lib/camera.js`：从 shot.anchoring.temporal 构建 Seedance prompt
- `kais-shooting-script`：输出 temporal 参数

---

## 三、融合后的渲染管线

```
Phase 2: ArtDirection 锁定
  → 输出: art_direction.json + color_palette + lighting_ref.png
  → 光影锚定: lighting_ref 作为全局光照标准

Phase 3: CharacterDesign 锁定
  → 输出: characters.json + front_ref.png + 3q_ref.png + side_ref.png
  → 身份锚定: 多视角参考图作为跨镜头身份锁

Phase 5: SceneDesign
  → S.P.A.C.E + DEPTH 约束
  → 深度锚定: 线稿中显式标注前后景层次

Phase 5.3-5.6: 线稿→渲染管线（改造后）
  images = [线稿, 角色正面, 角色3/4, 风格参考, 光影参考]
  prompt = 场景描述 + 光照参数 + 风格前缀
  → 四维锚定自动注入

Phase 6: Storyboard
  → 每个 shot 增加 anchoring 配置
  → 记录每个锚定维度的参数和参考图

Phase 7: Camera
  → Seedance prompt 中注入 temporal 参数
  → @1 引用渲染图，@2 引用角色参考（强化身份）
```

---

## 四、具体改动清单

### 4.1 Schema 改动

**ArtDirection 新增字段**：
```json
{
  "lighting": {
    "direction": "upper-left",
    "intensity": 0.7,
    "color_temp": "4500K",
    "mood": "dramatic, rim-light, volumetric",
    "reference_image": "assets/art-direction/lighting_ref.png"
  }
}
```

**SceneDesign S.P.A.C.E 扩展**：
```
SUBJECT: ...
PROPS: ...
COMPOSITION: ...
ENVIRONMENT: ...
DEPTH: foreground=角色; midground=桌面; background=窗外  ← 新增
```

**Shot anchoring 字段**（已在 storyboard-designer SKILL.md 中定义）：
```json
{
  "anchoring": {
    "depth": { "enabled": true, "strength": 0.7, ... },
    "identity": { "enabled": true, "characters": [...] },
    "lighting": { "enabled": true, "direction": "...", ... },
    "temporal": { "enabled": true, "motion_type": "...", ... }
  }
}
```

### 4.2 代码改动

| 文件 | 改动 | 优先级 |
|------|------|--------|
| `kais-art-direction/lib/stylist.js` | 新增 `generateLightingRef()` | P1 |
| `kais-art-direction/prompts/art-direction.md` | 增加光影参考图 prompt 模板 | P1 |
| `kais-character-designer/lib/designer.js` | 输出多视角参考图 | P1 |
| `kais-scene-designer/SKILL.md` | S.P.A.C.E 增加 DEPTH 字段 | P1 |
| `kais-scene-designer/lib/designer.js` | 传递 DEPTH 到线稿 prompt | P1 |
| `lib/scripts/sketch-to-render.py` | 标准化 images 顺序，注入 lighting prompt | P0 |
| `lib/scripts/scene-evaluator.py` | 增加深度层次检查 | P2 |
| `kais-camera/lib/camera.js` | 从 anchoring.temporal 构建 Seedance prompt | P2 |

### 4.3 渐进式降级策略

| 级别 | 身份锚定 | 深度锚定 | 光影锚定 | 时序锚定 | 成本 |
|------|---------|---------|---------|---------|------|
| Draft | 无 | 无 | 无 | 基础运动 | 最低 |
| Standard | images[1]角色参考 | 无 | 无 | 基础运动 | 中 |
| Cinematic | images[1-2]多视角 | S.P.A.C.E+DEPTH | images[最后]风格参考 | 结构化运动 | 高 |
| Premium | images[1-2]多视角 | S.P.A.C.E+DEPTH | images[最后]+lighting prompt | 完整时序参数 | 最高 |

---

## 五、与 ComfyUI 的对比

| 能力 | 即梦 API（当前） | ComfyUI（需要部署） |
|------|-----------------|-------------------|
| 角色一致性 | images[] 隐式 IP-Adapter | IP-Adapter 显式 weight 控制 |
| 深度控制 | 线稿隐式 | ControlNet Depth 显式 |
| 光影控制 | prompt + 参考图 | IC-Light 独立模块 |
| 运动控制 | Seedance @1@2 | AnimateDiff + ControlNet |
| 部署成本 | 零（已有） | 高（GPU + 多模型） |
| 一致性 | 80-90%（prompt 依赖） | 95%+（显式控制） |
| 速度 | 快（API 直调） | 慢（本地推理） |

**建议**：当前阶段用即梦 API 实现标准化融合（80-90% 一致性），未来考虑 ComfyUI 本地部署实现精确控制。

---

## 六、下一步行动

1. **P0**：改造 `sketch-to-render.py` — 标准化 images 顺序
2. **P1**：ArtDirection 增加光影参考图 + CharacterDesign 多视角
3. **P1**：S.P.A.C.E 增加 DEPTH 字段
4. **P2**：Camera temporal 结构化 + SceneEvaluator 增强
