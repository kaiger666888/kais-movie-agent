---
phase: 20
plan: 20
subsystem: asset-bus
tags: [keystone, schema, infrastructure, v3.0]
requires:
  - lib/asset-bus.js (v2.0)
provides:
  - AssetBus V3.0 (3 new typed slots + envelope + atomic write + JSONL)
affects:
  - Phase 21 (failed-shots consumer)
  - Phase 23 (creative-history consumer)
  - Phase 25 (finetune-dataset consumer)
tech-stack:
  added: []
  patterns:
    - write-tmp-then-rename (POSIX atomic)
    - mtime-based cache invalidation
    - content_hash = SHA-256(JSON.stringify(value))
    - JSONL O_APPEND for append-friendly slots
key-files:
  created:
    - test/phases/asset-bus.test.mjs
  modified:
    - lib/asset-bus.js
decisions:
  - "Envelope default-on: new data auto-wrapped; v2.0 raw data auto-unwrapped on read"
  - "content_hash = SHA-256(JSON.stringify(value)) — deterministic, dependency-free"
  - "JSONL slot (finetune-dataset) rejects write(), forces appendLine() — type-safe"
  - "mtime-based cache key: write triggers mtime change, next read automatically misses"
  - "Single combined implementation+test commit (SCHEMA-01/02/03 are tightly coupled in one file)"
metrics:
  duration: ~15min
  completed: 2026-06-23
  tasks_completed: 4
  files_changed: 2
  tests_added: 29
  tests_total: 237
---

# Phase 20: AssetBus Schema 扩展 (v3.0 keystone) — Summary

AssetBus V3.0 keystone infrastructure: 3 new typed slots (creative-history / failed-shots / finetune-dataset), backward-compatible envelope format, POSIX-atomic writes with mtime-keyed cache invalidation, and append-friendly JSONL for finetune datasets.

## What Was Built

### SCHEMA-01: New typed slots registered

Three new slots added to `ASSET_SCHEMA` (in `lib/asset-bus.js`):

| Slot | File | Format | Consumer |
| --- | --- | --- | --- |
| `creative-history` | `creative-history.json` | JSON | Phase 23 |
| `failed-shots` | `failed-shots.json` | JSON | Phase 21 |
| `finetune-dataset` | `finetune-dataset.jsonl` | JSONL | Phase 25 |

All 14 v2.0/v4.1 legacy slots retained with original configuration — zero behavior change.

### SCHEMA-02: Envelope format (backward compatible)

New v3.0 envelope:
```js
{
  value,                  // actual payload
  derived_from: [],       // upstream content hashes
  content_hash: 'sha256', // SHA-256(JSON.stringify(value))
  schema_version: '3.0',
}
```

- `write(name, data)` auto-wraps by default; `opts.envelope=false` skips wrap (v2.0 compat mode).
- `read(name)` auto-unwraps: detects `schema_version === '3.0'` + `value` key → returns `value`; otherwise returns raw data (v2.0 path).
- New `readEnvelope(name)` returns the raw envelope for inspecting metadata.
- `wrapEnvelope` / `unwrapEnvelope` / `computeContentHash` exported for external use.

### SCHEMA-03: Atomic write + mtime-based cache

- `_atomicWrite(file, data)`: writes to `${file}.tmp.${pid}.${ts}.${rand}` then POSIX `rename`. No reader ever sees a partially-written file.
- Cache key changed from `${slot}` to `${slot}:${mtimeMs}`. After write, mtime changes → next read misses cache and re-reads disk. No explicit invalidation logic needed.
- Concurrency test: 10 parallel `Promise.all` writes produce a parseable final file with exactly one winner payload.

### SCHEMA-03 ext: JSONL appendLine

- `appendLine(slot, lineObj)`: appends one JSON line to `.jsonl` slot via `appendFile` (O_APPEND).
- `readLines(slot)`: parses JSONL into array, skips empty lines.
- Type-safety: `write()` rejects JSONL slots; `appendLine()` rejects non-JSONL slots.
- Order test: 100 sequential appends produce 100 lines in exact order.

## Verification

All 237 tests pass (208 baseline + 29 new). See `20-VERIFICATION.md`.

## Deviations from Plan

**[Process] Combined 3 implementation commits into 1.**
- **Reason:** SCHEMA-01/02/03 are tightly coupled inside a single file (`lib/asset-bus.js`). The envelope wrapping (02) wraps the new slots (01); the atomic write (03) underlies both `write` and `appendLine`. Splitting them would require committing non-functional intermediate states or reworking the file 3 times.
- **Resolution:** Single substantive implementation+test commit (3acc5b4), followed by SUMMARY+VERIFICATION commit.
- **Outcome:** Functionally identical to the 4-commit plan; reviewer sees one cohesive unit.

No Rule 1-4 deviations encountered. No deferred items.

## Known Stubs

None. All three new slots are fully wired to read/write/append APIs. Phase 21/23/25 will populate them with real data.

## Threat Flags

None. No new network endpoints, auth paths, or trust-boundary schema changes. `content_hash` is deterministic SHA-256 of local data — no MAC, but not a security primitive (used for change detection, not integrity verification against adversaries).

## Self-Check: PASSED

- `lib/asset-bus.js` — FOUND (modified)
- `test/phases/asset-bus.test.mjs` — FOUND (created)
- Commit `3acc5b4` — FOUND
- Tests: 237/237 passing (208 baseline + 29 new, 0 regressions)
