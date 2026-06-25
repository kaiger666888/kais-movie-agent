# Phase 32 Context: Kais-AIGC Platform Backend (Python clients)

**Captured:** 2026-06-25
**Source:** User-provided phase context + research against Node.js `lib/*` reference implementations + `/data/workspace/hermes-agent/` patterns.

## Architectural Decisions (LOCKED — do not revisit)

### D-01: Deliverable location (inherited from Phase 31)
All Phase 32 code lives under `/data/workspace/hermes-agent/plugins/kais_aigc/` (sibling repo). The planning root (`/data/workspace/kais-movie-agent/.planning/`) documents and tracks this work, but actual artifacts are written to the hermes-agent repo. PLAN.md tasks MUST use absolute paths under `/data/workspace/hermes-agent/`.

### D-02: Python only, no Node.js bridges (inherited)
Pure Python `httpx`-based clients. No `subprocess.run`, no Node.js runtime dependency. Aligns with `OPENCLAW-REMOVE-03`.

### D-03: `httpx` is the HTTP client (no `requests`, no `aiohttp`)
`httpx==0.28.1` is already in `/data/workspace/hermes-agent/pyproject.toml` `dependencies`. Sync client (`httpx.Client`) is sufficient — the Node.js refs use native fetch (sync semantics). `requests` (also present) is NOT to be used for new code (PROJECT.md "零 npm 依赖" ethos translates to "no new deps" + httpx is the canonical hermes HTTP lib, used by `tools/microsoft_graph_client.py`, MCP OAuth tests, etc.).

### D-04: HTTP mocking via `httpx.MockTransport` (no new deps)
Confirmed: `respx` and `pytest-httpx` are NOT in pyproject.toml. The established pattern in hermes-agent (used in `tests/tools/test_microsoft_graph_client.py`, `tests/tools/test_microsoft_graph_auth.py`, `tests/tools/test_mcp_oauth_cold_load_expiry.py`, `tests/gateway/test_teams.py`) is `httpx.MockTransport(handler)` — a built-in httpx feature, no extra dependency. Phase 32 tests MUST use `httpx.MockTransport` to mock all HTTP calls. No new test-only dependencies.

### D-05: Each client is one Python module + one test file
Four modules under `plugins/kais_aigc/`:
- `gold_team.py` — GoldTeamClient + GoldTeamError
- `review_platform.py` — ReviewPlatformClient + ReviewClientError + HMAC verifier
- `canvas.py` — CanvasClient + CanvasClientError
- `jimeng.py` — JimengClient + JimengError

Four test files under `plugins/kais_aigc/tests/`:
- `test_gold_team.py`
- `test_review_platform.py`
- `test_canvas.py`
- `test_jimeng.py`

Each client module targets ~150-300 lines (client class + auth + degrade helpers + methods). No premature subpackage splitting.

### D-06: Configuration via env vars (names LOCKED)
Mirroring the env-var names in REQUIREMENTS.md GPU-DIRECT-05 + Node.js defaults:

| Client | URL env | Auth env | Default |
|--------|---------|----------|---------|
| gold_team | `KAIS_GOLD_TEAM_URL` | `KAIS_GOLD_TEAM_API_KEY` | URL `http://192.168.71.140:8002`, API key optional (Node.js ref removed auth) |
| review_platform | `KAIS_REVIEW_URL` | `KAIS_REVIEW_JWT_SECRET` + `KAIS_REVIEW_CALLBACK_SECRET` | URL `http://192.168.71.140:8090` |
| canvas | `KAIS_CANVAS_URL` | (none — internal network) | URL `http://192.168.71.176:10588` |
| jimeng | `KAIS_JIMENG_URL` | `KAIS_JIMENG_SESSION_ID` (comma-sep for rotation) | URL `http://localhost:5100` |

All env reads happen at client construction time (not at module import). Missing URL → degrade-mode returns the degrade envelope immediately without raising.

### D-07: Behavior parity with Node.js refs is the contract
The four clients are **reference ports**, not redesigns. Each method's HTTP path, request body shape, response unwrapping, and degrade envelope MUST match the corresponding Node.js `lib/*` method. Where v5.0 REQUIREMENTS harden behavior beyond Node.js (e.g., 5-min HMAC timestamp window for review callbacks), the hardened behavior wins — note in SUMMARY.

### D-08: Preserve v4.0 PIPE-INTEGRITY-01 fix (canvas HTTP-only)
`canvas.py` MUST write via HTTP `POST /api/canvas/v2/save-v2` only. Reading the graph uses `POST /api/canvas/v2/load-v2` (HTTP). NO direct sqlite access in the Python port. The Node.js `canvas-content-sync.js` still reads via sqlite3 CLI, but that is a legacy read path — v5.0 standardizes on HTTP for both read and write (CANVAS-IN-HERMES-03). The Python `CanvasClient` exposes `save_canvas(graph)` and `load_canvas()` only; degrade-tolerant on HTTP failure (warn + return degrade envelope, never raise to caller).

