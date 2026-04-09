# KAIS Movie Agent v3.0

> 生物进化式 AIGC 电影工业化生产管线

## 架构

基于洋葱架构 + 生物进化计算 + 元认知自优化，实现从选题到成片的自动化电影生产。

### 分层架构

- **文本进化群**（高探索区）：选题 → 故事大纲 → 剧本
- **视觉进化群**（中选择区）：风格 → 角色 → 场景 → 分镜
- **执行收敛群**（高收敛区）：拍摄脚本 → 视频生成 → 后期

### 核心特性

- 🧬 分层生物进化：文本层高探索 → 视觉层中选择 → 执行层高收敛
- 🎭 导演中心制：人工适应度函数作为选择压力
- 🔌 完全解耦：Skill 通过契约接口通信
- 🤖 统一API调用：JimengClient 统一管理即梦API

## 快速开始

```bash
# 克隆
git clone https://github.com/kaiger666888/kais-movie-agent.git
cd kais-movie-agent

# 设置即梦API认证
export JIMENG_SESSION_ID="your_session_id"

# 运行管线（交互模式，带审批门）
node pipeline.mjs run "你的主题" --interactive

# 查看状态
node pipeline.mjs status

# 列出项目
node pipeline.mjs list
```

## Skills

| Skill | 说明 | 类型 |
|-------|------|------|
| kais-topic-selector | 选题分析 | 文本进化 |
| kais-story-outline | 故事大纲 | 文本进化 |
| kais-scenario-writer | 剧本写作（A/B测试） | 文本进化 |
| kais-art-direction | 艺术指导/风格系统 | 视觉进化 |
| kais-character-designer | 角色设计（锦标赛选择） | 视觉进化 |
| kais-scene-designer | 场景设计 | 视觉进化 |
| kais-storyboard-designer | 分镜设计 | 视觉进化 |
| kais-shooting-script | 拍摄脚本生成 | 执行收敛 |

## 项目结构

```
kais-movie-agent/
├── pipeline.mjs          # 主管线编排器
├── movie-schema.json     # 全局数据契约（9个模型）
├── lib/
│   ├── evolution-engine.js  # 进化引擎
│   ├── event-bus.js         # 事件总线
│   ├── jimeng-client.js     # 即梦API统一客户端
│   └── index.js             # 统一导出
├── skills/
│   ├── kais-scenario-writer/
│   ├── kais-character-designer/
│   ├── kais-scene-designer/
│   ├── kais-art-direction/
│   ├── kais-storyboard-designer/
│   └── kais-shooting-script/
├── crew.js               # kais-pilot 编排文件
└── TEST_REPORT.md        # 集成测试报告
```

## 数据契约

`movie-schema.json` 定义了9个核心数据模型：

1. **ConceptArtifact** — 选题产物
2. **StoryDNA** — 故事DNA
3. **CharacterBible** — 角色设定
4. **SceneDesign** — 场景设计
5. **ArtDirection** — 艺术指导
6. **Storyboard** — 分镜
7. **ShootingScript** — 拍摄脚本
8. **EvolutionState** — 进化状态
9. **ProjectManifest** — 项目清单

## 依赖

- Node.js >= 18
- 即梦API服务（localhost:8000）— [jimeng-free-api-all](https://github.com/kaiger666888/jimeng-free-api-all)
- ffmpeg（后期合成）

## License

MIT
