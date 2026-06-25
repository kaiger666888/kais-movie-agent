---
phase: 35-orchestration-skill-skeleton
plan: master
type: execute
wave: N/A                  # Master — see child plans for wave assignment
depends_on: []
files_modified: []         # See child plans
autonomous: true
requirements: [HERMES-SKILL-01, HERMES-SKILL-02, HERMES-SKILL-03, HERMES-SKILL-04, HERMES-SKILL-05]
user_setup:
  - service: hermes-agent skills.external_dirs
    why: "Make kais-movie-pipeline discoverable by skills_list/skill_view without installing to ~/.hermes/skills/"
    env_vars: []
    dashboard_config:
      - task: "Add /data/workspace/hermes-agent/skills to skills.external_dirs in ~/.hermes/config.yaml"
        location: "~/.hermes/config.yaml (skills.external_dirs key — create if missing)"

must_haves:
  truths:
    - "Operator can invoke /kais-movie-pipeline slash command and the skill loads"
    - "skill_view(name='kais-movie-pipeline') returns the SKILL.md content with 13-step DAG and 15-expert collaboration graph"
    - "runner.py executes p01 → p02 → p03 in sequence with checkpoint after each phase"
    - "After kill+restart, runner.py resumes from the checkpointed phase"
    - "Each of p01/p02/p03 reads asset bus → invokes the right movie-expert via delegate_task → writes asset bus → triggers gate if configured"
    - "references/ contains 4 docs (pipeline-dag, review-gates, asset-bus-schema, expert-mapping) in skeleton form"
    - "All Phase 35 tests pass: test_runner.py (checkpoint resume + parallel_shots config) + test_p01_p02_p03.py (mocked delegate) + skill discovery test"
  artifacts:
    - path: "/data/workspace/hermes-agent/skills/kais-movie-pipeline/SKILL.md"
      provides: "Skill manifest with valid YAML frontmatter + 13-step DAG + 15-expert collab graph"
      contains: "name: kais-movie-pipeline"
      min_lines: 200
    - path: "/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/runner.py"
      provides: "13-phase loop + checkpoint resume + parallel_shots=4"
      contains: "PHASE_REGISTRY"
      min_lines: 120
    - path: "/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/__init__.py"
      provides: "Phase registry (p01-p03 in Phase 35; p04-p13 added in Phase 36)"
      contains: "PHASE_REGISTRY"
    - path: "/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p01_hook_topic.py"
      provides: "Phase 01 — calls hook_retention expert"
      contains: "EXPERT = \"hook_retention\""
    - path: "/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p02_outline.py"
      provides: "Phase 02 — calls creative_source + screenplay"
      contains: "EXPERT = \"creative_source\""
    - path: "/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p03_script_audit.py"
      provides: "Phase 03 — calls screenplay + script_auditor"
      contains: "EXPERT = \"screenplay\""
    - path: "/data/workspace/hermes-agent/skills/kais-movie-pipeline/references/pipeline-dag.md"
      provides: "13-step dependency graph"
    - path: "/data/workspace/hermes-agent/skills/kais-movie-pipeline/references/review-gates.md"
      provides: "8-gate per-phase mapping"
    - path: "/data/workspace/hermes-agent/skills/kais-movie-pipeline/references/asset-bus-schema.md"
      provides: "Slot types + lifecycle"
    - path: "/data/workspace/hermes-agent/skills/kais-movie-pipeline/references/expert-mapping.md"
      provides: "Phase ↔ movie-expert mapping"
    - path: "/data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_runner.py"
      provides: "Runner loop + checkpoint tests"
    - path: "/data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_p01_p02_p03.py"
      provides: "Vertical slice tests with mocked delegate_task"
    - path: "/data/workspace/hermes-agent/plugins/pipeline_state/asset_bus.py"
      provides: "ASSET_SCHEMA extended with phase-output slots (D-35-05)"
      contains: "topic-kernel"
  key_links:
    - from: "runner.py"
      to: "pipeline/phases/__init__.py PHASE_REGISTRY"
      via: "direct import"
      pattern: "from .phases import PHASE_REGISTRY"
    - from: "runner.py"
      to: "PipelineStateStore.save_checkpoint / load_latest_checkpoint"
      via: "checkpoint after each phase + resume detection"
      pattern: "save_checkpoint\\(|load_latest_checkpoint\\("
    - from: "runner.py"
      to: "runner_hooks.pause_for_review"
      via: "gate triggering per phase config"
      pattern: "pause_for_review\\("
    - from: "p01_hook_topic.py"
      to: "delegate_task (hook_retention expert)"
      via: "delegate_task call with goal referencing skill_view(name='hook_retention')"
      pattern: "skill_view\\(name=['\"]hook_retention['\"]\\)"
    - from: "p02_outline.py"
      to: "delegate_task (creative_source + screenplay)"
      via: "delegate_task call"
      pattern: "skill_view\\(name=['\"]creative_source['\"]\\)"
    - from: "p03_script_audit.py"
      to: "delegate_task (screenplay + script_auditor)"
      via: "delegate_task call"
      pattern: "skill_view\\(name=['\"]script_auditor['\"]\\)"
