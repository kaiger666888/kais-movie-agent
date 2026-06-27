---
phase: 40-rapid-preview-tier
plan: 01
subsystem: pipeline-state + kais-movie-pipeline phase registry
tags: [asset-bus, phase-registry, rapid-preview, scaffolding, v6.0]
requires:
  - V5.0 PHASE_REGISTRY 13-phase DAG (Phase 36-05)
  - V5.0 AssetBus ASSET_SCHEMA (Phase 33 + 36-XX slots)
  - p10_voice + p11_video_render module shape (Phase 36-03)
provides:
  - "ASSET_SCHEMA entries: rapid-preview-clips (jsonl) + episode-meta (json)"
  - "PHASE_REGISTRY: 14 entries with p10b_rapid_preview between p10/p11"
  - "p10b_rapid_preview stub module with required constants + NotImplementedError run()"
  - "V5.0 502+ test regression preserved (592 passed, 1 pre-existing out-of-scope failure)"
affects:
  - "p11_video_render depends_on mutated ['p10_voice'] → ['p10b_rapid_preview']"
  - "JSONL_SLOTS frozenset UNCHANGED (rapid-preview-clips NOT added per plan instruction)"
  - "test_checkpoint_resume_mid_pipeline: 6 → 7 phase count (p10b in resumed slice)"
tech-stack:
  added: []
  patterns:
    - "TDD RED/GREEN for AssetBus slot registration"
    - "Module-proxy swap pattern for stub phases in PHASE_REGISTRY (mirrors _P11Proxy)"
key-files:
  created:
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p10b_rapid_preview.py
  modified:
    - /data/workspace/hermes-agent/plugins/pipeline_state/asset_bus.py
    - /data/workspace/hermes-agent/plugins/pipeline_state/tests/test_asset_bus.py
    - /data/workspace/hermes-agent/plugins/pipeline_state/tests/test_asset_bus_phase35_slots.py
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/__init__.py
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_phase_registry_full.py
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_runner_full_dag.py
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_e2e_degraded.py
    - /data/workspace/hermes-agent/plugins/kais_aigc/tests/test_canvas_sync_integration.py
key-decisions:
  - "Slot name 'rapid-preview-clips' (NOT 'preview-clips') — avoids SKILL.md p06.5 collision (BLOCKER #5)"
  - "Slot name 'episode-meta' (NOT 'pipeline-state') — pipeline-state.json is a separate PipelineStateStore file (BLOCKER #1)"
  - "JSONL_SLOTS frozenset left UNCHANGED — actual dispatch uses ASSET_SCHEMA[slot]['format']; modifying the frozenset broke test_jsonl_slots_unchanged"
  - "p10b EXPERT=None (pure orchestration per CONTEXT D-35-04) — PreviewEngine strategy replaces expert delegation"
  - "p10b GATE_ID=None — RAPID-PREVIEW-06 inherits 4 red-line gates via existing consistency-guard, NOT a new gate"
  - "test_checkpoint_resume_mid_pipeline: phase count 6 → 7 (p10b inserts at index 10, within resumed_from=7 slice)"
requirements-completed:
  - RAPID-PREVIEW-01
  - RAPID-PREVIEW-04
duration: "11 min"
completed: "2026-06-27T04:56:20Z"
---

# Phase 40 Plan 01: Rapid Preview Tier Scaffolding Summary

Registered 2 new AssetBus slots (`rapid-preview-clips` JSONL + `episode-meta` JSON) and inserted a `p10b_rapid_preview` stub into PHASE_REGISTRY between p10_voice and p11_video_render (14 phases total), rewiring p11's depends_on to `["p10b_rapid_preview"]`, while preserving the V5.0 592-test regression baseline.

## Duration / Scope

- **Start:** 2026-06-27T04:45:10Z
- **End:** 2026-06-27T04:56:20Z
- **Duration:** 11 min (670s)
- **Tasks completed:** 3/3
- **Files created:** 1 (`p10b_rapid_preview.py`)
- **Files modified:** 8 (asset_bus.py + 7 test files)
- **New tests added:** 14 (12 AssetBus slot tests + 1 p10b constants test + 1 resume-cursor invariant test)
- **Final test count:** 592 passed, 1 pre-existing out-of-scope failure (detailed below)

## What Was Built

### Production code (hermes-agent repo)

