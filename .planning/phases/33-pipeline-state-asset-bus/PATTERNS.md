# Phase 33 Patterns: Python Data Structure + Atomic Write + DAG/BFS

**Source:** Node.js `lib/asset-bus.js`, `lib/creative-history-tracker.js`, `lib/pipeline.js` (state extract) + Phase 31/32 plugin patterns. Phase 33 ports pure data structures — NO HTTP, NO async, NO third-party deps.

## Reference Modules Consulted

| Module | Path | Why Consulted | Pattern Extracted |
|--------|------|---------------|-------------------|
| AssetBus | `kais-movie-agent/lib/asset-bus.js` | Direct port source | Envelope wrap/unwrap, atomic write, mtime cache, JSONL append |
| CreativeHistoryTracker | `kais-movie-agent/lib/creative-history-tracker.js` | Direct port source | DAG adjacency index, reverse BFS, blast radius cap, degraded mode |
| Pipeline (state extract) | `kais-movie-agent/lib/pipeline.js:217-249,611-618,700-707` | State shape + resume logic | State file format, done-statuses set, resume index |
| Phase 31 plugin pattern | `.planning/phases/31-.../PATTERNS.md` | register() + tools.py structure | Tool tuple loop, fake-ctx test pattern |
| Phase 32 dispatch pattern | `.planning/phases/32-.../PATTERNS.md` | Tool handler dispatch + try/except | `_handle_*` body swap from stub to real (Plan 33-04 mirrors 32-05) |
| Node.js test refs | `kais-movie-agent/test/phases/asset-bus.test.mjs` (33 tests), `creative-history-tracker.test.mjs` (13 tests), `creative-history-perf.test.mjs` (4 tests) | Behavior baseline | Per-test name → Python test name mapping |

## Adopted Pattern (pure stdlib, sync, dataclass records)

### Module Anatomy (per port module)

Every port module (`store.py`, `asset_bus.py`, `creative_history.py`) follows this skeleton:

```python
"""asset_bus.py — AssetBus V3 port (reference: kais-movie-agent/lib/asset-bus.js).

Pure stdlib. Sync API. Atomic writes via tempfile+os.replace.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

SCHEMA_VERSION = "3.0"
ASSETS_DIR = ".pipeline-assets"


@dataclass(frozen=True)
class Envelope:
    """V3 envelope wrapping raw payload with content_hash lineage."""
    value: Any
    derived_from: tuple[str, ...] = ()   # tuple, not list — frozen dataclass
    content_hash: str = ""
    schema_version: str = SCHEMA_VERSION


class AssetBusError(Exception):
    """Raised for programmer errors (unknown slot, wrong format)."""


class AssetBus:
    def __init__(self, workdir: str | Path):
        self._dir = Path(workdir) / ASSETS_DIR
        self._cache: dict[str, Any] = {}

    # ... atomic_write, _cache_key, write, read, append_line, read_lines, ...
```

**Key points:**
- `from __future__ import annotations` first import (matches Phase 31/32 style)
- Sync API throughout — NO `async def`. Phase 32 decision D-07 applies.
- `@dataclass(frozen=True)` for records (Envelope, StampRecord, Checkpoint) — immutable, hashable, type-safe
- Plain `dict[str, Any]` for dynamic-shape payloads (`shots[]`, `failures[]`)
- Module-level logger, not `print()` — matches Phase 32 client pattern

### Atomic Write Pattern (BLOCKER — must match Node.js)

Mirrors `asset-bus.js:160-165`. Python port uses `tempfile.mkstemp + os.replace`:

```python
def _atomic_write(self, file_path: Path, data: str) -> None:
    """Atomic write: tmp file + POSIX rename. Mirrors Node.js fs.writeFile+rename."""
    file_path.parent.mkdir(parents=True, exist_ok=True)
    # Unique tmp name: <filename>.tmp.<pid>.<time>.<rand>
    tmp_name = f"{file_path.name}.tmp.{os.getpid()}.{int(time.time()*1000)}.{os.urandom(3).hex()}"
    tmp_path = file_path.parent / tmp_name
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write(data)
    os.replace(str(tmp_path), str(file_path))  # atomic on POSIX
```

**JSONL append (NOT atomic — mirrors Node.js appendFile):**
```python
def append_line(self, slot: str, line_obj: dict) -> str:
    # ... validate slot is jsonl format ...
    path = self._dir / self._schema[slot]["file"]
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(line_obj) + "\n")
    self._invalidate_cache(slot)
    return str(path)
```

