---
phase: 36-remaining-10-phases-port
plan: master
type: execute
wave: N/A                  # Master — see child plans for wave assignment
depends_on: [35]
files_modified: []         # See child plans
autonomous: true
requirements: [HERMES-SKILL-03, HERMES-SKILL-05]
user_setup: []

must_haves:
  truths:
    - "All 10 phase modules (p04-p13) implement the Phase 35 lifecycle template (read bus → delegate_task → write bus → trigger gate if configured)"
    - "Each phase module delegates to the correct V8.6-assigned expert(s) via skill_view mention in the goal"
    - "Behavior aligns with Node.js lib/phases/index.js V8.6 handlers — same input slots read, same output slots written, same gates triggered (reference port per D-36-01)"
    - "runner.py sequentially schedules p01-p13 (13 phases) with mocked delegate; checkpoint at any phase + restart resumes from correct phase"
    - "p11_video_render fans out shot-level delegate calls concurrently up to parallel_shots=4 (D-36-08 actual dispatch)"
    - "PHASE_REGISTRY in pipeline/phases/__init__.py contains all 13 phase entries in DAG order with correct depends_on"
    - "references/ 4 docs refined from skeleton to full form — concrete per-phase slot flow, all 8 gates mapped, ~20 slots documented, expert goal templates summarized"
    - "All Phase 36 tests pass: 10 per-phase unit test files (4-7 tests each) + test_phase_registry_full + test_runner_full_dag"
  artifacts:
    - path: "/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p04_character_design.py"
      provides: "Phase 04 — character_designer + visual_executor (drawer)"
      contains: "EXPERT = \"character_designer\""
    - path: "/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p05_pain_discovery.py"
      provides: "Phase 05 — creative_source (re-invoke) + theory_critic"
      contains: "EXPERT = \"creative_source\""
    - path: "/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p06_spatio_temporal_script.py"
      provides: "Phase 06 — screenplay + cinematographer + script_auditor atomic §5"
      contains: "EXPERT = \"screenplay\""
    - path: "/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p07_scene_generation.py"
      provides: "Phase 07 — visual_executor + prompt_injector + style_genome + colorist atomic §4"
      contains: "EXPERT = \"visual_executor\""
    - path: "/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p08_scene_selection.py"
      provides: "Phase 08 — cinematographer + editor (geometry-bed consistency)"
      contains: "EXPERT = \"cinematographer\""
    - path: "/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p09_shot_breakdown.py"
      provides: "Phase 09 — cinematographer + continuity_auditor (E-Konte 5-layer)"
      contains: "EXPERT = \"cinematographer\""
    - path: "/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p10_voice.py"
      provides: "Phase 10 — audio_pipeline voicer sub-step"
      contains: "EXPERT = \"audio_pipeline\""
    - path: "/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p11_video_render.py"
      provides: "Phase 11 — visual_executor animator + audio_pipeline lip_sync with parallel_shots fan-out"
      contains: "parallel_shots"
    - path: "/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p12_composition.py"
      provides: "Phase 12 — audio_pipeline (composer+foley+mixer+spatial) + editor"
      contains: "EXPERT = \"audio_pipeline\""
    - path: "/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p13_delivery.py"
      provides: "Phase 13 — colorist + compliance_gate + editor (final delivery)"
      contains: "EXPERT = \"colorist\""
    - path: "/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/__init__.py"
      provides: "PHASE_REGISTRY extended with all 13 phases in DAG order"
      contains: "p13_delivery"
    - path: "/data/workspace/hermes-agent/skills/kais-movie-pipeline/references/pipeline-dag.md"
      provides: "Refined — per-edge slot flow table"
    - path: "/data/workspace/hermes-agent/skills/kais-movie-pipeline/references/review-gates.md"
      provides: "Refined — all 8 gates with actual trigger phase"
    - path: "/data/workspace/hermes-agent/skills/kais-movie-pipeline/references/asset-bus-schema.md"
      provides: "Refined — ~20 actual slots documented"
    - path: "/data/workspace/hermes-agent/skills/kais-movie-pipeline/references/expert-mapping.md"
      provides: "Refined — per-phase goal template summary"
    - path: "/data/workspace/hermes-agent/plugins/pipeline_state/asset_bus.py"
      provides: "ASSET_SCHEMA extended with ~20 p04-p13 phase-output slots"
      contains: "character-bible"
  key_links:
    - from: "p06_spatio_temporal_script.py"
      to: "delegate_task (screenplay + cinematographer + script_auditor atomic)"
      via: "single delegate_task call mentioning all 3 skill_views"
      pattern: "skill_view\\(name=['\"]screenplay['\"]\\).*skill_view\\(name=['\"]cinematographer['\"]\\).*skill_view\\(name=['\"]script_auditor['\"]\\)"
    - from: "p07_scene_generation.py"
      to: "delegate_task (4-expert atomic §4)"
      via: "single delegate_task call mentioning all 4 skill_views"
      pattern: "skill_view\\(name=['\"]visual_executor['\"]\\).*skill_view\\(name=['\"]colorist['\"]\\)"
    - from: "p11_video_render.py"
      to: "ThreadPoolExecutor shot-level fan-out"
      via: "concurrent.futures.ThreadPoolExecutor(max_workers=parallel_shots)"
      pattern: "ThreadPoolExecutor"
    - from: "pipeline/phases/__init__.py PHASE_REGISTRY"
      to: "all 13 phase modules"
      via: "direct imports + PHASE_REGISTRY list with 13 entries"
      pattern: "p13_delivery"
