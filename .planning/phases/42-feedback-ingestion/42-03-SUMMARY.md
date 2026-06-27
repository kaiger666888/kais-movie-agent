---
phase: 42-feedback-ingestion
plan: 03
subsystem: feedback-ingestion
tags: [http-server, starlette, uvicorn, context-manager, cli, asgi]
requires:
  - 42-02 (FeedbackIngestClient.submit_feedback validation pipeline)
  - V5.0 (Starlette + uvicorn + httpx — V5.0-blessed ASGI stack)
provides:
  - "feedback_ingest.FeedbackIngestClient.list_pending_updates — operator-side pending-review queue (newest-first, default limit 10)"
  - "feedback_ingest._build_starlette_app — pure ASGI factory wiring POST /api/v1/feedback to submit_feedback"
  - "feedback_ingest.start_feedback_server — @contextmanager running uvicorn in a daemon thread (yields handle with .client/.base_url/.server, graceful shutdown via should_exit + thread.join)"
  - "feedback_ingest._run_cli + __main__ block — production `python -m plugins.kais_aigc.feedback_ingest` entry point (blocking serve_forever on main thread)"
affects:
  - "plugins/kais_aigc/feedback_ingest.py (validation-only module -> HTTP-server-enabled)"
tech-stack:
  added: []
  patterns:
    - "Starlette ASGI factory (_build_starlette_app) — pure function returning Starlette(routes=[Route('/api/v1/feedback', handler, methods=['POST'])])"
    - "Async route handler delegating to sync validation client (D-07 invariant preserved)"
    - "@contextlib.contextmanager + daemon thread for test-safe uvicorn lifecycle"
    - "Lazy imports of starlette/uvicorn inside factory/functions — validation-only callers do not pay ASGI import cost"
    - "Production CLI uses uvicorn.run on the main thread (NOT the context manager) so SIGINT/SIGTERM propagate"
    - "Internal http_status key stripped from response body (T-42-13 info-disclosure mitigation)"
key-files:
  created:
    - /data/workspace/hermes-agent/plugins/kais_aigc/tests/test_feedback_server.py
    - /data/workspace/kais-movie-agent/.planning/phases/42-feedback-ingestion/42-03-SUMMARY.md
    - /data/workspace/kais-movie-agent/.planning/phases/42-feedback-ingestion/deferred-items.md
  modified:
    - /data/workspace/hermes-agent/plugins/kais_aigc/feedback_ingest.py
decisions:
  - "Lazy import of starlette/uvicorn INSIDE _build_starlette_app / start_feedback_server / _run_cli — preserves 42-01/42-02 callers' fast import path; V5.0 deps remain hard-required only when the HTTP surface is actually used."
  - "@contextlib.contextmanager (NOT a custom __enter__/__exit__ class) — simpler, less code, identical semantics for the test-cleanup use case."
  - "Production CLI uses uvicorn.run (blocking, main thread) NOT the context manager — CONTEXT.md LOCKED decision that production runs serve_forever while tests use the context manager. The context manager's daemon thread is unsuitable for production because SIGINT/SIGTERM would not propagate to a non-main thread."
  - "list_pending_updates uses pure-Python sorted(reverse=True) on received_at — lexicographic ISO 8601 sort is correct for the fixed _now_iso format; no DB index needed at the JSONL scale Phase 42 operates at."
  - "Route handler strips http_status from JSON response body — keeps the HTTP-envelope contract clean ({status, feedback_id, recipe_id}) and prevents internal-state leakage (T-42-13)."
metrics:
  duration: 4m47s
  completed: 2026-06-27T12:31:00Z
  tasks: 1
  files_created: 3
  files_modified: 1
  tests_added: 16
  commits: 2
---

# Phase 42 Plan 03: HTTP Server + start_feedback_server + list_pending_updates Summary

Starlette + uvicorn HTTP server wiring for `FeedbackIngestClient`, exposing `POST /api/v1/feedback` on `KAIS_FEEDBACK_PORT` (default 8091) with a `@contextmanager`-based lifecycle for tests and a blocking `__main__` CLI block for production.

## What Shipped

### 1. `list_pending_updates(limit=10)` on `FeedbackIngestClient`
Operator-facing "pending review queue" reader. Returns most-recent N feedback-data records sorted by `received_at` descending (lexicographic ISO 8601 sort). Raises `ValueError` on `limit < 1` or non-int. Returns `[]` on empty slot.

### 2. `_build_starlette_app(client)` — pure ASGI factory
Builds a Starlette application with one route: `POST /api/v1/feedback`. The async handler:
1. Reads raw body bytes (`await request.body()`)
2. Reads `X-Signature` header (empty string if missing)
3. Delegates to **sync** `client.submit_feedback(body, signature)` (D-07 invariant — handler is async but the validation client is sync)
4. Strips the internal `http_status` key from the response body (T-42-13 info-disclosure mitigation) and uses it as the JSONResponse status code

Returns `Starlette(routes=[Route("/api/v1/feedback", feedback_handler, methods=["POST"])])`. Pure function — does not start a server.

