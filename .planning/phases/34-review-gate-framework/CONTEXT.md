# Phase 34 Context: Review Gate Framework (HIL Gate Lifecycle)

**Phase goal:** Implement the HIL review gate state machine in `plugins/review_gates/` — Gate lifecycle (submit → wait → resolve) with 3 switchable modes (blocking / webhook / polling), 8 V8.6 gates as YAML config, integration with hermes-agent delegate_task approval callback, write-back to asset bus `review-outcomes` slot, and max_retries episode-fail preserving v4.0 PIPE-GUARD-01 CONSISTENCY_BLOCKED semantics.

**Source artifacts audited:**
- `hermes-agent/plugins/review_gates/{__init__.py, tools.py, plugin.yaml}` from Phase 31 — 4 stubs (`_handle_gate_submit` / `_handle_gate_wait` / `_handle_gate_resolve` / `_handle_gates_list`) returning `{status: not_implemented}`
- `hermes-agent/plugins/kais_aigc/review_platform.py` from Phase 32 — JWT bearer auth + HMAC-SHA256 callback verify with 5-min window (`verify_callback(body, signature, timestamp)` returns bool; `submit_review` returns `{review_id, state, routing}`)
- `hermes-agent/plugins/pipeline_state/asset_bus.py` from Phase 33 — `review-outcomes` slot routed as generic JSON (D-33-03; Phase 34 tightens schema per ROADMAP SC#4)
- `kais-movie-agent/lib/pipeline.js` — V8.6 review gate trigger logic (lines 295-379, 472-483): remote review submission, `awaiting_review` state, `review_id` persistence, `onProgress(phaseId, ..., 'awaiting_review')` event
- `kais-movie-agent/SKILL.md` — V8.6 phase table (gate column); quality-gate maps to `delivery` phase (line 138/827)
- v4.0 PIPE-GUARD-01 — CONSISTENCY_BLOCKED semantics: episode-level fail (throw + mark episode failed), no silent swallow

## CRITICAL FINDINGS

### CF-01: Gate Lifecycle (3 Modes — confirmed from ROADMAP SC#1 + GATE-NATIVE-01)

Three switchable resolution modes. A Gate is constructed with one mode; the same lifecycle methods work for all three; only the wait behavior differs.

| Mode | wait() behavior | Resume trigger | Use case |
|------|-----------------|----------------|----------|
| **blocking** | Synchronous pause — caller thread blocks on a `threading.Event` (or async equivalent). Used when the runner is a single sequential process that can afford to block. | `resolve()` from same process (e.g., operator types decision into CLI), or another thread | Local operator review (dev / single-machine prod) |
| **webhook** | Non-blocking — `submit()` returns immediately with `review_id`. Runner records `awaiting_review` state and exits (or moves on). An external HMAC callback later resumes by calling `resolve()`. | HMAC-signed POST from review-platform → `verify_callback` → `resolve()` | Production async pipelines (Phase 35 runner must persist state and resume on callback) |
| **polling** | Active pull — loop calling `review_platform.query_review_status(review_id)` every N seconds until `state in {resolved}` or `timeout_sec` elapses. | Polling finds terminal state | Fallback when webhook delivery isn't possible; integration tests |

**Implementation:** `Gate.wait()` dispatches on `self.mode`. blocking → `Event.wait(timeout)`. webhook → return immediately (caller persists state; resume via `Gate.from_state(...).resume(callback_body, signature)`). polling → `while elapsed < timeout: query; sleep(interval)`.

### CF-02: 8 V8.6 Gates (derived from SKILL.md + lib/pipeline.js)

The 8 review gates span the 13-phase V8.6 pipeline. Names follow the SKILL.md gate column convention. Each gate locks specific asset-bus slots during review (so the runner can't mutate assets under review).

| # | gate_id | After phase | Reviewer role | Asset-bus slots locked | Default mode | Timeout | Retry policy |
|---|---------|-------------|---------------|------------------------|--------------|---------|--------------|
| 1 | `topic-gate` | p01_hook_topic | creative_source | `hook-topic`, `outline` (forward) | blocking | 3600 | `{max_retries: 2, backoff: 300}` |
| 2 | `outline-gate` | p02_outline | creative_source | `outline` | blocking | 3600 | `{max_retries: 2, backoff: 300}` |
| 3 | `script-gate` | p03_script_audit | script_auditor + compliance_gate | `spatio-temporal-script`, `temp-dialogue` | blocking | 7200 | `{max_retries: 3, backoff: 600}` |
| 4 | `character-gate` | p04_character_design | creative_source | `character-assets` | blocking | 3600 | `{max_retries: 2, backoff: 300}` |
| 5 | `scene-select-gate` | p08_scene_selection | creative_source + theory_critic | `geometry-bed` | blocking | 3600 | `{max_retries: 2, backoff: 300}` |
| 6 | `shot-breakdown-gate` | p09_shot_breakdown | creative_source | `shot-list` | blocking | 3600 | `{max_retries: 2, backoff: 300}` |
| 7 | `render-gate` | p11_video_render | editor | `final-shots` | webhook | 14400 | `{max_retries: 1, backoff: 1800}` |
| 8 | `delivery-gate` | p13_delivery | compliance_marketing + editor | `final-shots`, `master-mp4` | blocking | 7200 | `{max_retries: 3, backoff: 600}` |

**Per ROADMAP SC#2**, each gate YAML entry must contain: `gate_id` / `phase` / `asset_bus_slots_to_lock` (list) / `reviewer_role` / `timeout_sec` / `callback_url` / `retry_policy` (max_retries + backoff_sec).

### CF-03: delegate_task Approval Callback (hermes-agent integration)

The blocking-mode gate must integrate with hermes-agent `delegate_task` approval protocol. **Research correction:** hermes-agent `delegate_task` does NOT have a native "approval callback" sub-protocol — it dispatches a task to an expert skill and waits for completion. Gate approval is therefore modeled as:

- `gate_submit(mode=blocking)` submits to `review_platform` AND records `awaiting_review` in `PipelineState.phases[phase]`.
- The runner (Phase 35) reads `awaiting_review` and exits that phase cleanly (not a crash — a controlled pause with state on disk).
- The resume path is operator-driven: operator calls `gate_resolve(gate_id, decision)` after reviewing, which advances state and the next runner invocation picks up from the post-gate phase.

Webhook mode is the same shape but the trigger is the HMAC callback → `gate_resolve` rather than a human typing.

**Phase 34 delivers a `runner_hooks.py` adapter** that the Phase 35 runner will call:
- `pause_for_review(gate_id, episode_id, payload)` — writes `awaiting_review` state, returns sentinel for runner to break its loop.
- `resume_from_review(callback_body, signature, timestamp)` — verifies HMAC (via `review_platform.verify_callback`), looks up the pending gate, calls `gate.resolve()` with the callback's decision.

### CF-04: Resolution Write-Back (ROADMAP SC#4)

`gate_resolve(gate_id, decision, suggested_action=None)` writes a record to the asset bus `review-outcomes` slot. **Tightened schema (Phase 33 routed this as generic JSON per D-33-03):**

```json
{
  "outcomes": [
    {
      "gate_id": "script-gate",
      "episode_id": "EP01",
      "decision": "approve" | "reject" | "contest",
      "suggested_action": "rollback:p02_outline" | null,
      "reviewer_role": "script_auditor",
      "resolved_at": "2026-06-25T15:30:00Z",
      "attempt": 2,
      "payload_snapshot": { ... }
    }
  ],
  "version": 1
}
```

- **approve** → runner advances to next phase (Phase 35 reads review-outcomes, sees approve, continues).
- **reject with suggested_action="rollback:pXX"** → runner jumps back to specified phase (re-runs pXX → its gate → etc.).
- **contest** → no advance, no rollback — flagged for human operator attention (terminal state until manual intervention).

### CF-05: max_retries Episode Fail (ROADMAP SC#5, v4.0 PIPE-GUARD-01)

When a gate's `attempt > retry_policy.max_retries`, the gate throws `GateMaxRetriesExceeded` AND the episode is marked `failed` in `PipelineState.phases[phase].status = "failed"` with `error: "CONSISTENCY_BLOCKED: gate {id} exhausted retries ({n})"`.

This **preserves v4.0 PIPE-GUARD-01 semantics** — the pipeline does NOT silently swallow the failure (silent swallow was the v4.0 bug that PIPE-GUARD-01 fixed). The throw propagates to the runner, which records the failure and stops the episode.

`GateMaxRetriesExceeded` is a new exception class in `gate.py`. It is NOT a `GateError` (transient) — it is terminal.

## Architectural Decisions

### D-34-01: Pure stdlib for gate state machine; httpx only in webhook/polling adapters

`gate.py`'s state machine (submit/wait/resolve lifecycle, mode dispatch, retry tracking, outcome write-back) is pure stdlib (`threading.Event`, `dataclasses`, `enum`, `time`, `pathlib`, `json`, `logging`). The HTTP-calling code (webhook HMAC verify path, polling query loop) lives in `runner_hooks.py` and reuses `review_platform.ReviewPlatformClient` from Phase 32. This keeps `gate.py` unit-testable without network mocks and matches Phase 33's "data layer is stdlib-only" pattern.

### D-34-02: YAML config loaded at construction; hot-reload NOT supported

`gates.yaml` is loaded once into a `GATE_REGISTRY: dict[str, GateConfig]` at `review_gates/__init__.py` import time. Hot-reload is explicitly out of scope — gate definitions are immutable for the lifetime of a hermes-agent process. Changing a gate requires a restart. This mirrors the Phase 31 plugin manifest loading pattern.

### D-34-03: PyYAML is the ONE allowed third-party dep for review_gates

YAML config loading requires `pyyaml`. This is the ONLY new third-party dep added in Phase 34. `pyyaml` is already a transitive dep of hermes-agent (used by plugin loader for `plugin.yaml`), so no `pyproject.toml` change is needed. Verify with: `python3 -c "import yaml; print(yaml.__version__)"` exits 0.

### D-34-04: Gate records are dataclasses; outcome records are dicts

`GateConfig` (loaded from YAML) is `@dataclass(frozen=True)` for hashability + immutability. `Gate` runtime instances (carrying attempt count, current review_id, Event) are mutable dataclasses. The `review-outcomes` slot payload is plain `dict` (matches AssetBus D-33-04 dynamic-shape pattern).

### D-34-05: blocking mode uses threading.Event; no asyncio

Phase 33 locked sync API (D-07). Phase 34 follows: blocking-mode `wait()` uses `threading.Event().wait(timeout_sec)`. If the hermes-agent runtime is async, the Phase 35 runner wraps the sync call in `asyncio.to_thread`. Phase 34 itself has no async code.

### D-34-06: Wave 1 parallelism via disjoint file ownership

- Plan 34-01 owns: `gate.py`, `tests/test_gate.py`
- Plan 34-02 owns: `gates.yaml`, `tests/test_gates_config.py`
- Plan 34-03 owns: `runner_hooks.py`, `tests/test_runner_hooks.py`
- Plan 34-04 owns: `tools.py` (modified), `tests/test_tools_dispatch.py`

Zero file overlap in Wave 1 → all three run in parallel. Wave 2 (34-04) imports from all three Wave 1 modules.

## Out of Phase 34 Scope (Explicit)

- **Orchestration runner** (Phase 35) — runner.py, 13-phase sequential execution, episode parallelism. Phase 34 delivers the adapter hooks; Phase 35 wires them into the runner loop.
- **13 phase handlers** (Phase 35/36) — p01_hook_topic through p13_delivery call gate_submit at their tail.
- **Real review-platform HTTP** (Phase 32 deliverable) — Phase 34 reuses the Phase 32 client; all Phase 34 tests use mocked transports.
- **Canvas sync on gate resolution** (Phase 37) — Phase 37 subscribes to gate-resolution events; Phase 34 just emits the resolution.
- **Upstream creative_history lineage retrofit** (v6.0+) — not relevant to gate framework.

## Source Coverage Audit

| Source | Item | Covered By |
|--------|------|------------|
| ROADMAP SC#1 | gate.py lifecycle + 3 modes | Plan 34-01 |
| ROADMAP SC#2 | 8 gates as YAML | Plan 34-02 |
| ROADMAP SC#3 | blocking pauses runner; webhook HMAC resume | Plan 34-01 (lifecycle) + Plan 34-03 (runner_hooks adapter) |
| ROADMAP SC#4 | review-outcomes write-back + rollback | Plan 34-01 (`resolve()` writes outcome) + Plan 34-03 (rollback trigger) |
| ROADMAP SC#5 | max_retries → episode fail (PIPE-GUARD-01) | Plan 34-01 (`GateMaxRetriesExceeded`) + Plan 34-03 (writes failed state) |
| GATE-NATIVE-01 | gate.py 3 modes | Plan 34-01 |
| GATE-NATIVE-02 | 8 gates YAML | Plan 34-02 |
| GATE-NATIVE-03 | delegate_task approval integration | Plan 34-03 (runner_hooks adapter) |
| GATE-NATIVE-04 | review-outcomes write-back | Plan 34-01 + 34-03 |
| GATE-NATIVE-05 | max_retries episode fail | Plan 34-01 + 34-03 |
| Phase 31 contract | 4 stubs in tools.py replaced | Plan 34-04 |

No gaps. All 5 ROADMAP SCs + 5 GATE-NATIVE REQs covered.