---

<objective>
Port the remaining 10 V8.6 pipeline phase modules (p04 through p13) into the `kais-movie-pipeline` orchestration skill, using the template Phase 35 established with p01-p03. After Phase 36, the full 13-phase V8.6 short-drama pipeline runs natively in Python under hermes-agent (mocked clients in tests; real E2E is Phase 39).

Output: 10 new phase modules + PHASE_REGISTRY extension + ~20 new asset-bus slots + 4 refined references/ docs + 12 new test files. Total ~2500-3500 LOC across 5 child plans.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/35-orchestration-skill-skeleton/CONTEXT.md
@.planning/phases/35-orchestration-skill-skeleton/PATTERNS.md
@.planning/phases/35-orchestration-skill-skeleton/VERIFICATION.md
@.planning/phases/36-remaining-10-phases-port/CONTEXT.md
@.planning/phases/36-remaining-10-phases-port/PATTERNS.md

# Phase 35 proven template (the contract)
@/data/workspace/hermes-agent/skills/kais-movie-pipeline/SKILL.md
@/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/runner.py
@/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/__init__.py
@/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p01_hook_topic.py
@/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p02_outline.py
@/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p03_script_audit.py

# Phase 35 reference docs (skeleton — Phase 36 refines)
@/data/workspace/hermes-agent/skills/kais-movie-pipeline/references/pipeline-dag.md
@/data/workspace/hermes-agent/skills/kais-movie-pipeline/references/review-gates.md
@/data/workspace/hermes-agent/skills/kais-movie-pipeline/references/asset-bus-schema.md
@/data/workspace/hermes-agent/skills/kais-movie-pipeline/references/expert-mapping.md

# V8.6 canonical mapping (single source of truth for p04-p13 expert assignment)
@/data/workspace/hermes-agent/skills/movie-experts/_shared/v86-pipeline-mapping.md

# Node.js V8.6 reference (behavioral contract only — NOT a runtime dependency)
@/data/workspace/kais-movie-agent/lib/phases/index.js
@/data/workspace/kais-movie-agent/SKILL.md

# Infrastructure shipped (Phase 31-34) — leverage, don't reimplement
@/data/workspace/hermes-agent/plugins/pipeline_state/asset_bus.py
@/data/workspace/hermes-agent/plugins/pipeline_state/store.py
@/data/workspace/hermes-agent/plugins/review_gates/runner_hooks.py

# Tests pattern (Phase 35 baseline)
@/data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_p01_unit.py
@/data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_p01_p02_p03.py
@/data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_runner.py

<interfaces>
Phase module signature (Phase 35 contract — DO NOT change for p04-p10, p12, p13):

```python
def run(
    episode_id: str,
    asset_bus_read: Callable[[str], Any],
    asset_bus_write: Callable[[str, dict], None],
    delegate_task: Callable[[str, str, list[str]], dict],
    trigger_gate: Callable[[str, str], dict] | None = None,
) -> dict:
    """Returns {"phase": PHASE_ID, "outputs": {...}, "gate": {...} | None}."""
```

