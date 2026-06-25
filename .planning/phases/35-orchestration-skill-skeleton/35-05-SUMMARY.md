---
phase: 35-orchestration-skill-skeleton
plan: 05
subsystem: orchestration-tests
tags: [pipeline, tests, runner, discovery, vertical-slice, pytest, mocked-delegate, skill-discovery]
requires:
  - "35-01 (SKILL.md + pipeline/ package markers)"
  - "35-02 (runner.py + AssetBus ASSET_SCHEMA extension)"
  - "35-03 (p01_hook_topic + p02_outline + p03_script_audit phase modules)"
  - "Phase 33 (pipeline_state — AssetBus, PipelineStateStore)"
  - "Phase 34 (review_gates — gate IDs)"
provides:
  - "test_runner.py — 17 runner tests: RunnerConfig defaults, empty/2-phase registry, checkpoint resume, _compute_start_index, enable_gates=False knob, conftest fixture smoke tests"
  - "test_p01_p02_p03.py — 13 vertical-slice lifecycle tests (5 p01 + 4 p02 + 4 p03) verifying read/delegate/write/gate contract"
  - "test_skill_discovery.py — 6 SC#4 discovery tests: frontmatter validity, body sections, skills_list discovery, skill_view content"
  - "conftest.py — 5 shared fixtures: mock_delegate_factory, tmp_asset_bus, tmp_state_store, fake_registry (reload-safe), make_fake_phase"
  - "tests/__init__.py — pytest package marker"
  - "Reload-safe PHASE_REGISTRY fixture pattern (rebinds BOTH phases + runner module attrs)"
affects:
  - "skills/kais-movie-pipeline/tests/conftest.py — NEW (fake_registry + factories)"
  - "skills/kais-movie-pipeline/tests/test_runner.py — EXTENDED (clean_registry reload-safe + TestRunnerWithConftestFixtures class)"
  - "skills/kais-movie-pipeline/tests/test_p01_p02_p03.py — REWRITTEN (skip markers removed, gate id corrected, tripwire removed)"
  - "skills/kais-movie-pipeline/tests/test_skill_discovery.py — NEW"
  - "skills/kais-movie-pipeline/tests/__init__.py — NEW"
tech-stack:
  added: []
  patterns:
    - "D-35-08 mocked tests: mock_delegate_factory emits fenced JSON; no real subagents/network/GPU anywhere"
    - "Reload-safe PHASE_REGISTRY fixture: rebinds BOTH phases_mod.PHASE_REGISTRY AND runner_mod.PHASE_REGISTRY to defend against sibling test_p03_unit.py's importlib.reload(phases_mod)"
    - "Skill discovery tests monkeypatch tools.skills_tool.SKILLS_DIR + agent.skill_utils.get_external_skills_dirs (no ~/.hermes/ state dependency)"
    - "test_p01_p02_p03.py testsuites organized by phase class (TestP01HookTopic, TestP02Outline, TestP03ScriptAudit) — mirrors module structure"
key-files:
  created:
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/__init__.py
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/conftest.py
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_skill_discovery.py
  modified:
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_runner.py
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_p01_p02_p03.py
decisions:
  - "D-35-08 enforced across all 22 Phase 35-05 tests: mock_delegate_factory + tmp_asset_bus + tmp_state_store — ZERO real subagent spawns, HTTP, or GPU calls"
  - "Reload-safe fixture pattern chosen over modifying runner.py — production code unchanged; fixture rebinds both module references defensively"
  - "test_p01_p02_p03.py gate ids taken from the actual module constants (p02 GATE_ID='story-framework-outline', not the abbreviated 'framework-outline' the plan's PATTERNS.md originally suggested)"
  - "Skill discovery tests point external_dirs at /data/workspace/hermes-agent/skills (the real on-disk location) instead of symlinking ~/.hermes/skills/ — operators configure this same path per SKILL.md §Operator Setup"
  - "Tripwire test removed: with 35-03 shipped, the @pytest.mark.skip markers are obsolete; the lifecycle tests now execute directly against real p01/p02/p03 modules"
metrics:
  duration: ~5 min
  completed: 2026-06-26
  tasks_completed: 2
  files_created: 3
  files_modified: 2
  tests_added: 22
  tests_passing: 53
  cross_plugin_regression: 353
---

# Phase 35 Plan 05: Test Suite + Skill Discovery Verification Summary

