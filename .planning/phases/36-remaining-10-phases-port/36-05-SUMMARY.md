---
phase: 36-remaining-10-phases-port
plan: 36-05
subsystem: kais-movie-pipeline (PHASE_REGISTRY + references + full-DAG tests)
tags: [wave-2, phase-registry, full-dag, runner, parallel-shots, references-refinement]
requires:
  - 36-01 (p04-p06 modules + slots)
  - 36-02 (p07-p09 modules + slots)
  - 36-03 (p10-p11 modules + slots, parallel_shots)
  - 36-04 (p12-p13 modules + slots)
provides:
  - PHASE_REGISTRY 13-entry (full V8.6 DAG p01-p13)
  - test_phase_registry_full.py (9 tests)
  - test_runner_full_dag.py (6 tests)
  - Refined pipeline-dag.md (slot flow per edge)
  - Refined review-gates.md (all 8 gates mapped)
  - Refined asset-bus-schema.md (21-slot table)
  - Refined expert-mapping.md (module paths + goal templates)
  - Runner parallel_shots forwarding fix (Rule 2)
affects: []
tech-stack:
  added: []
  patterns:
    - Pattern 6 (PHASE_REGISTRY linear DAG — 13 entries)
    - Pattern 8 (references/ refinement from skeleton to full form)
    - Rule 2 auto-fix (runner forwards parallel_shots via signature introspection)
key-files:
  created:
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_phase_registry_full.py
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_runner_full_dag.py
  modified:
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/__init__.py
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/runner.py
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_p03_unit.py
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/references/pipeline-dag.md
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/references/review-gates.md
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/references/asset-bus-schema.md
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/references/expert-mapping.md
decisions:
  - "D-36-03 realized: PHASE_REGISTRY is a strict linear DAG (each phase depends_on previous) — no branching; intra-phase shot-level parallelism in p11 is plumbed via RunnerConfig.parallel_shots, not via DAG topology"
  - "Rule 2 fix: runner forwards RunnerConfig.parallel_shots to p11 via _parallel_shots_kwargs helper using inspect.signature — only p11 declares the kwarg (D-36-08); other 12 phases keep the Phase 35 5-arg signature untouched"
  - "References refinement strategy: replace skeleton stubs in-place (keeping Phase 35 content where still accurate), add new sections after the existing material — preserves git blame + backward compat for port engineers who bookmarked sections"
metrics:
  duration: ~7m
  completed: 2026-06-26
  tasks_total: 8
  tasks_completed: 8
  files_created: 2
  files_modified: 7
  tests_added: 15
  tests_passing: 445 (430 baseline + 15 new, zero regressions)
---

# Phase 36 Plan 36-05: PHASE_REGISTRY 13-Entry + References Refinement Summary

Wave 2 of Phase 36 — wires all 10 new Wave 1 phase modules into PHASE_REGISTRY (completing the full V8.6 13-phase DAG), refines 4 reference docs from skeleton to full form using actual port data, and adds 15 integration tests proving the full DAG runs end-to-end with checkpoint resume + parallel_shots forwarding.

## What Was Built

### 1. PHASE_REGISTRY 13-entry (`pipeline/phases/__init__.py`)
- Imported + aliased p04..p13 modules from Wave 1 (36-01..36-04)
- Appended 10 entries to PHASE_REGISTRY after the Phase 35 vertical slice (p01-p03)
- Linear DAG: each phase `depends_on` the previous one — no branching (parallelism is intra-phase in p11 only via `RunnerConfig.parallel_shots`)
- Re-exported all 13 modules under their canonical long names (`from pipeline.phases import p11_video_render` etc.)

### 2. New test_phase_registry_full.py (9 tests)
Asserts the production PHASE_REGISTRY has:
- 13 entries in canonical V8.6 DAG order (p01..p13)
- Linear `depends_on` chain (p0N depends on p0(N-1), p01 is root)
- All modules importable + expose `run()` callable
- Module `PHASE_ID` constants match registry ids (catches mis-wiring)
- Well-formed entries (id/module/depends_on keys, no duplicates)
- All 13 modules re-exported under long names
- All modules expose the Phase 35 template constants (PHASE_ID/EXPERT/INPUT_SLOTS/OUTPUT_SLOTS/GATE_ID)

