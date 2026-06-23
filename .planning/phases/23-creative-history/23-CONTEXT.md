# Phase 23: CreativeHistoryTracker (旗舰能力) - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning
**Mode:** Auto-generated (flagship feature — discuss skipped, design from research SUMMARY.md)

<domain>
## Phase Boundary

新增 `lib/creative-history-tracker.js`,实现"改剧本一行 → 自动定位受影响镜头列表"。这是 v3.0 旗舰能力(Git-for-AIGC-movies MVP)。

**核心交付**:
1. AssetBus envelope 格式真正写入(`derived_from` / `content_hash`)
2. adjacency-list DAG + reverse BFS diff
3. Blast radius cap(防止 dependency explosion)
4. Hash-stamping 嵌入 cloud-production 下游 lineage MVP

**范围限定**: 本 phase 只做下游 lineage(cloud-production 产出 → 追溯上游来源),上游 retrofit(script→sts→shot)留 v3.1。

</domain>

<decisions>

## Implementation Decisions

### CreativeHistoryTracker API

```javascript
// lib/creative-history-tracker.js
export class CreativeHistoryTracker {
  constructor({ assetBus, maxBlastRadius = 20, maxDepth = 5 }) { ... }
  
  /**
   * 记录一个 asset 的生成关系(下游 → 上游)
   * @param {object} entry - {asset_slot, asset_id, source_hashes: string[], content_hash}
   */
  async stamp(entry) {
    // 1. 读 creative-history slot
    // 2. push shot entry {asset_slot, asset_id, source_hashes, content_hash, timestamp}
    // 3. 原子写入(Phase 20 atomicWrite)
  }
  
  /**
   * 反向 BFS:给定 source_hash 变更,找出所有 derived asset
   * @param {string} changedHash - 变更的上游 asset content_hash
   * @returns {Promise<{affected: Array, truncated: boolean, blast_radius: number}>}
   */
  async findAffected(changedHash) {
    // 1. 加载全 creative-history
    // 2. BFS:从 changedHash 出发,沿 source_hashes 反向遍历
    // 3. 应用 maxBlastRadius + maxDepth cap
    // 4. 超出 cap → truncated=true,只返回前 N 个 + 提示 operator scope
  }
  
  /**
   * 批量 diff:多个 hash 同时变更
   */
  async diff(changedHashes) {
    const all = new Set();
    let truncated = false;
    for (const h of changedHashes) {
      const r = await this.findAffected(h);
      r.affected.forEach(a => all.add(a));
      if (r.truncated) truncated = true;
    }
    return { affected: Array.from(all), truncated };
  }
}

### Envelope 写入(Phase 20 envelope 真正使用)

AssetBus.write 时,如果 derived_from 非空,自动计算 content_hash 并 envelope 包装:

```javascript
// lib/asset-bus.js (扩展)
async write(slot, value, opts = {}) {
  const { derivedFrom = [] } = opts;
  if (derivedFrom.length > 0 || opts.forceEnvelope) {
    const contentHash = sha256(JSON.stringify(value));
    const envelope = {
      value,
      derived_from: derivedFrom,
      content_hash: contentHash,
      schema_version: '3.0',
      wrapped_at: new Date().toISOString(),
    };
    return this._writeRaw(slot, envelope);
  }
  return this._writeRaw(slot, value);  // 向后兼容
}
```

### cloud-production 下游 lineage MVP

```javascript
// cloud-production handler 末尾
const tracker = new CreativeHistoryTracker({ assetBus: bus });

for (const result of results) {
  if (result.video_path && !result.error) {
    await tracker.stamp({
      asset_slot: 'final-shots',
      asset_id: result.shot_id,
      source_hashes: [
        stsScript.content_hash,           // 上游 spatio-temporal-script
        characterAssets.content_hash,     // 上游 character-assets
        sceneAssets.content_hash,         // 上游 scene-assets
      ].filter(Boolean),
      content_hash: sha256(result.video_path),  // 本 video 的 hash
    });
  }
}
```

### BFS diff 使用示例(改剧本后)

```javascript
// 假设 operator 修改了 spatio-temporal-script,内容 hash 变了
const newStsHash = await bus.recomputeHash('spatio-temporal-script');
const { affected, truncated } = await tracker.findAffected(newStsHash);
// affected = ['shot-001', 'shot-003', 'shot-007', ...]
// 写入 .pipeline-assets/blast-radius-report.json 供 operator 审阅
```

### Claude's Discretion

- **BFS lazy**: 平时不遍历,只在 findAffected 时按需 BFS
- **内存数据结构**: Map<source_hash, Set<derived_asset>>(O(1) lookup)
- **降级**: AssetBus 不可达 → tracker.stamp() fire-and-forget (warn 不 throw)
- **测试**: stamp / findAffected / blast radius cap / truncated / 降级

</decisions>

<code_context>

### Reusable Assets
- `lib/asset-bus.js` (Phase 20 envelope + atomic write + creative-history slot 已就位)
- `lib/phases/index.js` cloud-production handler (Phase 22 已实化)
- `node:crypto` SHA-256

### Integration Points
- cloud-production handler 末尾调用 tracker.stamp
- composition handler 可选调用 tracker.diff(改剧本后 operator trigger)

</code_context>

<specifics>

- **Blast radius cap**: 默认 20 shots,超出写报告 `blast-radius-report.json`
- **Max depth**: 默认 5 层(防止 script → sts → shot → frame → video → final 之类长链)
- **不做**: 上游 lineage retrofit(script→sts→shot hash stamping)留 v3.1
- **测试**: 1000 mock assets 遍历 < 500ms(performance requirement)

</specifics>

<deferred>

- 上游 hash stamping(script_generation → sts → shot) → v3.1
- 多 workdir 跨 episode lineage → v3.1
- BFS 算法升级(topological sort)→ v3.1

</deferred>