p11_video_render signature extension (D-36-08):
```python
def run(..., *, parallel_shots: int = 4) -> dict:
```

Module constants (every phase):
```python
PHASE_ID = "p<NN>_<name>"
EXPERT = "<primary>"           # collaborating experts in docstring
INPUT_SLOTS = [...]
OUTPUT_SLOTS = [...]
GATE_ID = "<gate_id>" | None
```

AssetBus extension (Wave 1 plans edit plugins/pipeline_state/asset_bus.py ASSET_SCHEMA):
```python
"<slot-name>": {
    "file": "<slot-name>.json",
    "format": "json",
    "description": "<purpose>",
    "writer_phase": "p<NN>",
    "reader_phases": [...],
},
```

PHASE_REGISTRY entry shape (36-05 appends 10):
```python
{"id": "p<NN>_<name>", "module": <module>, "depends_on": ["p<NN-1>_<prev>"]}
```
</interfaces>
</context>

<tasks>

This phase is decomposed into 5 sub-plans (see child PLAN files). The master does not execute tasks directly — each child plan is a self-contained executor prompt.

**Sub-plan overview:**

| Plan | Wave | Objective | Phases | Files |
|------|------|-----------|--------|-------|
| 36-01 | 1 | p04 + p05 + p06 — character/pain/spatio (script-stage continuation) | 3 | p04/p05/p06 modules + 3 test files + asset_bus.py slots |
| 36-02 | 1 | p07 + p08 + p09 — scene_gen/scene_select/shot_break (visual design) | 3 | p07/p08/p09 modules + 3 test files + asset_bus.py slots |
| 36-03 | 1 | p10 + p11 — voice + video_render (parallel_shots exercised) | 2 | p10/p11 modules + 2 test files + asset_bus.py slots |
| 36-04 | 1 | p12 + p13 — composition + delivery (final ship) | 2 | p12/p13 modules + 2 test files + asset_bus.py slots |
| 36-05 | 2 | PHASE_REGISTRY update + references/ refinement + full-DAG runner tests | 0 phases | __init__.py + 4 refs + 2 integration test files |

Wave 1 plans (36-01..36-04) can run in parallel — disjoint phase modules, disjoint asset-bus slots, disjoint test files. Wave 2 (36-05) depends on all Wave 1 plans completing.
</tasks>

<threat_model>
## Trust Boundaries

Same as Phase 35 (no new attack surface — Phase 36 is pure additive phase modules following the proven template).

| Boundary | Description |
|----------|-------------|
| delegate_task subagent ↔ phase module | Subagent returns summary string; phase module parses fenced JSON. Untrusted format from trusted subagent. Reuses `_parse_expert_output` (Phase 35) — strict json.loads, no eval/exec. |
| AssetBus ↔ phase module | Each new slot is JSON format, envelope-wrapped, atomic write. Slot names programmer-controlled. |
| p11 ThreadPoolExecutor ↔ delegate_task | Shot-level fan-out: up to 4 concurrent delegate_task calls. Each thread isolated; results aggregated. No shared mutable state. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-36-01 | Tampering | delegate_task summary parsing | accept | Reuses Phase 35 `_parse_expert_output` — strict json.loads, raises ValueError on malformed. |
| T-36-02 | DoS | p11 parallel fan-out runaway | mitigate | ThreadPoolExecutor capped at `parallel_shots=4` (RunnerConfig default). Tests use `parallel_shots=1` for determinism. |
| T-36-03 | Tampering | New asset-bus slots | accept | Slots are JSON envelope-wrapped, atomic write (Phase 33 contract preserved). No new attack surface vs Phase 35. |

No new packages, no Node.js bridges, no LLM code.
</threat_model>

<verification>
## Phase-level verification (after all 5 sub-plans complete)

