---
phase: 19
plan: D1
subsystem: llm-adapter
tags: [multimodal, vision-llm, glm-4.6v, refactor, blocker-fix]
requires:
  - v2.0 hermes-adapter (callLLM/callLLMJson text-only)
  - v2.0 continuity-auditor (5-dim audit framework)
provides:
  - callLLM/callLLMJson with multimodal content blocks
  - imagePathToDataUrl file→base64 helper
  - ZHIPU_VISION_MODEL single-source env var
  - _scoreCache model-version-aware invalidation
  - 50-pair golden set baseline framework
affects:
  - v3.0 Phase 21 (BlacklistEngine semantic match — needs real vision scoring)
  - v3.0 Phase 22 (Seedance lip sync verification — needs real vision scoring)
  - v3.0 Phase 25 (LoRA data feedback — depends on consistent visual eval)
tech-stack:
  added: []
  patterns:
    - OpenAI multimodal content blocks (text + image_url)
    - file:// → base64 data URL normalization (in adapter)
    - env-var-driven model selection (single source of truth)
    - cache key prefixing by model version
key-files:
  created:
    - test/phases/hermes-adapter-multimodal.test.mjs
    - test/phases/continuity-auditor-multimodal.test.mjs
    - test/phases/golden-set-baseline.test.mjs
    - test/golden-set/README.md
    - test/golden-set/baseline-runner.mjs
    - test/golden-set/pairs/pair-001.json
    - test/golden-set/pairs/pair-002.json
    - test/golden-set/pairs/pair-003.json
    - test/golden-set/pairs/pair-004.json
    - test/golden-set/pairs/pair-005.json
  modified:
    - lib/hermes-adapter.js
    - lib/continuity-auditor.js
    - lib/quality-gate.js
    - lib/scripts/scene-evaluator.py
    - lib/scripts/anatomy-validator.py
    - lib/scripts/hermes_helper.py
decisions:
  - callLLM auto-detects multimodal: Array prompt → vision model; string prompt → text model
  - file:// normalization happens inside adapter (callers stay simple)
  - ZHIPU_VISION_MODEL env default glm-4.6v (single source of truth)
  - _scoreCache keys prefixed with model version (silent invalidation on upgrade)
  - 50-pair golden set ships 5 placeholders + runner; operator补 45 real pairs (deferred)
metrics:
  duration: ~15 min
  completed: 2026-06-23
  tasks: 5
  files-created: 10
  files-modified: 6
  tests-added: 43
  tests-total: 208
  commits: 5
---

# Phase 19 Plan D1: callLLM 重构 + GLM-4.6V 升级 Summary

callLLM/callLLMJson 升级到 OpenAI multimodal content blocks,5 处硬编码视觉模型名统一到 ZHIPU_VISION_MODEL env, _scoreCache 按 model_version 命名空间化, 50-pair golden set baseline 框架就位 — Pitfalls P7 "single biggest failure-point" 修复。

## What Was Built

### Commit 1 (4cbe4ee): callLLM multimodal refactor + imagePathToDataUrl

`lib/hermes-adapter.js` 重写支持三种调用形式:
- `callLLM(stringPrompt, options)` — 旧式 text-only(向后兼容)
- `callLLM({prompt, system, model})` — options-only(continuity-auditor 风格)
- `callLLM({prompt: Array<ContentBlock>, ...})` — multimodal blocks

新增 `imagePathToDataUrl(path)` helper: 读取文件 + mime 检测 + base64 编码。智谱 GLM-4.6v 不支持 `file://` scheme, adapter 内部自动将本地路径转 `data:image/...;base64,...` URL,调用方代码不变。

关键设计:
1. **自动模型检测** — `Array.isArray(prompt)` 走 `getDefaultVisionModel()` (glm-4.6v), string 走 `getDefaultTextModel()` (glm-5.1)
2. **Hermes bypass** — Hermes MCP 协议当前仅支持 string prompt, multimodal 自动降级直连 ZHIPU API
3. **图片读取失败不阻塞** — 单张图 base64 失败仅警告,跳过该 block,整体调用继续
4. **零 npm 依赖** — 仅 `node:fs/promises` + `node:path`

### Commit 2 (d0673c6): 5 处硬编码视觉模型名 → ZHIPU_VISION_MODEL env

