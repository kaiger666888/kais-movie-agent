# Phase 37 PATTERNS — Canvas Sync Migration

Reference patterns executor should mirror. Each pattern shows the canonical shape, why it exists, and the anti-pattern to avoid.

---

## Pattern 1: Callback injection over event bus

**Canonical:**
```python
# runner.py — RunnerConfig gains optional callbacks
@dataclass
class RunnerConfig:
    parallel_shots: int = 4
    workdir: str = "."
    enable_gates: bool = True
    on_phase_complete: Callable[[str, str, dict], None] | None = None
    on_gate_resolved: Callable[[str, str, str, dict], None] | None = None

# runner.py — guarded invocation after checkpoint
store.save_checkpoint(episode_id, phase_id, {...})
if cfg.on_phase_complete is not None:
    try:
        cfg.on_phase_complete(episode_id, phase_id, result)
    except Exception:
        logger.warning("on_phase_complete callback raised", exc_info=True)
```

**Why:** hermes-agent has no formal event bus (verified D-37-01). Callbacks are explicit, type-safe, and disappear when `None`. Phase 35/36 tests construct `RunnerConfig()` without the new fields → guard short-circuits → zero behavior change.

**Anti-pattern:** Introducing an `EventBus` class or `publish("phase_complete", ...)` infrastructure for a single subscriber. Adds an architectural primitive that needs its own tests, docs, and migration story. Defer to v6.0+.

---

## Pattern 2: Pure FlowGraph builder separated from HTTP I/O

**Canonical:**
```python
# canvas_graph.py — pure functions, no I/O, trivially testable
def upsert_node(graph: dict, node_id: str, node_data: dict) -> dict:
    """Mutates graph in place — find existing node by id, update; else append.
    Returns the (possibly modified) graph for chaining."""
    existing_idx = next(
        (i for i, n in enumerate(graph["nodes"]) if n["id"] == node_id),
        None,
    )
    if existing_idx is not None:
        merged = {**graph["nodes"][existing_idx], **node_data}
        merged["data"] = {**graph["nodes"][existing_idx].get("data", {}),
                          **node_data.get("data", {})}
        graph["nodes"][existing_idx] = merged
    else:
        graph["nodes"].append({"id": node_id, **node_data})
    return graph

# canvas_sync.py — subscriber does I/O, delegates mutation to pure functions
def on_phase_complete(self, episode_id, phase_id, result):
    graph = self._client.load_canvas() or self._empty_graph()
    node_data = self._build_node_data(phase_id, result)
    upsert_node(graph, f"n-{phase_id}", node_data)
    if self._prev_phase_id is not None:
        ensure_link(graph, f"l-{self._prev_phase_id}-{phase_id}",
                    f"n-{self._prev_phase_id}", f"n-{phase_id}")
    self._client.save_canvas(graph)
    self._prev_phase_id = phase_id
```

**Why:** Phase 32 `canvas.py` established the philosophy: HTTP client is dumb, orchestration is elsewhere. Phase 37 extends this — FlowGraph mutation is pure logic, HTTP is I/O. Pure functions in `canvas_graph.py` can be unit-tested with zero mocking.

**Anti-pattern:** Mixing `httpx.Client` calls with FlowGraph mutation in the same function. Forces every test to mock HTTP just to verify node merging.

---

## Pattern 3: Degrade-tolerant subscriber boundary

**Canonical:**
```python
class CanvasSyncSubscriber:
    def on_phase_complete(self, episode_id, phase_id, result):
        try:
            graph = self._client.load_canvas() or self._empty_graph()
            # ... mutate + save ...
        except Exception:
            logger.warning(
                "canvas sync on_phase_complete degraded (episode=%s phase=%s)",
                episode_id, phase_id, exc_info=True,
            )
            # Swallow — NEVER raise to runner
```

**Why:** CANVAS-IN-HERMES-03 contract. Canvas is observability tooling — pipeline correctness must not depend on canvas availability. Phase 32 CanvasClient already returns degrade envelopes instead of raising; Phase 37 adds a defense-in-depth `try/except` so even unforeseen bugs (malformed graph, KeyError) don't crash the episode.

**Anti-pattern:** Letting `CanvasClientError` or `httpx.ConnectError` propagate to the runner. Even though Phase 32 catches network errors, 4xx raises `CanvasClientError` — if a buggy node payload triggers 400, the pipeline must not abort.

---

## Pattern 4: MockTransport-injected CanvasClient for tests

**Canonical:**
```python
# test_canvas_sync.py — mocked transport records requests
def make_mock_client(captured_urls, response_data=None):
    def handler(request):
        captured_urls.append((request.method, str(request.url)))
        return httpx.Response(200, json=response_data or {"code": 0, "msg": "ok", "data": {}})
    transport = httpx.MockTransport(handler)
    return CanvasClient(base_url="http://test:10588", project_id=1,
                        episodes_id=1, transport=transport)

def test_phase_complete_triggers_save_v2():
    urls = []
    client = make_mock_client(urls, response_data={"nodes": [], "links": []})
    sub = CanvasSyncSubscriber(client)
    sub.on_phase_complete("ep-1", "p01_hook_topic", {"summary": {"selectedTopic": "X"}})
    save_calls = [u for u in urls if u[1].endswith("/api/canvas/v2/save-v2")]
    assert len(save_calls) == 1  # exactly one save per phase completion
```

**Why:** SC#2 keystone verification. The mocked transport lets us assert exactly which `:10588` endpoints were hit, in what order, without a real canvas server. Phase 32 `CanvasClient` already accepts `transport=httpx.MockTransport(handler)` — Phase 37 tests reuse this seam.

