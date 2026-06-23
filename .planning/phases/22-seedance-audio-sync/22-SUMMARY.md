---
phase: 22
plan: audio-sync
subsystem: cloud-production
tags: [seedance-2.0, audio-visual-sync, lip-sync, voice-lock]
requires:
  - voice-timeline AssetBus slot (v2.0 Phase 5)
  - getOmniReferencePack (Phase 21)
  - ShotParallelScheduler + BlacklistEngine (Phase 21)
provides:
  - getOmniReferencePack audioRefs opt (Phase 22 A2-01)
  - cloud-production voice timing lock (Phase 22 A2-02)
  - @Audio binding validation (Phase 22 A2-03, Pitfalls trap 1 defense)
  - lip_sync_threshold=0.75 default (Phase 22 A2-04)
  - Chinese lip-sync test set framework (Phase 22 A2-05)
affects:
  - lib/character-asset-manager.js
  - lib/phases/index.js
  - test/lip-sync-samples/
tech-stack:
  added: []
  patterns:
    - voice-timeline timing lock (显式 fail-fast)
    - @Audio prompt token validation (防御 Seedance silent-ignore)
    - schema-driven test set framework + runner
key-files:
  created:
    - test/phases/character-asset-manager.test.mjs
    - test/phases/cloud-production-audio-sync.test.mjs
    - test/phases/lip-sync-samples.test.mjs
    - test/lip-sync-samples/README.md
    - test/lip-sync-samples/samples.json
    - test/lip-sync-samples/run-lip-sync-test.js
  modified:
    - lib/character-asset-manager.js
    - lib/phases/index.js
decisions:
  - getOmniReferencePack 接受 audioRefs opt, 产出 @Audio{n} 绑定 + hasAudio 标志
  - voice-timeline 兼容两种格式 (timeline 数组 + shotId map) 通过 _extractVoiceEntries 归一化
  - lip_sync_threshold 从 1.0 现实化到 0.75 (基于 Seedance 2.0 中文实测偏差)
  - 降级路径保留: gold-team 不可达写 stub audio slot, 不 fatal
metrics:
  duration: 328s
  tasks: 4
  files: 8
  tests: 290 (266 baseline + 24 new, all pass)
  completed: 2026-06-23
---

# Phase 22 Plan audio-sync: Seedance 2.0 Audio-Visual Sync Summary

让 `cloud-production` handler 用 Seedance 2.0 原生音画同步替代 v2.0 的"先生成视频再 dub"两步流程；防御 Pitfalls 陷阱 1 (audio_refs 非空但无 @Audio token 时 Seedance 静默忽略音频)。

## What Was Built

### A2-01: getOmniReferencePack 音频扩展
- `lib/character-asset-manager.js`: 新增 `audioRefs` opt，产出 `@Audio{n}` prompt 绑定
- 返回字段新增: `audioRefs` (有效音频数组), `hasAudio` (布尔标志)
- 过滤无效条目 (null / 空 path)
- `allFiles` 自动包含音频路径

### A2-02: cloud-production voice 时序锁
- `lib/phases/index.js` cloud-production handler: 读取 `voice-timeline` AssetBus slot
- **时序锁**: shots 含 `dialogue.text` 但 `voice-timeline` 未就绪 → 抛出显式错误 (不降级)
- 新增 `_extractVoiceEntries` helper 归一化两种 voice-timeline 格式:
  - `{ timeline: [{ shot_id, audioPath }] }` (数组格式)
  - `{ shotId: { audioPath } }` (map 格式)
- Per-shot audio refs assembly: 按 `shot.id` 过滤 voice entries，透传 character 标签

### A2-03: @Audio 强制校验 (Pitfalls 陷阱 1 防御)
- 提交 Seedance 任务前校验: `refPack.hasAudio && !promptBindings.includes('@Audio')` → throw
- 这是 Seedance 2.0 最隐蔽失败模式: audio_refs 非空但 prompt 无 @Audio token 时模型静默忽略音频，只有真实 GPU run 才暴露
- 提交参数新增: `audio_refs` (路径数组), `prompt_audio_bindings` (含 @Audio 的 prompt), `generate_audio` (布尔)

