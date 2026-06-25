# Phase 33 Context: Pipeline State & Asset Bus (Python Port)

**Phase goal:** Port 3 Node.js state modules to Python in `hermes-agent/plugins/pipeline_state/`. Pure data-structure work — no HTTP, no orchestration. Foundation for Phase 35 (HERMES-SKILL-02 checkpoint resume + HERMES-SKILL-03 phase read/write).

**Source artifacts audited:**
- `lib/asset-bus.js` — AssetBus V3 (332 lines)
- `lib/creative-history-tracker.js` — DAG + BFS (272 lines)
- `lib/pipeline.js` — PipelineStateStore logic embedded in `Pipeline._loadState/_saveState/_findResumeIndex/_migrateV2State` (~lines 217-249, 611-618, 700-707)
- Node.js test refs: `test/phases/asset-bus.test.mjs` (33 tests), `test/phases/asset-bus-derived-from.test.mjs` (8 tests), `test/phases/creative-history-tracker.test.mjs` (13 tests), `test/phases/creative-history-perf.test.mjs` (4 tests)
- v3.0-REQUIREMENTS.md: B4-01..06 (CreativeHistoryTracker), SCHEMA-01..03 (AssetBus V3)
- Skeleton: `plugins/pipeline_state/{__init__.py, tools.py, plugin.yaml}` from Phase 31

## CRITICAL FINDINGS

### CF-01: Atomic Write Strategy (CONFIRMED)

