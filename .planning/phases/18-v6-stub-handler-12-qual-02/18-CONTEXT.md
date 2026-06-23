# Phase 18: V6 stub handler 真实化 + QUAL-02 测试 - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning
**Mode:** Auto-generated (closure phase for v2.0 audit W-1 + W-4)

<domain>

## Phase Boundary

实化 v2.0 audit 标记的 12 个 V6 stub handler,让 pipeline 在 degraded 模式下也能产出有意义的内容(非空 JSON,不是 `_stub: true` 占位)。同时补充 QUAL-02 单元测试覆盖。

**核心问题**: Phase 10 为架构对齐,把 15 个 handler 全部 stub 化(只写空 JSON + `_pendingRealImplementation` 标记)。Phase 14 只实化了 character-generation。剩余 12 个仍是 stub,导致 E2E degraded 模式产出的 pain-report / outline / script 都是空数组。

</domain>

<decisions>

## Implementation Decisions

### 上半创意立项 handler 实化(8 个)

按 hooks/index.js 现有的 helper 实现真实业务逻辑:

| Handler | 实化方案 |
|---------|---------|
| `pain-discovery` | 调用 `audienceMatch()` (hooks/audience-match.js),产出 audience-match 结果作为 pain 输入;若失败降级为 requirement.json 透传 |
| `topic-selection` | 读 `candidate-topics.json`(由 pain-discovery 产出),按 LLM scoring 选 top 1,写 selected-topic.json |
| `outline-generation` | 调用 `callLLM` 生成 3 个 outline 候选(基于 selected-topic);失败降级为模板生成 |
| `outline-selection` | 读 outline-candidates.json,按 LLM 选优,写 selected-outline.json |
| `script-generation` | 调用 `callLLM` 基于 outline 生成 3 个 script 候选;失败降级 |
| `script-selection` | 读 script-candidates.json,选优,写 selected-script.json |
| `script-lock` | 透传 selected-script + 审核元数据 → script-locked.json |
| `character-selection` | 读 character-candidates.json(Phase 14 已实化 generation),按 LLM 选 top 1,写 soul-pack.json |

### 下半 production handler 实化(4 个)

| Handler | 实化方案 |
|---------|---------|
| `scene-generation` | 调用 JimengClient 生成 6 视角场景图;降级为 stub 路径占位 |
| `scene-selection` | 读 scene-candidates.json,选优,写 geometry-bed.json(可参考 V4.1 geometry-bed handler) |
| `final-audio` | 收集 bgm-skeleton + temp-dialogue + sfx 路径,写 audio-stems.json(不实际生成音频) |
| `delivery` | 已部分实化(Phase 16 调用 aggregateForEpisode),补充 final.mp4 路径验证 + 完整 quality-report 字段 |

### 降级策略

所有 LLM 调用必须 try/catch + 模板降级:
```javascript
try {
  const result = await callLLM(prompt, { model: 'glm-4.6' });
  // 真实产出
} catch (e) {
  console.warn(`[phase-id] LLM 降级: ${e.message}`);
  // 模板产出(至少 1 条 candidate,不是空数组)
  return {
    _degraded: true,
    _reason: e.message,
    candidates: [buildTemplateCandidate(requirement)],
  };
}
```

### QUAL-02 测试补充

新增 `test/phases/quality-gate-hardening.test.mjs`:
- 全维度失败 → 抛 `QUALITY_GATE_ALL_DIMENSIONS_FAILED`
- 部分维度 null + 部分有分 → 总分按已成功归一化
- 单维度极低分 → 一票否决
- 全维度有分 → 正常路径

</decisions>

<code_context>

### Reusable Assets
- `lib/hooks/index.js` — `audienceMatch`, `deepAudienceAnalysis`, `generateTopics`, `analyzeScript` 等
- `lib/hermes-adapter.js` — `callLLM` / `callLLMJson`
- `lib/phases/index.js` — V4.1 现有 handler(如 `spatio-temporal-script`)作为实化模板
- `lib/jimeng-client.js` — JimengClient(场景图生成)

### Established Patterns
- Phase 10 stub handler 7 步结构(保留)
- V4.1 handler 真实实现模板(requirement-bible / spatio-temporal-script)
- 降级模板:`{ _degraded: true, _reason, candidates: [模板] }`

</code_context>

<specifics>

## Specific Ideas

- **模板候选**: 每个 generation handler 在 LLM 失败时至少产出 1 条模板 candidate,保证 selection handler 有数据可选
- **hooks 优先**: 已有的 hooks/ 目录函数优先使用,不重复造轮子
- **测试位置**: 
  - handler 测试加到 `test/phases/handlers.test.mjs`
  - QUAL-02 测试新文件 `test/phases/quality-gate-hardening.test.mjs`
- **不做**: 不实现真实 GPU 生成(scene-generation / final-audio 仍可走 degraded 路径)

</specifics>

<deferred>

## Deferred Ideas

- 真实 GPU scene/audio 生成 → v3.0
- LLM prompt fine-tuning → v3.0
- 跨 episode candidate 复用 → v3.0

</deferred>
