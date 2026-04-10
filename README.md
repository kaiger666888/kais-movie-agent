# kais-movie-agent

AI 短片制作全流程管线 — 从故事到成片的一站式 skill 集合。

## 架构

```
kais-movie-agent/
├── skills/                    # 7 个专项 skill
│   ├── kais-art-direction     # 美术方向定义
│   ├── kais-character-designer # 角色设计 + 参考图生成
│   ├── kais-scenario-writer   # 剧本/分镜编写
│   ├── kais-scene-designer    # 场景图生成（含线稿控制管线）
│   ├── kais-storyboard-designer # 分镜板设计
│   ├── kais-camera            # 视频生成 + 合成
│   └── kais-shooting-script   # 拍摄脚本
├── lib/                       # 共享工具
│   ├── scripts/
│   │   ├── sketch-generator.py  # 线稿生成器（S.P.A.C.E约束 → 黑白线稿）
│   │   ├── sketch-to-render.py  # 基于线稿渲染（线稿+参考图 → 最终渲染）
│   │   └── scene-evaluator.py   # 场景图评价器（支持 sketch/render/default 模式）
│   ├── jimeng-client.js       # 即梦 API 客户端
│   └── cost-scheduler.js      # 积分/成本调度
└── docs/                      # 文档
```

## 管线流程

```
Phase 1: 需求确认
  ↓
Phase 2: 美术方向 (kais-art-direction)
  ↓
Phase 3: 角色设计 (kais-character-designer)
  ↓
Phase 4: 剧本编写 (kais-scenario-writer)
  ↓
Phase 5: 场景图生成 (kais-scene-designer)
  ├─ Phase 5.3: 线稿生成 ← sketch-generator.py
  ├─ Phase 5.4: 线稿审核 ← scene-evaluator.py --mode sketch
  ├─ Phase 5.5: 基于线稿渲染 ← sketch-to-render.py
  └─ Phase 5.6: 渲染审核 ← scene-evaluator.py --mode render
  ↓
Phase 6: 分镜板 (kais-storyboard-designer)
  ↓  （线稿作为构图蓝本，渲染图作为最终参考）
Phase 7: 拍摄脚本 (kais-shooting-script)
  ↓  （视频生成使用渲染图作为首帧，非线稿）
Phase 8: 视频生成 (kais-camera)
  ↓
Phase 9: 后期合成 + 交付
```

## 线稿控制管线

两阶段生成策略：**先线稿锁定构图，再基于线稿渲染释放风格**。

### 为什么需要线稿管线？

直接文生图的问题：构图不可控、角色位置随机、空间关系混乱。
线稿管线通过分离"构图"和"风格"两个维度，显著提升空间准确性（+30-50%）。

### 流程详解

```
场景描述 + S.P.A.C.E空间约束 + 角色参考图
  ↓
Phase 5.3: 线稿生成
  - 模型: jimeng-5.0
  - sample_strength: 0.35
  - 输出: 纯黑白漫画线稿（无色无阴影）
  - 负面提示: 排除彩色/渲染/阴影/渐变
  ↓
Phase 5.4: 线稿审核 (scene-evaluator.py --mode sketch)
  - 检查: 纯黑白、线条清晰、构图合理、空间关系、元素完整性
  - FAIL → 重新生成（最多2次）
  ↓
Phase 5.5: 基于线稿渲染
  - 模型: jimeng-5.0
  - sample_strength: 0.25
  - 双重控制: 线稿(结构) + 角色参考图(外观)
  - 输出: 最终渲染图
  - 负面提示: 排除线稿/草图/粗糙/黑白
  ↓
Phase 5.6: 渲染审核 (scene-evaluator.py --mode render)
  - 检查: 无残留线稿、风格一致、角色一致、构图保持、美感
  - FAIL → 调整参数重试（最多1次）
```

### 成本对比

| 模式 | 每场景调用 | 积分 | 空间准确性 | 适用 |
|------|----------|------|-----------|------|
| 快速模式（--no-sketch） | ~2次 | ~2 | 基准 | 简单/快速迭代 |
| 线稿管线（默认） | ~3次 | ~3 | +30-50% | 正式制作 |

### 快速模式

对于简单场景或快速探索，可在场景设计中使用 `--no-sketch` 跳过线稿阶段，直接文生图。

## 质量保障

### 场景图自动评价
每个生图环节都自动执行逻辑一致性检查（支持三种模式）：
- **sketch 模式**：线稿审核（构图/空间/元素/纯黑白）
- **render 模式**：渲染审核（风格/美感/无残留线稿/角色一致）
- **default 模式**：通用检查（物品重复、道具缺失、物理合理性）

使用智谱 `glm-4v-flash` 免费视觉模型。

## 底层依赖

- **文生图**: 即梦 API (jimeng-5.0) — `http://localhost:8000`
- **视频生成**: Seedance 2.0
- **评价**: 智谱 GLM-4V-Flash
- **合成**: FFmpeg

## 环境变量

- `JIMENG_SESSION_ID`: 即梦 session ID
- `JIMENG_API_URL`: 即梦 API 地址（默认 http://localhost:8000）

## License

MIT
