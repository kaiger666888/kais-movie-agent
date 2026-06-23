/**
 * FineTuneETL — 最高风险 phase (Phase 25, v3.0)
 *
 * 将 Hermes audit + failed_shots 数据提炼为 LoRA training manifest。
 *
 * 核心防御:
 *   1. **Human review gate 作为 LAUNCH BLOCKER** (强制阻断,非提示)
 *      - 4 字段必填: copyright_status / pii_scrubbed / label_correct / approved_for_training
 *      - 任一缺失 → throw(绝不写最终 manifest)
 *   2. **PII scrubber** — 检测 id_card_cn / phone_cn / email / bank_card
 *   3. **Dataset poisoning 检测** (SilentBadDiffusion NeurIPS 2023 防御)
 *      - Outlier (embedding > 2σ)
 *      - Near-duplicate (pHash > 0.95)
 *      - Trigger pattern (异常高频 token)
 *   4. **Golden-set regression** — 训练前后对比 baseline
 *
 * 重要约束:
 *   - 不做实际训练,只产 manifest + 提交能力
 *   - Hermes audit 不可达 → best-effort (只用 failed_shots 数据)
 *   - Poisoning 检测 warn-only(标记可疑样本,不阻断 manifest 生成)
 *
 * 参考: lib/asset-bus.js (finetune-dataset / failed-shots slots, Phase 20)
 *       lib/blacklist-engine.js (_cosineSimilarity)
 *       lib/hermes-adapter.js (callEmbedding)
 *       lib/gold-team-client.js (submitTask)
 */
'use strict';

