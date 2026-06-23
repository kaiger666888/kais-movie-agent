---
phase: 23
plan: creative-history
subsystem: asset-lineage
tags: [aigc, lineage, bfs, flagship, v3.0]
requires:
  - phase-20-asset-bus (envelope + atomic write + creative-history slot)
  - phase-22-cloud-production (handler已实化)
provides:
  - CreativeHistoryTracker (Git-for-AIGC-movies MVP core)
  - writeBlastRadiusReport helper
  - AssetBus.write derivedFrom extension
  - cloud-production 下游 lineage MVP
affects:
  - lib/asset-bus.js
  - lib/creative-history-tracker.js (new)
  - lib/phases/index.js (cloud-production handler)
tech-stack:
  added: []
  patterns:
    - reverse BFS over adjacency-list DAG
    - content_hash linkage (SHA-256)
    - blast radius cap + truncation flag
    - degraded mode (fire-and-forget on AssetBus unreachable)
key-files:
  created:
    - lib/creative-history-tracker.js
    - test/phases/creative-history-tracker.test.mjs
    - test/phases/creative-history-perf.test.mjs
    - test/phases/asset-bus-derived-from.test.mjs
    - test/phases/cloud-production-tracker.test.mjs
  modified:
    - lib/asset-bus.js
    - lib/phases/index.js
decisions:
  - "derivedFrom 非空强制 envelope even when envelope=false (保证 content_hash linkage)"
  - "camelCase derivedFrom 为 canonical, snake_case 为 alias"
  - "BFS lazy rebuild index on every findAffected (O(N) rebuild, cached in-memory, invalidated on stamp)"
  - "Degraded mode: AssetBus 不可达 → stamp() warn + return false, 不阻塞主流程"
  - "Max blast radius default 20, maxDepth default 5 — operator 可通过 opts 配置"
metrics:
  duration: ~15min
  completed: 2026-06-22
  tasks: 4
  files_changed: 7
  tests_added: 22
  tests_total: 312
  perf_bfs_1000_assets_ms: 0.47
---

# Phase 23: CreativeHistoryTracker (旗舰能力) Summary

Git-for-AIGC-movies MVP — 实现 "改剧本一行 → 自动定位受影响镜头列表"。下游 lineage(cloud-production → 上游来源追溯),上游 retrofit 留 v3.1。

## What Was Built

### 1. AssetBus.write derivedFrom extension (B4-01)
- `opts.derivedFrom` (camelCase canonical) + `opts.derived_from` (snake_case alias)
- **Invariant**: derivedFrom 非空时强制 envelope wrap (即使 `envelope: false`),保证 content_hash 链路完整
- 6 tests (envelope / raw / forced / deterministic / alias / precedence)

### 2. CreativeHistoryTracker core (B4-03, B4-04)
- `stamp(entry)`: 原子追加 record 到 creative-history slot,含 `{asset_slot, asset_id, source_hashes[], content_hash, timestamp}`
- `findAffected(changedHash)`: 反向 BFS,Map<source_hash, Set<record>> O(1) lookup
- `diff(changedHashes)`: 批量 findAffected + union 去重
- **Caps**: maxBlastRadius=20, maxDepth=5,超限 → `truncated=true` + 截断返回
- **Degraded**: AssetBus 不可达 → warn + return false (no throw)
- 11 tests (single stamp / chain A→B→C / leaf / cap / depth cap / diamond dedup / diff / degraded)

### 3. cloud-production 下游 lineage MVP (B4-05)
- Handler 末尾(stamp block,after video_tasks.json 写入):
  - 读取 sts/character/scene envelope 的 content_hash 作为 source_hashes
  - 对每个 status=completed 的 video 调用 `tracker.stamp({asset_slot:'final-shots', asset_id: shot_id, source_hashes, content_hash: sha256(video_path)})`
  - Stamp 失败 → warn 不阻塞主流程
- 1 integration test (mock GoldTeamClient + 验证 creative-history 含正确 source_hashes)

### 4. Performance + report (B4-04 verification)
- 1000-asset BFS 实测 **0.47ms** (要求 < 500ms,余量 1000x)
- `writeBlastRadiusReport(result, path)`: 当 truncated=true 时写 operator-reviewable JSON,含 affected list + truncation note + cap 配置
- 4 tests (wide DAG perf / deep chain perf / report content / non-truncated note)

## Deviations from Plan

None - plan executed exactly as written. All 9 critical constraints satisfied.

## Test Results

```
ℹ tests 312  (290 baseline + 22 new)
ℹ suites 92
ℹ pass 312
ℹ fail 0
```

新增测试文件:
- `test/phases/asset-bus-derived-from.test.mjs` (6 tests)
- `test/phases/creative-history-tracker.test.mjs` (11 tests)
- `test/phases/cloud-production-tracker.test.mjs` (1 test)
- `test/phases/creative-history-perf.test.mjs` (4 tests)

## Performance

| 场景 | 实测 | 要求 |
|------|------|------|
| 1000-asset wide DAG BFS | 0.47ms | < 500ms |
| 10-layer deep chain BFS | 4.88ms (含 stamp) | < 500ms |

## Known Stubs

None.

## Deferred / Future Work (v3.1)

- 上游 hash stamping (script_generation → sts → shot) — 留 v3.1
- 多 workdir 跨 episode lineage — 留 v3.1
- BFS 算法升级 (topological sort) — 留 v3.1
- composition handler 可选 trigger diff (改剧本后 operator 审阅)

## Self-Check: PASSED

- [x] lib/creative-history-tracker.js exists
- [x] All 4 test files exist
- [x] Commit 4500947 (AssetBus derivedFrom) in git log
- [x] Commit caa2575 (Tracker core) in git log
- [x] Commit 068cad4 (cloud-production stamp) in git log
- [x] Commit 71797e4 (perf + report) in git log
- [x] All 312 tests pass
