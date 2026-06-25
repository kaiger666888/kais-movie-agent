# Phase 32 Patterns: Python HTTP Client + Degrade Pattern

**Source:** Research against `/data/workspace/hermes-agent/tools/microsoft_graph_client.py`, `tests/tools/test_microsoft_graph_client.py`, `plugins/spotify/client.py`, and Node.js refs (`lib/gold-team-client.js`, `lib/review-platform-client.js`, `lib/canvas-client.js`, `lib/jimeng-client.js`).

This document shows the executor the exact Python patterns to mirror so they don't re-explore the codebase.

## Reference Modules Consulted

| Module | Path | Why Consulted | Pattern Extracted |
|--------|------|---------------|-------------------|
| microsoft_graph_client | `tools/microsoft_graph_client.py` | Sync httpx client with bearer auth + retry + custom error | httpx.Client usage, error class, header injection |
| microsoft_graph_client tests | `tests/tools/test_microsoft_graph_client.py` | httpx.MockTransport-based testing | MockTransport handler pattern, async test class |
| spotify client | `plugins/spotify/client.py` | Plugin-local client class pattern | Client construction from env, error subclass, helper methods |
| spotify tools | `plugins/spotify/tools.py` | Tool handler dispatching to client | `_spotify_client()` factory, `_spotify_tool_error` mapper, try/except wrapping |
| tool registry helpers | `tools/registry.py` (`tool_result`, `tool_error`) | Uniform JSON result/error serialization | Handler return shape |

## Adopted Pattern (per-client class + MockTransport tests)

### Client Class Anatomy

Every client module follows this skeleton. Names vary; the shape is invariant.

```python
"""gold_team.py — GoldTeamClient (GPU task scheduler :8002).

Reference port of Node.js lib/gold-team-client.js. Adds X-API-Key auth
(GPU-DIRECT-01) — Node.js ref removed auth ("内网互通") but v5.0 hardens it.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)


class GoldTeamError(Exception):
    """Raised for 4xx client errors and unrecoverable failures."""

    def __init__(self, message: str, *, status: int | None = None, url: str | None = None):
        super().__init__(message)
        self.status = status
        self.url = url


class GoldTeamClient:
    """Sync httpx client for gold-team GPU task API.

    All public methods return dicts. Network/5xx/timeout errors degrade
    (return `{"degraded": True, ...}`) per GPU-DIRECT-05. 4xx errors raise
    `GoldTeamError` (caller bug).
    """

    DEFAULT_BASE_URL = "http://192.168.71.140:8002"  # REQUIREMENTS GPU-DIRECT-01
    DEFAULT_TIMEOUT = 60.0  # GPU tasks may be long

    def __init__(
        self,
        *,
        base_url: str | None = None,
        api_key: str | None = None,
        timeout: float | None = None,
        transport: httpx.BaseTransport | None = None,  # tests inject MockTransport
    ):
        self._base_url = (base_url or os.environ.get("KAIS_GOLD_TEAM_URL") or self.DEFAULT_BASE_URL).rstrip("/")
        self._api_key = api_key if api_key is not None else os.environ.get("KAIS_GOLD_TEAM_API_KEY")
        self._timeout = timeout if timeout is not None else self.DEFAULT_TIMEOUT
        # transport=None → real network; tests pass httpx.MockTransport(handler)
        self._client = httpx.Client(timeout=self._timeout, transport=transport)

    def _headers(self) -> dict[str, str]:
        h = {"Content-Type": "application/json"}
        if self._api_key:
            h["X-API-Key"] = self._api_key
        return h

    def _degrade(self, operation: str, reason: str) -> dict[str, Any]:
        logger.warning("gold_team %s degraded: %s", operation, reason)
        return {"degraded": True, "client": "gold_team", "operation": operation, "reason": reason}

    def submit_task(self, *, task_type: str, params: dict, **kw) -> dict:
        # ... POST /api/v1/tasks, return parsed data, degrade on 5xx/timeout
        ...

    def close(self) -> None:
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
```

**Key points:**
- `httpx.Client` (sync), not `httpx.AsyncClient`. D-07 + CRITICAL-FINDING-07.
- `transport` constructor kwarg lets tests inject `httpx.MockTransport` without monkey-patching.
- `_headers()` injects auth. `_degrade()` returns the uniform envelope.
- Context manager (`__enter__/__exit__`) ensures the httpx client is closed.

### MockTransport Test Pattern

Mirrors `tests/tools/test_microsoft_graph_client.py`. The MockTransport handler is a callable `(httpx.Request) -> httpx.Response`:

