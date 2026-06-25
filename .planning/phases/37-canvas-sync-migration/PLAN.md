---
phase: 37-canvas-sync-migration
plan: master
type: execute
wave: N/A
depends_on: [35, 36]
files_modified: []
autonomous: true
requirements: [CANVAS-IN-HERMES-01, CANVAS-IN-HERMES-02, CANVAS-IN-HERMES-03]
user_setup: []

must_haves:
  truths:
    - "Canvas sync hook exists as a Python event subscriber in hermes-agent (no Node.js runtime dependency)"
    - "Canvas sync fires on phase completion — runner.py emits a phase_complete event after each phase's asset-bus write"
    - "Canvas sync fires on gate resolution approve — runner_hooks.resume_from_callback emits a gate_resolved event after review-outcomes write"
    - "Canvas subscriber uses the existing Phase 32 CanvasClient HTTP API v2 only (no sqlite, preserves PIPE-INTEGRITY-01)"
    - "Canvas subscriber is degrade-tolerant — if :10588 unreachable, warns and continues; never blocks the pipeline"
    - "Both trigger paths (phase complete + gate approve) produce observable :10588 save-v2 HTTP calls in mocked-canvas tests"
    - "No openclaw / Toonflow references in the new canvas_sync module or its tests"
  artifacts:
    - path: "/data/workspace/hermes-agent/plugins/kais_aigc/canvas_sync.py"
      provides: "Python event subscriber port of lib/canvas-sync-hook.js — on_phase_complete + on_gate_resolved handlers that build FlowGraph upserts"
      contains: "class CanvasSyncSubscriber"
    - path: "/data/workspace/hermes-agent/plugins/kais_aigc/canvas_graph.py"
      provides: "FlowGraph upsert/link builder — pure functions translating phase + result payloads into canvas node/link JSON (mirrors Node.js upsertNode + ensureLink + computeNodePosition)"
      contains: "def upsert_node"
    - path: "/data/workspace/hermes-agent/plugins/kais_aigc/tests/test_canvas_sync.py"
      provides: "Unit + integration tests for the subscriber — mocked CanvasClient, both trigger paths observable"
      contains: "test_phase_complete_triggers_save_v2"
    - path: "/data/workspace/hermes-agent/plugins/kais_aigc/tests/test_canvas_graph.py"
      provides: "Pure-function unit tests for the FlowGraph builder (no HTTP)"
      contains: "upsert_node"
    - path: "/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/runner.py"
      provides: "Phase completion event hook — RunnerConfig gains on_phase_complete callback, runner invokes after checkpoint save"
      contains: "on_phase_complete"
    - path: "/data/workspace/hermes-agent/plugins/review_gates/runner_hooks.py"
      provides: "Gate resolution event hook — resume_from_callback emits on_gate_resolved callback after writing review-outcomes"
      contains: "on_gate_resolved"
    - path: "/data/workspace/hermes-agent/plugins/kais_aigc/tools.py"
      provides: "kais_canvas_sync tool dispatch wiring — exposes subscriber registration as a hermes-agent tool"
      contains: "kais_canvas_sync"
  key_links:
    - from: "pipeline/runner.py run_episode"
      to: "CanvasSyncSubscriber.on_phase_complete"
      via: "RunnerConfig.on_phase_complete callback invoked after store.save_checkpoint"
      pattern: "on_phase_complete\\("
    - from: "review_gates/runner_hooks.resume_from_callback"
      to: "CanvasSyncSubscriber.on_gate_resolved"
      via: "module-level on_gate_resolved callback invoked after writing review-outcomes slot"
      pattern: "on_gate_resolved\\("
    - from: "CanvasSyncSubscriber.on_phase_complete"
      to: "CanvasClient.save_canvas (:10588 save-v2)"
      via: "CanvasClient from plugins.kais_aigc.canvas (Phase 32 — reused, not duplicated)"
      pattern: "save_canvas"
    - from: "plugins/kais_aigc/canvas_sync.py"
      to: "no openclaw / Toonflow reference"
      via: "grep scan of the new module — must be 0 hits"
      pattern: "openclaw|Toonflow"
---