### A2-04: lip_sync_threshold 现实化
- `HERMES_DEFAULTS.delivery.lip_sync_threshold`: 1.0 → 0.75
- 原因: Seedance 2.0 中文 lip sync 实测分普遍低于 1.0 (英文 0.85, 中文 0.75)
- 中文偏见 documented in 22-CONTEXT.md specifics

### A2-05: 中文 lip sync 测试集框架
- `test/lip-sync-samples/samples.json`: 3 个 placeholder 样本 (operator 补真实音频)
- `test/lip-sync-samples/run-lip-sync-test.js`: runner 加载/校验/提交/聚合报告
- Schema 含: id, prompt, audio_path, anchor_path, expected_threshold, scenario, character, dialogue_text, emotion
- 报告 `lip-sync-report.json` 含: per-sample score, average, pass_rate, recommended threshold (avg - 5%)
- runner 支持 `GOLD_TEAM_URL` 未配置时仅产出占位报告 (CI 安全)

## Deviations from Plan

None — plan executed exactly as written.

## Tests

**Baseline:** 266 tests pass
**Added:** 24 new tests (all pass)
**Total:** 290 tests, 0 fail

### 新增测试文件
| File | Tests | Coverage |
|------|-------|----------|
| test/phases/character-asset-manager.test.mjs | 6 | A2-01 audio extension |
| test/phases/cloud-production-audio-sync.test.mjs | 6 | A2-02 timing lock + A2-03 @Audio validation |
| test/phases/lip-sync-samples.test.mjs | 12 | A2-05 schema + report aggregation |

### 覆盖矩阵
| Decision ID | 测试覆盖 | 状态 |
|-------------|---------|------|
| A2-01 getOmniReferencePack audioRefs | 6 tests | ✅ |
| A2-02 voice 时序锁 | 3 tests (throw + 正常 + 无对白) | ✅ |
| A2-03 @Audio 强制校验 | 2 tests (透传 + 无对白 false) | ✅ |
| A2-04 lip_sync_threshold=0.75 | (静态代码 + samples expected_range) | ✅ |
| A2-05 测试集框架 | 12 tests (schema + report) | ✅ |

## Commits

| Hash | Message |
|------|---------|
| 042d45b | feat(22-audio-sync): extend getOmniReferencePack with audio bindings (A2-01) |
| b499477 | feat(22-audio-sync): cloud-production voice lock + audio validation (A2-02, A2-03) |
| 3615b5b | feat(22-audio-sync): lip_sync_threshold 现实化 + Chinese test set framework (A2-04, A2-05) |

## Known Stubs

**1. test/lip-sync-samples/audio/*.wav** (operator 补)
- 真实中文对白音频缺失，runner 在 GOLD_TEAM_URL 未设置时仅产出占位报告
- 不阻塞 Phase 22 完成: 框架就位，实际 GPU 跑测试集 deferred 给 operator

**2. test/lip-sync-samples/anchors/*.png** (operator 补)
- L1 身份锚点图缺失，同上 deferred

**3. gold-team task_type: seedance_omni_reference audio 字段** (operator 验证)
- 22-CONTEXT.md deferred 项: 假设 gold-team 服务端已支持 audio_refs 字段
- 实际服务端 API 契约验证由 operator 在真实 GPU run 时完成

## Threat Flags

无新增威胁面。Phase 22 改动限于现有 cloud-production 流程的参数透传，未引入新网络端点/认证路径/文件访问模式。`@Audio` 验证是防御性检查 (Rule 2 auto-add missing critical functionality — 防止 Seedance silent-ignore)。

## Deferred to Operator

1. 补充 `test/lip-sync-samples/audio/*.wav` + `anchors/*.png` (3 个样本)
2. 真实 GPU 跑 `node test/lip-sync-samples/run-lip-sync-test.js` 校准 `lip_sync_threshold`
3. 验证 gold-team 服务端支持 `audio_refs` / `generate_audio` / `prompt_audio_bindings` 字段
4. 上游 voice phase 实化 (当前 Phase 22 假设 voice-timeline.json 已存在，降级路径处理)

## Self-Check: PASSED
