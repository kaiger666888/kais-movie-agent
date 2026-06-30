# V6.0 Blueprint: Rapid Convergence Loop (最速收敛闭环)

## 背景

V5.0 SHIPPED（502 tests, 25/25 REQs, 0 openclaw refs）。13步管线完整 Python 化。

但 Notion 第一性原理分析暴露 3 个核心缺口：
1. **极速预览层缺失** — 直接上 Seedance 2.0（3-10min/条），无法做 10 条以内定向赛马
2. **数据回流闭环缺失** — 管线止步于 master.mp4，没有发布→数据→配方反馈
3. **配方库未结构化** — creative-history 有记录但无「结构→完播率」可复用配方

## 第一性原理公式

> 在注意力经济的约束下，以趋近于零的边际成本，完成情绪方程的最速收敛求解与资产化

## V6.0 目标：补齐最速收敛闭环

```
调研萃取 → 配方建模 → 定向赛马 → 数据收敛 → 资产化沉淀
    ↑                                              |
    └──────────────── 数据飞轮 ────────────────────┘
```

### 3 个核心交付物

#### 1. 快速预览层 (Rapid Preview Tier)
- **问题**：当前 p11 video_render 用 dreamina Seedance 2.0，单条 3-10 分钟，无法赛马
- **方案**：在 p10(voice) 和 p11(video_render) 之间插入 **p10b: rapid_preview** phase
- **引擎**：LTX-Video（秒级生成）或 slideshow-style（关键帧+TTS → FFmpeg 合成，<10s）
- **产出**：每个 shot 生成 2-3 个低质量极速预览变体，供结构参数 A/B 赛马
- **AssetBus 新槽**：`preview-clips` (JSONL)

#### 2. 配方库 (Emotion Recipe Library)
- **问题**：script_auditor 5维评分散落在 creative-history JSONL，无结构化配方
- **方案**：新增 `plugins/pipeline_state/recipe_library.py`
- **配方格式**：
  ```json
  {
    "recipe_id": "urban-fantasy-001",
    "version": "1.2",
    "genre": "都市奇幻·轻喜剧",
    "structure": {
      "hook_position_sec": 3,
      "emotion_sequence": ["suppress", "thrill", "doubt", "thrill"],
      "turning_points_sec": [3, 15, 30, 55],
      "emotion_drop_level": 4,
      "ending_state": "new_suspense"
    },
    "validation": {
      "platform": "douyin",
      "completion_rate": 0.48,
      "confidence_interval": "±4%",
      "sample_size": 15,
      "converged": true
    },
    "provenance": {
      "source_episode": "ep-001",
      "created": "2026-06-27",
      "last_validated": "2026-06-27"
    }
  }
  ```
- **AssetBus 新槽**：`emotion-recipe` (JSONL, 追加式)

#### 3. 数据回流接口 (Feedback Ingestion)
- **问题**：管线止步于 master.mp4，无平台数据回流
- **方案**：新增 `plugins/kais_aigc/feedback_ingest.py`
- **接口**：POST /api/v1/feedback — 接收平台数据（完播率/互动率/追播率）
- **动作**：写入 `feedback-data` (JSONL)，触发配方库更新
- **不自动发布**：数据回流只更新配方库评分，不自动修改管线行为（人决策优先）

### 约束

- **降级容忍保留**：预览层不可用时 fallback 到直接 Seedance（但必须报 warning）
- **不改动 V5.0 13步结构**：p10b 是插入，不替换 p11
- **红线门继承**：V5.0 的 4 个红线门在预览层同样生效
- **控制变量**：预览赛马一次只改一个结构参数（Notion 红线 #6）