| 文件 | 旧 | 新 |
|------|----|----|
| `lib/continuity-auditor.js:398` | `'glm-4v-flash'` | `process.env.ZHIPU_VISION_MODEL \|\| 'glm-4.6v'` |
| `lib/quality-gate.js:152` | `'glm-4.6v'` (hardcoded) | `options.visionModel \|\| env \|\| 'glm-4.6v'` |
| `lib/scripts/scene-evaluator.py:40` | `MODEL = "glm-4.6v"` (const) | `_get_vision_model()` 函数,每次调用读 env |
| `lib/scripts/anatomy-validator.py:32` | `MODEL = "glm-4.6v"` (const) | 同上 |
| `lib/scripts/hermes_helper.py:23` | `model: str = "glm-4.6v"` (default arg) | `None` + `_default_vision_model()` 内部读 env |

Python 模块级常量会在 import 时固化, 无法运行时切换; 改为函数 `_get_vision_model()` 在每次调用时读 `os.environ.get("ZHIPU_VISION_MODEL", "glm-4.6v")`,与 JS 侧保持一致。

Grep 验证: `grep -rn "glm-4v-flash\|glm-4v\b" lib/ test/` 返回空。

### Commit 3 (c180b35): auditImageVsL1 multimodal + _scoreCache model_version

`lib/continuity-auditor.js` 的 `auditImageVsL1` 完全重写 prompt 构造: 从嵌入 `[${path}]` 字符串改为构造 Array<ContentBlock> — adapter 自动把本地路径转 base64, 视觉模型真正"看到"图片。

**Pitfalls P7 根因修复** — 旧代码把 `[xxx.png]` 作为纯文本传给 GLM-4V,模型基于文件名猜测打分;新代码构造正规 image_url blocks,模型实际处理图像。

`_cacheKey(imagePath, anchorPath, modelVersion)` 加入 `modelVersion` 前缀:`${modelVersion}:${sha256(image+anchor)}`。模型切换时旧 entry 自然 miss → 重新评分(分布可能不同),无需显式迁移。

### Commit 4 (8b6e935): 50-pair golden set baseline 框架

`test/golden-set/` 目录 + 5 个占位 pair + 可执行 runner。每个 pair 的 JSON schema:
```json
{
  "id": "pair-001",
  "anchor_image": "pair-001.anchor.png",
  "generated_image": "pair-001.generated.png",
  "ground_truth": {
    "expected_score_range": [0.85, 0.95],
    "same_identity": true,
    "notes": "..."
  }
}
```

`baseline-runner.mjs` 自动发现 pairs,逐对调 `auditImageVsL1`,输出 `baseline-report.json` + append `baseline-history.jsonl`。无 API key / 图片缺失时自动降级 mock 模式,用 ground-truth 中点 + noise 占位,报告 `_mock: true` 标识。

阈值推荐算法: `recommendThreshold = (p5SameIdentity + p95DiffIdentity) / 2` — 同身份样本 5% 分位 与 不同身份 95% 分位 的中点。

## Deviations from Plan

### Plan-vs-Execution 差异

**1. [Rule 1 - Bug] `first-director.js` 文件名错误 + 非 vision model**

- **Found during:** Commit 2 (D1-02 model unification)
- **Issue:** CONTEXT.md 列出 `lib/first-director.js` 作为目标, 但:
  - 实际文件名是 `lib/1st-director.js` (不是 `first-director.js`)
  - 该文件仅使用 `glm-5.1` 文本模型, **完全无视觉模型引用**
- **Fix:** 跳过该文件(不在范围内)。CONTEXT.md 的清单存在两处事实错误。
- **Files modified:** 无(正确地不动)
- **Commit:** d0673c6

**2. [Rule 1 - Bug] `scene-bible.js` 无 vision model 引用**

- **Found during:** Commit 2
- **Issue:** CONTEXT.md 列出 `lib/scene-bible.js` 包含 `'glm-4v'`,但 grep 显示该文件只使用 `jimeng-5.0` (即梦图像生成模型, 非 LLM)。
- **Fix:** 跳过该文件。
- **Commit:** d0673c6

**3. [Rule 2 - Auto-add missing critical] `callLLMJson` 签名不一致**

- **Found during:** Commit 1 设计阶段
- **Issue:** 既有 `callLLMJson(string, options)` 调用方(phases/index.js, topic-generation),又有 `callLLMJson({prompt, system})` 调用方(continuity-auditor, script-auditor, cn-compliance, murch-scoring)。旧实现仅接受第一种签名。
- **Fix:** `_normalizeCallArgs(arg1, arg2)` 同时支持 `(prompt, options)` 和 `(optionsObject)` 形式。
- **Files modified:** lib/hermes-adapter.js
- **Commit:** 4cbe4ee