```python
"""test_gold_team.py — mocked-HTTP tests for GoldTeamClient."""
from __future__ import annotations

import httpx
import pytest

from plugins.kais_aigc.gold_team import GoldTeamClient, GoldTeamError


def _client(handler, **kw) -> GoldTeamClient:
    """Build a GoldTeamClient whose httpx calls are mocked by `handler`."""
    return GoldTeamClient(
        base_url="http://test-gold-team",
        api_key="test-key",
        transport=httpx.MockTransport(handler),
        **kw,
    )


class TestGoldTeamClient:
    def test_submit_task_happy_path(self):
        captured: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            captured.append(request)
            assert request.url.path == "/api/v1/tasks"
            assert request.method == "POST"
            assert request.headers["X-API-Key"] == "test-key"
            return httpx.Response(200, json={"data": {"task_id": "t-1", "state": "queued"}})

        with _client(handler) as c:
            result = c.submit_task(task_type="image_draw", params={"prompt": "cat"})
        assert result["task_id"] == "t-1"
        assert result["state"] == "queued"
        assert len(captured) == 1

    def test_submit_task_degrades_on_503(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(503)

        with _client(handler) as c:
            result = c.submit_task(task_type="image_draw", params={})
        assert result["degraded"] is True
        assert result["client"] == "gold_team"

    def test_submit_task_raises_on_400(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(400, json={"error": "bad task_type"})

        with _client(handler) as c:
            with pytest.raises(GoldTeamError):
                c.submit_task(task_type="invalid", params={})

    def test_submit_task_degrades_on_connect_error(self):
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("connection refused", request=request)

        with _client(handler) as c:
            result = c.submit_task(task_type="image_draw", params={})
        assert result["degraded"] is True
        assert "refused" in result["reason"]
```

**Key points:**
- One `_client(handler)` factory per test file keeps tests concise.
- Every test uses `with _client(handler) as c:` — ensures the httpx client is closed even on assertion failure.
- Tests assert on BOTH the returned dict AND the captured request (URL path, method, headers, body) to verify the client constructs requests correctly.
- Happy path + degrade (5xx) + degrade (connect error) + raise (4xx) = minimum 4 tests per client. Add auth-specific + retry-specific + edge tests to reach 5-10 per file.

### Tool Handler Dispatch Pattern (Plan 32-05)

Mirrors `plugins/spotify/tools.py` `_handle_spotify_*` + `_spotify_client()` factory + `_spotify_tool_error` mapper. Plan 32-05 replaces the four Phase 31 stubs with real dispatch:

```python
# In plugins/kais_aigc/tools.py (Plan 32-05 swaps handler bodies only)

from plugins.kais_aigc.gold_team import GoldTeamClient, GoldTeamError
from plugins.kais_aigc.review_platform import ReviewPlatformClient, ReviewClientError
from plugins.kais_aigc.canvas import CanvasClient, CanvasClientError
from plugins.kais_aigc.jimeng import JimengClient, JimengError


def _gold_team_client() -> GoldTeamClient:
    return GoldTeamClient()  # reads KAIS_GOLD_TEAM_URL/API_KEY env


def _kais_tool_error(client: str, exc: Exception) -> str:
    """Map client exceptions to tool_error JSON. Mirrors _spotify_tool_error."""
    from tools.registry import tool_error
    if isinstance(exc, (GoldTeamError, ReviewClientError, CanvasClientError, JimengError)):
        return tool_error(str(exc), status_code=exc.status or 500)
    return tool_error(f"{client} tool failed: {type(exc).__name__}: {exc}")


def _handle_kais_gold_team_submit(args: dict, **kw) -> str:
    """Phase 32 implementation — replaces Phase 31 stub."""
    from tools.registry import tool_result
    task_type = args.get("task_type")
    if not task_type:
        return tool_error("task_type is required")
    payload = args.get("payload") or {}
    wait = bool(args.get("wait", False))
    try:
        with _gold_team_client() as c:
            result = c.submit_task(task_type=task_type, params=payload, wait=wait)
        return tool_result(result)
    except Exception as exc:
        return _kais_tool_error("gold_team", exc)
```

**Key points:**
- The schema dict (`KAIS_GOLD_TEAM_SUBMIT_SCHEMA`) is unchanged from Phase 31 except: `task_type` enum expands to full 17 (Plan 32-05 Task 1), and the description drops the "Phase 32 implements" note.
- Handlers wrap every client call in try/except — degrade envelopes (returned dicts) flow through `tool_result`, exceptions flow through `_kais_tool_error`.
- `with _gold_team_client() as c:` ensures the httpx client is closed per dispatch.

## Differences From Reference Modules (Documented)

| Aspect | microsoft_graph_client (reference) | Phase 32 clients | Why |
|--------|-----------------------------------|------------------|-----|
| Async | `async def get_json(...)` with `anyio` | Sync (`def submit_task(...)`) | D-07 + CRITICAL-FINDING-07 — sync httpx + sync tool handler |
| Token provider | Injected `MicrosoftGraphTokenProvider` | Inline env-var read at construction | v5.0 env-var config (D-06) — no separate token provider class |
| Retry policy | tenacity-based exponential backoff | jimeng has built-in retry; others degrade after 1 attempt | Match Node.js ref behavior — jimeng retries on 429, others fail-fast |
| Test async class | `@pytest.mark.anyio class Test...: async def test_...` | Plain `class Test...: def test_...` (sync) | Sync handlers don't need anyio |

| Aspect | spotify client (reference) | Phase 32 clients | Why |
|--------|--------------------------|------------------|-----|
| Auth flow | OAuth via `hermes_cli.auth.get_auth_status` | Static API key / JWT from env | Internal services, no OAuth dance |
| `check_fn` | `_check_spotify_available` gates on login | `None` (Phase 31) — Phase 32 may add URL-presence check, optional | Degrade-mode makes availability optional |
