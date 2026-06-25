---
phase: 33-pipeline-state-asset-bus
plan: 02
subsystem: pipeline-state
tags: [asset-bus, v3-port, atomic-write, envelope, jsonl, stdlib]
requires:
  - "plugins/pipeline_state/{__init__.py,tools.py,plugin.yaml} from Phase 31"
provides:
  - "plugins/pipeline_state/asset_bus.py — AssetBus class + wrap_envelope/unwrap_envelope/_compute_content_hash + ASSET_SCHEMA + SCHEMA_VERSION"
  - "plugins/pipeline_state/tests/test_asset_bus.py — 37 pytest cases"
affects:
  - "Plan 33-03 (CreativeHistoryTracker) consumes AssetBus.write/read on creative-history slot"
  - "Plan 33-04 (tools.py dispatch) imports AssetBus + AssetBusError + AssetBus.JSONL_SLOTS"
tech-stack:
  added: []
  patterns:
    - "Atomic write: tempfile.mkstemp(prefix=...) + os.replace (POSIX rename atomicity)"
    - "V3 envelope {value, derived_from, content_hash, schema_version} with v2.0 backward compat on unwrap"
    - "mtime_ns-based cache with slot-prefix invalidation on write"
    - "JSONL append via open(...,'a') — no fsync (mirrors Node.js appendFile)"
    - "Content hash: json.dumps(sort_keys=True) + hashlib.sha256 — canonical for cross-run determinism"
key-files:
  created:
    - "/data/workspace/hermes-agent/plugins/pipeline_state/asset_bus.py"
    - "/data/workspace/hermes-agent/plugins/pipeline_state/tests/test_asset_bus.py"
  modified: []
decisions:
  - "D-33-01: Pure stdlib (hashlib/json/os/tempfile/time/pathlib/typing) — no httpx/pydantic/aiofiles"
  - "D-33-02: All JSON writes atomic (tmp+rename); JSONL append stays non-atomic (open 'a', no fsync) — matches Node.js"
  - "D-33-03: review-outcomes routed as generic JSON slot; Phase 34 tightens schema"
  - "D-33-05: st_mtime_ns cache key (ns precision, stricter than Node.js mtimeMs)"
  - "sort_keys=True on content hash (deviation from Node.js insertion-order — removes dict-ordering bugs)"
metrics:
  duration: ~12 min
  completed: 2026-06-25
  tasks: 2
  tests: 37
  files_created: 2
---

# Phase 33 Plan 02: AssetBus V3 Port Summary

Ported Node.js `lib/asset-bus.js` (332 lines) to Python `plugins/pipeline_state/asset_bus.py` — pure stdlib, sync API, atomic JSON writes via tmp+`os.replace`, JSONL append for the finetune-dataset slot, v3.0 envelope wrap/unwrap with v2.0 backward compat.

## What Was Built

### `asset_bus.py` (331 LOC)

- `SCHEMA_VERSION = "3.0"`, `ASSETS_DIR = ".pipeline-assets"`.
- `ASSET_SCHEMA` — exactly 4 slots per CONTEXT CF-05:
  - `creative-history` → `creative-history.json` (json) — `{shots: Array<record>, version: number}`
  - `failed-shots` → `failed-shots.json` (json) — `{failures: Array<{shot_id, error, timestamp, run_id, prompt, fingerprints?}>, version: number}`
  - `finetune-dataset` → `finetune-dataset.jsonl` (**jsonl**, append-only)
  - `review-outcomes` → `review-outcomes.json` (json, generic per D-33-03 — Phase 34 defines schema)
- `class AssetBusError(Exception)` — programmer errors (unknown slot, format mismatch, missing required).
- Module-level functions:
  - `_compute_content_hash(value)` — `hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()` (64-char hex; `sort_keys=True` per PATTERNS, differs from Node.js insertion-order for cross-run determinism).
  - `wrap_envelope(value, derived_from=None)` → `{value, derived_from, content_hash, schema_version:"3.0"}`.
  - `unwrap_envelope(raw)` — returns `raw["value"]` iff dict with `schema_version=="3.0"` + `"value"` key + not array; else passes through unchanged (v2.0 backward compat).
  - `_atomic_write_text(path, data)` — `parent.mkdir(parents=True, exist_ok=True)` then `tempfile.mkstemp`-style tmp file (name = `<file>.tmp.<pid>.<ms>.<urandom-hex>`) then `os.replace` (POSIX atomic). Best-effort tmp cleanup on exception.
