# Phase 37 CONTEXT — Canvas Sync Migration

**Phase:** 37 — Canvas Sync Migration
**Status:** planning
**Depends on:** Phase 35 (skill runner — phase completion event source), Phase 34 (gate framework — gate resolution event source), Phase 32 (CanvasClient — HTTP API v2 ready, reused), Phase 36 (13-phase DAG — canvas sync fires for all phases)
**Cross-repo:** Deliverables land in `/data/workspace/hermes-agent/plugins/kais_aigc/` + `skills/kais-movie-pipeline/pipeline/`; planning docs live here.

---

## Goal (outcome, not task)

**As a** hermes-agent operator,
**I want to** run the kais-movie-pipeline and have canvas sync fire automatically on every phase completion and every gate resolution approve — written to `:10588/api/canvas/v2/save-v2` via HTTP,
**so that** the kais-aigc-platform infinite canvas reflects pipeline progress in real time without any Node.js subprocess, openclaw orchestration, or direct sqlite writes.

After Phase 37, the canvas integration is fully hermes-native. Phase 38 cuts the remaining openclaw references; Phase 39 ships E2E.

---

## Decisions (locked — DO NOT revisit)

### D-37-01: Callback injection, not formal event bus
**Decision:** hermes-agent has no formal internal event bus (verified: `grep -rniE "event.?bus|EventBus" plugins/ skills/` → 0 hits). Phase 37 uses simple callback injection instead: `RunnerConfig` gains two optional `Callable` fields (`on_phase_complete`, `on_gate_resolved`), both defaulting to `None`. The runner and `runner_hooks.resume_from_callback` invoke these callbacks at the right lifecycle points. The subscriber registers itself by setting the callbacks (or the module-level gate hook). This is the minimum-disruption design — formal event bus is a v6.0+ concern.

**Rationale:** Avoids introducing a new architectural primitive (event bus) for a single subscriber. Callbacks are explicit, testable, and disappear when not registered (Phase 35/36 tests stay green unchanged).

### D-37-02: Subscriber lives in plugins/kais_aigc/
**Decision:** `canvas_sync.py` lives in `plugins/kais_aigc/` (co-located with `canvas.py` from Phase 32). The subscriber is the orchestration glue between pipeline events and the canvas HTTP client — it belongs in the kais_aigc plugin's tool surface alongside the other kais-aigc clients.

**Not** in `skills/kais-movie-pipeline/` — the skill is the consumer of the subscriber (it registers the subscriber on its RunnerConfig), but the subscriber itself is a reusable plugin component (other skills could register it too).

### D-37-03: Pure FlowGraph builder extracted to canvas_graph.py
**Decision:** The Node.js `canvas-sync-hook.js` mixes HTTP I/O with FlowGraph mutation logic. Phase 37 splits these:
- `canvas_graph.py` — pure functions: `upsert_node`, `ensure_link`, `compute_node_position`, `default_phase_mapper`. No I/O. Trivially unit-testable.
- `canvas_sync.py` — the subscriber class: loads graph via `CanvasClient.load_canvas()`, mutates via `canvas_graph` functions, saves via `CanvasClient.save_canvas()`.

This separation matches the Phase 32 `canvas.py` philosophy (HTTP client is dumb; orchestration is elsewhere) and makes the FlowGraph mutation logic testable without mocking HTTP.

### D-37-04: Degrade-tolerant contract — subscriber never raises to runner
**Decision:** Per CANVAS-IN-HERMES-03, the subscriber MUST NOT block the pipeline. All `CanvasClient` calls (already degrade-tolerant via Phase 32 envelopes) are wrapped in `try/except Exception` at the subscriber boundary. Network errors, malformed responses, slow timeouts → logged at WARNING, swallowed. The runner's `on_phase_complete` callback invocation is itself wrapped in a `try/except` in the runner (defensive — a buggy subscriber never crashes the episode).

### D-37-05: No Node.js runtime dependency
**Decision:** Pure Python port. The Node.js `lib/canvas-sync-hook.js` is the behavioral reference only. No `subprocess.run(["node", ...])`, no `require()`, no `package.json` import. The Python subscriber uses `httpx` (via Phase 32 `CanvasClient`) for all I/O. Verified by `grep -rniE "openclaw|Toonflow|subprocess.run.*node|require\\("` returning 0 hits in Phase 37 deliverables.

### D-37-06: RunnerConfig defaults None — Phase 35/36 regression preserved
**Decision:** The new `on_phase_complete` / `on_gate_resolved` fields on `RunnerConfig` default to `None`. The runner's invocation is guarded: `if cfg.on_phase_complete is not None: cfg.on_phase_complete(...)`. This means **every existing Phase 35/36 test passes unchanged** — they construct `RunnerConfig()` without the new fields, the guard short-circuits, no canvas sync fires. The full-DAG test (`test_runner_full_dag.py`) must stay green after Phase 37.

