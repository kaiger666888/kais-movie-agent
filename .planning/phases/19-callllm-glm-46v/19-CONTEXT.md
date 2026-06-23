# Phase 19: callLLM 重构 + GLM-4.6V 升级 - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase + research already done — discuss skipped)

<domain>
## Phase Boundary

让 `callLLM`/`callLLMJson` 正确处理 OpenAI multimodal `image_url` content blocks(目前把图片路径作为文本嵌入 prompt,任何模型都看不到图)。然后:
- 将全 codebase 5 处硬编码的视觉模型名(`glm-4v-flash`/`glm-4v`/`glm-4.6v` 三个版本碎片)统一到 `ZHIPU_VISION_MODEL` env var,默认 `glm-4.6v`
- 50-pair golden set 校准 baseline(升级前后 score 分布对比)
- `_scoreCache` 按 `model_version` 命名空间失效

**核心问题(Pitfalls research 陷阱 7,最高 single-failure-point 风险)**:
`lib/continuity-auditor.js:398` 当前 prompt 是:
```
对比以下生成图与角色身份锚点的面部一致性。
身份锚点(角色标准外观）: ${identityAnchorPaths.map(p => `[${p}]`).join(', ')}
生成图: [${generatedImagePath}]
```
路径 `[xxx]` 作为纯文本传给 GLM-4V,**模型根本看不到图片**,只能基于文件名猜测打分。任何模型升级都是"静默失效"。

</domain>

<decisions>
## Implementation Decisions

### callLLM API 升级(向后兼容)

```javascript
// 旧 API(保留兼容,内部转换)
await callLLM(promptString, { model, system, ... })  // text-only

// 新 API(支持 multimodal)
await callLLM({
  prompt: [
    { type: 'text', text: '对比以下生成图与角色身份锚点...' },
    { type: 'image_url', image_url: { url: 'file:///path/to/img.png' } },
    // 或 base64: { url: 'data:image/png;base64,...' }
  ],
  system: '...',
  model: 'glm-4.6v',
})

await callLLMJson({ prompt: [...multimodal...], system, model })
```

**关键设计**:
1. `callLLM` 检测 `prompt` 是字符串还是数组,字符串走旧路径(text-only),数组走 multimodal
2. `file://` URL 由 adapter 读取并转 base64 data URL(智谱 GLM-4.6v 不支持 file://)
3. 现有所有 text-only 调用(script-generation 等)不破坏

### callLLMJson 支持图片

```javascript
// callLLMJson 也接受 multimodal prompt 数组
await callLLMJson({
  prompt: [
    { type: 'text', text: '评估一致性,返回 JSON' },
    { type: 'image_url', image_url: { url: 'file:///anchor1.png' } },
    { type: 'image_url', image_url: { url: 'file:///generated.png' } },
  ],
  system: '...',
  model: 'glm-4.6v',
})
// 返回: { score: 0.85, reasoning: '...', issues: [] }
```

### 模型名统一(5 处硬编码)

| 文件 | 当前 | 新 |
|------|------|---|
| `lib/continuity-auditor.js:398` | `'glm-4v-flash'` (hardcoded) | `process.env.ZHIPU_VISION_MODEL \|\| 'glm-4.6v'` |
| `lib/quality-gate.js:152` | `'glm-4.6v'` (hardcoded) | 同上(实际已是 4.6v,只改 env 化) |
| `lib/scene-bible.js` | `'glm-4v'` (hardcoded) | 同上 |
| `lib/scripts/scene-evaluator.py` | `'glm-4v-flash'` (hardcoded) | 同上(Python 读 env) |
| `lib/first-director.js` | `'glm-4.6v'` (hardcoded) | 同上 |

### 50-pair golden set baseline

- 准备 50 对图片(身份锚点 + 生成图)
- 跑 3 次:旧 glm-4v-flash + 新 glm-4.6v + glm-4.6v with thinking
- 输出 `test/golden-set/baseline-report.json`:
  ```json
  {
    "samples": 50,
    "glm-4v-flash": { "mean": 0.78, "std": 0.12, "duration_ms": 1234 },
    "glm-4.6v": { "mean": 0.72, "std": 0.08, "duration_ms": 2345 },
    "glm-4.6v-thinking": { "mean": 0.74, "std": 0.06, "duration_ms": 5678 },
    "threshold_recommendation": 0.70  // 基于 std 校准
  }
  ```
- 测试集本身存 `test/golden-set/pairs/*.json`(每对 2 张图 + ground truth 标签)

### _scoreCache 按 model_version 失效

```javascript
// lib/continuity-auditor.js
function _cacheKey(imagePath, anchorPaths, modelVersion) {
  const inputHash = sha256(JSON.stringify({ imagePath, anchorPaths }));
  return `${modelVersion}:${inputHash}`;  // model_version 前缀
}

// 模型切换时,旧 key 自然失效(查询 miss → 重新评分)
```

### Claude's Discretion

- **降级**:GLM-4.6v 不可达时返回 null(保留 v2.0 quality-gate null-fallback 语义)
- **file:// 转 base64**:helper `imagePathToDataUrl(path)`(读文件 + mime 检测)
- **thinking 模式**:默认关闭,可通过 `callLLMJson({ ..., thinking: { type: 'enabled' } })` 开启
- **测试**:单元测试覆盖 multimodal payload 构造 + file:// 转换 + cache 失效 + 降级路径
- **不做**:不修改非视觉 LLM 调用(text-only prompt)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/hermes-adapter.js` — `callLLM` / `callLLMJson` 当前实现(待重构)
- `lib/continuity-auditor.js:398` — 主要重构点(prompt 文本嵌入路径)
- `lib/quality-gate.js:152` — 已用 glm-4.6v(仅 env 化)
- `lib/scene-bible.js` — glm-4v 硬编码
- `lib/scripts/scene-evaluator.py` — Python glm-4v-flash
- `lib/first-director.js` — glm-4.6v 硬编码

### Established Patterns
- 现有 `callLLM(prompt, options)` text-only API
- OpenAI multimodal content blocks 是行业标准(GLM-4.6v / GPT-4V / Claude 都支持)
- v2.0 quality-gate null-fallback 模式

### Integration Points
- 所有 visual LLM 调用点(5 处)迁移到 multimodal API
- v3.0 后续 phase 21 (BlacklistEngine semantic match) 依赖此重构
- v3.0 后续 phase 22 (Seedance lip sync 验证) 依赖此重构

</code_context>

<specifics>
## Specific Ideas

- **智谱 GLM-4.6v endpoint**: `https://open.bigmodel.cn/api/paas/v4/chat/completions`
- **支持 image_url**: 两种格式 — `data:image/...;base64,...` 或 公网 URL
- **file:// 转换**: 必须读文件转 base64(智谱不支持 file://)
- **API key**: `ZHIPU_API_KEY` env(var 已存在)
- **模型 env**: `ZHIPU_VISION_MODEL`(新增,默认 `glm-4.6v`)
- **golden set 50 对**: 部分用现有 projects/ 已有资产 + 人工标注 ground truth

</specifics>

<deferred>
## Deferred Ideas

- thinking 模式深度调优 → 后续基于 baseline report 决定
- 其他视觉模型支持(GPT-4V / Claude)→ v4.0
- 视觉模型 finetuning → Phase 25 (B6)

</deferred>
