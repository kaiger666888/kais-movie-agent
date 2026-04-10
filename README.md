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
│   │   └── scene-evaluator.py # 场景图自动逻辑评价器
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
Phase 5.5: 场景评价 (lib/scripts/scene-evaluator.py) ← 自动逻辑检查
  ↓
Phase 6: 分镜板 (kais-storyboard-designer)
  ↓
Phase 7: 视频生成 (kais-camera)
  ↓
Phase 8: 后期合成 + 交付
```

## 质量保障

### 场景图自动评价 (Phase 5.5)
每个生图环节都自动执行逻辑一致性检查：
- 物品重复检测（如筷子在手+口袋）
- 关键道具缺失
- 物理合理性
- 表情/景别验证

使用智谱 `glm-4v-flash` 免费视觉模型。

## 底层依赖

- **文生图**: kais-jimeng (即梦 API)
- **视频生成**: Seedance
- **评价**: 智谱 GLM-4V-Flash
- **合成**: FFmpeg

## License

MIT