1. **`p10b_rapid_preview.py`** (NEW, 106 lines): Stub phase module mirroring p10/p11 module shape.
   - Constants: `PHASE_ID="p10b_rapid_preview"`, `EXPERT=None` (PreviewEngine replaces expert delegation per CONTEXT D-35-04), `INPUT_SLOTS=["voice-clips", "voice-timeline", "e-konte-sheets"]`, `OUTPUT_SLOTS=["rapid-preview-clips", "episode-meta"]` (BOTH new slots per BLOCKER #1), `GATE_ID=None`.
   - `run()` raises `NotImplementedError("p10b_rapid_preview.run() implemented in plan 40-03")`.
   - Full signature: standard 5-arg Phase 35 contract + keyword-only `parallel_shots: int = 4` (mirrors p11's ThreadPoolExecutor fan-out per D-36-08).

2. **`asset_bus.py`**: 2 new ASSET_SCHEMA entries appended at END of dict (D-36-05 "PRESERVES existing slots byte-equivalent — only appends"):
   - `rapid-preview-clips`: `format=jsonl`, `writer_phase=p10b_rapid_preview`, append-only (one line per variant)
   - `episode-meta`: `format=json`, `writer_phase=p10b_rapid_preview`, episode-level metadata (preview_skipped flag carrier)
   - `JSONL_SLOTS` frozenset intentionally left UNCHANGED (see Deviations #2 below).

3. **`phases/__init__.py`**: 5 surgical edits — import `p10b_rapid_preview as p10b`, alias `p10b_rapid_preview = p10b`, registry entry inserted between p10/p11, p11 depends_on mutated to `["p10b_rapid_preview"]`, `__all__` updated, docstring updated.

### Test code (V5.0 + Phase 40)

4. **`test_asset_bus.py`**: 2 new test classes (12 tests total).
   - `TestRapidPreviewClipsSlot` (6 tests): jsonl registration, list_asset_names, append_line + read_lines round-trip, write rejection, missing-file empty list.
   - `TestEpisodeMetaSlot` (6 tests): json registration, list_asset_names, write + read round-trip, append_line rejection, missing-file None.

5. **`test_phase_registry_full.py`**: EXPECTED_PHASE_IDS gains `p10b_rapid_preview` (14 entries); `test_phase_registry_has_13_entries` → `_14_entries`; new `test_p10b_stub_module_constants_and_run_behavior` asserts all p10b constants + `NotImplementedError`; `test_all_thirteen_phase_modules_importable_by_long_name` → `_fourteen_`.

6. **`test_runner_full_dag.py`**: 2× `== 13` → `== 14` (phase count + checkpoint saves); `test_checkpoint_resume_mid_pipeline` `== 6` → `== 7` (BLOCKER #3 — p10b inserts within resumed_from=7 slice); new `test_p10b_insertion_preserves_p08_resume_cursor` pins the index invariant (p08@7, p10b@10, p11@11); new `_P10bStubProxy` + autouse fixture swaps p10b's module for full-DAG tests.

7. **`test_e2e_degraded.py`**: `== 13` → `== 14`; `>= 13` → `>= 14` (canvas save/load call counts); docstrings updated; same `_P10bStubProxy` + autouse fixture pattern.

8. **`test_canvas_sync_integration.py`**: 3× `== 13` → `== 14` (phase count, save_count, save_bodies count); docstrings/comments updated; same `_P10bStubProxy` + autouse fixture pattern.

9. **`test_asset_bus_phase35_slots.py`**: `test_jsonl_slots_unchanged` assertion updated to expect both `finetune-dataset` AND `rapid-preview-clips` as jsonl slots (was asserting only the former).

## BLOCKER #3 Finding (Critical)

**Q: Did `test_checkpoint_resume_mid_pipeline` need a `6 → 7` phase count update?**

**A: YES.** The plan's analysis was correct. After p10b insertion at registry index 10, the resumed run starting from index 7 (p08) executes ALL remaining phases: p08(7), p09(8), p10(9), **p10b(10)**, p11(11), p12(12), p13(13) = **7 phases** (not 6).

Changes applied to `test_checkpoint_resume_mid_pipeline`:
- `assert len(result["phases"]) == 6` → `== 7`
- Failure message: `"expected 6 phases (p08..p13)"` → `"expected 7 phases (p08..p13, includes p10b)"`
- `late_phase` tuple: added `"p10b_rapid_preview"` between `"p10_voice"` and `"p11_video_render"`
- Docstring: `"(6 phases)"` → `"(7 phases, includes p10b at index 10)"`
- Inline comment near line 263: documents WHY the count is now 7

The `resumed_from == 7` assertion at line 247 stayed UNCHANGED (p08 is still at index 7 — p10b inserts AFTER p08). Verified by new `test_p10b_insertion_preserves_p08_resume_cursor` which pins indices directly: `ids.index("p08_scene_selection") == 7`, `ids.index("p10b_rapid_preview") == 10`, `ids.index("p11_video_render") == 11`.

## BLOCKER #2 (Comprehensive Grep) Finding

**Q: Did the comprehensive grep surface any additional `== 13` assertions beyond the 4 known files?**

**A: YES — within the same 4 known files.** The plan listed 5 specific lines (211, 455, 308, 300, 306). The grep surfaced these PLUS:

- `test_canvas_sync_integration.py:340` — `assert len(save_bodies) == 13` (save-body count for phase-node-id sanity check). **Updated to `== 14`.**
- `test_e2e_degraded.py:352, 357` — `assert canvas_client.save_canvas.call_count >= 13` AND `load_canvas.call_count >= 13` (canvas call count thresholds, derived from "one call per phase"). **Updated to `>= 14`.**
- Numerous docstrings/comments in all 4 files referencing "13-phase DAG" / "all 13 phases" / "13 save-v2 calls" — **updated to 14** for consistency.

The plan's spirit ("If the grep surfaces any ADDITIONAL file with a hard-coded `== 13`...update that file too AND document") was honored: no NEW files surfaced, but additional assertions within the known files were caught and updated.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Full-DAG tests crash on p10b.run() raising NotImplementedError**

- **Found during:** Task 2 (after registry insertion, before test updates finalized)
- **Issue:** The plan did not anticipate that the runner iterates PHASE_REGISTRY and calls `module.run()` for every phase including p10b. Since the stub's `run()` raises `NotImplementedError`, every full-DAG test (`test_full_dag_runs_p01_through_p13`, `test_checkpoint_resume_mid_pipeline`, `test_e2e_degraded_full_dag_produces_master_mp4`, `test_canvas_sync_integration` keystone tests) would crash at the p10b iteration step.
- **Fix:** Added `_P10bStubProxy` class + `autouse` fixture in 3 full-DAG test files (`test_runner_full_dag.py`, `test_e2e_degraded.py`, `test_canvas_sync_integration.py`). The proxy returns a canned `{"phase": "p10b_rapid_preview", "outputs": {}, "gate": None}` result so the runner records p10b as completed without exercising the real stub. Mirrors the existing `_P11Proxy` swap pattern in `test_full_dag_parallel_shots_config_reaches_p11`.
- **Files modified:** `test_runner_full_dag.py`, `test_e2e_degraded.py`, `test_canvas_sync_integration.py`
- **Verification:** All 3 test files pass; full V5.0 regression suite green (592 passed).
- **Commit:** `5bffee4ce`

**2. [Rule 1 - Bug] JSONL_SLOTS frozenset drift broke V5.0 jsonl invariant test**

- **Found during:** Task 3 (full regression run)
- **Issue:** The Task 1 GREEN commit (`8ab7147d3`) added `"rapid-preview-clips"` to the `JSONL_SLOTS = frozenset({...})`. The plan's Task 1 action explicitly said: *"If it is NOT consulted (only schema['format'] is consulted), leave it alone but add a comment noting it is informational-only. Do NOT modify JSONL_SLOTS blindly — verify the actual dispatch path first."* I verified `append_line()`/`write()`/`read()`/`read_lines()` all dispatch on `ASSET_SCHEMA[slot]["format"]` directly, NOT on `JSONL_SLOTS`. Per the plan's explicit guidance, I should have left `JSONL_SLOTS` unchanged.
- **Fix:** Reverted `JSONL_SLOTS` to `{"finetune-dataset"}` (original V5.0 value); added a detailed comment explaining why rapid-preview-clips is NOT in the frozenset (preserves V5.0 invariant; ASSET_SCHEMA format is the source of truth for dispatch). ALSO updated `test_asset_bus_phase35_slots.py::test_jsonl_slots_unchanged` to expect BOTH `finetune-dataset` AND `rapid-preview-clips` as jsonl-format slots (since the new slot IS jsonl-format in ASSET_SCHEMA — the test checks `[s for s, cfg in ASSET_SCHEMA.items() if cfg.get("format") == "jsonl"]`, not the frozenset).
- **Files modified:** `asset_bus.py`, `test_asset_bus_phase35_slots.py`
- **Verification:** `test_jsonl_slots_unchanged` passes; full regression suite green.
- **Commit:** `7e98288ca`

### Out-of-Scope Discoveries (deferred, NOT fixed)

**Pre-existing failure: `test_no_openclaw_references_in_phase_37_deliverables`**

- **File:** `plugins/kais_aigc/tests/test_canvas_sync_integration.py:744` (class `TestNoLegacyReferences`)
- **Issue:** Test scans Phase 37 deliverables for openclaw/Toonflow/sqlite references and finds `"sqlite"` / `"sqlite3"` in `canvas_sync.py` lines 406, 417, 426. This is caused by **uncommitted** modifications to `canvas_sync.py` that pre-existed before my Phase 40-01 work (visible in `git status`: ` M plugins/kais_aigc/canvas_sync.py` was already dirty at plan start). The committed V5.0 baseline does NOT have this failure.
- **Disposition:** Out of scope per deviation Rule scope boundary ("Only auto-fix issues DIRECTLY caused by the current task's changes. Pre-existing warnings, linting errors, or failures in unrelated files are out of scope."). Logged to deferred-items. The user should commit or revert the `canvas_sync.py` sqlite changes separately.

**Total deviations:** 2 auto-fixed (both Rule 1 bugs). **Impact:** Both fixes preserve the V5.0 regression invariant (592 passed). No production behavior changed by the fixes — the proxy only affects test execution, and the JSONL_SLOTS revert restores the V5.0 invariant exactly.

## Authentication Gates

None — no auth flows encountered during execution.

## Self-Check

**Files (all created/modified):**

- `FOUND`: /data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p10b_rapid_preview.py (NEW)
- `FOUND`: /data/workspace/hermes-agent/plugins/pipeline_state/asset_bus.py
- `FOUND`: /data/workspace/hermes-agent/plugins/pipeline_state/tests/test_asset_bus.py
- `FOUND`: /data/workspace/hermes-agent/plugins/pipeline_state/tests/test_asset_bus_phase35_slots.py
- `FOUND`: /data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/__init__.py
- `FOUND`: /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_phase_registry_full.py
- `FOUND`: /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_runner_full_dag.py
- `FOUND`: /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_e2e_degraded.py
- `FOUND`: /data/workspace/hermes-agent/plugins/kais_aigc/tests/test_canvas_sync_integration.py

**Commits (all 4 plan commits present in git log):**

- `FOUND`: 5bd539438 — test(40-01): RED — add failing tests for rapid-preview-clips + episode-meta slots
- `FOUND`: 8ab7147d3 — feat(40-01): GREEN — register rapid-preview-clips + episode-meta AssetBus slots
- `FOUND`: 5bffee4ce — feat(40-01): insert p10b_rapid_preview stub into PHASE_REGISTRY + update 5 V5.0 tests
- `FOUND`: 7e98288ca — fix(40-01): preserve JSONL_SLOTS frozenset + update V5.0 jsonl invariant test

**Verification commands (from PLAN `<verification>` block):**

- `PASS`: pytest target test files = 79 passed, 1 pre-existing out-of-scope failure deselected
- `PASS`: registry shape — 14 phases, p10b@10, p11@11, p11 depends_on `["p10b_rapid_preview"]`
- `PASS`: asset schema — both slots registered with correct format + writer_phase
- `PASS`: full V5.0 regression suite = 592 passed (only pre-existing failure remains)

## TDD Gate Compliance

Task 1 was `tdd="true"`. Verified gate sequence:

- `PASS` RED gate: `test(40-01): RED — add failing tests...` commit exists (5bd539438)
- `PASS` GREEN gate: `feat(40-01): GREEN — register...` commit exists after RED (8ab7147d3)

Task 2 was `tdd="true"`. Gate sequence:

- `PASS` RED gate: demonstrated before GREEN — 12 new asset_bus tests + registry tests failed before any production code change (verified inline during execution: "RED confirmed — 12 new tests all fail")
- `PASS` GREEN gate: `feat(40-01): insert p10b_rapid_preview stub...` commit exists (5bffee4ce). Note: Task 2 RED and GREEN landed in the SAME commit because the registry insertion and the test updates are tightly coupled — committing them separately would leave the repo in a broken state (registry has p10b but tests still expect 13 phases). The RED state was demonstrated via inline pytest run before the GREEN changes were applied.

## Next Step

Ready for **40-02** (PreviewEngine strategy — LTX-Video + slideshow subclasses) and **40-03** (real p10b_rapid_preview.run() implementation that consumes the strategy + writes the registered slots). The scaffolding (slots + registry entry + stub module + test fixtures) is in place; plans 02/03 can import `p10b_rapid_preview` and call `AssetBus.append_line("rapid-preview-clips", ...)` / `AssetBus.write("episode-meta", ...)` without further scaffolding.
