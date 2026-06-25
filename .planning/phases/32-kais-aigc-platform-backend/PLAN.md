---
phase: 32-kais-aigc-platform-backend
plan: master
type: execute
wave: 1  # master overview — child plans declare their own waves
depends_on:
  - 31-plugin-skeleton-hermes-agent-wiring
files_modified: []  # child plans own files
autonomous: true
requirements:
  - GPU-DIRECT-01
  - GPU-DIRECT-02
  - GPU-DIRECT-03
  - GPU-DIRECT-04
  - GPU-DIRECT-05
  - GPU-DIRECT-06  # wiring half — Phase 31 shipped loader half

must_haves:
  truths:
    - "gold_team.py submits 17 task types with X-API-Key auth, polls async tasks, batches, and degrades on unreachable"
    - "review_platform.py submits reviews with JWT bearer, polls status, and verifies HMAC-SHA256 callbacks with a 5-minute timestamp window"
    - "canvas.py saves/loads graph via HTTP API v2 only (no sqlite) and degrades on HTTP failure (preserves v4.0 PIPE-INTEGRITY-01 fix)"
    - "jimeng.py dispatches 6 subcommands with session rotation and exponential backoff on 429"
    - "All 4 clients degrade gracefully (return envelope, never raise to caller) on network/5xx errors; raise on 4xx client bugs"
    - "All 4 clients configure via env vars (KAIS_GOLD_TEAM_URL/API_KEY, KAIS_REVIEW_URL/JWT_SECRET/CALLBACK_SECRET, KAIS_CANVAS_URL, KAIS_JIMENG_URL/SESSION_ID)"
    - "All 4 clients have mocked-HTTP test coverage (httpx.MockTransport) — no real HTTP calls in tests"
    - "tools.py dispatches kais_gold_team_submit/kais_review_submit/kais_canvas_sync/kais_jimeng_call to the real client classes (Phase 31 stubs replaced)"
    - "Orchestration skill (Phase 35+) can invoke the 4 tools via hermes-agent tool dispatch and get real JSON results"
  artifacts:
    - path: "/data/workspace/hermes-agent/plugins/kais_aigc/gold_team.py"
      provides: "GoldTeamClient + GoldTeamError — GPU task scheduler"
      min_lines: 150
    - path: "/data/workspace/hermes-agent/plugins/kais_aigc/review_platform.py"
      provides: "ReviewPlatformClient + ReviewClientError + HMAC verifier with 5min window"
      min_lines: 150
    - path: "/data/workspace/hermes-agent/plugins/kais_aigc/canvas.py"
      provides: "CanvasClient + CanvasClientError — HTTP API v2 only"
      min_lines: 120
    - path: "/data/workspace/hermes-agent/plugins/kais_aigc/jimeng.py"
      provides: "JimengClient + JimengError — 6 subcommands + session rotation + exp backoff"
      min_lines: 150
    - path: "/data/workspace/hermes-agent/plugins/kais_aigc/tests/test_gold_team.py"
      provides: "Mocked-HTTP tests for GoldTeamClient"
    - path: "/data/workspace/hermes-agent/plugins/kais_aigc/tests/test_review_platform.py"
      provides: "Mocked-HTTP tests for ReviewPlatformClient + HMAC verifier"
    - path: "/data/workspace/hermes-agent/plugins/kais_aigc/tests/test_canvas.py"
      provides: "Mocked-HTTP tests for CanvasClient"
    - path: "/data/workspace/hermes-agent/plugins/kais_aigc/tests/test_jimeng.py"
      provides: "Mocked-HTTP tests for JimengClient"
    - path: "/data/workspace/hermes-agent/plugins/kais_aigc/tools.py"
      provides: "Updated — 4 handlers now dispatch to real clients; task_type enum expanded to 17"
      contains: "_gold_team_client"
  key_links:
    - from: "/data/workspace/hermes-agent/plugins/kais_aigc/tools.py (_handle_kais_gold_team_submit)"
      to: "plugins/kais_aigc/gold_team.py (GoldTeamClient)"
      via: "from plugins.kais_aigc.gold_team import GoldTeamClient"
      pattern: "from plugins\\.kais_aigc\\.gold_team import"
    - from: "/data/workspace/hermes-agent/plugins/kais_aigc/tools.py (_handle_kais_review_submit)"
      to: "plugins/kais_aigc/review_platform.py (ReviewPlatformClient)"
      via: "from plugins.kais_aigc.review_platform import ReviewPlatformClient"
      pattern: "from plugins\\.kais_aigc\\.review_platform import"
    - from: "/data/workspace/hermes-agent/plugins/kais_aigc/tools.py (_handle_kais_canvas_sync)"
      to: "plugins/kais_aigc/canvas.py (CanvasClient)"
      via: "from plugins.kais_aigc.canvas import CanvasClient"
      pattern: "from plugins\\.kais_aigc\\.canvas import"
    - from: "/data/workspace/hermes-agent/plugins/kais_aigc/tools.py (_handle_kais_jimeng_call)"
      to: "plugins/kais_aigc/jimeng.py (JimengClient)"
      via: "from plugins.kais_aigc.jimeng import JimengClient"
      pattern: "from plugins\\.kais_aigc\\.jimeng import"