- `class AssetBus`:
  - Class attr `JSONL_SLOTS = frozenset({"finetune-dataset"})` — used by Plan 33-04 dispatch.
  - `_cache_key(slot)` → `f"{slot}:{st_mtime_ns}"` or None on missing file / unknown slot.
  - `_invalidate_cache(slot)` — deletes all keys with prefix `f"{slot}:"`.
  - `write(slot, data, *, envelope=True, derived_from=None)` — rejects unknown + jsonl slots; `derived_from` non-empty **forces** envelope even when `envelope=False` (mirrors asset-bus.js:210 so CreativeHistoryTracker lineage is always captured); atomic write; cache invalidate + reprime; returns path.
  - `read(slot)` — rejects unknown + jsonl slots; mtime cache hit short-circuits; on `FileNotFoundError`/`JSONDecodeError` returns None.
  - `read_envelope(slot)` — like read but returns raw parsed (no unwrap), for inspecting derived_from/content_hash.
  - `require(slot)` — like read but raises `AssetBusError` on None.
  - `append_line(slot, line_obj)` — rejects unknown + non-jsonl slots; `open(path, "a")` + `json.dumps(...) + "\n"` (no fsync — mirrors Node.js appendFile); invalidates cache; returns path.
  - `read_lines(slot)` — rejects unknown + non-jsonl; returns `[]` on missing file; skips blank lines (`line.strip()` filter).
  - `list_asset_names()` — `list(ASSET_SCHEMA.keys())`.

### `test_asset_bus.py` (288 LOC, 37 tests)

Pytest test classes mirroring Node.js `describe` blocks:

- `TestSchemaConfig` (5): schema_version, 4 slots, finetune jsonl format, json default, list_asset_names.
- `TestContentHash` (4): 64-char hex, deterministic, different inputs, canonical order invariance.
- `TestEnvelopeHelpers` (6): complete shape, default derived_from=[], None handling, unwrap v3 detection, v2 passthrough, array passthrough.
- `TestAtomicWrite` (2): no `.tmp.*` residue, assets dir auto-created.
- `TestWriteRead` (7): round-trip, envelope=False raw, derived_from forces envelope, rejects jsonl/unknown for both write and read.
- `TestBackwardCompat` (1): v2 raw file (no envelope) reads back as-is.
- `TestMtimeCache` (3): write-read-write-read sees new data, double-read consistent, read_envelope metadata.
- `TestJSONL` (6): single append, rejects non-jsonl/unknown, missing file → [], skips blanks, 100 ordered appends.
- `TestReadMissing` (3): missing → None, require raises, require returns when present.

All 37 pass in 0.09s.

## Verification

| Done criterion | Status |
|----------------|--------|
| asset_bus.py exists with AssetBus + wrap_envelope/unwrap_envelope/_compute_content_hash + ASSET_SCHEMA + SCHEMA_VERSION | MET |
| `_atomic_write_text` uses `os.replace` (grep `os\.replace` ≥1) | MET (4 matches) |
| JSONL append uses `open(..., "a")` (grep ≥1) | MET (3 matches) |
| No async, no third-party imports | MET (0 httpx/pydantic/aiofiles/asyncio imports) |
| ASSET_SCHEMA has exactly 4 slots | MET |
| 15-18 tests in test_asset_bus.py pass | EXCEEDED — 37 tests pass |
| asset_bus.py ≥ 220 LOC | MET (331 LOC) |
| test_asset_bus.py ≥ 250 LOC | MET (288 LOC) |

**Run command:** `cd /data/workspace/hermes-agent && python3 -m pytest plugins/pipeline_state/tests/test_asset_bus.py -v` → 37 passed in 0.09s.

## TDD Gate Compliance

- RED gate: `test(33-02): add failing tests for AssetBus V3 port` — commit `32bab59bf` (288 LOC, 37 tests, all failing on import).
- GREEN gate: `feat(pipeline_state): port AssetBus V3 (Phase 33-02)` — commit `8df375a31` (331 LOC implementation; all 37 tests now pass).
- REFACTOR: not needed — implementation is clean as written.

Both gates satisfied in order.

## Deviations from Plan

None — plan executed exactly as written. All must-have truths, artifact min_lines, and key_link patterns honored.

**Documented port differences (from PATTERNS.md "Differences From Node.js Reference" — not plan deviations):**
- Sync API (D-07)
- `sort_keys=True` on content hash (deterministic)
- `st_mtime_ns` instead of `mtimeMs`
- Atomic write for state file (D-33-02 hardening)

## Known Stubs

None. All slots route to real implementations (creative-history / failed-shots / finetune-dataset are fully wired; review-outcomes is intentionally generic pending Phase 34 schema — this is the documented Phase 33 contract per D-33-03, not a stub).

## Self-Check: PASSED

- `plugins/pipeline_state/asset_bus.py` — FOUND (331 LOC)
- `plugins/pipeline_state/tests/test_asset_bus.py` — FOUND (288 LOC, 37 tests)
- Commit `32bab59bf` (RED) — FOUND in `git log`
- Commit `8df375a31` (GREEN) — FOUND in `git log`
- Tests run: 37/37 PASSED in 0.09s