<objective>
Migrate the canvas sync hook from Node.js `lib/canvas-sync-hook.js` to a Python event subscriber inside `plugins/kais_aigc/`. The subscriber fires on two trigger paths: (a) phase completion (after the runner persists a phase's asset-bus write) and (b) gate resolution approve (after `runner_hooks.resume_from_callback` writes the `review-outcomes` slot). Both paths produce observable `:10588` save-v2 HTTP calls. After Phase 37, canvas sync is fully native to hermes-agent — no Node.js subprocess, no openclaw Toonflow orchestration.

Output: 2 new modules (`canvas_sync.py` + `canvas_graph.py`) + 2 RunnerConfig/callback hooks + 2 test files + tools.py dispatch update. Total ~600-900 LOC across 3 plans.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/37-canvas-sync-migration/CONTEXT.md
@.planning/phases/37-canvas-sync-migration/PATTERNS.md
@.planning/phases/35-orchestration-skill-skeleton/VERIFICATION.md
@.planning/phases/36-remaining-10-phases-port/VERIFICATION.md

# Node.js reference — what we port (behavioral contract only, NOT runtime dep)
@/data/workspace/kais-movie-agent/lib/canvas-sync-hook.js
@/data/workspace/kais-movie-agent/lib/canvas-content-sync.js
@/data/workspace/kais-movie-agent/lib/canvas-client.js

# Phase 32 client (HTTP API v2 — REUSE, do not duplicate)
@/data/workspace/hermes-agent/plugins/kais_aigc/canvas.py

# Event sources — where callbacks are added
@/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/runner.py
@/data/workspace/hermes-agent/plugins/review_gates/runner_hooks.py
@/data/workspace/hermes-agent/plugins/pipeline_state/asset_bus.py
@/data/workspace/hermes-agent/plugins/kais_aigc/tools.py

<interfaces>
RunnerConfig extension (37-01):

```python
@dataclass
class RunnerConfig:
    parallel_shots: int = 4
    workdir: str = "."
    enable_gates: bool = True
    # Phase 37 — canvas sync event hooks (defaults None = no-op, preserves
    # existing Phase 35/36 test behavior when subscriber not registered).
    on_phase_complete: Callable[[str, str, dict], None] | None = None
    on_gate_resolved: Callable[[str, str, str, dict], None] | None = None
```

Runner emits phase completion AFTER checkpoint save:

```python
store.save_checkpoint(episode_id, phase_id, {...})
if cfg.on_phase_complete is not None:
    cfg.on_phase_complete(episode_id, phase_id, result)
```

runner_hooks gate resolution hook (37-01):

```python
# Module-level optional callback. None by default — Phase 34 tests unchanged.
_on_gate_resolved: Callable[[str, str, str, dict], None] | None = None

def set_gate_resolved_hook(fn):  # called by subscriber registration
    global _on_gate_resolved
    _on_gate_resolved = fn

# Inside resume_from_callback, after bus.write("review-outcomes", {...}):
if _on_gate_resolved is not None:
    _on_gate_resolved(episode_id, gate_id, decision, outcome_payload)
```

CanvasSyncSubscriber (37-02):

```python
class CanvasSyncSubscriber:
    def __init__(self, canvas: CanvasClient, agent_name: str = ""):
        ...
    def on_phase_complete(self, episode_id: str, phase_id: str, result: dict) -> None:
        """Build node from phase result, upsert into graph, save_canvas."""
    def on_gate_resolved(self, episode_id: str, gate_id: str, decision: str, payload: dict) -> None:
        """On approve — write formal canvas node; on reject — mark phase node error."""
```

canvas_graph.py pure functions (37-02):

```python
def upsert_node(graph: dict, node_id: str, node_data: dict) -> dict: ...
def ensure_link(graph: dict, link_id: str, source: str, target: str) -> dict: ...
def compute_node_position(phase_group: str, stage_order: int) -> dict: ...
def default_phase_mapper(phase: dict) -> dict: ...
```

Subscriber registration (37-03):

```python
def register_canvas_sync(
    *,
    base_url: str | None = None,
    project_id: int,
    episodes_id: int,
    runner_config: RunnerConfig,
    transport: httpx.BaseTransport | None = None,
) -> CanvasSyncSubscriber:
    """Construct client + subscriber, wire callbacks into runner_config + gate hook."""
```
</interfaces>
</context>

<tasks>

This phase is decomposed into 3 sub-plans (see child PLAN files).

**Sub-plan overview:**

| Plan | Wave | Objective | Files |
|------|------|-----------|-------|
| 37-01 | 1 | Event hooks in runner.py + runner_hooks.py — RunnerConfig gains `on_phase_complete` / `on_gate_resolved` callbacks (defaults None, Phase 35/36 tests unchanged) | runner.py + runner_hooks.py + 1 test file |
| 37-02 | 1 | canvas_graph.py (pure FlowGraph builder) + canvas_sync.py (subscriber) — port upsertNode/ensureLink/computeNodePosition/defaultPhaseMapper + CanvasSyncSubscriber class | canvas_graph.py + canvas_sync.py + 2 test files |
| 37-03 | 2 | Wire subscriber to events + register_canvas_sync + tools.py dispatch + integration tests with mocked CanvasClient observing :10588 save-v2 on both trigger paths | tools.py + 1 integration test file |

Wave 1 (37-01 + 37-02) can run in parallel — 37-01 adds the callback plumbing, 37-02 builds the subscriber. Wave 2 (37-03) wires them and verifies both trigger paths end-to-end.
</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Phase result payload → subscriber | The `result` dict passed to `on_phase_complete` comes from the phase module's return. Subscriber parses `summary` / `metrics` / `review` keys defensively (missing keys → graceful empty). |
| Gate resolution payload → subscriber | `resume_from_callback` constructs the outcome dict from the verified HMAC callback. Subscriber reads `decision` / `gate_id` / `suggested_action` defensively. |
| Canvas HTTP response → subscriber | CanvasClient already envelopes degrade responses (Phase 32). Subscriber treats degrade envelopes as no-op and continues. |
| Subscriber ↔ pipeline runtime | Subscriber MUST NEVER raise to the pipeline caller. All exceptions caught, logged at WARNING, swallowed. Degrade-tolerant by contract (CANVAS-IN-HERMES-03). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-37-01 | DoS | Subscriber blocks pipeline on slow :10588 | mitigate | Subscriber wraps CanvasClient call in try/except; CanvasClient already has 15s timeout; subscriber catches all exceptions, logs WARNING, returns. |
| T-37-02 | Tampering | Malformed phase result crashes subscriber | mitigate | Subscriber uses `.get()` with defaults for all parsed keys; canvas_graph.py validates node_data shape before upsert. |
| T-37-03 | Info disclosure | Canvas graph leaks between episodes | accept | Subscriber constructed per-episode (project_id + episodes_id); runner resets subscriber between episodes. No cross-episode state. |
| T-37-04 | Denial of service | Subscriber writes invalid FlowGraph breaking :10588 | mitigate | canvas_graph.py always produces a valid FlowGraph skeleton ({nodes, links, branches, variantGroups, meta}) — never partial. |

No new packages, no Node.js bridges, no LLM code.
</threat_model>

<verification>
## Phase-level verification (after all 3 sub-plans complete)

```bash
# 1. All Phase 32-37 tests pass (445 baseline + new Phase 37 tests)
cd /data/workspace/hermes-agent && python3 -m pytest skills/kais-movie-pipeline/tests/ plugins/kais_aigc/tests/ plugins/pipeline_state/tests/ plugins/review_gates/tests/

# 2. No openclaw references in v5.0 deliverables (CANVAS-IN-HERMES-01 contract)
grep -rniE "openclaw|Toonflow" plugins/kais_aigc/canvas_sync.py plugins/kais_aigc/canvas_graph.py plugins/kais_aigc/tests/test_canvas_sync.py plugins/kais_aigc/tests/test_canvas_graph.py
# Expect: 0 hits

# 3. No sqlite direct access in the new subscriber (PIPE-INTEGRITY-01 preserved)
grep -niE "sqlite|sqlite3|connect\(|cursor\.execute" plugins/kais_aigc/canvas_sync.py plugins/kais_aigc/canvas_graph.py
# Expect: 0 hits

# 4. Both trigger paths fire :10588 save-v2 (CANVAS-IN-HERMES-02 — the keystone)
python3 -m pytest plugins/kais_aigc/tests/test_canvas_sync.py::test_phase_complete_triggers_save_v2 -v
python3 -m pytest plugins/kais_aigc/tests/test_canvas_sync.py::test_gate_approve_triggers_save_v2 -v

# 5. Degrade-tolerant: unreachable :10588 does not raise to runner
python3 -m pytest plugins/kais_aigc/tests/test_canvas_sync.py::test_canvas_unreachable_does_not_block_pipeline -v

# 6. Phase 35/36 regression — RunnerConfig defaults preserve existing behavior
python3 -m pytest skills/kais-movie-pipeline/tests/test_runner_full_dag.py -v
```
</verification>

<success_criteria>
All 3 ROADMAP Phase 37 SC met:

1. **SC#1**: Canvas sync hook migrated from Node.js to hermes-agent Python event subscriber (no Node.js runtime dependency). Verified by: `canvas_sync.py` + `canvas_graph.py` exist as Python modules; subscriber registered via `register_canvas_sync()` callback wiring; no `subprocess.run(...node)` or `require('...')` calls anywhere in v5.0 deliverables.

2. **SC#2**: Canvas sync fires on BOTH (a) phase completion and (b) gate resolution approve. Verified by: two integration tests in `test_canvas_sync.py` that inject a mocked CanvasClient (httpx.MockTransport), run `on_phase_complete` and `on_gate_resolved(approve)` respectively, and assert the mocked transport received exactly one POST to `/api/canvas/v2/save-v2` per trigger.

3. **SC#3**: Canvas client uses HTTP API v2 only (no sqlite — preserves PIPE-INTEGRITY-01), degrade-tolerant. Verified by: subscriber only ever calls `CanvasClient.save_canvas` / `load_canvas` (Phase 32 contract); `test_canvas_unreachable_does_not_block_pipeline` asserts `httpx.ConnectError` is caught, runner loop continues, episode result still returned.
</success_criteria>

<output>
Create `.planning/phases/37-canvas-sync-migration/37-0{1..3}-SUMMARY.md` when each sub-plan completes.
Master SUMMARY (`.planning/phases/37-canvas-sync-migration/37-SUMMARY.md`) is created by the orchestrator after all 3 sub-plans finish.
</output>

<source_audit>

## Multi-Source Coverage Audit (mandatory)

### GOAL (ROADMAP Phase 37 goal)
- "canvas sync hook 从 Node.js `lib/canvas-sync-hook.js` 迁移到 hermes-agent Python event subscriber,phase 完成 / gate 决议两时机触发,完全脱离 openclaw Toonflow"
- **COVERED by:** All 3 sub-plans collectively (37-01 events, 37-02 port, 37-03 wire)

### REQ (REQUIREMENTS.md phase_req_ids for Phase 37)
- **CANVAS-IN-HERMES-01** (Node → Python event subscriber) → **37-02** (subscriber class) + **37-03** (registration + tools.py wiring)
- **CANVAS-IN-HERMES-02** (two trigger paths — phase complete + gate approve) → **37-01** (event hooks) + **37-03** (integration tests on both paths)
- **CANVAS-IN-HERMES-03** (hook half — HTTP v2 only, degrade) → **37-02** (subscriber uses Phase 32 CanvasClient) + **37-03** (degrade test)
- **Coverage: 3/3 REQ IDs mapped. No gaps.**

### CONTEXT (D-37-XX decisions from CONTEXT.md)
All decisions covered:
- D-37-01 (callback injection, not formal event bus) → **37-01**
- D-37-02 (subscriber in plugins/kais_aigc/, co-located with canvas.py) → **37-02**
- D-37-03 (pure FlowGraph builder extracted to canvas_graph.py) → **37-02**
- D-37-04 (degrade-tolerant contract — never raise to runner) → **37-02** + **37-03**
- D-37-05 (no Node.js runtime dependency — pure Python port) → all plans
- D-37-06 (Phase 35/36 regression: RunnerConfig defaults None) → **37-01**
- D-37-07 (gate resolution hook lives in runner_hooks module-level) → **37-01**

### Phase 32 carry-forward (CF-37-01)
- CF-37-01 (reuse CanvasClient — do NOT duplicate HTTP/degrade logic) → **37-02** imports `from plugins.kais_aigc.canvas import CanvasClient`

**Audit result: 0 gaps. Plan set is complete.**
</source_audit>
