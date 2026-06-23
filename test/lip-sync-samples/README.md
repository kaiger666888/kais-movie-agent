# 中文 Lip Sync 测试集 (Phase 22 A2-05)

Seedance 2.0 音画同步的中文基准测试集，用于校准 `HERMES_DEFAULTS.delivery.lip_sync_threshold`。

## 状态: 框架就位，实际音频 operator 补

当前 `samples.json` 中 3 个样本为 placeholder：
- `audio/*.wav` — 真实中文对白音频（operator 补）
- `anchors/*.png` — L1 身份锚点图（operator 补）

## 文件结构

```
test/lip-sync-samples/
├── README.md              # 本文件
├── samples.json           # 测试集 metadata (schema 见下)
├── audio/                 # 实际中文对白音频 (operator 补)
│   ├── zh-sample-001.wav
│   ├── zh-sample-002.wav
│   └── zh-sample-003.wav
├── anchors/               # L1 身份锚点图 (operator 补)
│   ├── zh-sample-001.png
│   ├── zh-sample-002.png
│   └── zh-sample-003.png
└── run-lip-sync-test.js   # 运行脚本
```

## samples.json Schema

```json
{
  "_schema_version": "1.0",
  "_language": "zh-CN",
  "_expected_threshold_range": [0.65, 0.85],
  "samples": [
    {
      "id": "string (唯一标识)",
      "prompt": "string (提交给 Seedance 的镜头描述)",
      "audio_path": "string (相对路径 → audio/*.wav)",
      "anchor_path": "string (相对路径 → anchors/*.png, L1 锚点)",
      "expected_threshold": "number (0-1, 期望 lip sync 分数下限)",
      "scenario": "string (场景描述)",
      "character": "string",
      "dialogue_text": "string (对白原文)",
      "emotion": "string (情绪标签)"
    }
  ]
}
```

## 运行测试

```bash
# 1. operator 补充 audio/*.wav + anchors/*.png
# 2. 确保 gold-team 可达 (GOLD_TEAM_URL 环境变量)
# 3. 运行:
node test/lip-sync-samples/run-lip-sync-test.js
# 产出: test/lip-sync-samples/lip-sync-report.json
```

## 报告字段

`lip-sync-report.json`:
- `samples[].score`: 实际 lip sync 分数 (0-1)
- `samples[].passed`: 是否 >= expected_threshold
- `summary.average_score`: 全部样本平均
- `summary.pass_rate`: 通过率
- `recommendation.suggested_threshold`: 基于测试集推荐的 lip_sync_threshold

## 阈值校准依据

- 中文 lip sync 普遍低于英文 (Seedance 2.0 已知偏差)
- 当前默认阈值 `0.75` (Phase 22 A2-04 从 1.0 调整)
- 英文建议 `0.85`，中文建议 `0.75`
- 实际 GPU 跑完测试集后，根据 average_score 调整
