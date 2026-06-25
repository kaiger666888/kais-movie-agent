---
phase: 32-kais-aigc-platform-backend
plan: 03
subsystem: kais-aigc-platform-clients
tags: [canvas, http, httpx, python-client, degrade, pipe-integrity]
requires:
  - 31-kais-aigc-plugin-skeleton  # Phase 31 plugin scaffold (__init__.py + tools.py stubs)
provides:
  - plugins.kais_aigc.canvas.CanvasClient       # HTTP v2 client — save_canvas / load_canvas
  - plugins.kais_aigc.canvas.CanvasClientError  # 4xx / caller-bug error class
affects:
  - plugins.kais_aigc.tools._handle_kais_canvas_sync  # Phase 32-05 swaps stub → dispatches to CanvasClient
tech-stack:
  added: []  # httpx==0.28.1 already in pyproject.toml; zero new deps
  patterns:
    - sync httpx.Client + transport kwarg for MockTransport tests (mirrors microsoft_graph_client)
    - uniform degrade envelope {degraded, client, operation, reason}
    - HTTP-only single-write-path (v4.0 PIPE-INTEGRITY-01 preservation)
key-files:
  created:
    - /data/workspace/hermes-agent/plugins/kais_aigc/canvas.py
    - /data/workspace/hermes-agent/plugins/kais_aigc/tests/test_canvas.py
  modified: []
decisions:
  - D-08: HTTP-only — no sqlite / subprocess / DB_PATH references (v4.0 PIPE-INTEGRITY-01 preserved, verified by grep)
  - "CanvasClient surface trimmed to save_canvas + load_canvas + save_canvas_degraded (CRITICAL-FINDING-08): rich Node.js node/edge/branch/variant ops out of scope"
  - "WebSocket NOT ported — deferred to Phase 37+ if live canvas events are needed"
  - "save_canvas stamps graph.meta.updatedAt (ms epoch) before save, mirroring canvas-content-sync.js line 53"
metrics:
  duration: ~12m
  completed: 2026-06-25
  tasks: 2
  files_created: 2
---

# Phase 32 Plan 03: Canvas Client (HTTP v2 only) Summary

Python port of the Node.js `lib/canvas-client.js` HTTP subset + `lib/canvas-content-sync.js` saveGraph helper — exposes `CanvasClient` with `save_canvas` / `load_canvas` / `save_canvas_degraded`, HTTP API v2 only, fully preserving the v4.0 PIPE-INTEGRITY-01 single-write-path fix.

## Artifacts

| File | LOC | Provides |
|------|-----|----------|
| `/data/workspace/hermes-agent/plugins/kais_aigc/canvas.py` | 281 | `CanvasClient` + `CanvasClientError` — 12 methods (`save_canvas`, `load_canvas`, `save_canvas_degraded`, `set_context`, `_require_context`, `_headers`, `_degrade`, `_request`, `close`, `__enter__`, `__exit__`) |
| `/data/workspace/hermes-agent/plugins/kais_aigc/tests/test_canvas.py` | 234 | 14 mocked-HTTP tests via `httpx.MockTransport` |

## Test Coverage (14/14 pass, 0.12s)

- `test_save_canvas_happy_path` — envelope `{code,msg,data}` unwrapped; body schema `{projectId, episodesId, graph}` verified
- `test_save_canvas_sets_updatedat` — `graph.meta.updatedAt` (ms epoch) stamped before save
- `test_save_canvas_degrades_on_503` — 5xx → degrade envelope, no raise
- `test_save_canvas_degrades_on_connect_error` — `ConnectError` → degrade
- `test_save_canvas_degrades_on_timeout` — `ReadTimeout` → degrade
- `test_save_canvas_raises_on_400` — 4xx → `CanvasClientError` (caller bug), status captured
- `test_load_canvas_happy_path` — POST `/api/canvas/v2/load-v2`, payload returned
- `test_load_canvas_returns_none_when_no_graph` — `data: null` → `None`
- `test_require_context_raises_when_project_id_unset`
- `test_require_context_raises_when_episodes_id_unset`
- `test_save_canvas_rejects_non_dict_graph` — caller-side validation
- `test_save_canvas_degraded_swallows_4xx` — convenience wrapper catches → degrade (matches Node.js saveGraph)
- `test_set_context_updates_ids` — late-binding context update
- `test_env_var_fallback_used_when_base_url_unset` — `KAIS_CANVAS_URL` honored

## Critical Findings — Resolutions

### CRITICAL-FINDING-05 (save-v2 body schema)
RESOLVED. `save_canvas` posts `{projectId, episodesId, graph}` to `/api/canvas/v2/save-v2`; `_request` unwraps the `{code, msg, data}` response envelope. Verified by `test_save_canvas_happy_path` (asserts body schema + envelope unwrap).

### CRITICAL-FINDING-08 / D-08 (scope trim to save+load only)
RESOLVED. `CanvasClient` exposes only `save_canvas`, `load_canvas`, `save_canvas_degraded`. The Node.js client's `addNode` / `addLink` / `createBranch` / `patchCanvas` / variant-group ops are intentionally NOT ported — Phase 35+ orchestration will build the full FlowGraph in Python and persist via `save_canvas(merged_graph)`. WebSocket support (`socket.io-client` in Node.js) is also deferred — Phase 37+ reintroduces it only if a phase needs live canvas events.