End-to-end test coverage for the Phase 35 vertical slice: 22 new tests across 3 files verify the runner loop, p01-p03 phase-module lifecycle, and skill discovery. Plus a reload-safe PHASE_REGISTRY fixture (Rule 3 fix) that resolves the 9 cross-test failures documented as deferred in 35-03-SUMMARY. All 53 Phase 35 tests pass; 353-test cross-plugin regression clean.

## What Was Built

### Task 1: conftest.py + test_runner.py extension

**conftest.py (5 shared fixtures):**
- `mock_delegate_factory` — factory `(output_dict) -> delegate_task`. Returns a callable matching production signature `(goal, context, toolsets) -> {"summary": ...}`; embeds output as fenced JSON (matches phase-module parse contract); captures last invocation on `.last_call` attribute
- `tmp_asset_bus` — `(bus, workdir)` tuple; real `AssetBus(str(tmp_path))` for slot round-trip tests
- `tmp_state_store` — `(store, workdir)` tuple; real `PipelineStateStore(str(tmp_path))`
- `fake_registry` — clears PHASE_REGISTRY, yields it for test population, restores on teardown. **Reload-safe**: rebinds BOTH `phases_mod.PHASE_REGISTRY` AND `runner_mod.PHASE_REGISTRY` to defend against `test_p03_unit.py`'s `importlib.reload(phases_mod)` which rebinds the phases module attribute to a new list object
- `make_fake_phase` — factory `(phase_id, output_dict, gate_id=None) -> fake_module`. Returns an object exposing the standard `run()` signature; records invocations on `.calls`; exercises gate logic if configured

**test_runner.py (17 tests, all passing):**
- `TestRunnerConfigDefaults` (4 tests) — parallel_shots=4 default (D-35-06), workdir=".", enable_gates=True, config overridable
- `TestEmptyRegistry` (2 tests) — empty registry returns immediately with `phases={}` + config echoed
- `TestTwoPhaseExecution` (2 tests) — 2-entry stub registry executes both in order; checkpoint saved after each; injected callables reach phase `.run()`
- `TestCheckpointResume` (4 tests) — resume skips completed phase; `_compute_start_index` returns 0 for None/unknown phase, correct idx for known phase
- `TestGateConfigKnob` (2 tests) — `enable_gates=False` passes None to phase module; `enable_gates=True` passes callable
- `TestRunnerWithConftestFixtures` (3 tests, Phase 35-05 new) — fake_registry drives run_episode; tmp_asset_bus round-trips slots; mock_delegate_factory emits fenced JSON

### Task 2: test_p01_p02_p03.py + test_skill_discovery.py

**test_p01_p02_p03.py (13 lifecycle tests, all passing):**

p01_hook_topic (5 tests):
- `test_p01_invokes_hook_retention_expert` — goal contains `skill_view(name='hook_retention')`
- `test_p01_reads_requirement_slot` — requirement content reaches delegate context
- `test_p01_writes_topic_kernel_and_hook_design` — both output slots written
- `test_p01_triggers_gate_1_when_enabled` — Gate 1 `selection-topic-hook` fires with correct args
- `test_p01_skips_gate_when_none` — `trigger_gate=None` → no gate, `result["gate"] is None`

p02_outline (4 tests):
- `test_p02_invokes_creative_source_and_screenplay` — goal mentions BOTH experts
- `test_p02_reads_topic_kernel_slot` — topic-kernel content reaches context
- `test_p02_writes_story_framework` — full expert payload (story_kernel + snowflake + snyder) written
- `test_p02_triggers_gate_2_when_enabled` — Gate 2 `story-framework-outline` fires

p03_script_audit (4 tests):
- `test_p03_invokes_screenplay_and_script_auditor` — goal mentions BOTH experts
- `test_p03_reads_story_framework_slot` — story-framework content reaches context
- `test_p03_writes_script_draft_and_audit_report` — both output slots written
- `test_p03_triggers_gate_3_when_enabled` — Gate 3 `script-audit` fires

