# Phase 36 PATTERNS — p04-p13 Port Patterns

**Source:** Phase 35 PATTERNS (proven end-to-end with 53 tests) + V8.6 mapping (`_shared/v86-pipeline-mapping.md`).
**Purpose:** Canonical patterns Wave 1 executors follow when porting p04-p13. Deviations require CONTEXT.md decision logging.

---

## Pattern 1: Phase Module Skeleton (MANDATORY — every p04-p13 module)

Copy from `/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p01_hook_topic.py`. Structure:

```python
"""p<NN>_<name>.py — Phase <NN>: <V8.6 step description>.

Reference port of Node.js lib/phases/index.js <handler name>.
Per CONTEXT D-35-04 + D-36-01 this module is PURE ORCHESTRATION —
no LLM calls, no prompt templates, no business logic. All creative
work delegated to <EXPERT> movie-expert skill via delegate_task.

Inputs (asset bus READ):
  - <slot> — <description>

Outputs (asset bus WRITE):
  - <slot> — <description>

Gate triggered (when trigger_gate is provided):
  - Gate <N> <gate_id> (per references/review-gates.md). [or "None — no gate for this phase."]
"""

from __future__ import annotations

import json
import logging
from typing import Any, Callable

from .p01_hook_topic import _parse_expert_output  # reuse parser

logger = logging.getLogger(__name__)

PHASE_ID = "p<NN>_<name>"
EXPERT = "<primary_expert_id>"  # collaborating experts listed in docstring
INPUT_SLOTS = ["<input-slot-1>", ...]
OUTPUT_SLOTS = ["<output-slot-1>", ...]
GATE_ID = "<gate_id>"  # or None


def run(
    episode_id: str,
    asset_bus_read: Callable[[str], Any],
    asset_bus_write: Callable[[str, dict], None],
    delegate_task: Callable[[str, str, list[str]], dict],
    trigger_gate: Callable[[str, str], dict] | None = None,
) -> dict:
    """Execute phase p<NN> (V8.6 §<x> <description>).

    Returns {"phase": PHASE_ID, "outputs": {...}, "gate": {...} | None}.
    """
    # 1. Gather inputs (graceful when slot empty).
    <input_var> = asset_bus_read("<input-slot>") or {}

    # 2. Construct self-contained goal mentioning all assigned experts
    #    via skill_view, naming upstream slot inputs, specifying JSON shape.
    <input>_json = json.dumps(<input_var>, ensure_ascii=False)
    goal = (
        f"Apply the <EXPERT> [and <COLLAB_EXPERT>] expert skill(s) in a "
        f"V8.6 §<x> <operation> for episode {episode_id}: <what they do>. "
        f"First call skill_view(name='<expert>') [and skill_view(name='<collab>')] "
        f"to load the expert(s), then <workflow step>. "
        f"<Upstream input label>: {<input>_json}. "
        f"Emit the final output as a single fenced JSON block at end of your "
        f'summary, shaped as {{"<key1>": {{...}}, "<key2>": [...]}}.'
    )
    context = json.dumps(
        {"episode_id": episode_id, "<input_label>": <input_var>},
        ensure_ascii=False,
    )

    # 3. Delegate (synchronous — D-35-02 confirms blocking).
    delegate_result = delegate_task(goal, context, ["skills", "file"])
    expert_output = _parse_expert_output(delegate_result)

    # 4. Write outputs (split or single depending on V8.6 contract).
    asset_bus_write("<output-slot>", expert_output["<key>"])  # or whole payload

    # 5. Trigger gate if configured.
    gate_result = None
    if GATE_ID and trigger_gate is not None:
        gate_result = trigger_gate(GATE_ID, episode_id)
        logger.info("p<NN>: gate %s triggered for episode %s -> %s",
                    GATE_ID, episode_id, gate_result)

    return {"phase": PHASE_ID, "outputs": expert_output, "gate": gate_result}
```

**Mandatory constraints:**
- Module-level constants `PHASE_ID` / `EXPERT` / `INPUT_SLOTS` / `OUTPUT_SLOTS` / `GATE_ID` — runner + tests read these.
- 5-arg `run()` signature (p11 adds `parallel_shots: int = 4` kwarg per D-36-08).
- `_parse_expert_output` imported from p01 (no duplicate parser).
- No `import openai`, `import anthropic`, no `subprocess.run(["node", ...])`, no prompt_template constants.
- Sync only — no `async def run()`.

---

## Pattern 2: delegate_task Goal Shape (MANDATORY)

Every `goal` string MUST include:
1. **Verb** referencing the V8.6 step operation ("Apply the X expert skill in a V8.6 §Y operation")
2. **skill_view mention** for every assigned expert ("First call skill_view(name='X') [and skill_view(name='Y')] to load the expert(s)")
3. **Upstream slot inputs** named + JSON-serialized in the goal body
4. **Output shape** specified ("Emit the final output as a single fenced JSON block at end of your summary, shaped as {key: ...}")