### D-37-07: Gate resolution hook lives module-level in runner_hooks
**Decision:** `runner_hooks.py` already has a module-level `_PENDING_GATES` cache and a `pause_for_review` / `resume_from_callback` flow. Phase 37-01 adds a module-level `_on_gate_resolved` callable (default `None`) + a `set_gate_resolved_hook(fn)` setter. `resume_from_callback` invokes the hook after writing the `review-outcomes` slot. The subscriber calls `set_gate_resolved_hook(self.on_gate_resolved)` during registration.

**Alternative considered:** pass the callback through `pause_for_review` parameters. Rejected — `pause_for_review` is called from phase modules via `trigger_gate`, and adding a parameter there would touch all 13 phase modules. Module-level hook is cleaner.

---

## Critical Findings from Prior Phases (carry forward)

### CF-37-01: Reuse Phase 32 CanvasClient — do NOT duplicate
`plugins/kais_aigc/canvas.py` (Phase 32) already implements: HTTP API v2 only, save_canvas + load_canvas, `{projectId, episodesId, graph}` body shape, `{code, msg, data}` envelope unwrapping, degrade envelope on connect/timeout/5xx, 15s default timeout, `httpx.MockTransport` injection for tests. Phase 37 subscriber imports and uses this client — zero duplication of HTTP/degrade logic.

### CF-37-02: Phase 35 runner checkpoint-after-phase is the natural event point
`runner.py` line 316-320 calls `store.save_checkpoint(episode_id, phase_id, {...})` immediately after `module.run(...)`. This is the natural insertion point for the phase completion event — the phase's asset-bus write is already persisted, the result dict is in hand. Phase 37-01 inserts the `on_phase_complete` invocation right after this checkpoint save.

### CF-37-03: Phase 34 resume_from_callback writes review-outcomes before returning
`runner_hooks.resume_from_callback` (Phase 34) writes the gate decision to the `review-outcomes` asset-bus slot before returning the rollback hint. Phase 37-01 inserts the `on_gate_resolved` invocation after this write — the canvas sees the approved node only after the formal outcome is persisted.

### CF-37-04: Node.js defaultPhaseMapper regex is the behavioral contract
The Node.js `defaultPhaseMapper` (canvas-sync-hook.js lines 41-57) infers `phaseGroup` (research / story / production / post) from the phase's `stage` prefix. Phase 37 ports this regex verbatim into `canvas_graph.default_phase_mapper` — same grouping, same stage-prefix patterns. The 13 Phase 35/36 phase IDs (`p01_hook_topic`..`p13_delivery`) must map cleanly; the regex covers `topic|outline|script|character|scene|spatio|pain` (research/story) and `seed|motion|render|final` (production/post).

### CF-37-05: Node.js computeNodePosition lane layout is the behavioral contract
The Node.js `computeNodePosition` (lines 142-152) places nodes in 4 lane columns (research x=100, story x=1200, production x=2000, post x=2800) with a 3-per-row wrap. Phase 37 ports this verbatim — canvas UI consistency with the Node.js path during the migration window.

---

## Claude's Discretion areas

- **Subscriber construction shape** — class vs factory function: use a class (`CanvasSyncSubscriber`) for testability (mock individual methods). Document in PATTERNS.md.
- **FlowGraph initial skeleton** — when `load_canvas()` returns `None` (empty canvas), the subscriber constructs a `{nodes: [], links: [], branches: [{id: "main", ...}], variantGroups: [], meta: {...}}` skeleton. Exact `meta` fields at executor discretion but must include `version: "2"`, `projectId`, `episodesId`, `createdAt`, `updatedAt`.
- **Node ID convention** — `n-{phase_id}` (mirrors Node.js). Link ID `l-{prev_phase_id}-{phase_id}`.
- **Test transport pattern** — `httpx.MockTransport` with a handler that records request URLs + returns canned responses. Asserting the handler saw a `save-v2` POST is the keystone verification for SC#2.
- **tools.py dispatch shape** — `kais_canvas_sync` tool takes `project_id` + `episodes_id` + optional `base_url`, constructs subscriber, returns a registration handle. Exact return shape at executor discretion.

---

## Out of Phase 37 Scope (handled in later phases)

- Full openclaw grep cleanup + DEPRECATED.md (Phase 38)
- E2E producing master.mp4 with canvas sync observed end-to-end (Phase 39)
- Canvas WebSocket live events (v6.0+ — Phase 32 explicitly scoped WebSocket out)
- Rich node variant groups / branch creation beyond the `main` branch (Node.js has the API but v5.0 only needs linear main-branch sync)
- Multi-agent canvas (other skills registering the subscriber) — Phase 37 wires it for kais-movie-pipeline only; the API is reusable but not exercised
