# Golden Set — 视觉评分基线校准

## 目的 (D1-03)

GLM-4V → GLM-4.6V 模型升级 (Phase 19 D1) 的评分基线校准集。

每次视觉模型升级 / 阈值调整前,必须:
1. 用 baseline-runner 跑此 50 对样本集
2. 输出 `baseline-report.json` 含 score 分布 / 均值 / 标准差 / 时延
3. 与历史 baseline 对比;如均值漂移 > 0.1 或 std > 0.15,需重新校准阈值

## 目录结构

```
test/golden-set/
├── README.md                      # 本文件
├── pairs/                         # 50 对样本
│   ├── pair-001.json              # 样本元数据(锚点 + 生成图 + ground truth)
│   ├── pair-001.anchor.png        # 角色身份锚点图
│   ├── pair-001.generated.png     # 待评估生成图
│   ├── pair-002.json
│   ├── ...
│   └── pair-050.json
├── baseline-report.json           # 当前 baseline(每次跑生成覆盖)
├── baseline-history.jsonl         # 历史 baseline (append-only)
└── baseline-runner.mjs            # 执行脚本(node test/golden-set/baseline-runner.mjs)
```

## pair JSON schema

```json
{
  "id": "pair-001",
  "character": "主角",
  "anchor_image": "pair-001.anchor.png",
  "generated_image": "pair-001.generated.png",
  "ground_truth": {
    "expected_score_range": [0.85, 0.95],
    "same_identity": true,
    "notes": "标准正面照,光线一致,服装一致"
  }
}
```

- `expected_score_range`: 人工标注的可接受分数区间
- `same_identity`: true=同一角色(应高分),false=不同角色(应低分)
- `notes`: 人工标注说明

## 当前状态 (2026-06-23)

**Phase 19 D1 交付框架 — 样本占位待 operator 补全:**

- ✅ 目录结构 + JSON schema 定义
- ✅ baseline-runner.mjs 执行脚本
- ✅ baseline-report.json 字段定义
- ✅ 5 个 mock pair 样例(用占位 placeholder 说明需 operator 补实际图片)
- ⏳ **TODO operator**: 补全剩余 45 对真实样本(从 projects/ 挑选 + 人工标注)
- ⏳ **TODO operator**: 首次 baseline 运行(需要真实 ZHIPU_API_KEY)

## 运行

```bash
# 设置 API key
export ZHIPU_API_KEY=sk-...

# 跑 baseline
node test/golden-set/baseline-runner.mjs

# 切换模型对比
export ZHIPU_VISION_MODEL=glm-4v-flash
node test/golden-set/baseline-runner.mjs --tag glm-4v-flash
export ZHIPU_VISION_MODEL=glm-4.6v
node test/golden-set/baseline-runner.mjs --tag glm-4.6v
```

## 验收标准 (D1-03)

- [x] baseline-runner.mjs 可独立运行(无 npm install)
- [x] 输出 baseline-report.json 字段定义清晰
- [x] 5 个 mock 样例可运行(实际 API key 缺失时退化为 mock 评分)
- [x] 单元测试: baseline runner 能跑(mock 数据)
- [ ] operator 补全 50 对真实样本 + 首次运行 baseline (deferred to operator)