---

<objective>
Implement 4 real Python HTTP clients in `plugins/kais_aigc/` (gold_team / review_platform / canvas / jimeng), replacing the stub handlers from Phase 31. Each client is a behaviorally-equivalent port of its Node.js `lib/*` counterpart with v5.0 hardenings (X-API-Key for gold_team, JWT bearer + 5min HMAC window for review_platform, HTTP-only canvas preserving v4.0 PIPE-INTEGRITY-01). All 4 clients are degrade-first (return envelope on network/5xx errors, raise on 4xx bugs) and configure via env vars. Wave 2 wires the clients into the existing `tools.py` handlers.

**Purpose:** Phase 31 left 4 tool stubs returning `{"status": "not_implemented"}`. Phase 32 swaps those for real HTTP clients so that Phase 35's orchestration skill can dispatch GPU tasks, submit reviews, sync canvas, and call jimeng via hermes-agent tool dispatch — completely replacing Node.js `lib/*` + openclaw on the dispatch path.

**Output:** 4 client modules + 4 test files + updated `tools.py` (handlers + 17-element enum). ~25-40 mocked-HTTP tests total. No new dependencies (httpx + PyJWT already in pyproject.toml).

**Critical corrections from research (see CONTEXT.md CRITICAL-FINDING-01..07):**
1. Node.js gold-team port is `:8900`; REQUIREMENTS says `:8002`. Use `:8002` per REQUIREMENTS (authoritative).
2. Node.js gold-team removed auth; REQUIREMENTS adds X-API-Key. Python port adds the header.
3. Node.js review-platform does NOT attach JWT; REQUIREMENTS requires it. Python port adds JWT bearer.
4. Node.js HMAC verification has NO timestamp window; REQUIREMENTS requires 5min. Python port adds it (v5.0 hardening).
5. Node.js canvas reads via sqlite3 CLI; v5.0 Python port reads via HTTP only (CANVAS-IN-HERMES-03).
6. jimeng Node.js ref is `@deprecated` and uses `:8003`; REQUIREMENTS says `:5100`. Port the contract (6 subcommands + rotation + backoff), use `:5100`.

**Cross-repo note:** All deliverable files live in `/data/workspace/hermes-agent/plugins/kais_aigc/`. Planning docs stay in `/data/workspace/kais-movie-agent/.planning/phases/32-kais-aigc-platform-backend/`. Use absolute paths into hermes-agent when writing.

**RESEARCH SKIPPED per flag.** CONTEXT.md + PATTERNS.md carry the architectural decisions and pattern mappings that RESEARCH.md would have held.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/32-kais-aigc-platform-backend/CONTEXT.md
@.planning/phases/32-kais-aigc-platform-backend/PATTERNS.md

# Phase 31 shipped artifacts (the skeleton Phase 32 fills in)
@.planning/phases/31-plugin-skeleton-hermes-agent-wiring/VERIFICATION.md
@.planning/phases/31-plugin-skeleton-hermes-agent-wiring/PATTERNS.md