```bash
# 1. All Phase 35 + 36 tests pass
cd /data/workspace/hermes-agent && python -m pytest skills/kais-movie-pipeline/tests/ plugins/kais_aigc/tests/ plugins/pipeline_state/tests/ plugins/review_gates/tests/

# 2. PHASE_REGISTRY has 13 entries in DAG order
python -c "from pipeline.phases import PHASE_REGISTRY; assert len(PHASE_REGISTRY) == 13; ids=[e['id'] for e in PHASE_REGISTRY]; assert ids[0]=='p01_hook_topic' and ids[-1]=='p13_delivery'"

# 3. Full DAG runner executes p01-p13 sequentially with mocked delegate
python -m pytest skills/kais-movie-pipeline/tests/test_runner_full_dag.py -v

# 4. Checkpoint resume works mid-pipeline (kill at p07, restart, resume)
python -m pytest skills/kais-movie-pipeline/tests/test_runner_full_dag.py::test_checkpoint_resume_mid_pipeline -v

# 5. Anti-pattern scan (should be empty)
grep -nE "openai|anthropic|prompt_template|subprocess.run.*node" skills/kais-movie-pipeline/pipeline/phases/p0*.py skills/kais-movie-pipeline/pipeline/phases/p1*.py
```
</verification>

<success_criteria>
All 4 ROADMAP Phase 36 SC met:

1. **SC#1**: 10 phase modules (p04-p13) each implement full lifecycle (read bus → delegate expert → write bus → trigger gate). Verified by 10 per-phase unit test files (4-7 tests each).

2. **SC#2**: Behavior aligns with Node.js V8.6 — same input slots, same experts, same output slots, same gates (reference port per D-36-01). Verified by per-phase tests asserting INPUT_SLOTS / EXPERT / OUTPUT_SLOTS / GATE_ID constants match V8.6 mapping.

3. **SC#3**: runner.py sequentially schedules p01-p13; checkpoint resume mid-pipeline works. Verified by test_runner_full_dag.py (full 13-phase sequential run + checkpoint at p07 + restart + resume).

4. **SC#4**: references/ 4 docs refined to full form (per-phase slot flow + all 8 gates + ~20 slots + expert goal templates). Verified by file inspection — concrete tables replace skeleton stubs.
</success_criteria>

<output>
Create `.planning/phases/36-remaining-10-phases-port/36-0{1..5}-SUMMARY.md` when each sub-plan completes.
Master SUMMARY (`.planning/phases/36-remaining-10-phases-port/36-SUMMARY.md`) is created by the orchestrator after all 5 sub-plans finish.
</output>

<source_audit>

## Multi-Source Coverage Audit (mandatory)

### GOAL (ROADMAP Phase 36 goal)
- "p04_character_design 到 p13_delivery 共 10 个 phase 模块全部 ported,每个 phase 完成完整生命周期,完整 13 步管线在 Python 运行"
- **COVERED by:** All 5 sub-plans collectively (36-01..04 port phases, 36-05 wires registry + tests + refines docs)

### REQ (REQUIREMENTS.md phase_req_ids for Phase 36)
- **HERMES-SKILL-03** (p04-p13 — 10 phase modules each completing lifecycle) → **36-01/02/03/04**
- **HERMES-SKILL-05** (refined references/ per actual port experience) → **36-05**
- **Coverage: 2/2 REQ IDs mapped. No gaps.**

### CONTEXT (D-XX decisions from CONTEXT.md)
All 8 decisions (D-36-01..08) covered:
- D-36-01 (reference port, not re-design) → all Wave 1 plans + PATTERNS.md Pattern 1
- D-36-02 (phase naming & DAG order) → all Wave 1 plans
- D-36-03 (PHASE_REGISTRY update) → **36-05**
- D-36-04 (AssetBus schema extension per Wave 1 plan) → **36-01/02/03/04**
- D-36-05 (test pattern mirror Phase 35) → all Wave 1 plans + **36-05** integration tests
- D-36-06 (references/ refinement in Wave 2) → **36-05**
- D-36-07 (wave grouping 4 parallel + 1 wave-2) → master plan structure
- D-36-08 (parallel_shots actual dispatch in p11) → **36-03** + PATTERNS.md Pattern 7

### Phase 35 carry-forward (CF-36-01..04)
- CF-36-01 (template is contract) → all Wave 1 plans
- CF-36-02 (goal shape self-contained) → all Wave 1 plans + PATTERNS.md Pattern 2
- CF-36-03 (atomic ops single delegate call) → **36-01** (p06 §5), **36-02** (p07 §4), **36-04** (p12 §6) + PATTERNS.md Pattern 3
- CF-36-04 (gate triggering conditional) → all Wave 1 plans with GATE_ID=None phases

**Audit result: 0 gaps. Plan set is complete.**
</source_audit>
