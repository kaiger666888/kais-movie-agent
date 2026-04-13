# 完整 Phase 流程图

```
Phase 1: 需求确认 + 深度调研
  ├── 1.1 用户需求解析（主题/时长/风格/受众）
  ├── 1.2 品牌与背景调研（按需，见 research-workflow.md）
  └── 1.3 输出 requirement.json + brief.md
  → 🔒 REVIEW GATE

Phase 2: 剧本大纲 (kais-scenario-writer)
  ├── 2.1 StoryDNA 提取（核心冲突/角色弧光/情感节拍）
  ├── 2.2 大纲生成（A/B 双版本）
  ├── 2.3 场景对白 + 动作描写
  └── 2.4 输出 scenario.json + story_bible.json
  → 🔒 REVIEW GATE

Phase 3: 美术方向 (kais-art-direction)
  ├── 3.1 Mood Board 3 选 1
  ├── 3.2 光影参考图
  └── 3.3 输出 art_direction.json + color_palette.json
  → 🔒 REVIEW GATE

Phase 4: 角色设计 (kais-character-designer)
  ├── 4.1 角色卡（外貌/性格/服装）
  ├── 4.2 转面图生成
  └── 4.3 输出 characters.json + 参考图
  → 🔒 REVIEW GATE

Phase 4.5: 配音 (kais-voice)
  ├── 4.5.1 TTS 音色选择（多音色试听 + 审核）
  └── 4.5.2 全片对白合成
  → 🔒 REVIEW GATE

Phase 5: 场景图生成 (kais-scene-designer)
  ├── 5.1 场景布局设计
  └── 5.2 场景图渲染
  → checkpoint

Phase 5.3: 线稿生成（anatomy-guard 预防）
  ├── 5.3.1 线稿生成（sketch-generator.py）
  └── 5.3.2 解剖质量预检
  → checkpoint

Phase 5.5: 基于线稿渲染
  ├── 5.5.1 线稿→渲染（sketch-to-render.py, 四维锚定融合）
  └── 5.5.2 解剖质量检测（anatomy-validator.py）
  → checkpoint

Phase 5.6: 渲染审核
  └── 全部场景图审核
  → 🔒 REVIEW GATE

Phase 5.7: 拍摄手法规划 (kais-cinematography-planner)
  └── Coverage Map 批量映射
  → checkpoint

Phase 6: 分镜板 (kais-storyboard-designer)
  ├── 6.1 逐镜头设计（景别/运镜/时长/对白）
  └── 6.2 输出 storyboard.json + shots.json
  → 🔒 REVIEW GATE

Phase 7: 视频生成 (kais-camera + 延长链)
  ├── 7.1 视频批量生成（Seedance 2.0）
  ├── 7.2 延长链拼接（extension-chain.js）
  └── 7.3 粗剪 rough_cut.mp4
  → 🔒 REVIEW GATE

Phase 8: 后期合成 + 交付
  ├── 8.1 字幕生成
  ├── 8.2 音频混流（TTS + BGM）
  ├── 8.3 最终合成 final.mp4
  └── 8.4 QC 报告 + 交付
  → checkpoint
```