### 3. `start_feedback_server` — `@contextlib.contextmanager`
Context manager that constructs a `FeedbackIngestClient`, builds the app, and runs `uvicorn.Server` in a daemon thread. Yields `types.SimpleNamespace(client=..., base_url=..., server=...)`.

- Port resolution mirrors `FeedbackIngestClient.__init__` D-06: explicit arg → `KAIS_FEEDBACK_PORT` env → `DEFAULT_FEEDBACK_PORT` (8091).
- Secret resolution: explicit arg → `KAIS_FEEDBACK_SECRET` env.
- Polls `server.started` for up to 5 seconds (50 × 100ms) before yielding.
- Graceful shutdown on `__exit__`: `server.should_exit = True; thread.join(timeout=5.0)` — port released deterministically.

### 4. `__main__` CLI block (`_run_cli`)
Production entry point: `python -m plugins.kais_aigc.feedback_ingest`. Constructs `AssetBus(KAIS_WORKDIR)` + `RecipeLibrary`, then calls `uvicorn.run(app, host=..., port=...)` **on the main thread** (blocking `serve_forever` per CONTEXT.md LOCKED decision). uvicorn's built-in signal handlers perform graceful shutdown on SIGINT/SIGTERM.

The CLI deliberately does NOT use `start_feedback_server` — the context manager's daemon thread would not receive process signals. CONTEXT.md specifies "context manager for test cleanup; blocking serve_forever() in production."

## TDD Gate Compliance

- RED: `cf78d380a` — `test(42-03): add failing tests for HTTP server + list_pending_updates` (16 tests fail with missing imports/methods)
- GREEN: `035053d76` — `feat(42-03): Starlette HTTP server + start_feedback_server + list_pending_updates` (16/16 pass)
- No REFACTOR needed.

Gate sequence verified in git log.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Initial `start_feedback_server` missing `@contextlib.contextmanager` decorator**
- **Found during:** Task 1 GREEN run (4 of 16 tests failed with `TypeError: 'generator' object does not support the context manager protocol`)
- **Issue:** I imported `contextlib` INSIDE the function body but applied the `@contextlib.contextmanager` decorator at function-definition time — too late, since the decorator runs at module import.
- **Fix:** Moved `import contextlib` to module-level imports; added `@contextlib.contextmanager` decorator; removed the redundant inner import.
- **Files modified:** `plugins/kais_aigc/feedback_ingest.py`
- **Commit:** `035053d76`

### Out-of-scope Failures Deferred

**`test_canvas_sync_integration.py::test_no_openclaw_references_in_phase_37_deliverables`** — pre-existing failure caused by unstaged modifications to `plugins/kais_aigc/canvas_sync.py` (a separate V8.6 phaseIndex effort that introduced direct `sqlite3` imports). Verified pre-existing by stashing unstaged changes (test passes without them). NOT touched by plan 42-03. Logged to `deferred-items.md` for the canvas_sync owner.

## Verification

```
plugins/kais_aigc/tests/test_feedback_server.py: 16 passed in 1.31s
```

Test breakdown:
- `TestListPendingUpdates` (Tests 1-3): empty slot / limit-N newest-first / default-10
- `TestStarletteApp` (Tests 4-11): factory output + 5 HTTP status codes (200/401/422/400/404) + 405 GET + 404 unknown path — all via Starlette `TestClient` (in-process ASGI, no port binding)
- `TestServerLifecycle` (Tests 12-16): real uvicorn round-trip on ephemeral port via httpx + handle attributes + port release on context exit + `KAIS_FEEDBACK_PORT` env resolution + `__main__` source inspection

Baseline regression: **401 tests passing** across Phase 42-01/42-02 + Phase 41 (`test_feedback_server.py + test_feedback_validation.py + test_feedback_ingest_skeleton.py + plugins/pipeline_state/tests/`).

## Success Criteria

- [x] 16/16 server tests GREEN
- [x] `list_pending_updates` default limit=10, sorts newest first
- [x] `start_feedback_server` yields object with `.client` + `.base_url`
- [x] HTTP endpoint delegates correctly to `submit_feedback` (all 5 status codes match: 200/401/422/400/404)
- [x] `__main__` block enables `python -m plugins.kais_aigc.feedback_ingest`
- [x] Only POST routed (GET → 405; unknown paths → 404 — T-42-11 mitigation)
- [x] Response body carries no internal state (http_status stripped — T-42-13 mitigation)
- [x] Worker=1 implicit (single `uvicorn.Server` instance — no `--workers` flag)
- [x] Graceful shutdown via `server.should_exit=True` + `thread.join(timeout=5.0)`

## Self-Check: PASSED

- Files created/modified: all FOUND on disk
  - `/data/workspace/hermes-agent/plugins/kais_aigc/feedback_ingest.py` (788 lines)
  - `/data/workspace/hermes-agent/plugins/kais_aigc/tests/test_feedback_server.py` (359 lines, min_lines=150 satisfied)
- Commits: all FOUND in git log
  - `cf78d380a` (RED): `test(42-03): add failing tests for HTTP server + list_pending_updates`
  - `035053d76` (GREEN): `feat(42-03): Starlette HTTP server + start_feedback_server + list_pending_updates`
