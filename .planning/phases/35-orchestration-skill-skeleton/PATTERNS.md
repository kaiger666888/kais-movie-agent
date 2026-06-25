# Phase 35 Patterns: Orchestration Skill + delegate_task + AssetBus Extension

**Source:** Research against existing infrastructure:
- `hermes-agent/skills/movie-experts/_shared/SKILL-LAYOUT.md` (skill format spec)
- `hermes-agent/skills/movie-experts/hook_retention/SKILL.md` (expert skill example)
- `hermes-agent/tools/delegate_tool.py` (DELEGATE_TASK_SCHEMA, lines 2966-3101)
- `hermes-agent/tools/skills_tool.py` (skill_view, skills_list, discovery scan)
- `hermes-agent/agent/skill_utils.py` `get_external_skills_dirs()` (external_dirs config)
- `hermes-agent/plugins/kais_aigc/tools.py` (4 dispatching tool handlers)
- `hermes-agent/plugins/pipeline_state/tools.py` (4 dispatching tool handlers, AssetBus JSONL_SLOTS)
- `hermes-agent/plugins/pipeline_state/asset_bus.py` (ASSET_SCHEMA, write/read/append_line signatures)
- `hermes-agent/plugins/pipeline_state/store.py` (save_checkpoint / load_latest_checkpoint)
- `hermes-agent/plugins/review_gates/tools.py` (4 dispatching tool handlers)
- `hermes-agent/plugins/review_gates/runner_hooks.py` (pause_for_review / resolve_direct)
- `kais-movie-agent/lib/phases/index.js` (Node.js reference port target — behavioral contract only)
- `hermes-agent/skills/movie-experts/_shared/v86-pipeline-mapping.md` (canonical 13-step mapping)

This document shows executors the exact patterns to mirror so they don't re-explore the codebase.

---

## Reference Modules Consulted

| Module | Path | Why Consulted | Pattern Extracted |
|--------|------|---------------|-------------------|
| SKILL-LAYOUT | `skills/movie-experts/_shared/SKILL-LAYOUT.md` | Mandatory skill directory layout + frontmatter schema | YAML frontmatter shape, body section order, file naming |
| hook_retention SKILL.md | `skills/movie-experts/hook_retention/SKILL.md` | Full expert skill example | `metadata.hermes.{tags, related_skills, expert_id, metrics}` shape |
| skills_tool.py | `tools/skills_tool.py` | How skill_view / skills_list discover skills | Recursive scan for SKILL.md, frontmatter parse, collision detection |
| skill_utils.get_external_skills_dirs | `agent/skill_utils.py:416` | Skills directory resolution | `skills.external_dirs` config in `~/.hermes/config.yaml` |
| delegate_tool.py | `tools/delegate_tool.py:2966` | DELEGATE_TASK_SCHEMA + how subagents spawned | `goal` + `context` + `toolsets` param shape, sync blocking |
| kais_aigc tools | `plugins/kais_aigc/tools.py` | Real dispatch pattern (Phase 32) | `_handle_*` factory + try/except + tool_result/tool_error envelope |
| pipeline_state tools | `plugins/pipeline_state/tools.py` | AssetBus + checkpoint dispatch (Phase 33) | `_asset_bus()` / `_state_store()` factory pattern |
| review_gates tools | `plugins/review_gates/tools.py` | Gate submit/resolve dispatch (Phase 34) | `runner_hooks.pause_for_review` integration |
| asset_bus.py | `plugins/pipeline_state/asset_bus.py` | ASSET_SCHEMA shape + slot write/read API | JSON slot write, JSONL slot append_line, envelope wrap |
| store.py | `plugins/pipeline_state/store.py` | Checkpoint API | `save_checkpoint(episode_id, phase, payload)` / `load_latest_checkpoint(episode_id)` |
| v86-pipeline-mapping.md | `skills/movie-experts/_shared/v86-pipeline-mapping.md` | Canonical 13-step → expert mapping | Step 1/2/3 expert table, 8-gate structure |

