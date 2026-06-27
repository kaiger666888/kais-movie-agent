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