### v4.0 PIPE-INTEGRITY-01 preservation (THE load-bearing constraint)
RESOLVED + GREP-VERIFIED. `canvas.py` contains ZERO references to sqlite, subprocess, or DB_PATH. Single HTTP write path eliminates the double-write race fixed in v4.0.

```
$ grep -ci "sqlite"  /data/workspace/hermes-agent/plugins/kais_aigc/canvas.py
0
$ grep -ci "sqlite"  /data/workspace/hermes-agent/plugins/kais_aigc/tests/test_canvas.py
0
$ grep -i "subprocess\|db_path" plugins/kais_aigc/canvas.py
(no matches)
```

The Node.js `canvas-content-sync.js` still reads via an in-process DB CLI for its legacy path — the v5.0 Python standardizes on HTTP for both read and write per `CANVAS-IN-HERMES-03`.

## Verification Gates

| Gate | Result |
|------|--------|
| Structure AST check (classes, methods, imports, transport kwarg, KAIS_CANVAS_URL, PIPE-INTEGRITY-01 marker, ≥120 LOC) | PASS — 12 methods, 281 LOC |
| `pytest plugins/kais_aigc/tests/test_canvas.py -v` | PASS — 14/14 in 0.12s |
| `git diff pyproject.toml` (no new deps) | PASS — empty diff |
| `grep -ci "sqlite" canvas.py == 0` | PASS — 0 |
| Every `CanvasClient(` in tests passes `transport=` (no real network) | PASS — verified by AST scan |

## Hand-off to Plan 32-05

`Plan 32-05` can now swap the `_handle_kais_canvas_sync` stub (declared in `plugins/kais_aigc/tools.py` from Phase 31) to dispatch to `CanvasClient`. Suggested wiring (per PATTERNS.md "Tool Handler Dispatch Pattern"):

```python
from plugins.kais_aigc.canvas import CanvasClient, CanvasClientError

def _handle_kais_canvas_sync(args: dict, **kw) -> str:
    from tools.registry import tool_result, tool_error
    project_id = args.get("project_id")
    episodes_id = args.get("episodes_id")
    action = args.get("action") or "save"
    graph = args.get("graph") or {}
    try:
        with CanvasClient(project_id=project_id, episodes_id=episodes_id) as c:
            if action == "load":
                result = c.load_canvas()
            else:
                result = c.save_canvas_degraded(graph)
        return tool_result(result)
    except CanvasClientError as exc:
        return tool_error(str(exc), status_code=exc.status or 500)
```

(The exact `KAIS_CANVAS_SYNC_SCHEMA` arg names are owned by Plan 32-05.)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] PLAN verification script scoped `transport` arg check to `args.args` only**
- **Found during:** Task 1 verification
- **Issue:** The PLAN's AST verification script asserted `'transport' in [a.arg for a in init_node.args.args]` after picking the *first* `__init__` in the AST walk (which is `CanvasClientError.__init__`, not `CanvasClient.__init__`). Additionally, `CanvasClient.__init__` uses keyword-only args (per PLAN spec `__init__(self, *, base_url=None, ...)`), so `transport` lives in `args.kwonlyargs` — `args.args` only contains `['self']`. The script as written would always fail.
- **Fix:** Used a corrected verification that (a) scopes to `CanvasClient.__init__` by iterating the class body, and (b) checks `args.args + args.kwonlyargs`. The implementation itself is correct per PLAN spec.
- **Files modified:** None — implementation unchanged; only the verification script (transient, not committed).
- **Commit:** e388c9c6f

**2. [Rule 1 — Bug] Source/docstring contained forbidden literal tokens**
- **Found during:** Task 1 verification (grep gate)
- **Issue:** The grep gate `grep -ci "sqlite" canvas.py == 0` is case-insensitive substring. My initial docstring + code legitimately explained the v4.0 fix using the words "sqlite", "subprocess", "DB_PATH" (to document what we deliberately DON'T do) — but the gate flags *any* occurrence including explanatory text. The PLAN task 2 `<done>` criteria also requires "No sqlite references in test file."
- **Fix:** Rephrased all docstring explanations to avoid the literal forbidden tokens — e.g. "no DB-layer direct access", "ZERO direct DB access or shell-out calls". Meaning preserved; tokens absent.
- **Files modified:** canvas.py (3 edits), test_canvas.py (1 edit) — all pre-commit.
- **Commit:** e388c9c6f

No other deviations. Plan executed as written.

## Self-Check: PASSED

- FOUND: `/data/workspace/hermes-agent/plugins/kais_aigc/canvas.py` (281 lines)
- FOUND: `/data/workspace/hermes-agent/plugins/kais_aigc/tests/test_canvas.py` (234 lines)
- FOUND: commit `e388c9c6f` in `git log --oneline --all`
- FOUND: 14/14 tests pass on re-run