### Content Hash Pattern

```python
def _compute_content_hash(value: Any) -> str:
    """SHA-256 of canonical JSON. sort_keys=True for cross-run determinism."""
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()
```

**Deviation from Node.js:** `sort_keys=True`. Node.js `JSON.stringify` preserves insertion order; Python `json.dumps` does too by default. Adding `sort_keys=True` removes a class of bugs where dict construction order affects hashes — important for content-addressable lineage. Documented in CONTEXT.md CF-03.

### Envelope Wrap/Unwrap Pattern

Mirrors `asset-bus.js:122-143`:

```python
def wrap_envelope(value: Any, derived_from: list[str] | None = None) -> dict:
    derived = tuple(derived_from) if derived_from else ()
    return {
        "value": value,
        "derived_from": list(derived),
        "content_hash": _compute_content_hash(value),
        "schema_version": SCHEMA_VERSION,
    }

def unwrap_envelope(raw: Any) -> Any:
    """Return raw.value if v3.0 envelope, else raw (v2.0 backward compat)."""
    if (
        isinstance(raw, dict)
        and not isinstance(raw, list)
        and raw.get("schema_version") == SCHEMA_VERSION
        and "value" in raw
    ):
        return raw["value"]
    return raw
```

### mtime Cache Pattern

Mirrors `asset-bus.js:172-182, 217-225`. Python uses `st_mtime_ns` (nanoseconds):

```python
def _cache_key(self, slot: str) -> str | None:
    schema = self._SCHEMA.get(slot)
    if not schema:
        return None
    path = self._dir / schema["file"]
    try:
        st = path.stat()
        return f"{slot}:{st.st_mtime_ns}"
    except FileNotFoundError:
        return None

def _invalidate_cache(self, slot: str) -> None:
    # Delete all keys for this slot (mtime changed → new key on next read)
    prefix = f"{slot}:"
    keys_to_delete = [k for k in self._cache if k.startswith(prefix) or k == slot]
    for k in keys_to_delete:
        del self._cache[k]
```

### CreativeHistoryTracker DAG + BFS Pattern

Mirrors `creative-history-tracker.js:33-233`. Uses `collections.deque` for BFS O(1) popleft:

```python
from collections import deque

class CreativeHistoryTracker:
    DEFAULT_MAX_BLAST_RADIUS = 20
    DEFAULT_MAX_DEPTH = 5

    def __init__(self, *, asset_bus: "AssetBus",
                 max_blast_radius: int = 20, max_depth: int = 5):
        if asset_bus is None:
            raise ValueError("CreativeHistoryTracker: asset_bus required")
        self._bus = asset_bus
        self._max_blast_radius = max_blast_radius
        self._max_depth = max_depth
        self._index_cache: dict[str, list[dict]] | None = None

    def find_affected(self, changed_hash: str) -> dict:
        """Reverse BFS — find all downstream assets transitively dependent on changed_hash."""
        index = self._build_index()
        affected: list[dict] = []
        seen_hashes: set[str] = {changed_hash}
        seen_asset_ids: set[str] = set()
        truncated = False
        max_depth_reached = 0

        queue: deque[tuple[str, int]] = deque([(changed_hash, 0)])

        while queue:
            h, depth = queue.popleft()
            if depth >= self._max_depth:
                continue
            derived_records = index.get(h, [])
            for record in derived_records:
                asset_key = f"{record['asset_slot']}:{record['asset_id']}"
                if asset_key in seen_asset_ids:
                    continue
                seen_asset_ids.add(asset_key)
                if len(affected) >= self._max_blast_radius:
                    truncated = True
                    break
                affected.append({...})
                if depth + 1 > max_depth_reached:
                    max_depth_reached = depth + 1
                if record["content_hash"] not in seen_hashes:
                    seen_hashes.add(record["content_hash"])
                    queue.append((record["content_hash"], depth + 1))
            if truncated:
                break

        return {
            "affected": affected,
            "truncated": truncated,
            "blast_radius": len(affected),
            "max_depth": max_depth_reached,
            "cap": {"maxBlastRadius": self._max_blast_radius, "maxDepth": self._max_depth},
        }
```

**Key points:**
- `deque.popleft()` is O(1); `list.pop(0)` is O(N) — perf-critical for 1000-asset BFS test.
- snake_case methods (`find_affected` not `findAffected`, `stamp` stays `stamp` — already snake-case in concept).
- Return dict uses camelCase keys (`maxBlastRadius`, `maxDepth`) inside `cap` — matches Node.js envelope exactly so reports are interchangeable.