# Node.js reference implementations (port behavior from these)
@/data/workspace/kais-movie-agent/lib/gold-team-client.js
@/data/workspace/kais-movie-agent/lib/review-platform-client.js
@/data/workspace/kais-movie-agent/lib/canvas-client.js
@/data/workspace/kais-movie-agent/lib/canvas-content-sync.js
@/data/workspace/kais-movie-agent/lib/jimeng-client.js
@/data/workspace/kais-movie-agent/bin/callback-server.js  # HMAC verification pattern (Python adds 5min window)
@/data/workspace/kais-movie-agent/shared/hmac_node.js  # sign/verify reference

# Existing plugin artifacts (read ONCE for pattern)
@/data/workspace/hermes-agent/plugins/kais_aigc/__init__.py
@/data/workspace/hermes-agent/plugins/kais_aigc/tools.py
@/data/workspace/hermes-agent/plugins/kais_aigc/plugin.yaml

# Reference patterns (read ONCE for pattern)
@/data/workspace/hermes-agent/plugins/spotify/tools.py
@/data/workspace/hermes-agent/tools/registry.py
@/data/workspace/hermes-agent/tests/tools/test_microsoft_graph_client.py
@/data/workspace/hermes-agent/pyproject.toml  # confirm httpx + PyJWT present, no respx

<interfaces>
<!-- Contracts the executor needs. Extracted from the codebase. -->

From /data/workspace/hermes-agent/tools/registry.py:
```python
def tool_result(data=None, **kwargs) -> str: ...  # JSON-serializes to str
def tool_error(message, **extra) -> str: ...
```

From /data/workspace/hermes-agent/hermes_cli/plugins.py (PluginContext.register_tool):
```python
def register_tool(self, name, toolset, schema, handler,
                  check_fn=None, requires_env=None, is_async=False,
                  description="", emoji="", override=False) -> None: ...
```

From /data/workspace/hermes-agent/pyproject.toml (already available deps):
```
"httpx[socks]==0.28.1",     # sync + async HTTP client, MockTransport built-in
"PyJWT[crypto]==2.13.0",    # HS256/RS256 JWT — for review_platform bearer auth
"tenacity==9.1.4",          # retry decorator — available if jimeng needs it
```

From Phase 31 plugins/kais_aigc/tools.py (the 4 handler signatures — DO NOT change):
```python
def _handle_kais_gold_team_submit(args: dict, **kw) -> str: ...
def _handle_kais_review_submit(args: dict, **kw) -> str: ...
def _handle_kais_canvas_sync(args: dict, **kw) -> str: ...
def _handle_kais_jimeng_call(args: dict, **kw) -> str: ...
```

httpx.MockTransport handler contract (from tests/tools/test_microsoft_graph_client.py):
```python
def handler(request: httpx.Request) -> httpx.Response:
    # inspect request.url, request.method, request.headers, request.content
    return httpx.Response(status, json={...}, headers={...})
client = httpx.Client(transport=httpx.MockTransport(handler))
```
</interfaces>
</context>

<tasks>
<!-- This master PLAN.md does NOT itself contain tasks. The 5 child plans
     (32-01 through 32-05) own the tasks. See <plan_breakdown> below. -->
</tasks>

<plan_breakdown>

Phase 32 decomposes into 5 child plans across 2 waves. Child plans are independent files at `.planning/phases/32-kais-aigc-platform-backend/32-{NN}-PLAN.md`.

### Wave 1 (4 parallel client plans — no file conflicts)

| Plan | Client | Files | Tests | Depends on |
|------|--------|-------|-------|------------|
| 32-01 | gold_team.py | gold_team.py, tests/test_gold_team.py | 8-10 | Phase 31 |
| 32-02 | review_platform.py | review_platform.py, tests/test_review_platform.py | 8-10 | Phase 31 |
| 32-03 | canvas.py | canvas.py, tests/test_canvas.py | 6-8 | Phase 31 |
| 32-04 | jimeng.py | jimeng.py, tests/test_jimeng.py | 7-9 | Phase 31 |