**Anti-pattern:** goal that just says "design a character" with no skill_view instruction — subagent won't load the expert SKILL.md and will free-form improvise.

**Reference exemplars:** `p01_hook_topic.py` lines 89-98, `p02_outline.py` lines 61-74, `p03_script_audit.py` lines 63-78.

---

## Pattern 3: Atomic Operation = Single delegate_task Call

V8.6 §1-§6 atomic operations (multi-expert collaboration) port as **ONE** `delegate_task` call per phase. The subagent orchestrates the multi-expert collaboration internally after loading both expert SKILL.md files.

- p06 spatio-temporal (§5): screenplay + cinematographer + script_auditor — ONE delegate call, goal mentions all 3 skill_views
- p07 scene_generation (§4): visual_executor + prompt_injector + style_genome + colorist — ONE delegate call, goal mentions all 4 skill_views
- p11 audio_master (§6) lives in p12 in our split: audio_pipeline 6 sub-steps — ONE delegate call (audio_pipeline SKILL.md already encapsulates the 6 sub-steps)

**Rationale:** Splitting atomic operations across multiple delegate calls would re-introduce the V8.4-era 25-step complexity that V8.6 explicitly collapsed.

---

## Pattern 4: AssetBus Slot Extension (per Wave 1 plan)

Each Wave 1 plan (36-01..36-04) edits `plugins/pipeline_state/asset_bus.py` ASSET_SCHEMA dict to add new slots. Pattern (mirror Phase 35-02 lines 79-100):

```python
# --- Phase 36 slots (added per D-36-04) ---
"<slot-name>": {
    "file": "<slot-name>.json",
    "format": "json",        # or "jsonl" for append-only
    "description": "<purpose>",
    "writer_phase": "p<NN>",
    "reader_phases": ["p<NN+1>", ...],
},
```

**Constraints:**
- Kebab-case names (matches Phase 33 + Phase 35 convention)
- Semantic names, no phase prefix (`character-bible` not `p04-character-bible`)
- Each plan declares its slot additions in must_haves.artifacts so verification catches missing entries
- Do NOT modify Phase 33's 4 original slots (creative-history / failed-shots / finetune-dataset / review-outcomes) — preserved per D-35-05/CF-35-03

---

## Pattern 5: Test File Per Phase (MANDATORY)

Mirror `tests/test_p01_unit.py` / `test_p02_unit.py` / `test_p03_unit.py` from Phase 35. Each `tests/test_p<NN>_<name>.py` has 4-7 tests:

```python
import json
import pytest
from pipeline.phases import p<NN>_<name>

def _mock_delegate_return(payload: dict) -> dict:
    return {"summary": f"Expert output:\n```json\n{json.dumps(payload)}\n```"}

class TestP<NN><Name>:
    def test_reads_correct_input_slot(self, ...): ...
    def test_goal_mentions_all_assigned_experts_via_skill_view(self, ...): ...
    def test_calls_delegate_task_once_with_skills_file_toolsets(self, ...): ...
    def test_writes_correct_output_slots(self, ...): ...
    def test_triggers_correct_gate_when_configured(self, ...): ...    # skip if GATE_ID is None
    def test_skips_gate_when_trigger_gate_is_none(self, ...): ...
    def test_parses_expert_json_output_correctly(self, ...): ...
    def test_handles_empty_input_slot_gracefully(self, ...): ...
```

**Constraints:**
- No real subagent spawns (D-35-08) — mock delegate_task returns canned fenced-JSON
- No real HTTP — mock all 4 kais_aigc clients
- Use `tmp_path` for AssetBus + PipelineStateStore isolation
- pytest fixtures per Phase 35 `tests/conftest.py`

---

## Pattern 6: PHASE_REGISTRY Update (36-05 only)

`pipeline/phases/__init__.py` extension:

