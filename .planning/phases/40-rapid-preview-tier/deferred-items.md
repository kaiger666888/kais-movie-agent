# Deferred Items — Phase 40 (Rapid Preview Tier)

Out-of-scope issues discovered during plan execution. NOT fixed by the
executing plan per the scope boundary rule (only auto-fix issues directly
caused by the current plan's changes).

## Pre-existing (discovered during 40-03 Task 3 regression)

### canvas_sync.py sqlite references (SC#1 violation, pre-existing)

**Discovered:** 2026-06-27, during plan 40-03 Task 3 full regression run.

**Test failing:** `plugins/kais_aigc/tests/test_canvas_sync_integration.py::TestNoLegacyReferences::test_no_openclaw_references_in_phase_37_deliverables`

**Failure detail:**
```
SC#1 violation: openclaw / Toonflow / sqlite code references found in Phase 37
deliverables: ["canvas_sync.py line 406: 'sqlite'", "canvas_sync.py line 417:
'sqlite'", "canvas_sync.py line 426: 'sqlite3'"]
```

**Cause:** `plugins/kais_aigc/canvas_sync.py` was modified before plan 40-03
started (visible in `git status` at plan start as
`M plugins/kais_aigc/canvas_sync.py`). The modification introduced `sqlite`
references at lines 406, 417, 426 that the SC#1 legacy-reference scan flags.

**Why not fixed by 40-03:** Plan 40-03 only touches `p10b_rapid_preview.py`
and `test_p10b_unit.py` (+ the registry test stub-boundary update). The
canvas_sync.py modification is an in-flight change from a different work
stream, unrelated to rapid preview tier. Confirmed pre-existing via
`git stash`: with 40-03's working tree changes stashed, the test STILL
detects the sqlite references (because canvas_sync.py was already modified
at plan start).

**Action required:** Owner of the canvas_sync.py change should either
(a) remove the sqlite references, or (b) update the SC#1 scan to allow
sqlite in canvas_sync.py if the references are intentional. Out of scope
for v6.0 rapid preview tier.

## Phase 40 review (2026-06-27) — accepted limitations and deferred fixes

### WR-01 (Phase 40 review) — LTXVideoEngine httpx.Client thread-safety

**Discovered:** 2026-06-27, during Phase 40 code review.

**Finding:** `p10b` fans out per-shot via `ThreadPoolExecutor(max_workers=
parallel_shots=4)` and shares a single engine instance across worker
threads. In `KAIS_PREVIEW_ENGINE=ltx` mode, all workers share the same
`httpx.Client` connection pool. The sync `httpx.Client` uses a `httpcore`
sync connection pool whose thread-safety for CONCURRENT `request()` calls
from multiple threads is not part of its public contract. Under real
network latency, interleaved `.post()` calls can theoretically corrupt
connection state or trip `httpcore`'s "connection already in use"
assertion.

**v6.0 mitigation (already in place):** default mode is
`KAIS_PREVIEW_ENGINE=slideshow` — `SlideshowEngine.generate` spawns its
own subprocess per call and holds no shared state. Hazard is LTX-mode
only.

**v6.0 fix applied:** documented as accepted limitation via docstring
WARNING on `LTXVideoEngine` (commit `fac52c13c`). Operator-side mitigation
for LTX mode: set `parallel_shots=1` (serialize fan-out).

**Deferred to v6.1:** the proper fix is one of:
- (a) `threading.Lock` around `engine.generate` for LTXVideoEngine
  (simplest; serializes HTTP but preserves sync API).
- (b) Per-worker engine via `ThreadPoolExecutor(initializer=...)` +
  `threading.local` (matches per-shot fan-out pattern most cleanly).
- (c) Switch to `httpx.AsyncClient` + `asyncio.gather` (largest change;
  aligns with async migration path).

Option (b) is recommended — it preserves the per-shot concurrency model
while giving each worker its own connection pool.