Each Wave 1 plan owns exactly 2 files (client module + test file). Zero `files_modified` overlap → fully parallel.

### Wave 2 (1 wiring plan — depends on all 4 Wave 1 plans)

| Plan | Files | Depends on |
|------|-------|------------|
| 32-05 | tools.py (handler bodies + 17-element enum), tests/test_tools_dispatch.py | 32-01, 32-02, 32-03, 32-04 |

Plan 32-05 swaps the 4 Phase 31 stub handlers in `tools.py` for real client dispatch, expands the gold_team `task_type` enum to the full 17, and adds 4-6 integration tests proving each tool routes to the right client through `tool_result` / `tool_error`.

### Plan Sizing Rationale

Each Wave 1 client is ~150-300 LOC + 5-10 tests = ~10-20% context per plan. The 4 clients are independent (different external services, different auth schemes, different degrade triggers) and thus parallelize cleanly. Wave 2's wiring plan is small (~5% context — just swapping handler bodies + enum + a handful of integration tests) but MUST follow Wave 1 because it imports from all 4 client modules.

</plan_breakdown>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Pipeline → gold-team | Outbound HTTP to internal GPU cluster (:8002). Crosses cluster boundary. |
| Pipeline → review-platform | Outbound HTTP to internal review service (:8090). Carries callback secret. |
| review-platform → Pipeline (callback) | Inbound HTTP callback (HMAC-signed). Crosses service boundary INWARD. |
| Pipeline → canvas | Outbound HTTP to canvas service (:10588). Internal. |
| Pipeline → jimeng | Outbound HTTP to jimeng-free-api (:5100). External-ish (third-party API proxy). |
| Operator env → Client constructors | Env vars (KAIS_*) read at construction. Trusted config source. |
| Test runner → MockTransport | Tests inject httpx.MockTransport — no real network egress. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-32-01 | Spoofing | gold_team outbound | mitigate | X-API-Key header required when KAIS_GOLD_TEAM_API_KEY set (GPU-DIRECT-01). Reject requests if key configured but missing. |
| T-32-02 | Spoofing | review_platform outbound | mitigate | JWT bearer (HS256, 5min exp) signed with KAIS_REVIEW_JWT_SECRET (GPU-DIRECT-02). Reject if secret unset. |
| T-32-03 | Tampering | review_platform callback | mitigate | HMAC-SHA256 verify with `hmac.compare_digest` (constant-time). Reject if signature missing/mismatched. (GPU-DIRECT-02) |
| T-32-04 | Repudiation | review_platform callback | mitigate | 5-minute timestamp window (X-Timestamp header). Reject if `abs(now - ts) > 300`. Prevents replay. (GPU-DIRECT-02) |
| T-32-05 | Information Disclosure | All clients — error messages | mitigate | Degrade envelopes return short `reason` strings; never echo full response bodies or stack traces in `tool_result`. 4xx errors raise (logged at WARNING), not returned to model. |
| T-32-06 | Denial of Service | jimeng — rate limit cascade | mitigate | Exponential backoff (1s→16s cap) + session rotation on 429 (after 3 strikes) — matches Node.js ref. Degrade after max_retries (5). |
| T-32-07 | Elevation of Privilege | canvas — sqlite direct write | mitigate | HTTP API v2 only. NO sqlite3 import in canvas.py. Grep gate enforces `sqlite` not present. Preserves v4.0 PIPE-INTEGRITY-01. |
| T-32-08 | Tampering | test isolation | mitigate | All tests use httpx.MockTransport — verified by grep: no `httpx.Client()` without `transport=` kwarg in test files. No real network egress in CI. |
| T-32-SC | Tampering | pip installs | accept | No new dependencies. httpx + PyJWT + tenacity already pinned in pyproject.toml. No install tasks in any plan. |

</threat_model>

<verification>
After all 5 child plans complete:

1. **Full test suite** — all new tests pass:
   ```bash
   cd /data/workspace/hermes-agent && pytest plugins/kais_aigc/tests/ -v
   # Expected: ~30-40 tests pass, 0 failures
   ```