### D-09: Degrade-first contract (uniform across 4 clients)
Every external call has a degrade path. Degrade envelope shape (returned, never raised):
```python
{
  "degraded": True,
  "reason": "<short error message>",
  "client": "<gold_team|review_platform|canvas|jimeng>",
  "operation": "<submit|query|save|load|call>",
}
```
Degrade triggers: connection refused, connect timeout, read timeout, HTTP 5xx (server errors), HTTP 429 (rate limit after retries exhausted — jimeng). Degrade does NOT trigger on: HTTP 4xx client errors (these raise — caller bug). Tests MUST cover both happy path and at least one degrade path per client.

### D-10: `tools.py` schema stays stable (no renegotiation)
The four schemas declared in Phase 31 (`KAIS_GOLD_TEAM_SUBMIT_SCHEMA`, `KAIS_REVIEW_SUBMIT_SCHEMA`, `KAIS_CANVAS_SYNC_SCHEMA`, `KAIS_JIMENG_CALL_SCHEMA`) are the public tool contract. Phase 32 only swaps the four `_handle_*` handler bodies in `tools.py` to dispatch to the new client classes. The schema `task_type` enum in `KAIS_GOLD_TEAM_SUBMIT_SCHEMA` is expanded from the 4-element representative enum to the full 17-element enum (per GPU-DIRECT-01). `__init__.py`'s `register()` is unchanged.

### D-11: HMAC-SHA256 callback verification is NEW hardening
The Node.js `bin/callback-server.js` verifies callbacks with plain HMAC body match (no timestamp). REQUIREMENTS GPU-DIRECT-02 explicitly requires "5min timestamp window" for the Python port. The Python `review_platform.py` MUST implement HMAC verification that:
1. Reads `X-Timestamp` (Unix seconds) from the callback headers.
2. Rejects if `abs(now - timestamp) > 300` seconds.
3. Computes `HMAC-SHA256(secret, body)` and compares against `X-HMAC-Signature` header (`sha256=<hex>` format).
4. Uses `hmac.compare_digest` for constant-time comparison (mitigates timing attacks).

This is documented as a v5.0 hardening (not present in Node.js ref).

## Critical Research Findings (corrections / clarifications)

### CRITICAL-FINDING-01: Node.js `gold-team-client.js` uses port 8900, NOT 8002
The Node.js reference default `baseUrl` is `http://192.168.71.140:8900` (line 30). The phase_context and REQUIREMENTS GPU-DIRECT-01 say `:8002`. The endpoint paths differ too: Node.js uses `/api/tasks` (no `/v1/`); REQUIREMENTS says `/api/v1/tasks`.

**Resolution:** Phase 32 uses the URL/port from the env var (`KAIS_GOLD_TEAM_URL`). The default fallback URL is left to the executor's judgment (REQUIREMENTS says `:8002`, Node.js ref says `:8900`). The endpoint path is `/api/v1/tasks` per REQUIREMENTS (the authoritative source — the Node.js ref may be on an older API version). Tests use `httpx.MockTransport` so the actual port doesn't matter for verification — only the path does. SUMMARY must note this drift.

### CRITICAL-FINDING-02: Node.js gold-team removed auth ("内网互通")
Node.js `gold-team-client.js` line 5: "认证: 已移除（内网互通）". The constructor still reads `HMAC_SECRET_MA_GT` for callback *verification* (not for outbound request auth). REQUIREMENTS GPU-DIRECT-01 says "X-API-Key 认证". This is a v5.0 hardening — the Python port MUST send `X-API-Key: <KAIS_GOLD_TEAM_API_KEY>` header on every outbound request when the env var is set (optional when unset, matching Node.js behavior of "auth removed").

### CRITICAL-FINDING-03: `review-platform-client.js` does NOT do JWT bearer auth on submit
The Node.js `submitReview` method sends only `Content-Type` + optional `X-Trace-Id` — no JWT. REQUIREMENTS GPU-DIRECT-02 says "JWT bearer 认证". The Node.js `queryReviewStatus` docstring says "with JWT auth" but the implementation does not attach any Authorization header. This is a v5.0 gap: the Python port MUST attach `Authorization: Bearer <JWT>` to outbound review requests when `KAIS_REVIEW_JWT_SECRET` is set. The JWT is constructed as a short-lived HS256 token (signed with the secret). SUMMARY must note this hardening.

### CRITICAL-FINDING-04: jimeng Node.js ref uses port 8003, NOT 5100
Node.js `jimeng-client.js` constructor default is `http://localhost:8003`. REQUIREMENTS GPU-DIRECT-04 says `:5100`. The Node.js ref is also marked `@deprecated` (replaced by `dreamina` CLI in production). Phase 32 ports the API *contract* (6 subcommands + session rotation + exponential backoff + 429 handling), not the deprecated implementation details. Default URL is `http://localhost:5100` per REQUIREMENTS.