---

<objective>
Create the keystone Phase 35 orchestration skill `kais-movie-pipeline` — the top-level hermes-agent skill that runs the V8.6 13-step short-drama pipeline. Phase 35 ships a vertical slice: SKILL.md + runner.py + first 3 phases (p01/p02/p03) end-to-end, with the remaining 10 phases (p04-p13) filled in by Phase 36 using the template Phase 35 establishes.

Purpose: This is the integration keystone of v5.0 — once Phase 35 lands, kais-movie-agent "is" a hermes-agent skill (no longer a Node.js subprocess orchestrated by openclaw). All subsequent v5.0 phases (36-39) build on this skeleton.

Output: 11 new files in `/data/workspace/hermes-agent/skills/kais-movie-pipeline/` (SKILL.md + pipeline/* + references/* + tests/*) + 1 modified file in `plugins/pipeline_state/asset_bus.py` (ASSET_SCHEMA extension per D-35-05). Total ~1500-2000 LOC.
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

# Infrastructure shipped (Phase 31-34) — leverage, don't reimplement
@/data/workspace/hermes-agent/plugins/kais_aigc/tools.py
@/data/workspace/hermes-agent/plugins/pipeline_state/tools.py
@/data/workspace/hermes-agent/plugins/pipeline_state/asset_bus.py
@/data/workspace/hermes-agent/plugins/pipeline_state/store.py
@/data/workspace/hermes-agent/plugins/review_gates/tools.py
@/data/workspace/hermes-agent/plugins/review_gates/runner_hooks.py

# Movie-experts to consume (as-is)
@/data/workspace/hermes-agent/skills/movie-experts/hook_retention/SKILL.md
@/data/workspace/hermes-agent/skills/movie-experts/creative_source/SKILL.md
@/data/workspace/hermes-agent/skills/movie-experts/screenplay/SKILL.md
@/data/workspace/hermes-agent/skills/movie-experts/script_auditor/SKILL.md
@/data/workspace/hermes-agent/skills/movie-experts/_shared/SKILL-LAYOUT.md
@/data/workspace/hermes-agent/skills/movie-experts/_shared/v86-pipeline-mapping.md

# Skill discovery / delegate_task mechanism
@/data/workspace/hermes-agent/tools/skills_tool.py
@/data/workspace/hermes-agent/tools/delegate_tool.py

# Node.js reference (behavioral contract only — NOT a runtime dependency)
@/data/workspace/kais-movie-agent/lib/phases/index.js

<interfaces>
<!-- Key contracts executors need — extracted from codebase, no re-exploration needed. -->

From plugins/pipeline_state/asset_bus.py:
```python
SCHEMA_VERSION = "3.0"
ASSETS_DIR = ".pipeline-assets"

# Existing 4 slots (Phase 33 — PRESERVED):
#   creative-history (json) / failed-shots (json) / finetune-dataset (jsonl) / review-outcomes (json)
# Phase 35 EXTENDS ASSET_SCHEMA with: requirement / topic-kernel / hook-design /
# story-framework / script-draft / audit-report (all json)

class AssetBus:
    JSON_SLOTS: frozenset[str]  # slot names that are append-only JSONL
    def __init__(self, workdir: str): ...
    def write(self, slot: str, value: Any, envelope: bool = True) -> str: ...  # returns path
    def read(self, slot: str) -> Any | None: ...  # returns unwrapped payload (or full envelope if no envelope)
    def read_envelope(self, slot: str) -> dict | None: ...
    def append_line(self, slot: str, line_obj: dict) -> str: ...  # JSONL slots
    def read_lines(self, slot: str) -> list[dict]: ...  # JSONL slots
```

From plugins/pipeline_state/store.py:
```python
class PipelineStateStore:
    def __init__(self, workdir: str): ...
    def save_checkpoint(self, episode_id: str, phase: str, payload: dict) -> None: ...
    def load_latest_checkpoint(self, episode_id: str) -> dict | None: ...  # None if no checkpoint
```

From plugins/review_gates/runner_hooks.py:
```python
def pause_for_review(
    gate_id: str, episode_id: str, payload: dict, *, mode: GateMode | None = None,
) -> dict: ...  # blocking — returns when gate resolves
def resolve_direct(gate_id: str, decision: str, suggested_action: str | None = None) -> dict: ...
def mark_episode_failed(episode_id: str, gate_id: str, exc: Exception) -> None: ...
```

From tools/delegate_tool.py (DELEGATE_TASK_SCHEMA parameters):
```python
{
    "goal": str,          # self-contained instruction for subagent
    "context": str,       # background info (JSON-serialized inputs)
    "toolsets": [str],    # e.g. ["skills", "file", "terminal"]
    # Returns: dict with "summary" key (str) + other metadata
    # Sync: parent blocks until subagent completes (unless background=True)
}
```

From tools/skills_tool.py:
```python
# Discovery: recursive scan of get_skills_dir() + get_external_skills_dirs() for SKILL.md
# get_skills_dir() returns ~/.hermes/skills/
# get_external_skills_dirs() reads skills.external_dirs from ~/.hermes/config.yaml

def skills_list(category: str = None) -> str: ...  # JSON: {success, skills: [{name, description, category}]}
def skill_view(name: str, file_path: str = None) -> str: ...  # JSON: {success, name, content, ...}
# SKILL.md must have uppercase filename (loader skips lowercase skill.md)
# Frontmatter parsed via agent.skill_utils.parse_frontmatter — YAML
```

From skills/movie-experts/_shared/v86-pipeline-mapping.md (canonical 13-step mapping):
```
Step 1: hook_retention (atomic: 选题+主题+hook)
Step 2: creative_source + screenplay (atomic: 框架+大纲)
Step 3: screenplay + script_auditor (atomic: 剧本+审计)  ← Phase 35 vertical slice ends here
Step 4: character_designer + visual_executor
Step 5: cinematographer + style_genome + visual_executor
Step 6: screenplay + cinematographer + script_auditor (atomic: 运镜+终审)
Step 7: visual_executor + prompt_injector + style_genome + colorist (atomic)
Step 7B: audio_pipeline (voicer + composer + foley)
Step 8: cinematographer + editor
Step 9: continuity_auditor
Step 10: (dreamina CLI exec, visual_executor supervises)
Step 11: audio_pipeline (all 6 sub-steps, atomic)
Step 12-13: delivery (Phase 36 will define)

8 gates: Step 1/2/3/4/6/7/9/11 后 (per references/review-gates.md)
```
</interfaces>
</context>

<tasks>

This phase is decomposed into 5 sub-plans (see child PLAN files). The master does not execute tasks directly — each child plan is a self-contained executor prompt.

**Sub-plan overview:**

| Plan | Wave | Objective | Tasks | Files |
|------|------|-----------|-------|-------|
| 35-01 | 1 | SKILL.md + skill manifest + directory scaffold | 2 | SKILL.md, pipeline/__init__.py, pipeline/phases/__init__.py (stub registry) |
| 35-02 | 1 | runner.py + AssetBus ASSET_SCHEMA extension | 2 | pipeline/runner.py, plugins/pipeline_state/asset_bus.py (modify) |
| 35-03 | 2 | p01/p02/p03 phase modules (vertical slice) | 3 | pipeline/phases/p01_hook_topic.py, p02_outline.py, p03_script_audit.py, + PHASE_REGISTRY wiring |
| 35-04 | 1 | references/ 4 docs (skeleton) | 2 | references/pipeline-dag.md, review-gates.md, asset-bus-schema.md, expert-mapping.md |
| 35-05 | 2 | tests + skill discovery verification | 2 | tests/test_runner.py, tests/test_p01_p02_p03.py, tests/test_skill_discovery.py |

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| operator → SKILL.md | Skill content is loaded by hermes-agent skill loader; injection-pattern scan runs but only warns (skills are trusted by virtue of being in trusted dirs). Operator controls what's in skills/ dir. |
| delegate_task subagent ↔ phase module | Subagent returns summary string; phase module parses fenced JSON block. Untrusted format from a trusted (orchestration-spawned) subagent. |
| AssetBus ↔ phase module | Phase module reads/writes via injected callables; AssetBus does envelope + atomic write. Slot names are programmer-controlled, not operator-input. |
| runner ↔ PipelineStateStore | Checkpoint payload is programmer-controlled (phase results); resume detection maps phase_id to index. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-35-01 | Tampering | SKILL.md content loaded from skills dir | accept | Operator-controlled directory; hermes-agent loader already does injection-pattern warning. Phase 35 doesn't add new attack surface. |
| T-35-02 | Tampering | delegate_task summary parsing (`_parse_expert_output`) | mitigate | Phase module uses strict `json.loads` on fenced block; raises ValueError on malformed → orchestrator surfaces error, doesn't crash silently. No eval, no exec. |
| T-35-03 | Information Disclosure | AssetBus slots written with envelope (content_hash, derived_from) | accept | AssetBus is local-file-backed; no network exfil path in Phase 35 scope. Already mitigated by Phase 33 atomic write + envelope. |
| T-35-04 | Denial of Service | delegate_task subagent runs forever | accept | hermes-agent delegate_task has built-in timeout/concurrency limits (out of Phase 35 scope); phase modules don't override. |
| T-35-05 | Elevation of Privilege | Phase module invokes plugin tools via standard dispatch | accept | Phase modules use the same dispatch path as any tool call — no special privileges. Gate triggers go through runner_hooks which is operator-authenticated. |
| T-35-SC | Tampering | No new package installs in Phase 35 | accept | Phase 35 uses only stdlib + existing hermes-agent imports (httpx, pytest already shipped). No `pip install` commands. |

No `[SLOP]` packages; no `[ASSUMED]`/`[SUS]` packages introduced. Phase 35 is pure Python stdlib + reuse of existing infrastructure.
</threat_model>

<verification>
## Phase-level verification (after all 5 sub-plans complete)

```bash
# 1. All Phase 35 tests pass
cd /data/workspace/hermes-agent && python -m pytest skills/kais-movie-pipeline/tests/ -v

# 2. Skill is discoverable (manual verification — requires external_dirs config OR symlink)
python -c "from tools.skills_tool import skills_list; import json; r = json.loads(skills_list()); names = [s['name'] for s in r['skills']]; print('kais-movie-pipeline' in names)"
# Expected: True (after operator configures skills.external_dirs per SKILL.md operator-setup section)

# 3. Skill loads via skill_view (returns full SKILL.md content)
python -c "from tools.skills_tool import skill_view; import json; r = json.loads(skill_view('kais-movie-pipeline')); print(r['success'], 'name=' + r.get('name', 'MISSING'))"
# Expected: True name=kais-movie-pipeline

# 4. Asset bus extension didn't break Phase 33
cd /data/workspace/hermes-agent && python -m pytest plugins/pipeline_state/test_asset_bus.py -v
# Expected: all Phase 33 tests still pass + new Phase 35 slot tests pass

# 5. Runner executes p01-p03 with mocked delegate
cd /data/workspace/hermes-agent && python -m pytest skills/kais-movie-pipeline/tests/test_runner.py::test_run_episode_completes_p01_p02_p03 -v
```
</verification>

<success_criteria>
All 5 ROADMAP Phase 35 SC met:

1. **SC#1 (HERMES-SKILL-01)**: SKILL.md exists with valid YAML frontmatter (name/description/version/prerequisites/metadata.hermes.related_skills with 15 experts) + 13-step DAG + trigger words + 15-expert collaboration graph. Verified by `test_skill_discovery.py::test_skill_md_frontmatter_valid`.

2. **SC#2 (HERMES-SKILL-02)**: runner.py implements 13-phase sequential execution (Phase 35: registry has p01-p03 + placeholders for p04-p13) + checkpoint resume + parallel_shots: 4. Verified by `test_runner.py::test_checkpoint_resume_after_interrupt` + `test_runner.py::test_parallel_shots_config_default_4`.

3. **SC#3 (HERMES-SKILL-03 p01-p03 only)**: p01_hook_topic + p02_outline + p03_script_audit each complete full lifecycle: read asset bus → delegate_task → write asset bus → trigger gate (if configured). Verified by `test_p01_p02_p03.py` (6-9 tests: 2-3 per phase).

4. **SC#4 (HERMES-SKILL-04)**: Skill discovered by hermes-agent loader; invocable via `/kais-movie-pipeline` slash command or `skill_view(name="kais-movie-pipeline")`. Verified by `test_skill_discovery.py::test_skill_discoverable_in_external_dirs`.

5. **SC#5 (HERMES-SKILL-05 skeleton)**: references/ has 4 docs (pipeline-dag.md / review-gates.md / asset-bus-schema.md / expert-mapping.md) in skeleton form. Verified by file existence + section-header grep.
</success_criteria>

<output>
Create `.planning/phases/35-orchestration-skill-skeleton/35-0{1..5}-SUMMARY.md` when each sub-plan completes.
Master SUMMARY (`.planning/phases/35-orchestration-skill-skeleton/35-SUMMARY.md`) is created by the orchestrator after all 5 sub-plans finish.
</output>

<source_audit>

## Multi-Source Coverage Audit (mandatory)

### GOAL (ROADMAP Phase 35 goal)
- "顶层编排 skill 骨架就位 — SKILL.md 合法 + runner.py + 前 3 phase 端到端跑通,wired 到 movie-experts via delegate_task,读写 asset bus,触发 gate;hermes-agent loader 发现 skill,可通过 slash command / skill_view 调用"
- **COVERED by:** All 5 sub-plans collectively (35-01 SKILL.md, 35-02 runner, 35-03 p01-p03, 35-04 refs, 35-05 tests+discovery)

### REQ (REQUIREMENTS.md phase_req_ids for Phase 35)
- **HERMES-SKILL-01** (SKILL.md + 13-step DAG + 15-expert collab graph) → **35-01**
- **HERMES-SKILL-02** (runner.py: 13-phase + checkpoint + parallel_shots=4) → **35-02**
- **HERMES-SKILL-03** (p01-p03 only in Phase 35: load/gather/execute/write/gate) → **35-03**
- **HERMES-SKILL-04** (skill discovered + invocable via slash command / skill_view) → **35-05**
- **HERMES-SKILL-05** (4 refs docs skeleton) → **35-04**
- **Coverage: 5/5 REQ IDs mapped. No gaps.**

### RESEARCH (RESEARCH.md / CONTEXT.md features & constraints)
Not applicable — no RESEARCH.md for Phase 35 (Level 1 discovery; CONTEXT.md captures findings). CONTEXT.md decisions D-35-01 through D-35-08 all covered:
- D-35-01 (skill location/layout) → **35-01**
- D-35-02 (discovery mechanism) → **35-01** (SKILL.md operator-setup section) + **35-05** (discovery test)
- D-35-03 (Python-only) → all plans (no Node.js bridges anywhere)
- D-35-04 (phase modules pure orchestration) → **35-03** (phase module anatomy)
- D-35-05 (AssetBus ASSET_SCHEMA extension) → **35-02** task 1
- D-35-06 (parallel_shots=4 preserved) → **35-02** runner + test
- D-35-07 (delegate_task contract) → **35-03** (phase modules) + PATTERNS.md
- D-35-08 (mocked tests) → **35-05**

### CONTEXT (D-XX decisions from CONTEXT.md)
All 8 decisions (D-35-01..08) covered above. No deferred ideas implemented. No out-of-scope items snuck in.

**Audit result: 0 gaps. Plan set is complete.**
</source_audit>
