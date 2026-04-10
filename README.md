# kais-movie-agent

AI 短片制作全流程管线 — 从故事到成片的一站式 skill 集合。

## 架构

```
kais-movie-agent/
├── skills/                    # 7 个专项 skill
│   ├── kais-art-direction     # 美术方向定义
│   ├── kais-character-designer # 角色设计 + 参考图生成
│   ├── kais-scenario-writer   # 剧本/分镜编写
│   ├── kais-scene-designer    # 场景图生成（含角色一致性）
│   ├── kais-storyboard-designer # 分镜板设计
│   ├── kais-camera            # 视频生成 + 合成
│   └── kais-shooting-script   # 拍摄脚本
├── lib/                       # 共享工具
│   ├── scripts/
│   │   ├── sketch-generator.py    # 🆕 线稿生成器
│   │   ├── sketch-to-render.py    # 🆕 基于线稿渲染
│   │   └── scene-evaluator.py     # 场景图评价（支持 sketch/render 模式）
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
  ↓
Phase 5.3: 线稿生成 🆕 sketch-generator.py
  - 输入：S.P.A.C.E空间约束 + 角色参考图
  - 输出：黑白漫画风格线稿
  - API: jimeng-5.0, sample_strength=0.35
  ↓
Phase 5.4: 线稿审核 🆕 scene-evaluator.py --mode sketch
  - 检查：构图、纯黑白、关键元素、线条清晰度
  - FAIL → 重新生成（最多2次）
  ↓
Phase 5.5: 基于线稿渲染 🆕 sketch-to-render.py
  - 输入：线稿 + 风格描述 + 角色参考图
  - 输出：最终渲染图
  - API: jimeng-5.0, images=[线稿,角色], sample_strength=0.25
  ↓
Phase 5.6: 渲染审核 🆕 scene-evaluator.py --mode render
  - 检查：无残留线稿、风格统一、角色一致
  - FAIL → 重新渲染（最多1次）
  ↓
Phase 6: 分镜板 (kais-storyboard-designer)
  ↓
Phase 7: 视频生成 (kais-camera)
  ↓
Phase 8: 后期合成 + 交付
```

## 🆕 线稿控制管线

### 核心理念
**先锁定构图，再释放风格** — 两阶段生成确保叙事精确性和视觉美感。

### Stage 1: 线稿生成
专注构图/空间/动作精确性，输出黑白漫画线稿。

```bash
JIMENG_SESSION_ID=xxx python3 lib/scripts/sketch-generator.py \
  --prompt "角色坐在桌前吃面，看着面前的屏幕" \
  --space "SUBJECT:正面坐姿;PROPS:碗筷子屏幕;COMPOSITION:中景" \
  --ref characters/char_wuji/front-source.png \
  --output sketches/B03-eating.png
```

### Stage 2: 线稿→渲染
基于线稿结构，添加风格/光影/色彩。

```bash
JIMENG_SESSION_ID=xxx python3 lib/scripts/sketch-to-render.py \
  --sketch sketches/B03-eating.png \
  --prompt "赛博朋克风格，霓虹灯光" \
  --ref characters/char_wuji/front-source.png \
  --output scenes/B03-eating.png
```

### 参数调优
| 阶段 | sample_strength | 说明 |
|------|----------------|------|
| 线稿生成 | 0.30-0.40 | 角色参考图影响，允许AI创造性构图 |
| 线稿→渲染 | 0.20-0.30 | 线稿结构保留，允许风格变化 |

### 成本对比
| 方案 | 积分/场景 | 空间准确性 |
|------|----------|-----------|
| 直接生成 | 2 | ~60% |
| 线稿管线 | 3 | ~85% |

## 质量保障

### 场景图自动评价
- **线稿模式** (`--mode sketch`)：构图、纯黑白、关键元素、线条质量
- **渲染模式** (`--mode render`)：无残留线稿、风格统一、角色一致
- **默认模式**：物品重复、道具缺失、物理合理性、表情验证

使用智谱 `glm-4v-flash` 免费视觉模型。

## 底层依赖

- **文生图**: kais-jimeng (即梦 API)
- **视频生成**: Seedance
- **评价**: 智谱 GLM-4V-Flash
- **合成**: FFmpeg

## License

MIT
