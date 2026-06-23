/**
 * BlacklistEngine — bad case 持久化 + 语义匹配引擎 (Phase 21)
 *
 * 核心能力:
 *   1. record()  — 永久失败的 shot 记录入 AssetBus failed-shots slot,
 *                   顺带写 prompt 的 embedding(供下次语义匹配)
 *   2. check()   — 给定 shot 的 prompt,与历史 failure 做 cosine sim,
 *                   >= threshold (0.92) 视为命中黑名单
 *   3. pruneExpired() — TTL 过期的 failure 清理(默认 30 天)
 *   4. _writeAuditLog() — 所有关键操作落 jsonl 审计日志
 *
 * 降级策略:
 *   - escape hatch: process.env.BLACKLIST_DISABLED=1 或 config.blacklist.disabled=true
 *                   → check() 返回 'disabled' (允许一切)
 *   - GLM/embedding 不可达 → check() 返回 'degraded' (允许一切,pipeline 继续)
 *
 * 集成点:
 *   - ShotParallelScheduler.runWithRetry 在 retry 前调用 check(),
 *     hit → 跳过该 shot (≠ retry、≠ fail)
 *   - cloud-production handler 持久化 permanent failures (via record())
 *
 * 日志: .pipeline-assets/blacklist-audit.jsonl (append-only,每行一个 JSON 对象)
 */
'use strict';

import { appendFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

import { callEmbedding } from './hermes-adapter.js';

const DEFAULT_THRESHOLD = 0.92;
const DEFAULT_TTL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const AUDIT_LOG_NAME = 'blacklist-audit.jsonl';

/**
 * Cosine similarity of two equal-length numeric vectors.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} in [-1, 1]; returns 0 for empty/unequal length
 */
function _cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
    return 0;
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * SHA-256 hash of any string.
 */
function _sha256(s) {
  return createHash('sha256').update(String(s)).digest('hex');
}

export class BlacklistEngine {
  /**
   * @param {object} opts
   * @param {object} opts.assetBus - AssetBus 实例(必填)
   * @param {string} [opts.workdir] - 工作目录(用于 audit log 路径;默认 assetBus._dir 的父目录)
   * @param {number} [opts.threshold=0.92] - 命中阈值
   * @param {number} [opts.ttlDays=30] - TTL 天数
   * @param {boolean} [opts.disabled] - 显式禁用(优先级高于 env)
   * @param {object} [opts.config] - pipeline config(可选,读取 config.blacklist.{disabled,ttl_days,threshold})
   * @param {object} [opts.embeddingFn] - 注入 embedding 函数(测试用;默认 callEmbedding)
   */
  constructor(opts = {}) {
    if (!opts.assetBus) {
      throw new Error('BlacklistEngine: assetBus is required');
    }
    this.assetBus = opts.assetBus;

    // workdir 推断: opts.workdir → assetBus._dir 父目录 → '.'
    this._workdir = opts.workdir || dirname(opts.assetBus._dir) || '.';

    // 配置链: opts → config.blacklist → defaults
    const cfg = opts.config?.blacklist || {};
    this.threshold = opts.threshold ?? cfg.threshold ?? DEFAULT_THRESHOLD;
    this.ttlDays = opts.ttlDays ?? cfg.ttl_days ?? DEFAULT_TTL_DAYS;
    this.ttlMs = this.ttlDays * DAY_MS;

    // 禁用判定: opts.disabled → config → env
    const envDisabled = process.env.BLACKLIST_DISABLED === '1' || process.env.BLACKLIST_DISABLED === 'true';
    this.disabled = opts.disabled === true || cfg.disabled === true || envDisabled;

    // embedding 函数注入(测试用)
    this._embeddingFn = opts.embeddingFn || callEmbedding;

    // audit log 路径: {workdir}/.pipeline-assets/blacklist-audit.jsonl
    this._auditLogPath = join(this._workdir, '.pipeline-assets', AUDIT_LOG_NAME);

    // 内存缓存: failed-shots 数组(首次 check 时加载)
    this._cachedFailures = null;
  }

  // ─── 公开 API ────────────────────────────────────────────────────

  /**
   * 记录一个 failed shot(供下次 run 黑名单匹配)。
   *
   * 步骤:
   *   1. 计算 prompt 的 embedding
   *   2. 读现有 failed-shots envelope
   *   3. 追加新条目 { shot_id, error, timestamp, run_id, prompt, prompt_hash, embedding? }
   *   4. 写回 AssetBus
   *   5. 写 audit log
   *
   * @param {object} entry
   * @param {string} entry.shot_id
   * @param {string} entry.error
   * @param {string} [entry.prompt]
   * @param {string} [entry.imagePath]
   * @param {string} [entry.audioPath]
   * @param {string} [entry.run_id]
   * @returns {Promise<{recorded: boolean, embedding_computed: boolean}>}
   */
  async record(entry = {}) {
    if (this.disabled) {
      await this._writeAuditLog('record_skipped_disabled', { shot_id: entry.shot_id });
      return { recorded: false, embedding_computed: false, reason: 'disabled' };
    }

    const timestamp = new Date().toISOString();
    const prompt = entry.prompt || '';
    const promptHash = prompt ? _sha256(prompt) : null;

    // 计算 embedding(失败也继续记录,只是后续无法语义匹配)
    let embedding = null;
    let embeddingComputed = false;
    if (prompt) {
      embedding = await this._embeddingFn(prompt);
      embeddingComputed = Array.isArray(embedding);
    }

    // 读现有 failures
    const existing = (await this.assetBus.read('failed-shots')) || { failures: [], version: 1 };
    if (!Array.isArray(existing.failures)) existing.failures = [];

    // 去重: 同 prompt_hash 视为同一条(更新 timestamp)
    const dedupedFailures = existing.failures.filter(
      f => !(f.prompt_hash && f.prompt_hash === promptHash && f.shot_id === entry.shot_id),
    );

    const newFailure = {
      shot_id: entry.shot_id,
      error: entry.error || 'unknown',
      timestamp,
      run_id: entry.run_id || null,
      prompt,
      prompt_hash: promptHash,
      ...(entry.imagePath ? { imagePath: entry.imagePath } : {}),
      ...(entry.audioPath ? { audioPath: entry.audioPath } : {}),
      ...(embeddingComputed ? { embedding } : {}),
    };

    dedupedFailures.push(newFailure);
    await this.assetBus.write('failed-shots', { failures: dedupedFailures, version: existing.version || 1 });

    // 失效内存缓存
    this._cachedFailures = null;

    await this._writeAuditLog('record', {
      shot_id: entry.shot_id,
      prompt_hash: promptHash,
      embedding_computed: embeddingComputed,
      failure_count: dedupedFailures.length,
    });

    return { recorded: true, embedding_computed: embeddingComputed };
  }

  /**
   * 检查给定 shot 是否命中黑名单。
   *
   * @param {object} query
   * @param {string} [query.prompt]
   * @param {string} [query.imagePath]
   * @returns {Promise<'hit'|'miss'|'disabled'|'degraded'>}
   */
  async check(query = {}) {
    if (this.disabled) {
      return 'disabled';
    }

    const prompt = query.prompt || '';
    if (!prompt) {
      // 无 prompt → 无法语义匹配,默认 miss
      return 'miss';
    }

    // 加载 + TTL 清理
    const failures = await this._loadAndPruneFailures();
    if (failures.length === 0) {
      return 'miss';
    }

    // 计算 query embedding(失败 → degraded)
    const queryVec = await this._embeddingFn(prompt);
    if (!Array.isArray(queryVec)) {
      await this._writeAuditLog('check_degraded_no_embedding', {
        prompt_hash: _sha256(prompt),
        failure_count: failures.length,
      });
      return 'degraded';
    }

    // 与每条 failure 比(过滤无 embedding 的)
    let bestSim = 0;
    let bestHit = null;
    for (const f of failures) {
      if (!Array.isArray(f.embedding)) continue;
      const sim = _cosineSimilarity(queryVec, f.embedding);
      if (sim > bestSim) {
        bestSim = sim;
        bestHit = f;
      }
    }

    if (bestHit && bestSim >= this.threshold) {
      await this._writeAuditLog('check_hit', {
        prompt_hash: _sha256(prompt),
        matched_shot_id: bestHit.shot_id,
        matched_prompt_hash: bestHit.prompt_hash,
        similarity: Number(bestSim.toFixed(4)),
        threshold: this.threshold,
      });
      return 'hit';
    }

    return 'miss';
  }

  /**
   * TTL 清理: 移除 timestamp > ttlDays 的条目。
   *
   * @returns {Promise<{pruned: number, remaining: number}>}
   */
  async pruneExpired() {
    const data = (await this.assetBus.read('failed-shots')) || { failures: [], version: 1 };
    const failures = Array.isArray(data.failures) ? data.failures : [];
    const now = Date.now();
    const before = failures.length;

    const kept = failures.filter(f => {
      if (!f.timestamp) return true;  // 无时间戳视为永不过期(保留)
      const ts = Date.parse(f.timestamp);
      if (Number.isNaN(ts)) return true;
      return (now - ts) < this.ttlMs;
    });

    if (kept.length !== before) {
      await this.assetBus.write('failed-shots', { failures: kept, version: data.version || 1 });
      this._cachedFailures = null;
      await this._writeAuditLog('prune', {
        before,
        after: kept.length,
        pruned: before - kept.length,
        ttl_days: this.ttlDays,
      });
    }

    return { pruned: before - kept.length, remaining: kept.length };
  }

  // ─── 内部 helpers ────────────────────────────────────────────────

  /**
   * 加载 failed-shots + TTL 内联清理(不写回,除非显式 pruneExpired)。
   * 内存缓存避免重复 I/O。
   */
  async _loadAndPruneFailures() {
    if (this._cachedFailures !== null) {
      return this._cachedFailures;
    }
    const data = (await this.assetBus.read('failed-shots')) || { failures: [] };
    const failures = Array.isArray(data.failures) ? data.failures : [];
    const now = Date.now();

    // 内存视图: 过滤掉已过期的不参与匹配
    this._cachedFailures = failures.filter(f => {
      if (!f.timestamp) return true;
      const ts = Date.parse(f.timestamp);
      if (Number.isNaN(ts)) return true;
      return (now - ts) < this.ttlMs;
    });

    return this._cachedFailures;
  }

  /**
   * 审计日志: append-only jsonl,每行一个 JSON 对象。
   * 格式: { timestamp, action, ...details }
   *
   * 失败不 throw — audit log 不应阻塞主流程。
   */
  async _writeAuditLog(action, details = {}) {
    try {
      await mkdir(dirname(this._auditLogPath), { recursive: true });
      const entry = JSON.stringify({
        timestamp: new Date().toISOString(),
        action,
        ...details,
      }) + '\n';
      await appendFile(this._auditLogPath, entry, 'utf-8');
    } catch (err) {
      // 不阻塞: 仅 warn
      console.warn(`[BlacklistEngine] audit log 写入失败: ${err.message}`);
    }
  }

  /**
   * 读取 audit log 全部条目(测试/调试用)。
   * @returns {Promise<object[]>}
   */
  async _readAuditLog() {
    try {
      const raw = await readFile(this._auditLogPath, 'utf-8');
      return raw.split('\n')
        .filter(l => l.trim().length > 0)
        .map(l => JSON.parse(l));
    } catch {
      return [];
    }
  }
}

// 导出工具函数(测试用)
export { _cosineSimilarity, _sha256 };

export default BlacklistEngine;
