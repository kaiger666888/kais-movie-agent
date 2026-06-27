# Deferred Items — Phase 42

## Out-of-scope failures discovered during plan execution

### 1. test_canvas_sync_integration.py::test_no_openclaw_references_in_phase_37_deliverables

- **Discovered during:** Plan 42-03 Task 1 (GREEN run)
- **Symptom:** Test fails with "SC#1 violation: openclaw / Toonflow / sqlite
  code references found in Phase 37 deliverables: canvas_sync.py lines
  406, 417, 426 ('sqlite', 'sqlite', 'sqlite3')".
- **Root cause:** Pre-existing unstaged modifications to
  `/data/workspace/hermes-agent/plugins/kais_aigc/canvas_sync.py`
  (visible in `git diff` — a separate V8.6 phaseIndex effort introduced
  direct sqlite3 imports + DB writes to bypass the Canvas API for
  projectId lookup). These modifications were present in the working
  tree BEFORE plan 42-03 started and are NOT touched by 42-03's
  scope (feedback_ingest.py + test_feedback_server.py only).
- **Why deferred:** Out of scope per deviation rules ("Pre-existing
  warnings, linting errors, or failures in unrelated files are out of
  scope"). The failure is in Phase 37 deliverable, not in any Phase 42
  file. The fix belongs to whoever owns the canvas_sync V8.6 effort.
- **Verification:** Stashing unstaged changes makes the test pass; the
  failure is 100% attributable to the dirty working tree, not to plan
  42-03 changes.
- **Action for canvas_sync owner:** Either remove the sqlite3 direct-DB
  path (use the Canvas API exclusively per D-37-05) or update the
  Phase 37 SC#1 test to whitelist the new pattern.
