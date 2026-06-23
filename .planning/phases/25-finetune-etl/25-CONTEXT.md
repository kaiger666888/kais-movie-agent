# Phase 25: FineTuningETL (最高风险) - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning
**Mode:** Auto-generated (highest-risk phase — discuss skipped, strict launch blockers per research)

<domain>
## Phase Boundary

新增 `lib/finetune-etl.js`,将 Hermes audit + failed_shots 数据提炼为 LoRA training manifest。**最高风险 phase**:数据 poisoning 是不可逆的(Pitfalls 陷阱 6,SilentBadDiffusion NeurIPS 2023),LoRA 不能"打补丁",只能重训。版权/PII 责任在部署后才显现。

**核心交付**:
1. JSONL manifest 产出 `(failed_shot, anchor, audio, recommended_action)`
2. LoRA training 任务提交接口(`gtClient.submitTask({task_type: 'lora_training'})`)
3. **Human review gate 作为 launch blocker**(强制阻断,非提示)
4. PII scrubber
5. Golden-set regression test
6. Dataset poisoning 检测

**关键原则**: v3.0 只产 manifest + 提交能力,实际训练由 operator 触发。

</domain>

<decisions>

## Implementation Decisions

### FineTuneETL API

```javascript
// lib/finetune-etl.js
export class FineTuneETL {
  constructor({ assetBus, workdir, goldTeamClient }) { ... }
  
  /**
   * 从 Hermes audit + failed_shots 生成 JSONL manifest
   * 每个 sample 必须 4 字段齐全(copyright_status, pii_scrubbed, label_correct, approved_for_training)
   * 未审批的 sample 进入 pending-review/,不写入最终 manifest
   */
  async generateManifest() {
    // 1. 读 failed-shots slot
    // 2. 对每条 failure,读对应的 anchor / audio 路径
    // 3. PII scrubber 扫描 metadata
    // 4. Poisoning 检测(outlier)
    // 5. 写 pending-review/<sample-id>.json 等待 operator 审批
    // 6. 已审批的 → 写 finetune-dataset slot (JSONL)
  }
  
  /**
   * Operator 审批单个 sample
   * 4 字段必须全部填,缺一不可
   */
  async approveSample(sampleId, review) {
    const required = ['copyright_status', 'pii_scrubbed', 'label_correct', 'approved_for_training'];
    for (const f of required) {
      if (review[f] === undefined) throw new Error(`Missing required field: ${f}`);
    }
    if (!review.approved_for_training) {
      // 写 rejected-log + 移出 pending
      return;
    }
    // 移入 finetune-dataset slot
  }
  
  /**
   * 提交 LoRA training 任务给 gold-team
   * @returns {task_id}
   */
  async submitTrainingJob(opts) {
    // opts: { base_model, manifest_path, hyperparams }
    const manifest = await this._readApprovedManifest();
    if (!manifest.length) throw new Error('No approved samples — nothing to train');
    
    return this.goldTeamClient.submitTask({
      task_type: 'lora_training',
      params: {
        base_model: opts.base_model || 'flux-dev',
        dataset_path: manifest.path,
        ...hyperparams,
      },
    });
  }
  
  /** Golden-set regression(训练前后跑 baseline 对比) */
  async runGoldenRegression(preTrainingHash, postTrainingHash) {
    // 跑 50-100 known-good prompts,对比 v2.0 baseline
    // 任一维度 regression > 5% → 警告
  }
}

### PII Scrubber

```javascript
// 检测训练数据中的隐私内容:
// - 中文身份证号(18位 regex)
// - 手机号(11位 regex)
// - 邮箱
// - 银行卡号(Luhn 校验)
// - IP 地址(可选)