```python
from . import p01_hook_topic as p01
from . import p02_outline as p02
from . import p03_script_audit as p03
from . import p04_character_design as p04  # Phase 36
from . import p05_pain_discovery as p05
from . import p06_spatio_temporal_script as p06
from . import p07_scene_generation as p07
from . import p08_scene_selection as p08
from . import p09_shot_breakdown as p09
from . import p10_voice as p10
from . import p11_video_render as p11
from . import p12_composition as p12
from . import p13_delivery as p13

PHASE_REGISTRY: list[dict] = [
    {"id": "p01_hook_topic",            "module": p01, "depends_on": []},
    {"id": "p02_outline",               "module": p02, "depends_on": ["p01_hook_topic"]},
    {"id": "p03_script_audit",          "module": p03, "depends_on": ["p02_outline"]},
    {"id": "p04_character_design",      "module": p04, "depends_on": ["p03_script_audit"]},
    {"id": "p05_pain_discovery",        "module": p05, "depends_on": ["p04_character_design"]},
    {"id": "p06_spatio_temporal_script","module": p06, "depends_on": ["p05_pain_discovery"]},
    {"id": "p07_scene_generation",      "module": p07, "depends_on": ["p06_spatio_temporal_script"]},
    {"id": "p08_scene_selection",       "module": p08, "depends_on": ["p07_scene_generation"]},
    {"id": "p09_shot_breakdown",        "module": p09, "depends_on": ["p08_scene_selection"]},
    {"id": "p10_voice",                 "module": p10, "depends_on": ["p09_shot_breakdown"]},
    {"id": "p11_video_render",          "module": p11, "depends_on": ["p10_voice"]},
    {"id": "p12_composition",           "module": p12, "depends_on": ["p11_video_render"]},
    {"id": "p13_delivery",              "module": p13, "depends_on": ["p12_composition"]},
]
```

Linear DAG (no branching — parallelism is intra-phase shot-level in p11 only).

---

## Pattern 7: p11 Parallel Shot Fan-Out (D-36-08 — p11 only)

p11_video_render is the only phase that uses `parallel_shots`. Signature extension:

```python
def run(
    episode_id: str,
    asset_bus_read: Callable[[str], Any],
    asset_bus_write: Callable[[str, dict], None],
    delegate_task: Callable[[str, str, list[str]], dict],
    trigger_gate: Callable[[str, str], dict] | None = None,
    *,
    parallel_shots: int = 4,  # D-36-08 — p11 only
) -> dict:
    ...
    # Fan out shot-level delegate_task calls concurrently.
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=parallel_shots) as pool:
        futures = [pool.submit(delegate_task, goal_per_shot(s), ctx, ["skills","file"])
                   for s in shot_list]
        results = [f.result() for f in futures]
    ...
```

**Tests mock the pool** — use `monkeypatch.setattr("concurrent.futures.ThreadPoolExecutor", FakePool)` or pass `parallel_shots=1` for sequential determinism.

---

## Pattern 8: references/ Refinement (36-05 only)

Replace skeleton stubs with port-experience data. Each doc gets concrete tables:

- `pipeline-dag.md` — add §"Slot Flow Per Edge" table: `p04 →reads→ [script-draft] →writes→ [character-bible, character-assets]` etc. for all 13 phases
- `review-gates.md` — replace §"Phase 35 Gates" stub with §"All 8 Gates" full table (gate 4-8 reviewer role + mode + actual trigger phase from p04-p13 implementation)
- `asset-bus-schema.md` — replace §"Phase 36 Future Slots TBD" with the actual ~20 slot table (slot / format / writer phase / reader phases / V8.6 equivalent)
- `expert-mapping.md` — replace "Phase 36" scope column with actual phase module file path + delegate_task `goal` template summary per phase (the verb + skill_view mention shape)

---

## Anti-Patterns (FORBIDDEN)

| Anti-pattern | Why forbidden | Detection |
|--------------|---------------|-----------|
| Porting Node.js imperative control flow line-by-line | Re-introduces V8.4-era complexity; V8.6 is the contract | Code review: phase module > 200 LOC suspicious |
| LLM calls / prompt_template constants in phase module | Violates D-35-04 PURE ORCHESTRATION | `grep -nE "openai\|anthropic\|prompt_template\|llm\."` should be 0 |
| `subprocess.run(["node", ...])` | Violates D-35-03 Python-only | `grep -nE "subprocess.*node"` should be 0 |
| `async def run()` | Phase 35 contract is sync (delegate_task blocks) | AST check |
| Multiple delegate_task calls for atomic § operations | Re-introduces 25-step complexity; V8.6 collapsed to atomic | Code review: p06/p07/p12 should have exactly 1 delegate call |
| Modifying Phase 33's 4 original asset-bus slots | Violates D-35-05 preservation | Diff `asset_bus.py` — only additions allowed |
| Calling `skill_view` in parent (orchestration) context | Burns parent context (15 experts × 5-15KB = exhaustion) | `grep -nE "skill_view\("` in phase module: only in goal strings, never as actual call |
| Debt markers (TBD/FIXME/XXX) without issue reference | Completion not auditable | `grep -nE "TBD\|FIXME\|XXX"` should be 0 or reference issue/PR |

---

## See Also

- Phase 35 PATTERNS.md (proven baseline — read first)
- Phase 35 p01_hook_topic.py / p02_outline.py / p03_script_audit.py (reference implementations)
- `_shared/v86-pipeline-mapping.md` (canonical V8.6 step ↔ expert mapping)
- `references/{pipeline-dag,review-gates,asset-bus-schema,expert-mapping}.md` (Phase 35 skeleton — Phase 36 refines)