2. **No new dependencies:**
   ```bash
   cd /data/workspace/hermes-agent && git diff pyproject.toml | wc -l
   # Expected: 0
   ```

3. **No sqlite in canvas.py (v4.0 PIPE-INTEGRITY-01 preserved):**
   ```bash
   grep -c "sqlite" /data/workspace/hermes-agent/plugins/kais_aigc/canvas.py
   # Expected: 0
   ```

4. **All 4 handler stubs replaced (Phase 32 wiring):**
   ```bash
   grep -c '"status": "not_implemented"' /data/workspace/hermes-agent/plugins/kais_aigc/tools.py
   # Expected: 0  (all 4 stubs replaced with real dispatch)
   grep -c "_gold_team_client\|_review_platform_client\|_canvas_client\|_jimeng_client" /data/workspace/hermes-agent/plugins/kais_aigc/tools.py
   # Expected: >= 4
   ```

5. **All 4 client imports present in tools.py:**
   ```bash
   grep -E "from plugins\.kais_aigc\.(gold_team|review_platform|canvas|jimeng) import" /data/workspace/hermes-agent/plugins/kais_aigc/tools.py | wc -l
   # Expected: 4
   ```

6. **17 task types in gold_team schema enum:**
   ```bash
   python -c "
import ast
src = open('/data/workspace/hermes-agent/plugins/kais_aigc/tools.py').read()
tree = ast.parse(src)
for node in ast.walk(tree):
    if isinstance(node, ast.Assign) and getattr(node.targets[0], 'id', '') == 'KAIS_GOLD_TEAM_SUBMIT_SCHEMA':
        enum_list = node.value.value  # traverse to the enum
print('schema found')
"
   # Plus: count strings in the task_type enum — expect 17
   ```

7. **Plugin still loads via Phase 31 loader (regression):**
   ```bash
   cd /data/workspace/hermes-agent && pytest plugins/kais_aigc/tests/ -v -k "smoke or loader"
   # Phase 31 smoke + loader tests still pass (no schema renegotiation broke them)
   ```

8. **Test isolation — no real HTTP egress:**
   ```bash
   grep -rE "httpx\.Client\(\s*\)" /data/workspace/hermes-agent/plugins/kais_aigc/tests/
   # Expected: 0 matches (every test client uses transport=MockTransport)
   ```
</verification>

<success_criteria>
- SC#1 (gold_team 17 types + X-API-Key + async polling + batch + SSE + degrade): MET by Plan 32-01 — submit/get/list/wait_for methods, X-API-Key header, async polling loop, degrade envelope on 5xx/timeout.
- SC#2 (review_platform JWT + HMAC verify + 5min window): MET by Plan 32-02 — JWT bearer on submit/query, `verify_callback()` with `hmac.compare_digest` + 300s timestamp tolerance.
- SC#3 (canvas HTTP v2 + loadGraph read-only + degrade + NO sqlite): MET by Plan 32-03 — `save_canvas()` + `load_canvas()` via HTTP only, grep-verifies no sqlite import.
- SC#4 (jimeng 6 subcommands + session rotation + exp backoff): MET by Plan 32-04 — subcommand dispatcher, multi-session rotation on 429, exponential backoff (1s→16s cap).
- SC#5 (4 clients degrade + env config + mocked HTTP tests + tool dispatch): MET by Plans 32-01..04 (degrade + env + tests) + Plan 32-05 (tools.py dispatch wiring).
</success_criteria>

<output>
When all 5 child plans complete, create `.planning/phases/32-kais-aigc-platform-backend/SUMMARY.md` (master phase summary aggregating the 5 child plan SUMMARYs).

**SUMMARY must record:**
- Total files created/modified
- Total test count (target ~30-40)
- Each client's LOC
- The 6 CRITICAL-FINDINGS from CONTEXT.md and how each was resolved
- v4.0 PIPE-INTEGRITY-01 preservation confirmation (no sqlite in canvas.py)
- v5.0 hardenings shipped (X-API-Key, JWT bearer, 5min HMAC window)
- Phase 33/34/37 readiness (what they can build on top of these clients)
</output>
