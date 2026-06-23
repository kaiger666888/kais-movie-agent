# Phase 12: 一致性审计实化 - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase with integration — discuss skipped per autonomous smart-discuss)

<domain>
## Phase Boundary

让 `lib/continuity-auditor.js` 的 `_getDINOv2Score()` 从 `return 0.85` 假数据变成真实的视觉模型打分,并让 `consistency-guard` handler(Phase 10 添加的 stub)实际调用 `auditContinuity()`。

同时让 `auditImageVsL1()` 在场景图/分镜首帧生成后即时触发(嵌入到 Phase 10 的 `scene-generation` / `seed-skeleton` / `ai-preview` handler 流程中),而不是只等 `consistency-guard` 阶段才检查。

**核心问题**:
1. `lib/continuity-auditor.js:192-196` 的 `_getDINOv2Score` 直接 `return 0.85`,从不调真实 API
2. Phase 10 的 `consistency-guard` handler 是 stub,只写空 JSON,不调 `auditContinuity`
3. `auditImageVsL1` 已实现但从未在生成阶段被调用

</domain>

<decisions>
## Implementation Decisions

### GLM-4V 接入方案

**方案**: 使用智谱 GLM-4V-Flash(免费)作为视觉对比模型,通过 `callLLMJson` helper(`lib/hermes-adapter.js`)调用。

**核心 prompt 模板**(替换 `_getDINOv2Score` 内部):
```javascript
async function _getDINOv2Score(client, visuals, characters) {
  // 1. 取每个角色的 L1 身份锚点路径(来自 character-assets)
  // 2. 对每个 visual(shot),与对应角色的 L1 锚点做对比
  // 3. 调用 GLM-4V 返回 0-1 分数
  const { callLLMJson } = await import('./hermes-adapter.js');
  
  const scores = [];
  for (const visual of visuals) {
    const character = _matchCharacter(visual, characters);
    if (!character?.assets?.L1_identity) continue;
    
    const anchors = character.assets.L1_identity.filter(a => a.status === 'approved');
    if (!anchors.length) continue;
    
    const result = await callLLMJson({
      prompt: `对比生成图与角色身份锚点的面部一致性。
      
身份锚点: ${anchors.map(a => `[${a.path}]`).join(', ')}
生成图: [${visual.image_path}]

评分: 五官/发型/肤色/整体相似度,综合输出 0.0-1.0 分。
返回 JSON: { "score": 0.0-1.0, "reasoning": "...", "issues": [] }`,
      system: '你是角色一致性审查专家。0.85+ 优秀,0.7-0.85 可接受,<0.7 需重新生成。',
      model: 'glm-4v-flash',
    });
    scores.push(result?.score ?? 0.7);
  }
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0.7;
}
```

### Claude's Discretion
- **API 路由**: 如果 gold-team 提供 DINOv2 endpoint(`gtClient.submitTask({task_type: 'dinov2_embedding', ...})`),优先用 DINOv2 余弦相似度;否则降级 GLM-4V
- **批处理**: 多个 visuals 应该批量调用 API(单次 prompt 含多个对比),减少请求数
- **缓存**: 相同 (image_path, anchor_path) 对的结果缓存到 `.pipeline-assets/consistency-cache.json`,避免重复打分
- **失败降级**: LLM 调用失败 → 返回 `null`(不是 0.7 假分数),让上层 `auditContinuity` 知道这是未评分而非合格
- **重试触发**: `auditImageVsL1` 返回 score < 0.7 时,handler 应该 log warning + 写入 `consistency-pass.json` 的 `retry_shots` 数组,而非直接 fail pipeline

### consistency-guard handler 实化