**Anti-pattern:** Mocking `CanvasClient` itself with `unittest.mock.MagicMock`. Hides whether the real client's request construction (URL, body shape, envelope unwrap) works. Always inject `MockTransport` and let the real client run.

---

## Pattern 5: Behavioral parity with Node.js defaultPhaseMapper + computeNodePosition

**Canonical:**
```python
# canvas_graph.py — port verbatim from lib/canvas-sync-hook.js
_PHASE_GROUP_RESEARCH_PREFIXES = ("pain", "topic", "outline", "script", "character", "scene", "spatio")
_PHASE_GROUP_PRODUCTION_PREFIXES = ("seed", "motion", "ai-preview", "consistency", "render", "final")

def default_phase_mapper(phase: dict) -> dict:
    stage = phase.get("stage") or phase.get("id") or ""
    phase_group = "production"
    if stage.startswith(_PHASE_GROUP_RESEARCH_PREFIXES):
        phase_group = "research" if phase.get("stage_order", 99) <= 5 else "story"
    elif stage.startswith(_PHASE_GROUP_PRODUCTION_PREFIXES):
        phase_group = "production"
    return {
        "label": phase.get("name") or phase.get("id", ""),
        "phase": phase_group,
        "tags": ["需审核"] if phase.get("review") else [],
        "filePath": ", ".join(phase.get("output_files", [])) or None,
    }

_LANE_X = {"research": 100, "story": 1200, "production": 2000, "post": 2800}

def compute_node_position(phase_group: str, stage_order: int) -> dict:
    x = _LANE_X.get(phase_group, 2000) + (stage_order % 3) * 350
    y = 100 + (stage_order // 3) * 200
    return {"x": x, "y": y}
```

**Why:** Canvas UI consistency during the migration window. The Node.js path and Python path produce visually identical layouts. CF-37-04/05.

**Anti-pattern:** "Improving" the layout algorithm during the port. Phase 37 is reference port (D-36-01 carry-forward), not re-design. Improvements defer to v6.0+.

---

## Pattern 6: Subscriber state — prev_phase_id for link drawing

**Canonical:**
```python
class CanvasSyncSubscriber:
    def __init__(self, canvas: CanvasClient, agent_name: str = ""):
        self._client = canvas
        self._agent_name = agent_name
        self._prev_phase_id: str | None = None  # for ensureLink chain

    def on_phase_complete(self, episode_id, phase_id, result):
        # ... upsert node ...
        if self._prev_phase_id is not None:
            ensure_link(graph, f"l-{self._prev_phase_id}-{phase_id}",
                        f"n-{self._prev_phase_id}", f"n-{phase_id}")
        self._prev_phase_id = phase_id
```

**Why:** The Node.js `nodeMap` tracks `prevPhaseId` to draw links between consecutive phase nodes. The Python port tracks the same state on the subscriber instance. Per-episode state — construct a fresh subscriber per episode.

**Anti-pattern:** Storing prev_phase_id in a module-level global. Breaks concurrent episode runs. Subscriber instance state is isolated per episode.

---

## Pattern 7: Registration API — single function wires both hooks

**Canonical:**
```python
# canvas_sync.py
def register_canvas_sync(
    *,
    base_url: str | None = None,
    project_id: int,
    episodes_id: int,
    runner_config: RunnerConfig,
    transport: httpx.BaseTransport | None = None,
) -> CanvasSyncSubscriber:
    """Construct client + subscriber, wire both callbacks. Returns subscriber."""
    client = CanvasClient(
        base_url=base_url, project_id=project_id,
        episodes_id=episodes_id, transport=transport,
    )
    sub = CanvasSyncSubscriber(client)
    runner_config.on_phase_complete = sub.on_phase_complete
    runner_config.on_gate_resolved = sub.on_gate_resolved
    # Gate hook is module-level in runner_hooks (D-37-07)
    from plugins.review_gates import runner_hooks
    runner_hooks.set_gate_resolved_hook(sub.on_gate_resolved)
    return sub
```

**Why:** Single registration call wires both trigger paths. The caller (skill or tools.py dispatch) doesn't need to know about the two-hook split. The subscriber is returned so callers can hold a reference (prevents GC of the callback target).

**Anti-pattern:** Forcing callers to manually set `runner_config.on_phase_complete = ...` and `runner_hooks.set_gate_resolved_hook(...)` in two separate calls. Error-prone — easy to wire one and forget the other, breaking SC#2's two-trigger-path contract.

---

## Pattern 8: tools.py dispatch — kais_canvas_sync tool

**Canonical:**
```python
# tools.py — Phase 32 dispatch pattern extended
def kais_canvas_sync(
    project_id: int,
    episodes_id: int,
    base_url: str | None = None,
) -> dict:
    """Register canvas sync on the current pipeline's RunnerConfig.

    Returns: {"registered": True, "subscriber": "<obj id>"} or degrade envelope.
    """
    from plugins.kais_aigc.canvas_sync import register_canvas_sync
    # Caller must supply the RunnerConfig — for skill-internal use the
    # SKILL.md invocation pattern documents this.
    ...
```

**Why:** Phase 31/32 SC requires every kais_aigc capability exposed as a hermes-agent tool. Phase 37 extends `tools.py` with `kais_canvas_sync`. The tool is the public API; direct `register_canvas_sync()` calls are for skill-internal wiring.

**Anti-pattern:** Skipping the tools.py dispatch and calling `register_canvas_sync()` directly from phase modules. Breaks the unified tool surface (GPU-DIRECT-06 contract) — other skills / agents can't discover the canvas sync capability.