**4. [Out of scope] `lib/gate-config.yaml:69` `glm-4-flash` (非视觉模型)**

- **Found during:** Commit 2
- **Issue:** 该 YAML 是 first_director 文本路由的配置, `glm-4-flash` 不是视觉模型。Pitfalls P7 列出但实际是 false positive。
- **Fix:** 不动(scope boundary — 不是视觉模型, 不在 D1 范围内)。

## Known Stubs / Deferred Items

**1. Golden set 真实图片占位**
- **Where:** `test/golden-set/pairs/pair-00*.png` 不存在(5 个 JSON 引用的图片文件未放置)
- **Why:** Phase 19 交付框架, 实际图片需要 operator 从 projects/ 挑选 L1 锚点 + 同角色生成图
- **Impact:** baseline-runner 自动降级 mock 模式; 真实 baseline 需 operator 操作
- **Future resolve:** operator 补 45 对剩余样本 + 首次真实 baseline 运行

**2. Real API key 验证**
- **Where:** 所有 mock 测试跳过了真实 API 调用
- **Why:** 执行环境无 `ZHIPU_API_KEY` (Pitfalls P7 第 6 条要求 "Test against real API key before merge")
- **Impact:** 单元测试覆盖了 payload 构造 / 路由 / 错误处理, 但未验证 GLM-4.6v 实际返回
- **Future resolve:** operator 在 staging 环境运行 baseline-runner 一次, 确认 distribution 合理

**3. Cache 迁移脚本**
- **Where:** `_scoreCache` 旧 entry (无 model_version 前缀) 不会被自动删除,仅不再被新模型命中
- **Why:** 旧 entry 在切回旧模型时仍可用(向前兼容), 删除反而损失信息
- **Impact:** 缓存文件可能略大; 不影响功能
- **Future resolve:** 如果出现性能问题, 可加一次性 GC

## TDD Gate Compliance

This plan did not use the strict TDD plan-level gate (`type: tdd`), but each commit followed a test-first mental model where applicable:
- Commit 1: 20 unit tests cover multimodal routing + imagePathToDataUrl
- Commit 3: 10 unit tests cover auditImageVsL1 multimodal + cache key divergence
- Commit 4: 13 unit tests cover baseline-runner mechanics + e2e mock run

Total: **43 new tests, all green**. Pre-existing 165 tests still green (zero regression).

## Performance / Cost Notes

- multimodal payload 自动转 base64 增加单次请求体积(~33% 图片大小); 智谱 GLM-4.6v 单次请求 ≤ 10MB(文档),大图需调用方自行 resize
- baseline-runner 单对 ~1-3s (真实 API), 50 对预计 1-3 分钟
- _scoreCache 命中时 0ms(读内存); miss 时 ~1-3s 调用 API

## Self-Check: PASSED

### Files created — verified exist

- ✅ `test/phases/hermes-adapter-multimodal.test.mjs`
- ✅ `test/phases/continuity-auditor-multimodal.test.mjs`
- ✅ `test/phases/golden-set-baseline.test.mjs`
- ✅ `test/golden-set/README.md`
- ✅ `test/golden-set/baseline-runner.mjs`
- ✅ `test/golden-set/pairs/pair-00[1-5].json` (5 files)

### Files modified — verified

- ✅ `lib/hermes-adapter.js`
- ✅ `lib/continuity-auditor.js`
- ✅ `lib/quality-gate.js`
- ✅ `lib/scripts/scene-evaluator.py`
- ✅ `lib/scripts/anatomy-validator.py`
- ✅ `lib/scripts/hermes_helper.py`

### Commits — verified in git log

- ✅ `4cbe4ee` feat(19-D1-01): callLLM/callLLMJson multimodal refactor + imagePathToDataUrl
- ✅ `d0673c6` refactor(19-D1-02): unify 5 hardcoded vision model names → ZHIPU_VISION_MODEL env
- ✅ `c180b35` feat(19-D1-01/D1-04): auditImageVsL1 multimodal + _scoreCache model_version
- ✅ `8b6e935` feat(19-D1-03): 50-pair golden set baseline framework (mock-mode)

### Test suite — verified green

```
208 tests / 208 pass / 0 fail
duration: ~10.3s
```