---

## Adopted Pattern: SKILL.md frontmatter + body

Mirrors `skills/movie-experts/hook_retention/SKILL.md` exactly. The new skill's frontmatter MUST validate against the loader's parse logic (`agent.skill_utils.parse_frontmatter`).

```yaml
---
name: kais-movie-pipeline                  # MUST match directory name; ≤64 chars
description: "Top-level orchestration skill: runs the 13-step V8.6 short-drama pipeline end-to-end. Loads 15 movie-expert sub-skills via delegate_task, persists state via pipeline_state plugin, triggers 8 HIL review gates via review_gates plugin. Python runner with checkpoint/resume."  # ≤1024 chars
version: 0.1.0                              # Phase 35 = skeleton; bump on each phase
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
prerequisites:
  tools: [delegate_task, skill_view, pipeline_checkpoint_save, pipeline_checkpoint_load, asset_bus_read, asset_bus_write, gate_submit, gate_resolve]  # Advisory — actual gating is via plugin enabled state
metadata:
  hermes:
    tags: [movie, pipeline, orchestration, short-drama, v86, vertical-slice]
    related_skills: [hook_retention, creative_source, screenplay, script_auditor, character_designer, cinematographer, style_genome, prompt_injector, visual_executor, continuity_auditor, audio_pipeline, editor, colorist, compliance_gate, theory_critic]  # 15 movie-experts — drives DAG ordering
    expert_id: kais-movie-pipeline           # FROZEN — matches directory name
    metrics: [pipeline_completion_rate, phase_resume_success_rate, gate_approval_rate]
    pipeline:
      version: v86                            # V8.6 kais-movie-agent pipeline
      step_count: 13
      gate_count: 8
      parallel_shots: 4                       # v2.0 carry-forward
---
```