### Degraded Mode Pattern

Mirrors `creative-history-tracker.js:97-101`. AssetBus failure → warn + return False/empty, no throw:

```python
def stamp(self, entry: dict) -> bool:
    if not entry or not entry.get("asset_id") or not entry.get("asset_slot"):
        raise ValueError("CreativeHistoryTracker.stamp: asset_slot and asset_id required")
    # ... build record ...
    try:
        current = self._bus.read("creative-history") or {"shots": [], "version": 1}
        if not isinstance(current.get("shots"), list):
            current["shots"] = []
        current["shots"].append(record)
        self._bus.write("creative-history", current, envelope=True)
        self._index_cache = None  # invalidate
        return True
    except Exception as e:
        logger.warning("CreativeHistoryTracker stamp degraded: %s", e)
        return False
```

### PipelineStateStore Pattern

Phase 33 implements ONLY the data layer (save/load/resume detection). Full run loop is Phase 35.

```python
@dataclass
class PipelineState:
    episode: str
    phases: dict[str, dict] = field(default_factory=dict)
    current_phase_id: str | None = None
    started_at: str | None = None
    completed_at: str | None = None
    last_resumed_at: str | None = None
    trace_id: str | None = None

    DONE_STATUSES = frozenset({"completed", "approved", "awaiting_review"})


class PipelineStateStore:
    """Persists pipeline state per workdir. Atomic write via tmp+rename (D-33-02)."""

    STATE_FILE = ".pipeline-state.json"

    def __init__(self, workdir: str | Path):
        self._workdir = Path(workdir)
        self._path = self._workdir / self.STATE_FILE

    def load(self) -> PipelineState:
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
            return PipelineState(**raw)  # filter unknown keys if needed
        except (FileNotFoundError, json.JSONDecodeError):
            return PipelineState(episode="")

    def save(self, state: PipelineState) -> None:
        data = json.dumps(asdict(state), indent=2, ensure_ascii=False)
        _atomic_write_text(self._path, data)

    def save_checkpoint(self, episode_id: str, phase: str, payload: dict) -> None:
        """Persist one phase's checkpoint (the SC#1 tool operation)."""
        state = self.load()
        if not state.episode:
            state.episode = episode_id
        state.phases[phase] = {
            "status": "completed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "result": payload,
        }
        state.current_phase_id = phase
        self.save(state)

    def load_latest_checkpoint(self, episode_id: str) -> dict | None:
        """Most recent phase checkpoint for episode (the SC#1 resume operation)."""
        state = self.load()
        if state.episode != episode_id or not state.current_phase_id:
            return None
        return state.phases.get(state.current_phase_id)

    def find_resume_phase(self, phase_order: list[str]) -> str | None:
        """First phase NOT in DONE_STATUSES, or None if all done. Mirrors pipeline.js:611."""
        state = self.load()
        for phase_id in phase_order:
            phase_state = state.phases.get(phase_id)
            if not phase_state or phase_state.get("status") not in state.DONE_STATUSES:
                return phase_id
        return None
```

### Tool Dispatch Pattern (Plan 33-04)

Mirrors Phase 32-05 (tools.py body swap). Replaces Phase 31 stubs with real dispatch:

