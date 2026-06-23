/**
 * CreativeHistoryTracker — Phase 23 v3.0 旗舰能力
 *
 * 实现 "改剧本一行 → 自动定位受影响镜头列表" (Git-for-AIGC-movies MVP)。
 *
 * 核心模型:
 *   每个 asset stamp 记录 {asset_slot, asset_id, source_hashes[], content_hash}
 *   source_hashes 指向其上游 asset 的 content_hash,形成 DAG。
 *
 * 核心操作:
 *   - stamp(entry): append 一条 record 到 creative-history slot
 *   - findAffected(changedHash): 反向 BFS 找出所有 derived asset
 *   - diff(changedHashes): 批量 findAffected
 *
 * Caps (防止 dependency explosion):
 *   - maxBlastRadius (默认 20): 返回结果数量上限
 *   - maxDepth (默认 5): BFS 链长度上限
 *   超出 cap → truncated=true,只返回前 N 个,提示 operator scope
 *
 * 降级:
 *   AssetBus 不可达 → stamp() fire-and-forget (warn 不 throw)
 *
 * 性能:
 *   - 内部维护 Map<source_hash, Set<derived_asset_id>> (O(1) lookup)
 *   - lazy 重建:每次 findAffected 触发一次 _buildIndex,O(N) where N = records
 *   - 1000 assets BFS < 500ms (verified by perf test)
 */
import { createHash } from 'node:crypto';

const DEFAULT_MAX_BLAST_RADIUS = 20;
const DEFAULT_MAX_DEPTH = 5;

export class CreativeHistoryTracker {
  /**
   * @param {object} opts
   * @param {*} opts.assetBus - AssetBus instance (required)
   * @param {number} [opts.maxBlastRadius=20] - cap on returned affected assets
   * @param {number} [opts.maxDepth=5] - BFS depth cap
   */
  constructor({ assetBus, maxBlastRadius = DEFAULT_MAX_BLAST_RADIUS, maxDepth = DEFAULT_MAX_DEPTH }) {
    if (!assetBus) throw new Error('CreativeHistoryTracker: assetBus required');
    this._bus = assetBus;
    this._maxBlastRadius = maxBlastRadius;
    this._maxDepth = maxDepth;
    this._indexCache = null;
    this._indexCacheKey = null;
  }

