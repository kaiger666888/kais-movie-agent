# Phase 20: AssetBus Schema 扩展 - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning
**Mode:** Auto-generated (keystone infrastructure phase — discuss skipped)

<domain>
## Phase Boundary

扩展 `lib/asset-bus.js` 支持新 typed slots + envelope 格式,为 Phase 21/23/25 解锁基础能力。

**核心变化**:
1. `ASSET_SCHEMA` 新增 3 typed slots:`creative-history` / `failed-shots` / `finetune-dataset`
2. Envelope 格式 `{value, derived_from, content_hash}` 支持向后兼容
3. 跨 phase 原子写入(并发安全)+ cache 失效

</domain>

<decisions>

## Implementation Decisions

### ASSET_SCHEMA 扩展

```javascript
// lib/asset-bus.js
const ASSET_SCHEMA = {
  // ... existing v2.0 slots (art-bible, character-assets, etc.)
  
  // v3.0 new slots
  'creative-history': {
    file: '.pipeline-assets/creative-history.json',
    schema: {
      shots: 'Array<{shot_id, source_hash, derived_from: string[], content_hash, timestamp}>',
      version: 'number',
    },
  },
  'failed-shots': {
    file: '.pipeline-assets/failed-shots.json',
    schema: {
      failures: 'Array<{shot_id, error, timestamp, run_id, prompt, fingerprints?: {dino?: number[], phash?: string}}>',
      version: 'number',
    },
  },
  'finetune-dataset': {
    file: '.pipeline-assets/finetune-dataset.jsonl',  // 注意是 jsonl 不是 json
    schema: {
      samples: 'string',  // JSONL, 每行一个 sample
      version: 'number',
    },
  },
};
```

### Envelope 格式(向后兼容)

```javascript
// 新格式 (v3.0+):
{
  value: <actual data>,
  derived_from: string[],  // 上游 asset 内容 hash 列表(可选)
  content_hash: string,    // 本 asset 的 SHA-256(可选)
  schema_version: '3.0',
}

// 旧格式 (v2.0): 直接是 data,无 envelope
// 读取时:if (data.schema_version) return data.value; else return data;
```

### 原子写入

```javascript
// 使用 write-then-rename 模式保证原子性
async atomicWrite(file, data) {
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, file);  // POSIX 原子
}
```

### Cache 失效

```javascript
// 读 cache key 加入 timestamp(file mtime)
async read(slot) {
  const file = this._path(slot);
  const mtime = (await stat(file)).mtimeMs;
  const cacheKey = `${slot}:${mtime}`;
  if (this._cache.has(cacheKey)) return this._cache.get(cacheKey);
  // ... read disk ...
  this._cache.set(cacheKey, data);
  return data;
}
// 写入后 cache 自动失效(mtime 变,下次读 miss)
```

### Claude's Discretion

- **Envelope 默认开启**: 新数据自动 envelope,旧数据读取时 unwrap
- **content_hash 计算**: SHA-256(JSON.stringify(value))(可选,默认计算)
- **derived_from**: 留给上游 phase 填,AssetBus 只做存储
- **测试**: 并发写入 / cache miss/hit / 向后兼容 / 降级

</decisions>

<specifics>

- **Schema 命名**: kebab-case(v2.0 惯例)
- **JSONL**: `finetune-dataset` 用 JSONL(每行一 sample,append-friendly)
- **不做**: 不修改现有 v2.0 slot 行为
- **向后兼容测试**: 读 v2.0 已有 .pipeline-assets/*.json 不破坏

</specifics>

<deferred>

- B4 creative-history 写入逻辑 → Phase 23
- B5 failed-shots 累积逻辑 → Phase 21
- B6 finetune-dataset 生成 → Phase 25

</deferred>