```python
# plugins/pipeline_state/tools.py (Plan 33-04 swaps handler bodies)

from plugins.pipeline_state.store import PipelineStateStore
from plugins.pipeline_state.asset_bus import AssetBus, AssetBusError
from tools.registry import tool_result, tool_error


def _state_store(workdir: str | None = None) -> PipelineStateStore:
    import os
    return PipelineStateStore(workdir or os.getcwd())


def _asset_bus(workdir: str | None = None) -> AssetBus:
    import os
    return AssetBus(workdir or os.getcwd())


def _handle_pipeline_checkpoint_save(args: dict, **kw) -> str:
    """Phase 33 implementation — replaces Phase 31 stub."""
    episode_id = args.get("episode_id")
    phase = args.get("phase")
    payload = args.get("payload") or {}
    if not episode_id or not phase:
        return tool_error("episode_id and phase are required")
    try:
        store = _state_store()
        store.save_checkpoint(episode_id, phase, payload)
        return tool_result({"status": "saved", "episode_id": episode_id, "phase": phase})
    except Exception as exc:
        return tool_error(f"checkpoint_save failed: {type(exc).__name__}: {exc}")


def _handle_pipeline_checkpoint_load(args: dict, **kw) -> str:
    episode_id = args.get("episode_id")
    if not episode_id:
        return tool_error("episode_id is required")
    try:
        store = _state_store()
        checkpoint = store.load_latest_checkpoint(episode_id)
        if checkpoint is None:
            return tool_result({"status": "no_checkpoint", "episode_id": episode_id})
        return tool_result({"status": "loaded", "episode_id": episode_id, "checkpoint": checkpoint})
    except Exception as exc:
        return tool_error(f"checkpoint_load failed: {type(exc).__name__}: {exc}")


def _handle_asset_bus_read(args: dict, **kw) -> str:
    episode_id = args.get("episode_id")
    slot = args.get("slot")
    if not episode_id or not slot:
        return tool_error("episode_id and slot are required")
    try:
        bus = _asset_bus()
        if slot in AssetBus.JSONL_SLOTS:
            data = bus.read_lines(slot)
        else:
            data = bus.read(slot)
        return tool_result({"status": "read", "episode_id": episode_id, "slot": slot, "data": data})
    except AssetBusError as exc:
        return tool_error(str(exc))
    except Exception as exc:
        return tool_error(f"asset_bus_read failed: {type(exc).__name__}: {exc}")


def _handle_asset_bus_write(args: dict, **kw) -> str:
    episode_id = args.get("episode_id")
    slot = args.get("slot")
    entry = args.get("entry")
    if not episode_id or not slot or entry is None:
        return tool_error("episode_id, slot, and entry are required")
    try:
        bus = _asset_bus()
        if slot in AssetBus.JSONL_SLOTS:
            path = bus.append_line(slot, entry)
        else:
            path = bus.write(slot, entry, envelope=True)
        return tool_result({"status": "written", "episode_id": episode_id, "slot": slot, "path": path})
    except AssetBusError as exc:
        return tool_error(str(exc))
    except Exception as exc:
        return tool_error(f"asset_bus_write failed: {type(exc).__name__}: {exc}")
```

**Key points:**
- Schema dicts (`*_SCHEMA`) are UNCHANGED from Phase 31 — only handler bodies swap.
- `_state_store()` and `_asset_bus()` factories read workdir from kw arg or `os.getcwd()` — no env var needed (this is a file-based module).
- Dispatch wraps every operation in try/except — programmer errors (`AssetBusError`) return `tool_error`, runtime exceptions return generic `tool_error`.
- `register()` in `__init__.py` is unchanged — Phase 31's `_TOOLS` tuple still references the same 4 names.

### Test Pattern (pytest, tmp_path fixture)

Mirrors Phase 32 MockTransport pattern adapted for filesystem testing. Uses pytest's `tmp_path` fixture (auto-cleanup, no manual mkdtemp/rm):

```python
# tests/test_asset_bus.py
from pathlib import Path
import pytest
from plugins.pipeline_state.asset_bus import AssetBus, AssetBusError, wrap_envelope, unwrap_envelope, SCHEMA_VERSION


class TestEnvelopeHelpers:
    def test_compute_content_hash_returns_64_char_sha256_hex(self):
        h = _compute_content_hash({"a": 1})
        assert len(h) == 64
        assert all(c in "0123456789abcdef" for c in h)

    def test_wrap_envelope_produces_complete_v3_shape(self):
        env = wrap_envelope({"x": 1}, derived_from=["upstream-hash"])
        assert env["schema_version"] == SCHEMA_VERSION
        assert env["derived_from"] == ["upstream-hash"]
        assert len(env["content_hash"]) == 64
        assert env["value"] == {"x": 1}

    def test_unwrap_envelope_v2_raw_passthrough(self):
        raw = {"legacy": "data"}
        assert unwrap_envelope(raw) is raw


class TestAssetBusWriteRead:
    def test_write_then_read_round_trips_with_envelope(self, tmp_path: Path):
        bus = AssetBus(tmp_path)
        bus.write("failed-shots", {"failures": [{"shot_id": "s1"}], "version": 1})
        data = bus.read("failed-shots")
        assert data == {"failures": [{"shot_id": "s1"}], "version": 1}

    def test_no_tmp_residue_after_write(self, tmp_path: Path):
        bus = AssetBus(tmp_path)
        bus.write("failed-shots", {"failures": [], "version": 1})
        files = list((tmp_path / ".pipeline-assets").iterdir())
        assert not any(".tmp." in f.name for f in files)
        assert any(f.name == "failed-shots.json" for f in files)

    # ... etc ...
```