**test_skill_discovery.py (6 tests, all passing) — SC#4 proof:**
- `test_skill_md_exists` — SKILL.md present at canonical path
- `test_skill_md_frontmatter_valid` — yaml.safe_load parses; mandatory fields present (name, description ≤1024, version, metadata.hermes.{tags, related_skills, expert_id, metrics})
- `test_related_skills_lists_15_movie_experts` — related_skills has exactly 15 entries including canonical subset
- `test_skill_md_has_required_body_sections` — all 8 sections present (## When to use, ## References, ## Pipeline DAG, ## Phase ↔ Expert Mapping, ## Review Gates, ## Runner, ## Operator Setup, ## What NOT to do)
- `test_skill_discoverable_in_external_dirs` — monkeypatch `SKILLS_DIR` to empty tmp + `get_external_skills_dirs` to `[hermes-agent/skills]`; `skills_list()` returns JSON including `kais-movie-pipeline`
- `test_skill_view_returns_content` — same monkeypatch; `skill_view("kais-movie-pipeline")` returns success + name match + >1000-char content + "## Pipeline DAG" section

## Success Criteria Met

- **SC#1 (HERMES-SKILL-01, SKILL.md valid)**: test_skill_discovery tests 1-3 verify frontmatter parses + mandatory fields + 15 related_skills. MET.
- **SC#2 (HERMES-SKILL-02, runner + checkpoint + parallel_shots)**: test_runner 17 tests cover RunnerConfig defaults, empty registry, 2-phase execution, checkpoint resume, `_compute_start_index`, enable_gates knob. MET.
- **SC#3 (HERMES-SKILL-03, p01-p03 lifecycle)**: test_p01_p02_p03 13 tests verify each phase's read→delegate→write→gate contract. MET.
- **SC#4 (HERMES-SKILL-04, skill discovery)**: test_skill_discovery tests 5-6 verify `skills_list()` finds the skill and `skill_view()` returns content when `external_dirs` is configured. MET.
- **SC#5 (refs skeleton)**: verified in 35-04 (out of scope here).
- **D-35-08 (mocked tests)**: every test uses mock_delegate_factory / mocked gates / tmp_path workdir. ZERO real subagent spawns, HTTP, or GPU calls. MET.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Reload-safe PHASE_REGISTRY fixtures**
- **Found during:** First full-suite run (`python3 -m pytest skills/kais-movie-pipeline/tests/`)
- **Issue:** 9 tests in test_runner.py failed when run after test_p03_unit.py. Root cause: `test_p03_unit.py` calls `importlib.reload(phases_mod)` to verify the registry is populated, which RE-BINDS `phases_mod.PHASE_REGISTRY` to a NEW list object. The runner's `from pipeline.phases import PHASE_REGISTRY` (executed at runner-import time) still holds the OLD list reference, so the fixture's in-place `.clear()` / `.extend()` mutations on the new list never reach the runner. This was documented as "Deferred Issues #1" in 35-03-SUMMARY with owner "Phase 35-05 sibling (test_runner.py owner) or Phase 36 final integration."
- **Fix:** Rewrote both `clean_registry` (local fixture in test_runner.py) and `fake_registry` (conftest.py shared fixture) to rebind BOTH `phases_mod.PHASE_REGISTRY` AND `runner_mod.PHASE_REGISTRY` to a shared fresh list for the duration of each test, then restore both module attributes to their pre-test snapshots on teardown. Now the fixture's mutations are guaranteed to reach the runner regardless of any sibling-test reload.
- **Files modified:** `skills/kais-movie-pipeline/tests/conftest.py`, `skills/kais-movie-pipeline/tests/test_runner.py`
- **Commit:** 5e6e026b1

**2. [Rule 1 — Bug] p02 gate id mismatch in test_p02_triggers_gate_2_when_enabled**
- **Found during:** Removing skip markers from test_p01_p02_p03.py
- **Issue:** The pre-35-03 stub expected gate id `"framework-outline"`, but the actual `p02_outline.GATE_ID` constant (shipped by 35-03) is `"story-framework-outline"`. Test would fail with `assert [("story-framework-outline", ...)] == [("framework-outline", ...)]`.
- **Fix:** Updated the assertion to match the canonical module constant. Added a comment clarifying that the canonical id lives in the module (not abbreviated in PATTERNS.md).
- **Files modified:** `skills/kais-movie-pipeline/tests/test_p01_p02_p03.py`
- **Commit:** 5e6e026b1

**3. [Rule 3 — Blocking] Removed obsolete tripwire + skip markers**
- **Found during:** Inspection of pre-existing test_p01_p02_p03.py
- **Issue:** The pre-35-03 stub had `@pytest.mark.skip(reason="waiting for 35-03 modules")` on all 13 lifecycle tests plus a tripwire `test_phase_modules_presence_flag` that would skip the suite when modules became available. With 35-03 shipped, both mechanisms are obsolete — they suppress the very tests Phase 35-05 requires.
- **Fix:** Removed all 4 skip markers (3 class-level + the tripwire). Removed the tripwire test entirely (modules-present is the production state now). All 13 lifecycle tests execute against real p01/p02/p03 modules.
- **Files modified:** `skills/kais-movie-pipeline/tests/test_p01_p02_p03.py`
- **Commit:** 5e6e026b1

## Authentication Gates

None.

## Known Stubs

None. Tests verify orchestration correctness via mocked delegate_task; no placeholder text, no `TODO`/`FIXME`. The mock delegate factory returns canned JSON matching the production delegate contract.

## Threat Flags

None. Tests introduce no new network endpoints, auth paths, file access patterns, or trust-boundary schema changes. The skill discovery tests monkeypatch `SKILLS_DIR` to an empty `tmp_path` (neutralize local state) and point `get_external_skills_dirs` at the real `/data/workspace/hermes-agent/skills` (the operator's documented config path) — no new trust surface.

## Verification

```bash
cd /data/workspace/hermes-agent

# Per-plan Task 1 verify block — runner tests
python3 -m pytest skills/kais-movie-pipeline/tests/test_runner.py -v
# → 17 passed in 0.06s

# Per-plan Task 2 verify block — p01-p03 + discovery
python3 -m pytest skills/kais-movie-pipeline/tests/test_p01_p02_p03.py \
                    skills/kais-movie-pipeline/tests/test_skill_discovery.py -v
# → 19 passed in 0.29s

# Full Phase 35 suite (all sibling plans + 35-05)
python3 -m pytest skills/kais-movie-pipeline/tests/
# → 53 passed in 0.32s

# Cross-plugin regression (critical_reminder #6)
python3 -m pytest plugins/kais_aigc/tests/ \
                    plugins/pipeline_state/tests/ \
                    plugins/review_gates/tests/ \
                    skills/kais-movie-pipeline/tests/
# → 353 passed, 9 warnings (pre-existing jwt/discord.py), 0 failures in 5.02s
```

Final result: **22 new Phase 35-05 tests, 53 Phase 35 total, 353 cross-plugin regression — all green.**

## Key Design Decisions

1. **Reload-safe fixtures over modifying production code.** The `importlib.reload(phases_mod)` in sibling `test_p03_unit.py` is legitimately verifying that `PHASE_REGISTRY` is populated on first import (a real correctness property of 35-03). Rather than weaken that test or modify `runner.py` to do deferred lookups (which would add production-code complexity for a test-only concern), the fixtures defensively rebind both module attributes. This is a one-time fix that benefits any future test that needs to mutate the registry.

2. **Skill discovery tests use the real on-disk SKILL.md.** Tests monkeypatch `get_external_skills_dirs` to return `[Path("/data/workspace/hermes-agent/skills")]` — the same path operators configure in `~/.hermes/config.yaml` per the SKILL.md §Operator Setup section. This exercises the real discovery scan logic (recursive SKILL.md walk, frontmatter parse, collision detection, platform filter) end-to-end. The alternative (constructing a synthetic skill tree in tmp_path) would have tested less of the real code path.

3. **Each lifecycle test asserts ONE contract aspect.** Rather than write a single "test p01 end-to-end" mega-test, each test isolates one property (expert invocation, slot read, slot write, gate trigger, gate skip). This makes failures pinpoint the exact contract violation. The trade-off is more tests total (13 vs ~5), but each is 8-15 lines and trivially debuggable.

4. **Mock delegate factory returns canned output, not a callable that branches on goal.** Tests don't try to make the mock "smart" (e.g., return different outputs for p01 vs p02 goals). Each test sets up its own delegate with the exact output it needs via `mock_delegate_factory({...})`. This keeps the mock honest — the test is asserting the phase module's behavior given a known expert response, not asserting the mock mimics expert behavior.

## Self-Check: PASSED

Files verified to exist on disk:
- FOUND: /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/__init__.py
- FOUND: /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/conftest.py (5 fixtures, reload-safe)
- FOUND: /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_runner.py (17 tests)
- FOUND: /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_p01_p02_p03.py (13 tests, no skip markers)
- FOUND: /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_skill_discovery.py (6 tests)

Commits verified to exist in hermes-agent repo:
- FOUND: 5e6e026b1 (test Phase 35-05 — activate lifecycle tests + reload-safe fixtures + gate id fix)
- FOUND: 45ea35f96 (test Phase 35-05 pre-stub — skipped lifecycle + discovery tests; superseded by 5e6e026b1)

Test counts verified:
- Phase 35-05 owned tests: 22 (13 lifecycle + 3 conftest-fixture smoke + 6 discovery)
- Phase 35 total: 53 (22 + 17 35-03 unit + 14 carry-over from 35-02/35-03 registries)
- Cross-plugin regression: 353 passed, 0 failed