### 3. New test_runner_full_dag.py (6 tests)
End-to-end orchestration against the REAL 13-phase PHASE_REGISTRY with mocked delegate_task (no real subagents, no real HTTP — D-35-08 contract):
- Full DAG runs p01 → p13, returns 13 phase results
- Checkpoint resume mid-pipeline: p07 checkpoint → restart resumes at p08, returns only p08..p13 (6 phases), `resumed_from=7`
- `enable_gates=False` suppresses gate triggering across the whole DAG (even phases with GATE_ID set report `gate=None`)
- `enable_gates=True` fires every gating phase in registry order (catches gate-fire order regressions)
- **`RunnerConfig.parallel_shots=7` reaches p11** (D-36-08 contract — verified via p11 proxy module that captures kwargs)
- Checkpoint persists after each phase (13 saves in registry order)

### 4. Rule 2 fix — Runner parallel_shots forwarding
**Discovered during Task 3 (RED test):** The runner's `module.run(...)` call forwarded only the 5 standard args, silently dropping `RunnerConfig.parallel_shots`. p11 always defaulted to 4 regardless of operator config — violating the D-36-08 / D-35-06 plumbing contract.

**Fix:** Added `_parallel_shots_kwargs(module, parallel_shots)` helper that uses `inspect.signature(module.run)` to detect whether the phase accepts a `parallel_shots` parameter. Only p11 declares it (keyword-only); the helper returns `{}` for the other 12 phases (which would otherwise `TypeError` on the unexpected kwarg). The runner now forwards `parallel_shots` only to phases that accept it.

### 5. Rule 1 fix — Stale Phase 35 assertion
`test_p03_unit.py::test_registry_has_three_entries` asserted `len(PHASE_REGISTRY) == 3` — this hard-coded count was incorrect the moment Phase 36-05 Task 1 extended the registry to 13 entries. Relaxed to `>= 3` and changed the equality check on `ids` to a slice check `ids[:3]` (Phase 35 floor still asserted; full DAG verified by the new test_phase_registry_full.py).