替换 Phase 10 stub,改为:
```javascript
'consistency-guard': {
  after: async (pipeline, phase, phaseConfig) => {
    const bus = new AssetBus(pipeline.workdir);
    const stsScript = await bus.read('spatio-temporal-script') || {};
    const characterAssets = await bus.read('character-assets') || {};
    const sceneAssets = await bus.read('scene-assets') || {};
    
    // 收集所有 visuals (生成图)
    const visuals = (stsScript.shots || [])
      .filter(s => s.image_path || s.seed_frame_path)
      .map(s => ({
        shot_id: s.id,
        image_path: s.image_path || s.seed_frame_path,
        scene_id: s.scene_id,
        character: s.character,
      }));
    
    if (!visuals.length) {
      // 降级:无 visuals 直接通过(Phase 14 真实生成后才会有图)
      await writeFile(...'consistency-pass.json', { _stub: true, _reason: 'no_visuals_yet' });
      return { summary: { skipped: 'no visuals' }, metrics: {} };
    }
    
    // 调用真实审计
    const result = await auditContinuity({
      visuals,
      characterAssets: characterAssets.characters || [],
      sceneMeta: sceneAssets,
    });
    
    await writeFile(join(pipeline.workdir, 'consistency-pass.json'), JSON.stringify(result, null, 2));
    
    if (!result.passed) {
      console.warn(`[consistency-guard] 审计未通过: ${result.recommendation}`);
      // 不抛 fatal — 让质量门控在 Phase 13 / composition 阶段统一判定
    }
    
    return { summary: result, metrics: { overall: result.overall, passed: result.passed } };
  },
},
```

### auditImageVsL1 即时触发

在以下 Phase 10 stub handler 中(替换 stub 内容),添加生成后即时审计:
- `scene-generation`: 每张场景图生成后调 `auditImageVsL1(imagePath, characterL1Anchors)`,score < 0.7 写入 retry 队列
- `seed-skeleton` (V4.1 已有 handler): 在 frameResults 之后,对每个首帧调 auditImageVsL1
- `ai-preview` (V4.1 已有 handler): 视频生成完成后,对首帧截取调 auditImageVsL1

注:Phase 12 不实现真实图像生成(留给 Phase 14/15),但确保 audit 调用点存在。当 Phase 14 真实产出图后,audit 自动生效。

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/continuity-auditor.js:40-114` — `auditContinuity()` 主函数,5 维度审计框架已就绪
- `lib/continuity-auditor.js:125-167` — `auditImageVsL1()` 单图对比函数,已实现 LLM 调用
- `lib/continuity-auditor.js:192-196` — `_getDINOv2Score()` TODO stub,本 phase 实化
- `lib/hermes-adapter.js` — `callLLMJson()` helper,支持 vision model (GLM-4V)
- `lib/asset-bus.js` — AssetBus,读写 `.pipeline-assets/`
- `lib/character-asset-manager.js` — L1 anchor 读取接口

### Established Patterns
- LLM 视觉调用: `callLLMJson({prompt, system, model: 'glm-4v-flash'})` (已在 `auditImageVsL1` 中使用)
- 失败降级: try/catch + return null + log warning
- Phase 10 handler 结构: hermes decide → 业务 → audit → collector → return

### Integration Points
- `lib/phases/index.js` 的 `consistency-guard` handler(Phase 10 stub,本 phase 替换)
- `lib/phases/index.js` 的 `scene-generation` handler(Phase 10 stub,本 phase 增强)
- `lib/continuity-auditor.js` 的 `_getDINOv2Score`(本 phase 实化)

</code_context>

<specifics>
## Specific Ideas

- **GLM-4V-Flash 免费**: 已在项目其他地方使用(`quality-gate.js`, `scene-evaluator.py`)
- **缓存**: `.pipeline-assets/consistency-cache.json` 避免重复打分,加速 E2E
- **不做**: 不实现 gold-team DINOv2 endpoint(留给后续,作为可选优化)
- **不做**: 不实现图像生成(留给 Phase 14),只确保 audit 调用点就位

</specifics>

<deferred>
## Deferred Ideas

- gold-team DINOv2 endpoint 接入(性能优化)→ 后续
- 跨剧集角色指纹库 → v3.0
- 一致性回归测试集 → v3.0

</deferred>