### CRITICAL-FINDING-05: canvas save endpoint body schema
From Node.js `canvas-client.js` `saveCanvas()` (lines 248-258), the request body to `POST /api/canvas/v2/save-v2` is:
```json
{
  "projectId": <int>,
  "episodesId": <int>,
  "graph": <FlowGraph JSON object>
}
```
The response wraps in `{code, msg, data}` and the client unwraps `data`. The Python `CanvasClient.save_canvas(graph)` must construct the same body. `projectId` + `episodesId` come from the client constructor (set via `set_context()` or constructor kwargs).

### CRITICAL-FINDING-06: 17 task types for gold_team
REQUIREMENTS GPU-DIRECT-01 lists: `image_draw / image_refine / video_final / wan_i2v / tts_zh / tts_en / tts_bilingual / upscale / face_restore / image_pulid / controlnet_depth / image_to_3d / image_to_3d_mv` (13 listed, "+ 等" suggests more). The Node.js ref shows: `tts_generation`, `image_pulid`, `controlnet_depth`, `wan_i2v`, `upscale`, `face_restore`. Phase 32 enumerates the full 17 by combining REQUIREMENTS + Node.js methods. The exact 17 list is finalized in `tools.py` enum expansion (Task 32-05). For client `gold_team.py`, the task_type is passed through as a string (the client doesn't validate the enum — only `tools.py` schema does).

### CRITICAL-FINDING-07: `is_async=True` not needed for tool dispatch
The Node.js clients are async (Promise-based), but the Python `httpx.Client` is sync. The hermes-agent tool registry auto-bridges async handlers via `_run_async`, but for Phase 32 the simpler choice is **sync handlers** (`is_async=False`). GPU calls are blocking (the gold-team `waitForTask` polls synchronously); making the tool handler async would require an event loop that doesn't exist in the hermes-agent tool dispatch path for sync handlers. Sync `httpx.Client` + sync handler is the right choice. If a future phase needs streaming SSE for gold-team events, that becomes an async tool then.

## Deferred Ideas (NOT in Phase 32 scope)

- PipelineStateStore / AssetBus V3 / CreativeHistoryTracker (Phase 33)
- Gate lifecycle state machine — submit/wait/resolve (Phase 34)
- Canvas sync event subscriber hook (Phase 37) — Phase 32 delivers the *client*, Phase 37 wires the *subscriber*
- Real GPU E2E calls (Phase 39 — Phase 32 uses mocked HTTP only)
- WebSocket support in CanvasClient (Node.js ref has it, but the v5.0 sync migration only needs HTTP for write paths; WS comes back if/when a phase needs live canvas events)
- Streaming SSE for gold-team task events (GPU-DIRECT-01 mentions "SSE events" — Phase 32 implements the SSE *endpoint hit* capability but tests use MockTransport which doesn't stream; real SSE verification is Phase 39)
- omni_reference / Seedance-specific jimeng methods (port the 6 generic subcommands only; specialized composition methods like `generateKeyframesBatch` belong to higher-level orchestration in Phase 35/36)

## Claude's Discretion

- **Default port for gold_team when env unset:** REQUIREMENTS says `:8002`, Node.js ref says `:8900`. Executor picks — `:8002` per REQUIREMENTS (authoritative). Document the choice in SUMMARY.
- **JWT construction for review_platform:** HS256 with `iat=now`, `exp=now+300`, `sub="kais-movie-agent"`. Library: `PyJWT` (already in pyproject.toml as `PyJWT[crypto]==2.13.0`).
- **Test file structure:** one `TestGoldTeamClient` class per test file using pytest fixtures for the MockTransport client. 5-10 tests per file covering happy path + auth + degrade + at least one error mode.
- **Logging:** use stdlib `logging.getLogger(__name__)`. Degrade paths log at WARNING level. No `print()`.
- **Error classes:** each client defines its own `<Name>Error(Exception)` subclass with `message`, `status`, `url` attributes (mirroring Node.js pattern).

## Risks (executor must mitigate)

| Risk | Mitigation |
|------|------------|
| API contract drift between Node.js ref and live kais-aigc-platform | Tests use MockTransport — they verify the *client* behaves correctly per the Node.js ref + REQUIREMENTS spec, not that the live service matches. Real E2E is Phase 39. Document any drift discovered in SUMMARY. |
| HTTP mocking lib temptation (respx/pytest-httpx) | D-04 LOCKED: `httpx.MockTransport` only. No new deps. |
| Degrade-mode false positives (degrade on 4xx) | D-09 LOCKED: 4xx raises, only 5xx/429/timeout/connection-errors degrade. Tests cover both paths. |
| HMAC timestamp window rejects valid callbacks due to clock skew | 300-second window (5min) is generous; tests use configurable `timestamp_skew_tolerance` with default 300. |
| Scope creep into Phase 33/34/37 territory | Deferred Ideas section explicitly excludes those. Executor greps for PipelineStateStore / Gate / event subscriber and refuses if found. |
