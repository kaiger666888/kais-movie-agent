# kais-aigc-movie-v3 — AI 短片制作管线 V3

## 激活条件

当用户提到以下关键词时激活：
- "拍电影"、"AI电影"、"制作短剧"、"v3管线"、"kais-aigc-movie-v3"
- "movie pipeline v3"、"AI短片v3"

## 定位

V3 管线编排器，整合 9 个专业 Skill 完成从选题到成片的完整流程。基于文件系统的 Skill 间数据传递，支持 checkpoint 恢复。

## 管线架构

```
选题 → 大纲 → 美术方向 → 角色设计 → 场景设计 → 剧本 → 分镜 → 拍摄脚本 → 素材生产 → 后期合成
```

### 数据流（每步输出 JSON，下步消费）

| 步骤 | Skill | 输出模型 | 文件 |
|------|-------|---------|------|
| 1 | kais-topic-selector | ConceptArtifact | concept.json |
| 2 | kais-story-outline | StoryDNA | story.json |
| 3 | kais-art-direction | ArtDirection | art-direction.json |
| 4 | kais-character-designer | CharacterBible[] | characters.json |
| 5 | kais-scene-designer | SceneDesign[] | scenes.json |
| 6 | kais-scenario-writer | ScenarioScript | scenario.json |
| 7 | kais-storyboard-designer | Storyboard | storyboard.json |
| 8 | kais-shooting-script | ShootingScript | shooting-script.json |
| 9 | (内置) | — | production.json |
| 10 | (内置) | — | final.json |

## Agent 执行指南

### 启动管线

```bash
node /tmp/crew-v3-build/pipeline.mjs run "<主题>" --ratio 9:16 --shots 8
```

管线会逐步执行，遇到需要 AI 的 Skill 步骤时会暂停并输出：

```
SKILL_PENDING: 需要执行 kais-topic-selector
输入文件: (无)
输出目标: /tmp/crew-v3-build/<project>/concept.json
```

### 执行暂停的 Skill

1. 读取对应 SKILL.md（pipeline 会提示路径）
2. 按照该 Skill 的指南，读取输入文件，执行 AI 任务
3. 将输出 JSON 写入指定路径
4. 标记完成：

```bash
node /tmp/crew-v3-build/pipeline.mjs complete <projectId>
```

### 恢复管线

```bash
node /tmp/crew-v3-build/pipeline.mjs resume
```

### 状态查询

```bash
node /tmp/crew-v3-build/pipeline.mjs status
node /tmp/crew-v3-build/pipeline.mjs list
```

## 数据契约

所有 Skill 遵循 `/tmp/crew-v3-build/movie-schema.json` 中定义的 9 个模型。每个输出文件必须包含 `type` 和 `version` 字段。

## 项目结构

```
/tmp/crew-v3-build/<projectId>/
├── .checkpoint.json     # 管线状态
├── concept.json         # 选题产物
├── story.json           # 故事大纲
├── art-direction.json   # 美术方向
├── characters.json      # 角色设计
├── scenes.json          # 场景设计
├── scenario.json        # 剧本
├── storyboard.json      # 分镜
├── shooting-script.json # 拍摄脚本
├── production.json      # 素材生产记录
├── final.json           # 最终输出
├── assets/              # 图片素材
├── clips/               # 视频片段
└── output/              # 成片
```

## 关键设计决策

1. **文件系统传递** — Skill 间通过 JSON 文件传递数据，不依赖内存
2. **Checkpoint 恢复** — 每步完成后自动保存状态，支持任意步骤恢复
3. **MVP Pop=1** — 不做种群进化，专注单线程跑通
4. **Agent 驱动** — AI 密集型步骤由 Agent 读取 SKILL.md 执行，管线只负责编排
5. **生产步骤内置** — 图片/视频生成通过 dreamina CLI 直接调用，不走 Skill
