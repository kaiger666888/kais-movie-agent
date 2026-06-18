# kais-movie-agent

AI 短片制作全流程管线 — 从故事到成片的一站式 skill 集合。

## 架构

```
kais-movie-agent/
├── skills/                    # 7 个专项 skill
│   ├── kais-art-direction     # 美术方向定义
│   ├── kais-character-designer # 角色设计 + L1/L2/L3/L4 分层资产管理
│   ├── kais-scenario-writer   # 剧本/分镜编写
│   ├── kais-scene-designer    # 场景图生成（含角色一致性）
│   ├── kais-storyboard-designer # 分镜板设计
│   ├── kais-camera            # 视频生成 + 合成
│   └── kais-shooting-script   # 拍摄脚本
├── lib/                       # 共享工具
│   ├── jimeng-client.js        # 即梦 API 客户端（compositions + omni_reference）
│   ├── character-asset-manager.js  # L1/L2/L3/L4 分层角色资产管理器
│   ├── reference-prompt-builder.js # 角色一致性 prompt 模板系统
│   ├── prompt-injector.js      # Prompt 自动注入（V3: 零面部描述策略）
│   ├── invariant-bus.js        # 跨步骤不变量总线（L1/L2 支持）
│   ├── continuity-auditor.js   # 5维一致性审计（L1锚点基准对比）
│   ├── scripts/
│   │   ├── sketch-generator.py    # 线稿生成器
│   │   ├── sketch-to-render.py    # 基于线稿渲染
│   │   └── scene-evaluator.py     # 场景图评价（支持 sketch/render 模式）
│   ├── jimeng-client.js       # 即梦 API 客户端
│   └── cost-scheduler.js      # 积分/成本调度
└── docs/                      # 文档
```

## 角色一致性策略（2026-06-18 更新）

### 核心策略：双参考系统 + 脸图分离

基于即梦 Seedance 2.0 最佳实践，角色一致性 80% 取决于参考图质量，20% 取决于提示词。

#### L1/L2/L3/L4 分层资产库

| 层级 | 名称 | 内容 | API 入口 | 用途 |
|------|------|------|---------|------|
| **L1** | 身份锚点 | 1-3 张面部/半身特写 | 角色参考（Character Ref） | 锁定五官/骨相/发型/肤色，**永不更换** |
| **L2** | 造型卡片 | 每套服装全身正面+侧面 | 智能参考（Smart Ref） | 锁定服装/道具/造型 |
| L3 | 姿势包 | 坐/站/走/跑等姿态 | 智能参考 | 动作参考 |
| L4 | 表情标定 | 微笑/怒/惊/泪 | 智能参考 | 表情戏时使用 |

**关键原则：角色参考只传脸，智能参考传衣服/姿势。不要混放！**

#### API 能力

| 端点 | 用途 | 参数 |
|------|------|------|
| `POST /v1/images/generations` | 文生图 | prompt, model |
| `POST /v1/images/compositions` | **图生图参考** | images, sample_strength (0.3-0.6) |
| `POST /v1/videos/generations` | 视频生成 | functionMode, file_paths |

#### 管线流程

```
Phase 1: 需求确认
  ↓
Phase 2: 美术方向 (kais-art-direction)
  ↓
Phase 3: 角色设计 (kais-character-designer)
  ├─ Step 3.1: L1 身份锚点生成（20选3面部特写）
  ├─ Step 3.2: 黄金标准质量检测
  ├─ Step 3.3: L2 造型卡片生成（compositions API）
  └─ Step 3.4: L3/L4 按需生成
  ↓
Phase 4: 剧本编写 (kais-scenario-writer)
  ↓
Phase 5: 场景图生成 (kais-scene-designer)
  ├─ Step 5.1: compositions API 生成（L1+L2 参考，sample_strength=0.4）
  ├─ Step 5.2: 线稿生成 sketch-generator.py
  ├─ Step 5.3: 线稿审核 scene-evaluator.py --mode sketch
  ├─ Step 5.4: 基于线稿渲染 sketch-to-render.py（L1+L2 参考）
  └─ Step 5.5: 渲染审核（auditImageVsL1 对比 L1 锚点）
  ↓
Phase 6: 分镜板 (kais-storyboard-designer)
  ↓
Phase 7: 视频生成 (kais-camera)
  └─ Seedance 2.0 omni_reference 模式
     ├─ image_file_1~3: L1 身份锚点（70% 权重）
     ├─ image_file_4~6: 分镜首帧 + L2 造型卡片
     └─ prompt: @Image1 提供身份，@Image4 提供场景服装
  ↓
Phase 8: 后期合成 + 交付
  └─ 一致性审计（L1 锚点基准对比）
```

## 质量保障

### 场景图自动评价
- **线稿模式** (`--mode sketch`)：构图、纯黑白、关键元素、线条质量
- **渲染模式** (`--mode render`)：无残留线稿、风格统一、角色一致
- **默认模式**：物品重复、道具缺失、物理合理性、表情验证

### 5维一致性审计
1. **identity_match** — 以 L1 身份锚点为基准的跨镜头面部一致性
2. **axis_compliance** — 180° 轴线合规
3. **wardrobe_drift** — 以 L2 造型卡片为基准的服装一致性
4. **spatial_consistency** — 空间一致性
5. **plot_continuity** — 剧情连续性

## 底层依赖

- **文生图**: kais-jimeng (即梦 API)
- **图生图参考**: 即梦 compositions API (sample_strength 0.3-0.6)
- **视频生成**: Seedance 2.0 omni_reference (@Image/@Video 绑定)
- **评价**: 智谱 GLM-4V-Flash + LLM 视觉分析
- **合成**: FFmpeg

## License

MIT