**Node.js strategy:** `write-tmp-then-rename`. Source `lib/asset-bus.js:160-165`:
```js
const tmp = `${file}.tmp.${pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
await writeFile(tmp, data);
await rename(tmp, file);
```

**Python port MUST mirror this** using `os.replace()` (POSIX rename atomicity):
```python
import os, tempfile
fd, tmp = tempfile.mkstemp(prefix=f"{filename}.tmp.", dir=dirname)
with os.fdopen(fd, "w") as f:
    f.write(data)
os.replace(tmp, target)  # atomic on POSIX
```

**JSONL append (finetune-dataset slot):** uses `fs.appendFile` (O_APPEND semantics). Python port: open with `"a"` mode, write line + `\n`. No fsync (Node.js doesn't fsync either — preserve behavior).

**Test assertion** (`asset-bus.test.mjs:197`): after `write()`, glob of `.pipeline-assets/*.tmp.*` MUST return `[]`. Python port must replicate.

### CF-02: Blast Radius Cap Values (CONFIRMED)

**Source `lib/creative-history-tracker.js:30-31`:**
```js
const DEFAULT_MAX_BLAST_RADIUS = 20;
const DEFAULT_MAX_DEPTH = 5;
```

**B4-04 spec (v3.0-REQUIREMENTS.md:40):** "Blast radius cap (≤500ms 查询预算 + depth limit)". Cap values are runtime-tunable (`maxBlastRadius`, `maxDepth` constructor kwargs); defaults 20/5.

**Performance baseline (creative-history-perf.test.mjs:26):** "1000 stamps: BFS over chain completes under 500ms". Node.js measured 0.47ms (PROJECT.md). Python port MUST include a perf test asserting BFS over 1000-stamp chain < 500ms (loose bound — same spec as Node.js). NOT < 1ms (that was a measured result, not a spec).

### CF-03: V3 Envelope Schema (CONFIRMED)

**Source `lib/asset-bus.js:122-129`:**
```js
function wrapEnvelope(value, derivedFrom = []) {
  return {
    value,                                          // raw payload
    derived_from: Array.isArray(derivedFrom) ? derivedFrom : [],  // string[] of upstream content_hashes
    content_hash: computeContentHash(value),        // SHA-256 hex of JSON.stringify(value)
    schema_version: SCHEMA_VERSION,                 // "3.0"
  };
}
```

**Unwrap rule (asset-bus.js:136-143):** treat as envelope IFF `schema_version === "3.0"` AND `value` key present AND not an array. Otherwise return raw (v2.0 backward compat).

**Phase 23 update (asset-bus.js:206-213):** when `derived_from` is non-empty, envelope is force-enabled (even if `envelope=False`) so `content_hash` linkage required by CreativeHistoryTracker is always recorded.

### CF-04: Creative-History Record Schema (CONFIRMED)

**Source `lib/creative-history-tracker.js:81-87` — stamp record:**
```js
{
  asset_slot: string,          // e.g. "final-shots"
  asset_id: string,            // e.g. "shot-001"
  source_hashes: string[],     // upstream content_hashes
  content_hash: string,        // this asset's hash
  timestamp: string,           // ISO 8601
}
```

**creative-history slot envelope payload schema (asset-bus.js:86-89):**
```js
{ shots: Array<stampRecord>, version: 1 }
```

### CF-05: AssetBus V3 Schema (FULL) — Scoped to 3 Typed Slots + envelope

**Full Node.js ASSET_SCHEMA has ~20 slots** (art-bible, character-assets, voice-timeline, shot-list, scene-assets, prop-assets, visual-soul, voice-soul, geometry-bed, spatio-temporal-script, temp-dialogue, bgm-skeleton, motion-preview, audio-reverb + 3 v3.0 new).

**Phase 33 scope (per ROADMAP SC#2):** port the **3 v3.0 typed slots only** (`creative-history` / `failed-shots` / `finetune-dataset`). The other slots belong to V2/V4.1 phases — out of Phase 33 scope. Tools.py schema enum also lists `review-outcomes` (Phase 34 will populate; Phase 33 just routes it as a generic JSON slot, see D-33-03 below).

**Slot configs:**
- `creative-history`: file `creative-history.json`, schema `{shots: Array<record>, version: number}`, format json
- `failed-shots`: file `failed-shots.json`, schema `{failures: Array<{shot_id, error, timestamp, run_id, prompt, fingerprints?}>, version: number}`, format json
- `finetune-dataset`: file `finetune-dataset.jsonl`, format jsonl (append-only)
- `review-outcomes`: file `review-outcomes.json` (Phase 33 generic JSON, Phase 34 defines schema)

### CF-06: PipelineStateStore Behavior (EXTRACTED)

**Pipeline state file:** `.pipeline-state.json` at workdir root (NOT under `.pipeline-assets/`).

**State shape** (extracted from `pipeline.js:217-249`):
```js
{
  episode: string,                  // "EP01"
  phases: {
    [phase_id]: {
      status: "completed" | "failed" | "awaiting_review" | "approved",
      completedAt?: string,         // ISO timestamp
      failedAt?: string,
      submitted_at?: string,
      review_id?: string,
      error?: string,
      result?: object,              // phase output summary
    }
  },
  currentPhaseId: string | null,
  startedAt: string | null,
  completedAt: string | null,
  lastResumedAt?: string,
  traceId?: string,
}
```

**Resume detection (`pipeline.js:611-618`):** first phase whose status is NOT in `{completed, approved, awaiting_review}` is the resume point. `awaiting_review` counts as "done" (re-running would duplicate work).

**Atomic write:** Node.js uses raw `writeFile` (NOT tmp-then-rename) for `.pipeline-state.json` — see `pipeline.js:247`. **Python port uses tmp-then-rename anyway** for consistency with AssetBus and because v5.0 ship-fast beats v3.0 partial compatibility (half-written state file = corrupt episode). D-33-02 locks this.

**Checkpoint semantics for Phase 33 scope:** Phase 33 implements `PipelineStateStore` as a stateful helper class — `save_checkpoint(episode_id, phase, payload)`, `load_latest_checkpoint(episode_id)`. The full run/resume orchestration loop is Phase 35 (HERMES-SKILL-02). Phase 33's store handles the data layer only.

## Architectural Decisions

### D-33-01: Pure stdlib Python, no third-party deps

AssetBus, CreativeHistoryTracker, PipelineStateStore use only `hashlib`, `json`, `os`, `tempfile`, `pathlib`, `time`, `dataclasses`. NO `httpx`, NO `pydantic`, NO `aiofiles`. Matches Phase 32's "no Node bridges" PROJECT.md decision and avoids dependency creep in a pure data-structure module.

### D-33-02: All filesystem writes use tmp-then-rename atomicity

Both `.pipeline-state.json` (checkpoints) AND `.pipeline-assets/*.json` (asset bus) use `tempfile.mkstemp + os.replace`. JSONL append uses `"a"` mode (per-CF-01, mirrors Node.js appendFile, no fsync).

This DEVIATES from Node.js pipeline.js (which uses raw writeFile for state) — intentional hardening. v3.0 Node.js behavior is preserved for the data shape; the write path is upgraded.

### D-33-03: AssetBus routes review-outcomes as generic JSON

Phase 34 defines the review-outcomes slot schema + Gate resolution semantics. Phase 33 implements AssetBus routing for the slot name (so `asset_bus_read/write` tool dispatch works end-to-end) but treats it as a generic JSON slot (not envelope-forced). Phase 34 will tighten the contract.

### D-33-04: dataclasses for records, dicts for slot payloads

Stamp records, checkpoint state, envelope are `@dataclass(frozen=True)` for type safety + hashability. Slot payloads (`shots[]`, `failures[]`) are plain `dict[str, Any]` — matches Node.js "anything JSON-serializable" semantics. This balances Pythonic typing with the dynamic-shape reality of AIGC payloads.

### D-33-05: mtime cache uses float `st_mtime_ns`

Node.js uses `st.mtimeMs`. Python port uses `os.stat(path).st_mtime_ns` (nanosecond precision — stricter than Node.js ms). Cache key format: `f"{asset_name}:{mtime_ns}"`. On write, the cache for that slot is fully invalidated (delete all keys starting with `asset_name:`).

### D-33-06: Wave 1 parallelism via disjoint file ownership

- Plan 33-01 owns: `store.py`, `tests/test_store.py`
- Plan 33-02 owns: `asset_bus.py`, `tests/test_asset_bus.py`
- Plan 33-03 owns: `creative_history.py`, `tests/test_creative_history.py`
- Plan 33-04 owns: `tools.py` (modified), `tests/test_tools_dispatch.py` (new)

Zero file overlap in Wave 1 → all three run in parallel. Wave 2 (33-04) touches `tools.py` which depends on imports from all three Wave 1 modules.

## Node.js → Python Port Mapping

| Node.js | Python | Notes |
|---------|--------|-------|
| `import { createHash } from 'crypto'` | `import hashlib` | `hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()` — use `sort_keys=True` for deterministic hashing across runs (Node.js JSON.stringify is insertion-order; Python dict ordering is preserved too, but sort_keys removes a class of bugs) |
| `import { readFile, writeFile, rename, mkdir } from 'fs/promises'` | `pathlib.Path.read_text / write_text`, `os.replace`, `Path.mkdir(parents=True)` | Sync API — no async needed (this is not HTTP-bound work) |
| `class AssetBus { constructor(workdir) {...} }` | `class AssetBus: def __init__(self, workdir: str \| Path): ...` | Sync methods throughout — NO `async def`. Phase 32's sync decision (D-07) applies. |
| `class CreativeHistoryTracker { constructor({assetBus, ...}) }` | `class CreativeHistoryTracker: def __init__(self, *, asset_bus, max_blast_radius=20, max_depth=5): ...` | snake_case kwargs. Keep `maxBlastRadius`/`maxDepth` camelCase NOT supported — Python idiom only. |
| `new Date().toISOString()` | `datetime.now(timezone.utc).isoformat()` | Use timezone-aware UTC. |
| `process.pid` | `os.getpid()` | For tmp filename uniqueness. |
| `Map<k,v>` | `dict[k,v]` | Python dict preserves insertion order (3.7+). |
| `Set<T>` | `set[T]` | |
| `Array.prototype.shift()` (BFS queue) | `collections.deque.popleft()` | O(1) vs list.pop(0) O(N). Performance-critical for BFS. |
| `_indexCache` lazy rebuild | `_index_cache` attribute, set to `None` on stamp() | Same lazy invalidation pattern. |

## Out of Phase 33 Scope (Explicit)

- **Gate lifecycle** (Phase 34) — Gate submit/wait/resolve, HMAC callbacks, max_retries fail
- **Orchestration runner** (Phase 35) — runner.py, sequential 13-phase execution, episode parallelism
- **13 phase handlers** (Phase 35/36) — p01_hook_topic through p13_delivery
- **HTTP calls** — Pure state / data-structure modules only
- **V2/V4.1 AssetBus slots** (art-bible, character-assets, voice-timeline, etc.) — out of scope, only 3 v3.0 typed slots ported
- **Upstream lineage retrofit** (B4-06) — deferred to v6.0+ per v3.0-REQUIREMENTS.md
- **CrossEpisodeAssetIndex** (Phase 24, B2) — separate capability, not part of Phase 33

## Source Coverage Audit

| Source | Item | Covered By |
|--------|------|------------|
| ROADMAP SC#1 | PipelineStateStore checkpoint save/load + episode persistence + resume | Plan 33-01 |
| ROADMAP SC#2 | AssetBus V3 — 3 typed slots + envelope + atomic write (JSONL append) | Plan 33-02 |
| ROADMAP SC#3 | CreativeHistoryTracker DAG + reverse BFS + blast radius cap | Plan 33-03 |
| ROADMAP SC#4 | Python unit tests ≥ Node.js equivalent case count | Plans 33-01/02/03 (test files) + Plan 33-04 (dispatch tests) |
| CONTEXT (skeleton `tools.py`) | 4 stub handlers replaced with real dispatch | Plan 33-04 |
| B4-01..04 | envelope + 3 slots + DAG + BFS + cap | Plans 33-02 (B4-01/02 envelope+slots) + 33-03 (B4-03/04 DAG+BFS+cap) |
| B4-05 | Hash-stamping downstream lineage | Plan 33-03 (`stamp()` method) |
| B4-06 | Upstream lineage retrofit | **Out of scope** (deferred v6.0+ per v3.0 spec line 42) |
| SCHEMA-01..03 | 3 typed slots + envelope compat + atomic write + cache invalidation | Plan 33-02 |

No gaps. B4-06 exclusion is documented in v3.0-REQUIREMENTS.md line 42 as deferred — not a Phase 33 gap.