**Body section order** (extends SKILL-LAYOUT's 12-section template with orchestration-specific sections):

1. `# Kais-Movie-Pipeline Orchestration Skill (短剧管线编排)` — H1 bilingual title.
2. `## When to use this skill` — trigger conditions (operator wants to produce a 短剧 / 微电影 episode end-to-end).
3. `## References` — table of 4 ref docs in `references/`.
4. `## Pipeline DAG` — Mermaid + ASCII 13-step dependency graph.
5. `## Phase ↔ Expert Mapping` — table sourced from `_shared/v86-pipeline-mapping.md` (Step 1-13 ↔ expert_id).
6. `## Review Gates` — 8-gate table (gate_id / trigger phase / reviewer role / mode).
7. `## Asset Bus Schema` — slot lifecycle summary table.
8. `## Runner` — runner.py invocation: CLI entrypoint, resume semantics, parallel_shots.
9. `## Operator Setup` — env vars (KAIS_GOLD_TEAM_URL etc.) + skills.external_dirs config snippet.
10. `## What NOT to do` — anti-patterns.

**Mandatory frontmatter fields:** `name`, `description`, `version`, `metadata.hermes.{tags, related_skills, expert_id, metrics}`. Same as SKILL-LAYOUT.

---

## Adopted Pattern: Phase module anatomy

Every phase module under `pipeline/phases/` follows this skeleton. Names vary; the shape is invariant.

```python
"""p01_hook_topic.py — Phase 01: hook+topic atomic (V8.6 Step 1).

Reference port of Node.js Step 1 + Step 2 (combined per V8.6 §1 atomic merge).
Loads the hook_retention expert via delegate_task, asking it to:
  1. Apply 10-dimension emotional resonance scan (kais-topic-radar)
  2. Filter by Topic Kernel resonance formula
  3. Design 3-second hook candidates (per hook_retention SKILL.md)

Inputs (asset bus read):
  - requirement (slot: requirement) — operator's high-level ask

Outputs (asset bus write):
  - topic-kernel (slot: topic-kernel) — TopicKernel JSON
  - hook-design (slot: hook-design) — hook_design.json schema

Gate triggered (if configured):
  - Gate 1 "selection-topic-hook" (per references/review-gates.md)
"""
from __future__ import annotations

import json
import logging
from typing import Any, Callable

logger = logging.getLogger(__name__)

PHASE_ID = "p01_hook_topic"
EXPERT = "hook_retention"
INPUT_SLOTS = ["requirement"]
OUTPUT_SLOTS = ["topic-kernel", "hook-design"]
GATE_ID = "selection-topic-hook"  # None if no gate for this phase


def run(
    episode_id: str,
    asset_bus_read: Callable[[str], Any],
    asset_bus_write: Callable[[str, dict], None],
    delegate_task: Callable[[str, str, list[str]], dict],
    trigger_gate: Callable[[str, str], dict] | None = None,
) -> dict:
    """Execute phase p01.

    Args:
        episode_id: Episode identifier.
        asset_bus_read: Callable(slot) -> data (injected; tests pass mock).
        asset_bus_write: Callable(slot, entry) -> None (injected).
        delegate_task: Callable(goal, context, toolsets) -> dict with "summary" key (injected).
        trigger_gate: Optional Callable(gate_id, episode_id) -> gate result dict.

    Returns:
        {"phase": PHASE_ID, "outputs": {...}, "gate": {...} | None}
    """
    # 1. Gather inputs
    requirement = asset_bus_read("requirement") or {}

    # 2. Construct delegate goal (self-contained — subagent knows nothing)
    goal = (
        f"Apply the hook_retention expert skill to design a 3-second hook + Topic Kernel "
        f"for episode {episode_id}. Operator requirement: {json.dumps(requirement, ensure_ascii=False)}. "
        f"First call skill_view(name='hook_retention') to load the expert, then follow its "
        f"Workflow to produce: (a) a TopicKernel JSON, (b) a hook_design JSON. "
        f"Emit both as a single fenced JSON block at end of your summary, shaped as "
        f'{{"topic_kernel": {{...}}, "hook_design": {{...}}}}.'
    )
    context = json.dumps({"episode_id": episode_id, "requirement": requirement}, ensure_ascii=False)

    # 3. Delegate
    result = delegate_task(goal, context, ["skills", "file"])
    expert_output = _parse_expert_output(result)

    # 4. Write outputs to asset bus
    asset_bus_write("topic-kernel", expert_output["topic_kernel"])
    asset_bus_write("hook-design", expert_output["hook_design"])

    # 5. Trigger gate if configured
    gate_result = None
    if GATE_ID and trigger_gate:
        gate_result = trigger_gate(GATE_ID, episode_id)

    return {"phase": PHASE_ID, "outputs": expert_output, "gate": gate_result}


def _parse_expert_output(delegate_result: dict) -> dict:
    """Extract the fenced JSON block from delegate_task summary.

    delegate_task returns {"summary": "<text>", ...}. Phase modules instruct the
    expert in `goal` to emit a fenced JSON block at end of summary; this parses it.
    Raises ValueError if no valid JSON block found (orchestration failure).
    """
    summary = delegate_result.get("summary", "") if isinstance(delegate_result, dict) else str(delegate_result)
    # Find last ```json ... ``` block
    *_, last = summary.rsplit("```json", 1)
    if "```" not in last:
        # Fallback: bare JSON
        raise ValueError(f"delegate_task summary missing JSON block; got: {summary[:200]}")
    json_str = last.split("```", 1)[0]
    return json.loads(json_str)
```

**Key points:**
- `run()` is a PURE FUNCTION — accepts injected callables (asset_bus_read, asset_bus_write, delegate_task, trigger_gate). Tests inject mocks; production wiring in `runner.py` provides real callables.
- `PHASE_ID` matches the registry key. `EXPERT` names the primary movie-expert invoked.
- `INPUT_SLOTS` / `OUTPUT_SLOTS` document the asset-bus contract; `runner.py` may cross-check these against `ASSET_SCHEMA`.
- `GATE_ID` is `None` if no gate configured for this phase (per `references/review-gates.md`).
- The `goal` string embeds the full instructions including a self-contained ask and a `skill_view(name=...)` invocation — the subagent is fully autonomous.

---

## Adopted Pattern: Phase registry (`pipeline/phases/__init__.py`)

```python
"""Phase registry — maps phase_id to run() function + metadata.

Phase 35 registers p01-p03 (vertical slice). Phase 36 adds p04-p13.
runner.py iterates PHASE_REGISTRY in order; resume skips already-checkpointed phases.
"""
from plugins.pipeline_state.phases.p01_hook_topic import p01
from plugins.pipeline_state.phases.p02_outline import p02
from plugins.pipeline_state.phases.p03_script_audit import p03
# Phase 36 will add: p04..p13

PHASE_REGISTRY: list[dict] = [
    {"id": "p01_hook_topic", "module": p01, "depends_on": []},
    {"id": "p02_outline", "module": p02, "depends_on": ["p01_hook_topic"]},
    {"id": "p03_script_audit", "module": p03, "depends_on": ["p02_outline"]},
    # Phase 36: p04..p13 with proper depends_on graph
]

__all__ = ["PHASE_REGISTRY"]
```

**Note:** Module paths in the registry are RELATIVE to the skill directory (`pipeline/phases/...`). The runner uses `importlib` or direct imports based on `sys.path` setup at skill load time. For Phase 35 we use direct imports (no dynamic loading) — simpler, no path juggling.

**Phase 36 extension:** Phase 36 just appends entries to `PHASE_REGISTRY`. The runner doesn't change.

---

## Adopted Pattern: runner.py loop + checkpoint resume

```python
"""runner.py — V8.6 13-phase orchestration runner.

Phase 35 scope: registry iteration + checkpoint save/load + parallel_shots config.
Phase 36 scope: real parallel shot dispatch (Phase 35 only plumbs the config).

Entry point: `python -m skills.kais-movie-pipeline.pipeline.runner --episode <id>`
"""
from __future__ import annotations

import argparse
import logging
from dataclasses import dataclass, field
from typing import Any

from plugins.pipeline_state.asset_bus import AssetBus
from plugins.pipeline_state.store import PipelineStateStore
from plugins.review_gates import runner_hooks
from skills.kais_movie_pipeline.pipeline.phases import PHASE_REGISTRY  # adjusted at install
from tools.delegate_tool import delegate_task as _real_delegate_task

logger = logging.getLogger(__name__)


@dataclass
class RunnerConfig:
    """Runner configuration. parallel_shots=4 preserves v2.0 behavior (D-35-06)."""
    parallel_shots: int = 4
    workdir: str = "."
    enable_gates: bool = True


def run_episode(episode_id: str, config: RunnerConfig | None = None) -> dict:
    """Run the full pipeline for one episode.

    Resumes from latest checkpoint if one exists. Saves checkpoint after each
    phase. Triggers gates per phase config (if config.enable_gates).
    """
    config = config or RunnerConfig()
    store = PipelineStateStore(config.workdir)
    bus = AssetBus(config.workdir)

    # Inject production callables (tests inject mocks)
    asset_bus_read = lambda slot: bus.read(slot)
    asset_bus_write = lambda slot, entry: bus.write(slot, entry, envelope=True)
    delegate = lambda goal, ctx, toolsets: _real_delegate_task(goal=goal, context=ctx, toolsets=toolsets)
    trigger_gate = (
        (lambda gate_id, ep: runner_hooks.pause_for_review(gate_id, ep, {}, mode=None))
        if config.enable_gates else None
    )

    # Resume detection
    checkpoint = store.load_latest_checkpoint(episode_id)
    start_idx = _compute_start_index(checkpoint)

    results = {}
    for idx in range(start_idx, len(PHASE_REGISTRY)):
        phase_entry = PHASE_REGISTRY[idx]
        phase_id = phase_entry["id"]
        module = phase_entry["module"]

        logger.info("Episode %s: starting phase %s", episode_id, phase_id)
        result = module.run(
            episode_id=episode_id,
            asset_bus_read=asset_bus_read,
            asset_bus_write=asset_bus_write,
            delegate_task=delegate,
            trigger_gate=trigger_gate,
        )
        results[phase_id] = result

        # Checkpoint after each phase (parallel_shots is for shot-level, not phase-level)
        store.save_checkpoint(episode_id, phase_id, {"result": result})

    return {"episode_id": episode_id, "phases": results, "parallel_shots": config.parallel_shots}


def _compute_start_index(checkpoint: dict | None) -> int:
    """Map a checkpoint's phase to a registry index for resume."""
    if not checkpoint:
        return 0
    last_phase = checkpoint.get("phase")
    for idx, entry in enumerate(PHASE_REGISTRY):
        if entry["id"] == last_phase:
            return idx + 1  # Resume AFTER the checkpointed phase
    return 0  # Unknown phase in checkpoint — start fresh
```

**Key points:**
- `RunnerConfig.parallel_shots: int = 4` — preserves v2.0 behavior (D-35-06). Phase 35 plumbs the config; Phase 36 implements actual parallel shot dispatch.
- Checkpoint after every phase — resume picks up at next phase.
- `_compute_start_index` maps a checkpoint's phase_id to a registry index.
- Lambda-wrapped callables (asset_bus_read etc.) make injection trivial for tests.

---

## Adopted Pattern: AssetBus ASSET_SCHEMA extension (D-35-05)

Phase 35-02 task 1 extends `plugins/pipeline_state/asset_bus.py` ASSET_SCHEMA with phase-output slots. Slots are JSON format (envelope-wrapped, atomic write) unless they're append-only history slots.

```python
# In plugins/pipeline_state/asset_bus.py — extend ASSET_SCHEMA (D-35-05)
ASSET_SCHEMA: dict[str, dict] = {
    # ── Phase 33 existing (PRESERVED — do not modify) ──
    "creative-history": {...},   # unchanged
    "failed-shots": {...},       # unchanged
    "finetune-dataset": {...},   # unchanged
    "review-outcomes": {...},    # unchanged
    # ── Phase 35 additions — phase-output slots ──
    "requirement": {"file": "requirement.json", "format": "json"},
    "topic-kernel": {"file": "topic-kernel.json", "format": "json"},
    "hook-design": {"file": "hook-design.json", "format": "json"},
    "story-framework": {"file": "story-framework.json", "format": "json"},
    "script-draft": {"file": "script-draft.json", "format": "json"},
    "audit-report": {"file": "audit-report.json", "format": "json"},
    # Phase 36 will add: character-bible, scene-design, shot-list, voice-timeline, video-clips, audio-stems, master-mp4, etc.
}
```

**Test pattern (mirror Phase 33 tests):**
```python
def test_phase35_slots_write_read(tmp_path):
    bus = AssetBus(str(tmp_path))
    bus.write("topic-kernel", {"title": "test"}, envelope=True)
    data = bus.read("topic-kernel")
    assert data["value"]["title"] == "test"
```

---

## Adopted Pattern: delegate_task mock pattern (for tests)

Phase 35 tests don't spawn real subagents. They monkeypatch the injected `delegate_task` callable.

```python
def test_p01_invokes_hook_retention_with_correct_inputs(tmp_path):
    """p01 should call delegate_task with goal mentioning hook_retention + requirement."""
    captured = {}

    def mock_delegate(goal, context, toolsets):
        captured["goal"] = goal
        captured["context"] = context
        captured["toolsets"] = toolsets
        return {"summary": '```json\n{"topic_kernel": {"title": "x"}, "hook_design": {"type": "情感钩"}}\n```'}

    bus = AssetBus(str(tmp_path))
    bus.write("requirement", {"topic": "灵活就业者"}, envelope=True)

    from skills.kais_movie_pipeline.pipeline.phases.p01_hook_topic import p01
    result = p01.run(
        episode_id="ep-001",
        asset_bus_read=lambda slot: bus.read(slot),
        asset_bus_write=lambda slot, entry: bus.write(slot, entry, envelope=True),
        delegate_task=mock_delegate,
        trigger_gate=None,
    )

    # Verify the right expert was loaded
    assert "skill_view(name='hook_retention')" in captured["goal"]
    # Verify the requirement was passed
    assert "灵活就业者" in captured["context"]
    # Verify outputs were written
    assert bus.read("topic-kernel")["value"]["title"] == "x"
    assert bus.read("hook-design")["value"]["type"] == "情感钩"
```

**Key points:**
- Mock returns a summary with fenced JSON block — matches the contract in PATTERNS phase module anatomy.
- Test asserts BOTH the delegate was called with right args AND the asset bus was written.
- `tmp_path` (pytest fixture) isolates each test's filesystem.

---

## Differences From Node.js Reference (Documented)

| Aspect | Node.js (`lib/phases/index.js`) | Python phase module | Why |
|--------|---------------------------------|---------------------|-----|
| Phase granularity | 1 handler per legacy Step (25 Steps total pre-V8.6) | 1 module per V8.6 Step (13 Steps total post-V8.6) | V8.6 atomic merges collapsed Steps; Python port uses V8.6 step boundaries (per `_shared/v86-pipeline-mapping.md`) |
| LLM call style | Direct `callLLM(...)` inline | `delegate_task(goal=..., context=..., toolsets=[...])` | hermes-agent subagent architecture — phase modules are pure orchestration (D-35-04); creative work delegated to expert skills |
| State persistence | Custom JSON files (pipeline-state.json + asset-bus/*.json) | PipelineStateStore + AssetBus V3 (Phase 33) | Reuse Phase 33 foundations (atomic write, envelope, JSONL append) |
| Gate triggering | Inline `await pauseForReview(...)` callbacks | `runner_hooks.pause_for_review(gate_id, episode_id, payload, mode=None)` | Phase 34 framework integration |
| Parallel shots | `ShotParallelScheduler` inline in video phase | `RunnerConfig.parallel_shots: int = 4` (Phase 35 config); Phase 36 dispatch | Phase 35 only plumbs config; p11 video phase (Phase 36) does real parallel |
| Asset bus slots | ~30 V8.6 slot names | 4 (Phase 33) + ~6 added Phase 35 + remainder Phase 36 | Phase 33 was minimum-viable for state; Phase 35 extends per-step (D-35-05); Phase 36 finishes |

---

## Anti-Patterns to Avoid

- **Don't call skill_view in the parent (orchestration) context.** Phase modules don't load expert SKILL.md themselves; they instruct the subagent (via `goal`) to call `skill_view`. Loading in parent would burn parent context (expert SKILL.md is 5-15KB each).
- **Don't write phase-specific business logic in phase modules.** If you're tempted to write a prompt template or call an LLM directly in a phase module, that logic belongs in an EXPERT skill, not the orchestration. Phase 35 phase modules are GLUE ONLY.
- **Don't dynamically import phase modules by string.** Use direct imports in `PHASE_REGISTRY` — simpler, no `importlib` juggling, and tests can patch easily.
- **Don't make phase `run()` async.** hermes-agent tool dispatch is sync (D-07 applies); `delegate_task` blocks. Sync `run()` is correct.
- **Don't store phase outputs in PipelineStateStore checkpoint payload.** Checkpoint is for RESUME state (phase cursor + small intermediate); phase artifacts are FIRST-CLASS and go in AssetBus slots (D-35-05).
- **Don't forget the operator setup section in SKILL.md body.** Operators need to know how to make the skill discoverable (external_dirs config or symlink). SC#4 depends on this.