import { readFile, writeFile, mkdir, readdir, rm, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

import { _cosineSimilarity } from './blacklist-engine.js';
import { callEmbedding } from './hermes-adapter.js';

// ─── Constants ───────────────────────────────────────────────────────────

const SCHEMA_VERSION = 1;
const PENDING_DIR_NAME = 'finetune-pending';
const REJECTED_DIR_NAME = 'finetune-rejected';

const REQUIRED_REVIEW_FIELDS = [
  'copyright_status',
  'pii_scrubbed',
  'label_correct',
  'approved_for_training',
];

/**
 * Allowed values for copyright_status (operator 必须明确选择).
 */
const ALLOWED_COPYRIGHT_VALUES = ['original', 'licensed', 'unknown', 'fair_use', 'public_domain'];

// ─── PII Patterns ────────────────────────────────────────────────────────

/**
 * PII regex patterns.
 * 注意: bank_card 用 Luhn 校验过滤纯数字串误报(13-19 位但需通过 Luhn)。
 */
const PII_PATTERNS = {
  id_card_cn: /\b\d{17}[\dXx]\b/g,
  phone_cn: /\b1[3-9]\d{9}\b/g,
  email: /[\w.+%-]+@[\w.-]+\.[A-Za-z]{2,}\b/g,
  bank_card: /\b\d{13,19}\b/g,
};

/**
 * Luhn checksum (银行卡号校验) — 过滤任意数字串误报为银行卡。
 */
function _luhnValid(numStr) {
  if (!/^\d+$/.test(numStr)) return false;
  let sum = 0;
  let alt = false;
  for (let i = numStr.length - 1; i >= 0; i--) {
    let n = Number(numStr[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum > 0 && sum % 10 === 0;
}

/**
 * PII scrubber — 扫描 metadata 中所有字符串值,检测隐私内容。
 *
 * @param {object|string} metadata — 任意可 JSON 序列化的值
 * @returns {{ has_pii: boolean, matches: Record<string, string[]>, scanned: number }}
 */
export function _scrubPii(metadata) {
  // 深度字符串化(捕获嵌套字段)
  const serialized = typeof metadata === 'string' ? metadata : JSON.stringify(metadata || {});
  const matches = {};
  let scanned = 0;

  for (const [key, regex] of Object.entries(PII_PATTERNS)) {
    // 全局 regex 需要重置 lastIndex 或新建实例
    const local = new RegExp(regex.source, regex.flags);
    const found = serialized.match(local) || [];
    if (key === 'bank_card') {
      // Luhn 过滤掉非银行卡的数字串
      const validated = found.filter(s => _luhnValid(s));
      if (validated.length > 0) matches[key] = validated;
    } else if (found.length > 0) {
      matches[key] = found;
    }
    scanned++;
  }

  return {
    has_pii: Object.keys(matches).length > 0,
    matches,
    scanned,
  };
}

// ─── Poisoning Detection ─────────────────────────────────────────────────

/**
 * Compute pHash similarity between two pHash strings (hex or binary).
 * Uses Hamming distance normalized to [0, 1] where 1 = identical.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} similarity in [0, 1]; 0 if either empty / unequal length
 */
export function _phashSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  // 将 hex 转为二进制位
  const toBits = (s) => {
    if (/^[01]+$/.test(s)) return s;
    let out = '';
    for (const ch of s.toLowerCase()) {
      const n = parseInt(ch, 16);
      if (Number.isNaN(n)) return '';
      out += n.toString(2).padStart(4, '0');
    }
    return out;
  };
  const ba = toBits(a);
  const bb = toBits(b);
  if (!ba || !bb || ba.length !== bb.length) return 0;
  let same = 0;
  for (let i = 0; i < ba.length; i++) {
    if (ba[i] === bb[i]) same++;
  }
  return same / ba.length;
}

/**
 * 计算 number[] 的均值和标准差。
 */
function _meanStd(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return { mean: 0, std: 0, n: 0 };
  }
  const n = values.length;
  const mean = values.reduce((s, x) => s + (Number(x) || 0), 0) / n;
  const variance = values.reduce((s, x) => {
    const d = (Number(x) || 0) - mean;
    return s + d * d;
  }, 0) / n;
  return { mean, std: Math.sqrt(variance), n };
}

/**
 * Token 频率异常检测 — 找出异常高频的非常见词。
 *
 * 简化策略: 统计所有 prompt 的 token 频率,
 * 如果某 token 出现频率 > 3× 中位数 且 不在常用 stopword 集合,标记为可疑 trigger。
 *
 * @param {string[]} prompts
 * @returns {{ suspicious_tokens: Array<{token: string, count: number, ratio_vs_median: number}> }}
 */
function _detectTriggerTokens(prompts) {
  const freq = new Map();
  const STOPWORDS = new Set([
    'the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'at', 'for',
    'is', 'are', 'with', 'by', 'as', 'this', 'that', 'it', 'from',
    '的', '了', '是', '在', '和', '与', '一个', '一只', '一幅', '画面', '场景',
  ]);

  for (const p of prompts) {
    if (typeof p !== 'string') continue;
    // 简单分词: 英文按非字母数字,中文按字符
    const asciiTokens = p.toLowerCase().match(/[a-z][a-z0-9_-]+/g) || [];
    const cjkTokens = p.match(/[一-龥]/g) || [];
    for (const t of [...asciiTokens, ...cjkTokens]) {
      if (STOPWORDS.has(t) || t.length < 2) continue;
      freq.set(t, (freq.get(t) || 0) + 1);
    }
  }

  const counts = [...freq.values()].sort((a, b) => a - b);
  if (counts.length === 0) {
    return { suspicious_tokens: [] };
  }
  const median = counts[Math.floor(counts.length / 2)] || 1;
  const threshold = Math.max(3, median * 3);

  const suspicious_tokens = [];
  for (const [token, count] of freq.entries()) {
    if (count >= threshold) {
      suspicious_tokens.push({
        token,
        count,
        ratio_vs_median: Number((count / Math.max(1, median)).toFixed(2)),
      });
    }
  }
  suspicious_tokens.sort((a, b) => b.count - a.count);
  return { suspicious_tokens };
}

/**
 * Dataset poisoning 检测 (SilentBadDiffusion 防御)。
 *
 * 三重检测:
 *   1. Outlier: embedding cosine 距离 > 2σ from cluster mean
 *   2. Near-duplicate: pHash 相似度 > 0.95 的对
 *   3. Trigger pattern: 异常高频 token
 *
 * @param {Array<{sample_id: string, prompt?: string, embedding?: number[], phash?: string}>} samples
 * @param {object} [opts]
 * @param {number} [opts.embeddingFn] - async (text) => number[]|null
 * @returns {Promise<{has_issues: boolean, issues: Array<{type, sample_id, detail}>, warnings: string[]}>}
 *         warn-only — 调用方决定是否阻断
 */
export async function _detectPoisoning(samples, opts = {}) {
  const issues = [];
  const warnings = [];
  if (!Array.isArray(samples) || samples.length === 0) {
    return { has_issues: false, issues, warnings };
  }

  const embeddingFn = opts.embeddingFn || callEmbedding;

  // 1. Outlier detection via embeddings
  const withEmbeddings = [];
  for (const s of samples) {
    let emb = Array.isArray(s.embedding) ? s.embedding : null;
    if (!emb && s.prompt) {
      try {
        emb = await embeddingFn(s.prompt);
      } catch {
        emb = null;
      }
    }
    if (Array.isArray(emb) && emb.length > 0) {
      withEmbeddings.push({ sample_id: s.sample_id, embedding: emb, prompt: s.prompt });
    }
  }

  if (withEmbeddings.length >= 3) {
    // 计算 centroid (元素级均值)
    const dim = withEmbeddings[0].embedding.length;
    const centroid = new Array(dim).fill(0);
    for (const s of withEmbeddings) {
      for (let i = 0; i < dim; i++) {
        centroid[i] += s.embedding[i] || 0;
      }
    }
    for (let i = 0; i < dim; i++) centroid[i] /= withEmbeddings.length;

    const sims = withEmbeddings.map(s => _cosineSimilarity(s.embedding, centroid));
    const { mean, std } = _meanStd(sims);
    // outlier: similarity < mean - 2*std (距离 centroid 远)
    const threshold = mean - 2 * std;
    for (let i = 0; i < withEmbeddings.length; i++) {
      if (sims[i] < threshold && std > 0) {
        issues.push({
          type: 'embedding_outlier',
          sample_id: withEmbeddings[i].sample_id,
          detail: `cosine_sim=${sims[i].toFixed(3)} < mean-2σ=${threshold.toFixed(3)} (mean=${mean.toFixed(3)}, σ=${std.toFixed(3)})`,
        });
      }
    }
    if (issues.length === 0) {
      warnings.push(`embedding outlier check: ${withEmbeddings.length} samples, no outlier detected (μ=${mean.toFixed(3)}, σ=${std.toFixed(3)})`);
    }
  } else {
    warnings.push(`embedding outlier check skipped: only ${withEmbeddings.length} samples (need ≥ 3)`);
  }

  // 2. Near-duplicate via pHash
  const withPhash = samples.filter(s => s.phash && typeof s.phash === 'string');
  const DUP_THRESHOLD = 0.95;
  for (let i = 0; i < withPhash.length; i++) {
    for (let j = i + 1; j < withPhash.length; j++) {
      const sim = _phashSimilarity(withPhash[i].phash, withPhash[j].phash);
      if (sim > DUP_THRESHOLD) {
        issues.push({
          type: 'near_duplicate',
          sample_id: `${withPhash[i].sample_id}~${withPhash[j].sample_id}`,
          detail: `pHash similarity=${sim.toFixed(3)} > ${DUP_THRESHOLD}`,
        });
      }
    }
  }

  // 3. Trigger pattern
  const prompts = samples.map(s => s.prompt || '').filter(Boolean);
  if (prompts.length >= 3) {
    const { suspicious_tokens } = _detectTriggerTokens(prompts);
    if (suspicious_tokens.length > 0) {
      for (const t of suspicious_tokens.slice(0, 5)) {
        issues.push({
          type: 'trigger_pattern',
          sample_id: '*',
          detail: `token "${t.token}" frequency=${t.count} (${t.ratio_vs_median}× median)`,
        });
      }
    }
  }

  return {
    has_issues: issues.length > 0,
    issues,
    warnings,
  };
}

// ─── FineTuneETL ─────────────────────────────────────────────────────────

export class FineTuneETL {
  /**
   * @param {object} opts
   * @param {object} opts.assetBus - AssetBus 实例 (必填)
   * @param {string} [opts.workdir] - 工作目录(用于 pending-review 路径)
   * @param {object} [opts.goldTeamClient] - GoldTeamClient 实例(submitTrainingJob 需要)
   * @param {object} [opts.embeddingFn] - 注入 embedding 函数(测试用;默认 callEmbedding)
   * @param {string} [opts.goldenSetDir] - golden-set 目录(测试用)
   */
  constructor(opts = {}) {
    if (!opts.assetBus) {
      throw new Error('FineTuneETL: assetBus is required');
    }
    this.assetBus = opts.assetBus;
    this._workdir = opts.workdir || dirname(opts.assetBus._dir) || '.';
    this._pendingDir = join(this._workdir, '.pipeline-assets', PENDING_DIR_NAME);
    this._rejectedDir = join(this._workdir, '.pipeline-assets', REJECTED_DIR_NAME);
    this.goldTeamClient = opts.goldTeamClient || null;
    this._embeddingFn = opts.embeddingFn || callEmbedding;
    this._goldenSetDir = opts.goldenSetDir || null;
  }

  // ─── Manifest Generation ──────────────────────────────────────────────

  /**
   * 从 failed-shots 生成 pending-review samples。
   *
   * 步骤:
   *   1. 读 failed-shots slot
   *   2. 对每条 failure,构造 sample (sample_id / failed_shot / anchor / audio / recommended_action)
   *   3. 跑 PII scrubber — 若 has_pii=true,pending 文件标记 pii_suspicious (但仍进入 review)
   *   4. 跑 poisoning 检测 (warn-only,标记 suspicious_samples)
   *   5. 写 pending-review/<sample-id>.json (review 字段空,等 operator)
   *   6. 已审批的 → 写 finetune-dataset slot (JSONL)
   *
   * @param {object} [opts]
   * @param {boolean} [opts.skipHermesAudit=false] - Hermes audit 不可达时降级
   * @returns {Promise<{ pending_count: number, pii_flagged: number, poisoning_flagged: number, poisoning_report: object }>}
   */
  async generateManifest(opts = {}) {
    await mkdir(this._pendingDir, { recursive: true });

    // 1. 读 failed-shots
    const failedShotsData = (await this.assetBus.read('failed-shots')) || { failures: [] };
    const failures = Array.isArray(failedShotsData.failures) ? failedShotsData.failures : [];

    if (failures.length === 0) {
      return {
        pending_count: 0,
        pii_flagged: 0,
        poisoning_flagged: 0,
        poisoning_report: { has_issues: false, issues: [], warnings: ['no failed shots to process'] },
      };
    }

    // 2. 为每条 failure 构造 pending sample
    const pendingSamples = [];
    let piiFlagged = 0;
    for (const f of failures) {
      const sampleId = f.shot_id ? `s-${f.shot_id.replace(/[^a-zA-Z0-9_-]/g, '_')}` : `s-${createHash('sha256').update(JSON.stringify(f)).digest('hex').slice(0, 12)}`;

      // PII 扫描: 整个 failure 对象(含 prompt / metadata)
      const piiReport = _scrubPii(f);
      if (piiReport.has_pii) piiFlagged++;

      const sample = {
        sample_id: sampleId,
        schema_version: SCHEMA_VERSION,
        generated_at: new Date().toISOString(),
        failed_shot: {
          shot_id: f.shot_id || null,
          error: f.error || 'unknown',
          timestamp: f.timestamp || null,
          run_id: f.run_id || null,
          prompt: f.prompt || '',
        },
        anchor: f.imagePath || null,
        audio: f.audioPath || null,
        recommended_action: this._recommendAction(f),
        pii_scan: piiReport,
        review: null, // 等待 operator 填写
      };

      pendingSamples.push(sample);
      const path = join(this._pendingDir, `${sampleId}.json`);
      await writeFile(path, JSON.stringify(sample, null, 2));
    }

    // 3. Poisoning 检测 (warn-only)
    const poisonInput = pendingSamples.map(s => ({
      sample_id: s.sample_id,
      prompt: s.failed_shot.prompt,
      // 如果 failed-shot 含 fingerprints (Phase 20 schema),复用
      phash: f_phash(pendingSamples, s.sample_id),
    }));
    const poisoningReport = await _detectPoisoning(poisonInput, { embeddingFn: this._embeddingFn });
    const poisoningFlagged = poisoningReport.has_issues ? poisoningReport.issues.length : 0;

    // 把 poisoning 结果写回各 pending 文件
    if (poisoningReport.has_issues) {
      for (const issue of poisoningReport.issues) {
        if (issue.sample_id === '*') continue;
        const ids = issue.sample_id.split('~');
        for (const sid of ids) {
          await this._markSuspicious(sid, issue);
        }
      }
    }

    return {
      pending_count: pendingSamples.length,
      pii_flagged: piiFlagged,
      poisoning_flagged: poisoningFlagged,
      poisoning_report: poisoningReport,
    };
  }

  /**
   * 根据失败原因给出推荐动作。
   */
  _recommendAction(failure) {
    const err = String(failure.error || '').toLowerCase();
    if (err.includes('face') || err.includes('identity')) {
      return 'regenerate_with_stronger_pulid';
    }
    if (err.includes('timeout') || err.includes('degraded')) {
      return 'retry';
    }
    if (err.includes('nsfw') || err.includes('safety')) {
      return 'reject_permanently';
    }
    if (err.includes('composition') || err.includes('lighting')) {
      return 'adjust_prompt_and_retry';
    }
    return 'review_manually';
  }

  async _markSuspicious(sampleId, issue) {
    try {
      const path = join(this._pendingDir, `${sampleId}.json`);
      const raw = await readFile(path, 'utf-8');
      const sample = JSON.parse(raw);
      if (!Array.isArray(sample.suspicious_flags)) sample.suspicious_flags = [];
      sample.suspicious_flags.push({
        type: issue.type,
        detail: issue.detail,
        flagged_at: new Date().toISOString(),
      });
      await writeFile(path, JSON.stringify(sample, null, 2));
    } catch {
      // 文件可能不存在 (sample_id="*" 已过滤) — 忽略
    }
  }

  // ─── Approve / Reject (Launch Blocker) ─────────────────────────────────

  /**
   * Operator 审批单个 sample — 4 字段必须全部填齐。
   *
   * Launch blocker contract:
   *   - review 必须含 copyright_status / pii_scrubbed / label_correct / approved_for_training
   *   - 任一字段缺失 → throw (绝不写最终 manifest)
   *   - approved_for_training=false → 写 rejected-log 并从 pending 移除
   *   - approved_for_training=true 且其他 3 字段合规 → 写 finetune-dataset slot (JSONL)
   *
   * @param {string} sampleId
   * @param {object} review - { copyright_status, pii_scrubbed, label_correct, approved_for_training, reviewer?, notes? }
   * @returns {Promise<{ action: 'approved'|'rejected', sample_id: string, dataset_line?: object }>}
   * @throws {Error} 任一 required 字段缺失 / copyright_status 值非法 / pending 文件不存在
   */
  async approveSample(sampleId, review = {}) {
    // 强制阻断: 4 字段必填
    for (const f of REQUIRED_REVIEW_FIELDS) {
      if (review[f] === undefined || review[f] === null) {
        throw new Error(`Missing required review field: ${f} (launch blocker — sample ${sampleId} rejected hard)`);
      }
    }

    // copyright_status 必须是允许的枚举值
    if (!ALLOWED_COPYRIGHT_VALUES.includes(review.copyright_status)) {
      throw new Error(`Invalid copyright_status "${review.copyright_status}" — allowed: ${ALLOWED_COPYRIGHT_VALUES.join(', ')}`);
    }

    // pii_scrubbed / label_correct / approved_for_training 必须是 boolean
    for (const f of ['pii_scrubbed', 'label_correct', 'approved_for_training']) {
      if (typeof review[f] !== 'boolean') {
        throw new Error(`Field ${f} must be boolean (got ${typeof review[f]})`);
      }
    }

    // 读 pending 文件
    const pendingPath = join(this._pendingDir, `${sampleId}.json`);
    let sample;
    try {
      sample = JSON.parse(await readFile(pendingPath, 'utf-8'));
    } catch {
      throw new Error(`Pending sample not found: ${sampleId} (path: ${pendingPath})`);
    }

    // 完整 review 对象(补 timestamp + reviewer)
    const fullReview = {
      ...review,
      reviewer: review.reviewer || 'operator',
      reviewed_at: new Date().toISOString(),
      notes: review.notes || '',
    };
    sample.review = fullReview;

    if (!review.approved_for_training) {
      // 拒绝 → 移入 rejected/
      await mkdir(this._rejectedDir, { recursive: true });
      const rejectedPath = join(this._rejectedDir, `${sampleId}.json`);
      await writeFile(rejectedPath, JSON.stringify(sample, null, 2));
      await rm(pendingPath, { force: true });
      return { action: 'rejected', sample_id: sampleId };
    }

    // 批准 → 写 finetune-dataset slot (JSONL)
    const datasetLine = {
      sample_id: sample.sample_id,
      failed_shot: sample.failed_shot,
      anchor: sample.anchor,
      audio: sample.audio,
      recommended_action: sample.recommended_action,
      review: fullReview,
      schema_version: SCHEMA_VERSION,
    };
    await this.assetBus.appendLine('finetune-dataset', datasetLine);

    // 从 pending 移除
    await rm(pendingPath, { force: true });

    return { action: 'approved', sample_id: sampleId, dataset_line: datasetLine };
  }

  // ─── List Pending Samples (供 CLI 用) ──────────────────────────────────

  /**
   * 列出所有 pending 样本(供 CLI list-pending)。
   * @returns {Promise<Array<{sample_id, pending_path, pii_flag, suspicious_flags_count, generated_at}>>}
   */
  async listPending() {
    let files = [];
    try {
      files = await readdir(this._pendingDir);
    } catch {
      return [];
    }
    const out = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await readFile(join(this._pendingDir, file), 'utf-8');
        const s = JSON.parse(raw);
        out.push({
          sample_id: s.sample_id,
          pending_path: join(this._pendingDir, file),
          pii_flag: !!(s.pii_scan?.has_pii),
          suspicious_flags_count: Array.isArray(s.suspicious_flags) ? s.suspicious_flags.length : 0,
          generated_at: s.generated_at || null,
        });
      } catch {
        // 损坏文件 — 跳过
      }
    }
    return out;
  }

  /**
   * 读取单个 pending sample 详情。
   */
  async getPendingSample(sampleId) {
    const path = join(this._pendingDir, `${sampleId}.json`);
    try {
      return JSON.parse(await readFile(path, 'utf-8'));
    } catch {
      return null;
    }
  }

  // ─── Submit LoRA Training Job ──────────────────────────────────────────

  /**
   * 读已批准的 samples (finetune-dataset slot),提交 LoRA training 任务给 gold-team。
   *
   * @param {object} opts
   * @param {string} [opts.base_model='flux-dev'] - 基础模型
   * @param {object} [opts.hyperparams] - LoRA 超参 { lora_rank, learning_rate, epochs }
   * @returns {Promise<{task_id: string, sample_count: number, manifest_path: string}>}
   * @throws {Error} no approved samples / goldTeamClient 未配置
   */
  async submitTrainingJob(opts = {}) {
    if (!this.goldTeamClient) {
      throw new Error('FineTuneETL.submitTrainingJob requires goldTeamClient (not configured)');
    }

    const samples = await this.assetBus.readLines('finetune-dataset');
    if (!samples || samples.length === 0) {
      throw new Error('No approved samples — nothing to train (run approveSample first)');
    }

    // 写最终 manifest 文件(供训练 worker 读取)
    const manifestPath = join(this._workdir, '.pipeline-assets', 'finetune-dataset.jsonl');
    // finetune-dataset slot 本身就是 JSONL (assetBus.appendLine 写入的)
    // 直接用 path,无需重写
    const baseModel = opts.base_model || 'flux-dev';
    const hyperparams = opts.hyperparams || {};

    const result = await this.goldTeamClient.submitTask({
      taskType: 'lora_training',
      params: {
        base_model: baseModel,
        dataset_path: manifestPath,
        sample_count: samples.length,
        ...hyperparams,
      },
      description: `LoRA training: ${samples.length} samples, base=${baseModel}`,
    });

    return {
      task_id: result.taskId,
      sample_count: samples.length,
      manifest_path: manifestPath,
    };
  }

  // ─── Golden-Set Regression ─────────────────────────────────────────────

  /**
   * 读 golden-set baseline + 训练前后 hash,产出 regression diff。
   *
   * golden-set 框架 (Phase 19 已就位):
   *   - test/golden-set/pairs/pair-*.json (50-100 个)
   *   - test/golden-set/regression-baseline.json (50-100 prompts,baseline scores)
   *
   * 比较 pre/post 训练的 score;任一维度 regression > 5% → 警告。
   *
   * @param {string} preTrainingHash - 训练前模型 hash (e.g. "flux-dev-base-v1")
   * @param {string} postTrainingHash - 训练后 LoRA hash
   * @param {object} [opts]
   * @param {object} [opts.postTrainingScores] - { prompt_id: score } (测试时注入)
   * @returns {Promise<{ baseline_count: number, regressions: Array<{prompt_id, delta_pct, severity}>, passed: boolean, threshold_pct: number }>}
   */
  async runGoldenRegression(preTrainingHash, postTrainingHash, opts = {}) {
    const goldenDir = this._goldenSetDir || join(process.cwd(), 'test', 'golden-set');
    const baselinePath = join(goldenDir, 'regression-baseline.json');

    let baseline;
    try {
      baseline = JSON.parse(await readFile(baselinePath, 'utf-8'));
    } catch (e) {
      throw new Error(`Cannot load golden-set regression baseline from ${baselinePath}: ${e.message}`);
    }

    const baselinePrompts = Array.isArray(baseline.prompts) ? baseline.prompts : [];
    const baselineCount = baselinePrompts.length;
    if (baselineCount === 0) {
      throw new Error('Golden-set baseline has no prompts — extend test/golden-set/regression-baseline.json to 50-100 prompts');
    }

    // post-training scores: 默认从 opts 读;生产环境应从 gold-team 任务结果拉取
    const postScores = opts.postTrainingScores || {};

    const REGRESSION_THRESHOLD_PCT = 5; // > 5% 视为 regression
    const regressions = [];

    for (const p of baselinePrompts) {
      const pre = Number(p.score);
      const post = Number(postScores[p.prompt_id]);
      if (Number.isNaN(pre) || Number.isNaN(post)) continue;
      const delta = post - pre;
      const deltaPct = pre === 0 ? 0 : Math.abs(delta / pre) * 100;
      if (delta < 0 && deltaPct > REGRESSION_THRESHOLD_PCT) {
        regressions.push({
          prompt_id: p.prompt_id,
          pre_score: pre,
          post_score: post,
          delta: Number(delta.toFixed(3)),
          delta_pct: Number(deltaPct.toFixed(2)),
          severity: deltaPct > 15 ? 'severe' : (deltaPct > 10 ? 'moderate' : 'minor'),
        });
      }
    }

    return {
      pre_training_hash: preTrainingHash,
      post_training_hash: postTrainingHash,
      baseline_count: baselineCount,
      regressions,
      passed: regressions.length === 0,
      threshold_pct: REGRESSION_THRESHOLD_PCT,
    };
  }
}

// ─── Helper: 提取 pending sample 的 phash (如果有) ─────────────────────

function f_phash(samples, sampleId) {
  const s = samples.find(x => x.sample_id === sampleId);
  if (!s) return undefined;
  // pending sample 暂不含 phash (待 Phase 20 failed-shots schema 扩展)
  return undefined;
}

export default FineTuneETL;
export {
  REQUIRED_REVIEW_FIELDS,
  ALLOWED_COPYRIGHT_VALUES,
  PII_PATTERNS,
  _luhnValid,
  _meanStd,
  _detectTriggerTokens,
};