### 6. References refinement (4 docs)
- **pipeline-dag.md** — added "Slot Flow Per Edge" table: 12 DAG edges with concrete slot names (sourced from Wave 1 module `OUTPUT_SLOTS`/`INPUT_SLOTS`) + cross-cutting reads (e.g. `script-draft` re-read by p05/p10) + side outputs (slots written once, consumed by gates only). Updated Scope table from "Future/Skeleton" to "Complete".
- **review-gates.md** — replaced "Phase 35 Gates" stub (3 gates) with "All 8 Gates (Phase 35+36 Complete)" table mapping each gate to its actual module `GATE_ID` constant + reviewer role + mode (hard/soft). Added list of phase modules with `GATE_ID = None` and why (e.g. p04's gate fires after p05, not p04).
- **asset-bus-schema.md** — replaced "Phase 36 Future Slots TBD" placeholder with full 21-slot table: slot / format / writer phase / reader phases / V8.6 equivalent. Added "Naming clarifications" subsection documenting resolved decisions (e.g. `character-bible` not `character-bible-2.0`; `video-clips` is JSON single-write not JSONL even though p11 fans out per-shot delegate calls).
- **expert-mapping.md** — updated Scope column from "Phase 36" to "Phase 36 Complete (36-0X)" + actual module file path per row. Added new "Per-Phase delegate_task Goal Templates" section: per-phase summary of the goal string's verb + skill_view mentions + output JSON shape (sourced from Wave 1 SUMMARYs).

## Verification Results

| Check | Result |
|-------|--------|
| PHASE_REGISTRY has 13 entries | PASS (verified at runtime) |
| test_phase_registry_full.py (9 tests) | PASS |
| test_runner_full_dag.py (6 tests) | PASS |
| Full kais-movie-pipeline + plugins suite | **445 passed** (430 baseline + 15 new, 0 regressions) |
| `asset-bus-schema.md` no bare "TBD/Future Slots" placeholders | PASS (only historical note explaining placeholder was REPLACED) |
| `master-mp4` slot documented | PASS (2 occurrences — slot row + naming clarification) |
| p10_unit.py deferred bug (36-04 SUMMARY noted) | **Already fixed** by 36-03 in commit `10a865044` (9/9 pass) |
| Anti-pattern scan in runner fix (no LLM/subprocess.node/prompt_template) | CLEAN |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Runner forwards parallel_shots to p11**
- **Found during:** Task 3 (RED test `test_full_dag_parallel_shots_config_reaches_p11`)
- **Issue:** `runner.run_episode()` called `module.run(episode_id=..., asset_bus_read=..., asset_bus_write=..., delegate_task=..., trigger_gate=...)` — silently dropping `RunnerConfig.parallel_shots`. p11_video_render always defaulted to 4 regardless of operator config, violating the D-36-08 contract (the whole reason `parallel_shots` exists in RunnerConfig per D-35-06).
- **Fix:** Added `_parallel_shots_kwargs(module, parallel_shots)` helper that uses `inspect.signature(module.run)` to detect the optional `parallel_shots` parameter. The runner now does `module.run(..., **_parallel_shots_kwargs(module, cfg.parallel_shots))`. Only p11 declares the kwarg (keyword-only per D-36-08); the other 12 phases return `{}` from the helper and remain on the Phase 35 5-arg signature untouched.
- **Files modified:** `pipeline/runner.py`
- **Commit:** `bb0171063`

**2. [Rule 1 - Bug] Stale test_p03_unit assertion after registry extension**
- **Found during:** Task 3 (regression run after Rule 2 fix)
- **Issue:** `test_p03_unit.py::test_registry_has_three_entries` asserted `len(phases_mod.PHASE_REGISTRY) == 3` and `ids == ["p01_hook_topic", "p02_outline", "p03_script_audit"]`. After Task 1 extended the registry to 13 entries (the entire point of this plan), this Phase 35 floor assertion became stale.
- **Fix:** Relaxed `== 3` to `>= 3` (Phase 35 vertical-slice floor still asserted) and changed the full-list `ids ==` check to a `ids[:3] ==` slice check. The full 13-entry DAG is verified by the new `test_phase_registry_full.py`.
- **Files modified:** `tests/test_p03_unit.py`
- **Commit:** `bb0171063`

### Notes

- **Deferred p10 bug already resolved:** The 36-04 SUMMARY noted `test_p10_unit.py::test_p10_writes_voice_clips_and_voice_timeline_slots` raised `TypeError` at line 164 (deferred to 36-05 per SCOPE BOUNDARY). Investigation during Task 8 showed this was already fixed in commit `10a865044` (36-03 Rule 1 auto-fix — extended `_asset_bus_factory` to return a 3-tuple). 9/9 p10 tests pass; no work needed.
- **Parallel registry binding:** `test_runner_full_dag.py::test_full_dag_parallel_shots_config_reaches_p11` swaps the p11 entry in BOTH `phases_mod.PHASE_REGISTRY` AND `runner_mod.PHASE_REGISTRY` because `test_p03_unit.py::test_registry_has_three_entries` calls `importlib.reload(phases_mod)` which re-binds phases_mod's list to a fresh object, leaving runner_mod holding the OLD list. This mirrors the Phase 35-05 binding-fix pattern documented in conftest.py's `fake_registry` fixture.

## Known Stubs

None — all changes are fully wired. PHASE_REGISTRY contains real module references (not stubs), runner fix forwards real config, references docs cite actual implementation data (no "TBD"/"Future" placeholders remaining). The 4 reference docs are documentation (no executable code); their "stubs" would be unfilled sections — all sections now contain concrete data.

## TDD Gate Compliance

N/A — plan frontmatter `type: execute` (not `type: tdd`). However, the runner parallel_shots fix followed an implicit RED→GREEN cycle: Task 3 wrote the failing test first (RED: `assert captured_kwargs.get("parallel_shots") == 7` failed), then the Rule 2 runner fix made it pass (GREEN). No REFACTOR step needed — the helper is minimal.

## Self-Check: PASSED

- [x] `/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/__init__.py` — FOUND (contains `p13_delivery` entry + import)
- [x] `/data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_phase_registry_full.py` — FOUND (contains `def test_phase_registry_has_13_entries`)
- [x] `/data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_runner_full_dag.py` — FOUND (contains `def test_full_dag_runs_p01_through_p13`)
- [x] `/data/workspace/hermes-agent/skills/kais-movie-pipeline/references/asset-bus-schema.md` — FOUND (contains `master-mp4` + 21-slot table)
- [x] `/data/workspace/hermes-agent/skills/kais-movie-pipeline/references/pipeline-dag.md` — FOUND (contains "Slot Flow Per Edge")
- [x] `/data/workspace/hermes-agent/skills/kais-movie-pipeline/references/review-gates.md` — FOUND (contains "All 8 Gates")
- [x] `/data/workspace/hermes-agent/skills/kais-movie-pipeline/references/expert-mapping.md` — FOUND (contains "Per-Phase delegate_task Goal Templates")
- [x] Commit `cb418b9bd` (PHASE_REGISTRY 13-entry) — FOUND in git log
- [x] Commit `b392332c3` (test_phase_registry_full) — FOUND in git log
- [x] Commit `bb0171063` (test_runner_full_dag + Rule 2 runner fix + Rule 1 p03 fix) — FOUND in git log
- [x] Commit `64ce622e4` (references refinement) — FOUND in git log