async function scrubPii(metadata) {
  const patterns = {
    id_card_cn: /\d{17}[\dX]/gi,
    phone_cn: /1[3-9]\d{9}/g,
    email: /[\w.-]+@[\w.-]+\.\w+/g,
    bank_card: /\d{13,19}/g,
  };
  const found = {};
  for (const [key, regex] of Object.entries(patterns)) {
    const matches = JSON.stringify(metadata).match(regex);
    if (matches) found[key] = matches;
  }
  return { has_pii: Object.keys(found).length > 0, matches: found };
}
```

### Dataset Poisoning 检测(SilentBadDiffusion 防御)

```javascript
/**
 * 基于 SilentBadDiffusion (NeurIPS 2023) 论文:
 * - 异常样本 outlier 检测(embedding 距离)
 * - 重复样本检测(exact duplicate / near-duplicate)
 * - Trigger pattern 检测(频繁出现的可疑 token)
 */
async function detectPoisoning(samples) {
  const issues = [];
  
  // 1. Outlier detection: 计算每条样本的 prompt embedding, 与均值距离 > 2σ 标记
  // 2. Near-duplicate: pHash 相似度 > 0.95 的对
  // 3. Trigger pattern: 统计 token 频率,异常高频的非常见词
  
  return { has_issues: issues.length > 0, issues };
}
```

### Human Review Gate(Launch Blocker)

```
pending-review/
├── <sample-id-1>.json
├── <sample-id-2>.json
└── ...

每条 sample 必须含:
{
  sample_id, failed_shot, anchor, audio, recommended_action,
  review: {
    copyright_status: 'original' | 'licensed' | 'unknown',  // 必填
    pii_scrubbed: true | false,                              // 必填
    label_correct: true | false,                              // 必填
    approved_for_training: true | false,                     // 必填,operator 签字
    reviewer: 'operator-name',
    reviewed_at: ISO timestamp,
    notes: '...'
  }
}

operator 审批流程:
1. ETL 写 pending-review/<id>.json(review 字段空)
2. operator 编辑文件填 review
3. operator 调 etl.approveSample(id, review)
4. approveSample 验证 4 字段齐全 → 移入 finetune-dataset slot
5. 任一字段缺失或 approved_for_training=false → 移入 rejected/
```

### Claude's Discretion

- **不做实际训练**: 本 phase 只产 manifest + 提交能力
- **降级**: Hermes audit 不可达 → best-effort,只用 failed_shots 数据
- **回归基线**: 复用 test/golden-set/(Phase 19 框架) + 扩展到 50-100 prompts
- **PII scrubber**: 默认开启,扫描所有 metadata 字段(prompt / description / character / scene)
- **Poisoning 检测**: 默认 warn-only(不阻断 manifest 生成,但标记可疑样本)
- **测试**: mock 数据覆盖 4 字段 / PII 检测 / poisoning 检测 / regression baseline

</decisions>

<code_context>

### Reusable Assets
- `lib/asset-bus.js` finetune-dataset slot (Phase 20 已就位,JSONL append)
- `lib/asset-bus.js` failed-shots slot (Phase 20 + Phase 21 已实化)
- `lib/blacklist-engine.js` _cosineSimilarity (poisoning outlier 检测)
- `lib/gold-team-client.js` submitTask 接口
- `lib/hermes-adapter.js` callEmbedding (poisoning prompt embedding)
- `test/golden-set/` (Phase 19 框架,本 phase 扩展)

### Integration Points
- delivery handler 末尾可选触发 ETL(产出 manifest)
- LoRA training 任务通过 gold-team 提交

</code_context>

<specifics>

- **JSONL manifest**: 每行一个 `{sample_id, failed_shot, anchor, audio, recommended_action, review}`
- **Pending-review 路径**: `<workdir>/.pipeline-assets/finetune-pending/<sample-id>.json`
- **Operator 工具**: `bin/finetune-review.js` CLI(列出 pending / approve / reject)
- **不做**: 不实现在线 learning 或 RLHF 流程

</specifics>

<deferred>

- 实际 LoRA training operator workflow → operator
- RLHF / DPO 升级 → v4.0
- 跨 workdir manifest 合并 → v3.1
- Multi-LoRA composition(same episode 多角色 LoRA) → v4.0

</deferred>
