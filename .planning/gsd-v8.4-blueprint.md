# GSD Blueprint: kais-movie-agent V8.4 — 即梦中心 + hermes-agent 专家映射更新

## 背景

SKILL.md 中的 hermes-agent 专家映射还是 v1 命名（drawer, scene_builder, animator 等），但 hermes-agent 实际已经做了 Phase 13-18 大规模合并重命名。同时审视发现管线缺少 prompt_injector、script_auditor 早期介入、audio_pipeline 语音生成等关键节点。

## 目标

1. 更新 SKILL.md 中的专家映射到 hermes-agent v2 实际状态
2. 调整管线结构（新增/前置缺失节点，替换废弃映射）
3. 同步更新 README.md 架构图
4. 同步更新 lib/ 代码中的注释和引用（如果有指向旧 expert_id 的）
5. Git commit + push

## 约束

- 不改变子 Skill（skills/ 目录）的代码逻辑
- 不改变 lib/ 的实际功能代码
- 只改文档（SKILL.md, README.md）和代码注释
- 保持即梦为中心的创作流程不变
- 版本号 V8.3 → V8.4

## 变更清单

### SKILL.md 变更

1. **版本号**: V8.3 → V8.4
2. **专家映射替换表**（核心变更）:
   - `drawer` → `visual_executor` (drawer sub-step)
   - `animator` → `visual_executor` (animator sub-step)
   - `scene_builder` → `cinematographer` (composition_lock sub-task) + `style_genome`
   - `composer` → `audio_pipeline` (composer sub-step)
   - `foley` → `audio_pipeline` (foley sub-step)
   - `mixer` → `audio_pipeline` (mixer sub-step)
   - `lip_sync` → `audio_pipeline` (lip_sync sub-step)
   - `spatial_audio` → `audio_pipeline` (spatial_audio sub-step)
   - `voicer` → `audio_pipeline` (voicer sub-step)
   - `continuity` → `continuity_auditor`
   - `performer` → `character_designer` (Phase 17 deprecated)
   - `storyboard_designer` → `cinematographer` (Phase 17 deprecated)

3. **新增 prompt_injector 节点**: 在 Step 13A 前，作为图片/视频 prompt 总出口
4. **前置 style_genome**: 从 Step 2.5 后就确立全局 5D 风格向量
5. **前置 script_auditor**: Step 5 后介入，5维定量审计给 Step 6 做评分依据
6. **新增 audio_pipeline.voicer**: Step 13B 中加入 TTS 旁白/对白
7. **新增 audio_pipeline.lip_sync**: Step 17 后（如需要口型同步）
8. **前置 editor 节奏设计**: Step 14 前介入，决定镜头数/时长/转场

### README.md 变更

1. 角色一致性策略段落后的架构图保持不变（主要是即梦 API 流程）
2. 更新 Phase 列表中涉及的专家名称
3. 版本号同步

### lib/ 代码变更

- 检查所有 JS 文件中对旧 expert_id 的引用，更新注释（如有）

## Worker 拆分

### W1: SKILL.md 专家映射更新 (SKILL.md)
- 替换所有过时的 expert_id
- 更新 Step 流程图中的专家标注
- 新增 prompt_injector / script_auditor / audio_pipeline.voicer 节点描述
- 前置 style_genome / editor 描述
- 版本号 V8.3 → V8.4

### W2: README.md 同步更新
- 更新专家名称
- 同步版本号
- 确保 README 与 SKILL.md 一致

### W3: lib/ 代码注释 + 完整性检查
- 检查 lib/*.js 中对旧 expert_id 的注释引用
- 检查 skills/ 子 skill 的 SKILL.md（如有提到专家映射）
- 汇总需要更新的文件列表

## 验收标准

- 所有旧 expert_id（drawer, scene_builder, animator, performer, storyboard_designer, continuity）在 SKILL.md 中不再作为独立专家出现
- prompt_injector 在 Step 13A 前有明确描述
- script_auditor 在 Step 5-6 之间有明确描述
- audio_pipeline 取代所有 6 个音频专家
- visual_executor 取代 drawer + animator
- README.md 与 SKILL.md 一致