**Key points:**
- pytest `tmp_path` fixture (auto-cleanup) replaces Node.js `mkdtemp/rm` try/finally boilerplate.
- Class-based test grouping (`class TestEnvelopeHelpers`, `class TestAssetBusWriteRead`) mirrors Node.js `describe` blocks.
- `tmp_path: Path` type hint — Path object, not str.
- One assert per behavior — test names are sentences (`test_write_then_read_round_trips_with_envelope`).

### Perf Test Pattern

Mirrors `creative-history-perf.test.mjs`:

```python
class TestPerformance:
    def test_bfs_1000_chain_completes_under_500ms(self, tmp_path: Path):
        import time
        bus = AssetBus(tmp_path)
        tracker = CreativeHistoryTracker(asset_bus=bus)
        # Build 1000-link chain: each stamp sources from previous content_hash
        prev_hash = "root"
        for i in range(1000):
            ok = tracker.stamp({
                "asset_slot": "final-shots",
                "asset_id": f"shot-{i:04d}",
                "source_hashes": [prev_hash],
                "content_hash": f"v-{i:04d}",
            })
            assert ok
            prev_hash = f"v-{i:04d}"
        # BFS from root should reach all 1000 assets
        start = time.perf_counter()
        result = tracker.find_affected("root")
        elapsed_ms = (time.perf_counter() - start) * 1000
        assert elapsed_ms < 500, f"BFS took {elapsed_ms:.1f}ms (>500ms budget)"
        assert result["blast_radius"] == 1000
        assert not result["truncated"]
```

**Note:** This perf test will likely show Python 5-10x slower than Node.js's 0.47ms. The 500ms B4-04 budget is the spec; measured Python time is informational. If Python exceeds 500ms, the executor should profile (likely the read-back per stamp — can be optimized by batching, but Node.js doesn't batch either so preserve behavior).

## Differences From Node.js Reference (Documented)

| Aspect | Node.js | Python | Why |
|--------|---------|--------|-----|
| Async API | `async write/read/stamp` | Sync `write/read/stamp` | D-07: Phase 32 locked sync. State module has no I/O wait — sync is simpler. |
| Content hash key order | `JSON.stringify` (insertion order) | `json.dumps(sort_keys=True)` | Deterministic across runs — removes a class of dict-ordering bugs |
| Pipeline state write | `fs.writeFile` (non-atomic) | `os.replace` (atomic) | D-33-02: Hardening. Half-written state = corrupt episode. |
| Class fields | `this._x = ...` in constructor | `@dataclass` annotations | Pythonic type safety, immutability for records |
| BFS queue | `Array.shift()` (O(N) — but small N in practice) | `deque.popleft()` (O(1)) | Python perf hygiene; matters for 1000-asset perf test |
| Error handling | `throw new Error(...)` | `raise ValueError(...)` / `raise AssetBusError(...)` | Pythonic |
| Logging | `console.warn(...)` | `logger.warning(...)` | Phase 32 convention |
| camelCase kwargs | `maxBlastRadius`, `derivedFrom` | `max_blast_radius`, `derived_from` | Python idiom. Internal cap response keeps camelCase (`{"maxBlastRadius": ...}`) for report compatibility |

## File Layout (Phase 33 deliverables)

```
hermes-agent/plugins/pipeline_state/
├── plugin.yaml              # UNCHANGED from Phase 31
├── __init__.py              # UNCHANGED from Phase 31 (register() loops _TOOLS tuple)
├── tools.py                 # MODIFIED in 33-04 (swap 4 stubs → real dispatch)
├── store.py                 # NEW (33-01) — PipelineStateStore + PipelineState dataclass
├── asset_bus.py             # NEW (33-02) — AssetBus + envelope + atomic write
├── creative_history.py      # NEW (33-03) — CreativeHistoryTracker + DAG + BFS
├── README.md                # UNCHANGED (Phase 31)
└── tests/
    ├── test_smoke.py                # UNCHANGED (Phase 31)
    ├── test_loader_discovery.py     # UNCHANGED (Phase 31)
    ├── test_store.py                # NEW (33-01) — 10-12 tests
    ├── test_asset_bus.py            # NEW (33-02) — 15-18 tests
    ├── test_creative_history.py     # NEW (33-03) — 12-15 tests
    └── test_tools_dispatch.py       # NEW (33-04) — 8-10 dispatch tests
```

**Total estimated:** ~800-1500 LOC Python, ~45-55 tests.
