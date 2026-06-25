---
phase: 36-remaining-10-phases-port
plan: 36-01
subsystem: kais-movie-pipeline (script-stage continuation)
tags: [port, python, orchestration, atomic-operation, v86]
requires:
  - p03_script_audit (script-draft slot producer)
  - Phase 35 PATTERNS (template)
  - Phase 36-02 sibling (asset_bus.py co-edit)
provides:
  - p04_character_design module (character-bible + character-assets slots)
  - p05_pain_discovery module (pain-points + escalation-ladder slots)
  - p06_spatio_temporal_script module (spatio-temporal-script + final-audit slots)
  - 6 new ASSET_SCHEMA slots
affects:
  - plugins/pipeline_state/asset_bus.py (ASSET_SCHEMA extended)
  - plugins/pipeline_state/tests/test_asset_bus_phase35_slots.py (assertion relaxed)
tech-stack:
  added: []
  patterns:
    - Pattern 1 (Phase module skeleton from Phase 35)
    - Pattern 2 (delegate_task goal shape with skill_view mentions)
    - Pattern 3 (Atomic §5 single delegate_task call for multi-expert)
    - Pattern 4 (AssetBus slot extension per Wave 1 plan)
    - Pattern 5 (Test file per phase, mocked delegate_task)
key-files:
  created:
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p04_character_design.py
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p05_pain_discovery.py
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p06_spatio_temporal_script.py
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_p04_unit.py
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_p05_unit.py
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_p06_unit.py
  modified:
    - /data/workspace/hermes-agent/plugins/pipeline_state/asset_bus.py (6 slots added)
    - /data/workspace/hermes-agent/plugins/pipeline_state/tests/test_asset_bus_phase35_slots.py (assertion relaxed)
decisions:
  - "p04 GATE_ID=None per V8.6 gates.yaml (Gate 4 shot-prep fires after p05, not p04) — documented in module docstring"
  - "p06 atomic §5 invariant verified by test: 3 experts (screenplay + cinematographer + script_auditor), exactly 1 delegate_task call (CF-36-03)"
  - "p05 GATE_ID='shot-prep' (Gate 4) — operator confirms pain points + escalation before visual design"
metrics:
  duration: ~12m
  completed: 2026-06-26
  tasks: 9
  files: 8
  tests-added: 21
  tests-passing: 221 (21 new + 200 regression)
---

# Phase 36 Plan 36-01: p04-p06 Character / Pain-Discovery / Spatio-Temporal Port Summary

Ports the V8.6 script-stage continuation phases (character design, pain point mining, spatio-temporal script + final audit) from Node.js to Python PURE ORCHESTRATION modules following the Phase 35 template. Each phase is a single atomic delegate_task call with multi-expert collaboration orchestrated by the subagent.

## What Was Built

**Three phase modules** (all follow Pattern 1 skeleton from PATTERNS.md):

1. **p04_character_design.py** — V8.6 Step 4 atomic. character_designer produces Character Bible 2.0 (4D-Anchor + style_prefix); visual_executor renders L1-L4 asset manifest. Reads `script-draft`, writes `character-bible` + `character-assets`. No gate (Gate 4 fires after p05).

2. **p05_pain_discovery.py** — V8.6 Step 5 atomic. creative_source mines L1-L6 pain strata; theory_critic stress-tests + builds escalation ladder. Reads `character-bible` + `script-draft`, writes `pain-points` + `escalation-ladder`. Triggers Gate 4 `shot-prep`.

3. **p06_spatio_temporal_script.py** — V8.6 Step 6 / §5 atomic. screenplay produces spatio-temporal script; cinematographer locks axis + composition; script_auditor runs final 5-dim audit. **CF-36-03 invariant: 3 experts collaborate in exactly 1 delegate_task call** (verified by `test_p06_atomic_single_delegate_call_despite_three_experts`). Reads `script-draft` + `character-bible`, writes `spatio-temporal-script` + `final-audit`. Triggers Gate 6 `spatio-temporal`.

**Six new ASSET_SCHEMA slots** added to asset_bus.py (D-36-04 per-plan extension): `character-bible`, `character-assets`, `pain-points`, `escalation-ladder`, `spatio-temporal-script`, `final-audit`. Existing slots preserved byte-equivalent.

**Twenty-one unit tests** (7 per phase): skill_view mentions in goal, single delegate_task call with `['skills', 'file']` toolsets, correct slot reads/writes, gate trigger when configured + skip when None, empty-input graceful handling, and the atomic §5 invariant for p06.

## Verification

```
=== p04/p05/p06 unit tests ===
21 passed in 0.06s

=== Full regression (skills + pipeline_state) ===
221 passed, 1 warning in 1.26s

=== Anti-pattern grep (must be empty) ===
(empty — no openai/anthropic/prompt_template/subprocess.node)

=== p06 atomic §5 invariant (expect 1 delegate_task call) ===
1

=== Asset bus new slot references (expect >=6) ===
14
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Relaxed stale Phase 35 asset-bus slot count assertion**
- **Found during:** Task 8 (regression run)
- **Issue:** `test_asset_bus_phase35_slots.py::test_total_slot_count_is_10` asserted `len(ASSET_SCHEMA) == 10`, but Phase 36 D-36-04 explicitly extends the schema per Wave 1 plan (36-01 adds 6 slots, sibling 36-02 adds 7 more → total 23). The hard-coded count was stale the moment Phase 36 Wave 1 began.
- **Fix:** Changed assertion from `== 10` to `>= 10` and renamed test to `test_total_slot_count_at_least_10`, documenting that Phase 36 extensions are expected. The Phase 35 baseline (4 Phase 33 + 6 Phase 35 = 10 floor) is still verified.
- **Files modified:** `plugins/pipeline_state/tests/test_asset_bus_phase35_slots.py`
- **Commit:** 366d75e24

### Sibling Plan Coordination

**asset_bus.py co-edit with 36-02:** Wave 1 sibling plan 36-02 (p07-p09) extended ASSET_SCHEMA in parallel and committed first (9b0abe065). That commit included both siblings' slot additions because both plans edited the same file. My 6 slots (`character-bible`, `character-assets`, `pain-points`, `escalation-ladder`, `spatio-temporal-script`, `final-audit`) are present in the committed file. No conflict — D-36-04 anticipated per-plan extension and slots are additive.

## Known Stubs

None — all three modules are fully wired PURE ORCHESTRATION. No hardcoded empty values, no placeholder text, no components without data sources. The modules delegate all creative work to expert skills via delegate_task (the contract).

## TDD Gate Compliance

N/A — plan frontmatter `type: execute` (not `type: tdd`). Tasks 5-7 wrote tests after implementation (tasks 2-4), which is the standard execute-plan flow for port work where the template is proven (Phase 35).

## Self-Check: PASSED

- [x] `/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p04_character_design.py` — FOUND (contains `EXPERT = "character_designer"`)
- [x] `/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p05_pain_discovery.py` — FOUND (contains `EXPERT = "creative_source"`)
- [x] `/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p06_spatio_temporal_script.py` — FOUND (contains `skill_view(name='script_auditor')`)
- [x] `/data/workspace/hermes-agent/plugins/pipeline_state/asset_bus.py` — FOUND (contains `character-bible`)
- [x] Commit `366d75e24` — FOUND in git log