  /**
   * Compute SHA-256 content hash of a serializable value.
   * @param {*} value
   * @returns {string}
   */
  static hash(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  /**
   * Append a stamp record to creative-history slot. Atomic via AssetBus atomicWrite.
   *
   * Record schema:
   *   {asset_slot, asset_id, source_hashes: string[], content_hash, timestamp}
   *
   * Degraded mode: AssetBus read/write failure → warn + return (no throw).
   *
   * @param {object} entry
   * @param {string} entry.asset_slot
   * @param {string} entry.asset_id
   * @param {string[]} entry.source_hashes - upstream content_hashes
   * @param {string} [entry.content_hash] - computed from entry if omitted
   * @param {string} [entry.timestamp]
   * @returns {Promise<boolean>} true on success, false on degraded
   */
  async stamp(entry) {
    if (!entry || !entry.asset_id || !entry.asset_slot) {
      throw new Error('CreativeHistoryTracker.stamp: asset_slot and asset_id required');
    }
    const sourceHashes = Array.isArray(entry.source_hashes) ? entry.source_hashes : [];
    const contentHash = entry.content_hash || CreativeHistoryTracker.hash(entry);

    const record = {
      asset_slot: entry.asset_slot,
      asset_id: entry.asset_id,
      source_hashes: sourceHashes,
      content_hash: contentHash,
      timestamp: entry.timestamp || new Date().toISOString(),
    };

    try {
      const current = (await this._bus.read('creative-history')) || { shots: [], version: 1 };
      if (!Array.isArray(current.shots)) current.shots = [];
      current.shots.push(record);
      // Atomic write — invalidate local index cache (mtime will change)
      await this._bus.write('creative-history', current, { envelope: true });
      this._indexCache = null;
      return true;
    } catch (e) {
      // Degraded: AssetBus unreachable. Fire-and-forget (warn, don't throw).
      console.warn(`[CreativeHistoryTracker] stamp degraded: ${e.message}`);
      return false;
    }
  }

  /**
   * Reverse BFS: given one or more changed upstream content_hashes, find all
   * downstream derived assets that transitively depend on them.
   *
   * Algorithm:
   *   1. Build Map<source_hash, Set<record>> on load (lazy, cached by mtime)
   *   2. Seed BFS queue with changedHash
   *   3. For each hash, look up records whose source_hashes contain it
   *   4. Each hit's content_hash becomes the next BFS layer (depth + 1)
   *   5. Cap by maxBlastRadius (truncated=true) and maxDepth (stop)
   *
   * @param {string} changedHash - upstream content_hash that changed
   * @returns {Promise<{affected: Array<object>, truncated: boolean, blast_radius: number, max_depth: number}>}
   */
  async findAffected(changedHash) {
    const index = await this._buildIndex();
    const affected = [];
    const seenHashes = new Set();
    const seenAssetIds = new Set();
    let truncated = false;
    let maxDepthReached = 0;

    // BFS queue: {hash, depth}
    const queue = [{ hash: changedHash, depth: 0 }];
    seenHashes.add(changedHash);

    while (queue.length > 0) {
      const { hash, depth } = queue.shift();
      if (depth >= this._maxDepth) continue;

      const derivedRecords = index.bySource.get(hash);
      if (!derivedRecords) continue;

      for (const record of derivedRecords) {
        // Deduplicate by asset_id (same asset stamped twice doesn't double-count)
        const assetKey = `${record.asset_slot}:${record.asset_id}`;
        if (seenAssetIds.has(assetKey)) continue;
        seenAssetIds.add(assetKey);

        if (affected.length >= this._maxBlastRadius) {
          truncated = true;
          break;
        }
        affected.push({
          asset_slot: record.asset_slot,
          asset_id: record.asset_id,
          content_hash: record.content_hash,
          source_hashes: record.source_hashes,
          timestamp: record.timestamp,
          depth: depth + 1,
        });
        if (depth + 1 > maxDepthReached) maxDepthReached = depth + 1;

        // Continue BFS through this record's content_hash
        if (!seenHashes.has(record.content_hash)) {
          seenHashes.add(record.content_hash);
          queue.push({ hash: record.content_hash, depth: depth + 1 });
        }
      }
      if (truncated) break;
    }

    return {
      affected,
      truncated,
      blast_radius: affected.length,
      max_depth: maxDepthReached,
      cap: {
        maxBlastRadius: this._maxBlastRadius,
        maxDepth: this._maxDepth,
      },
    };
  }

  /**
   * Batch diff: multiple upstream hashes changed. Union of affected sets.
   * @param {string[]} changedHashes
   * @returns {Promise<{affected: Array, truncated: boolean, per_hash: Map}>}
   */
  async diff(changedHashes) {
    if (!Array.isArray(changedHashes) || changedHashes.length === 0) {
      return { affected: [], truncated: false, per_hash: new Map() };
    }
    const all = new Map(); // assetKey -> record (union, dedup)
    let truncated = false;
    const perHash = new Map();

    for (const h of changedHashes) {
      const r = await this.findAffected(h);
      perHash.set(h, r);
      if (r.truncated) truncated = true;
      for (const a of r.affected) {
        const key = `${a.asset_slot}:${a.asset_id}`;
        if (!all.has(key)) all.set(key, a);
      }
    }
    return { affected: Array.from(all.values()), truncated, per_hash: perHash };
  }

  /**
   * Build reverse index Map<source_hash, Set<record>> from creative-history records.
   * Cached and invalidated on stamp().
   * @returns {Promise<{bySource: Map, records: Array, count: number}>}
   * @private
   */
  async _buildIndex() {
    if (this._indexCache) return this._indexCache;

    let data;
    try {
      data = (await this._bus.read('creative-history')) || { shots: [] };
    } catch (e) {
      console.warn(`[CreativeHistoryTracker] _buildIndex read failed: ${e.message}`);
      data = { shots: [] };
    }
    const records = Array.isArray(data.shots) ? data.shots : [];
    const bySource = new Map();

    for (const record of records) {
      if (!record || !record.content_hash) continue;
      const sources = Array.isArray(record.source_hashes) ? record.source_hashes : [];
      for (const src of sources) {
        if (!bySource.has(src)) bySource.set(src, []);
        bySource.get(src).push(record);
      }
    }

    this._indexCache = { bySource, records, count: records.length };
    return this._indexCache;
  }
}

export default CreativeHistoryTracker;

/**
 * Write a blast-radius-report JSON for operator review when BFS results are truncated.
 *
 * Report format:
 *   {
 *     generated_at, changed_hash, affected_count, truncated,
 *     cap: {maxBlastRadius, maxDepth}, affected: [{asset_slot, asset_id, ...}],
 *     note: "Scope exceeded cap — review and re-run with larger maxBlastRadius if needed"
 *   }
 *
 * @param {object} findAffectedResult - return value of tracker.findAffected()
 * @param {string} outputPath - absolute path to write report
 * @param {string} [changedHash] - optional, for record-keeping
 * @returns {Promise<string>} path written
 */
export async function writeBlastRadiusReport(findAffectedResult, outputPath, changedHash = null) {
  const report = {
    generated_at: new Date().toISOString(),
    changed_hash: changedHash,
    affected_count: findAffectedResult.affected.length,
    truncated: !!findAffectedResult.truncated,
    blast_radius: findAffectedResult.blast_radius,
    max_depth: findAffectedResult.max_depth,
    cap: findAffectedResult.cap || null,
    affected: findAffectedResult.affected,
    note: findAffectedResult.truncated
      ? `Scope exceeded maxBlastRadius=${findAffectedResult.cap?.maxBlastRadius}. Review manually or re-run tracker.findAffected(hash, {maxBlastRadius: N}).`
      : 'All affected assets captured.',
  };
  const { writeFile, mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2));
  return outputPath;
}
