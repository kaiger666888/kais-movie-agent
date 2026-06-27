# Phase 42: Feedback Ingestion - Context

**Gathered:** 2026-06-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Build `plugins/kais_aigc/feedback_ingest.py` — closes the "最速收敛闭环" final loop by ingesting platform metrics (completion rate / interaction rate / follow rate) and updating RecipeLibrary validation fields. Provides `FeedbackIngestClient` with 3 core methods (submit_feedback / get_feedback / list_pending_updates), an HTTP endpoint `POST /api/v1/feedback` with HMAC-SHA256 signature verification (mirrors V5.0 review-platform pattern), persists raw feedback to `feedback-data` JSONL AssetBus slot, and triggers `RecipeLibrary.update_validation()` synchronously. **Critically: has NO reference to p10b or pipeline runner** — feedback only updates recipe scores, NEVER directly modifies pipeline behavior. Human decisions consume the recipe library; the system does not auto-apply.

</domain>

<decisions>
## Implementation Decisions

### HTTP Server Architecture & HMAC
- HTTP server framework: **`httpx` + Starlette ASGI wrapper** — `httpx` already a V5.0 dep; Starlette is a thin ASGI toolkit (no Flask-style heavy framework); keeps zero-new-deps invariant for non-stdlib but V5.0-blessed deps
- Endpoint binding: **`POST /api/v1/feedback`** per blueprint; bind to `KAIS_FEEDBACK_PORT` env (default `:8091` — sibling to gold-team `:8002` and review `:8090`)
- HMAC signature scheme: **Mirror V5.0 `ReviewPlatformClient` exactly**:
  - Header: `X-Signature: sha256=<hex>`
  - Signature = HMAC-SHA256(`KAIS_FEEDBACK_SECRET`, `request_body_bytes`)
  - 5-minute timestamp window (reject timestamps older than 300s) — payload must include `measured_at: ISO-8601` field used for window check
  - Constant-time compare via `hmac.compare_digest()` (not `==`)
- Server lifecycle: **`start_feedback_server(host, port, secret, recipe_library)`** — context manager (`__enter__`/`__exit__`) for test cleanup; blocking `serve_forever()` in production; graceful shutdown on SIGTERM

### Validation Pipeline & Convergence Closure
- Request validation order: **Signature first → payload schema → semantic checks**:
  1. **Signature (401 on fail)** — `hmac.compare_digest(expected_sig, provided_sig)` BEFORE consuming CPU on JSON parsing; reject invalid signature with 401 Unauthorized
  2. **Payload schema (422 on fail)** — `json.loads(body)` must succeed; required fields present: `episode_id, platform, metrics{completion_rate, interaction_rate, follow_rate}, measured_at`; reject malformed JSON or missing fields with 422
  3. **Semantic checks (400 on fail)** — `metrics.completion_rate / interaction_rate / follow_rate` all in `[0, 1]`; `platform` in `{douyin, bilibili, youtube}`; reject with 400 Bad Request
  4. **Episode existence (404 on fail)** — `recipe_library.get_recipe_by_episode(episode_id)` (or similar lookup); reject unknown episode_id with 404 Not Found
  - Each rejection logs to `feedback-rejected` JSONL AssetBus slot with `{feedback_id, reason, payload_snippet, timestamp}`
- **Wilson CI: completion_rate is continuous binomial rate** — for `metrics.completion_rate = 0.48`, increment Wilson's passed by 0.48 and total by 1.0. After N feedbacks, Wilson CI computes on cumulative passed/total. This treats completion_rate as a continuous rate rather than binary pass/fail per feedback (preserves information).
  - Note: This requires Phase 41's `_wilson_ci(passed, total)` to handle float `passed` values. **Plan must update Phase 41 implementation** to accept `Union[int, float]` for passed (and verify math still correct).
- RecipeLibrary integration: **Direct call** — `FeedbackIngestClient.__init__` takes `recipe_library: RecipeLibrary`; on valid feedback, calls `recipe_library.update_validation(recipe_id, platform, completion_rate, sample_size_delta=1)` synchronously. No queue/worker.
- **"Not auto-modify pipeline" enforcement** — STRUCTURAL:
  - `FeedbackIngestClient` has NO reference to `pipeline.phases.p10b_rapid_preview`, `runner.py`, `preview_engine`, or any pipeline-runner module
  - Only references: `RecipeLibrary` (Phase 41) + `AssetBus` (V5.0) + stdlib
  - Verified by import-graph check: `grep -E "from.*pipeline|import.*p10b|import.*runner|import.*preview_engine" plugins/kais_aigc/feedback_ingest.py` returns 0 matches
  - The recipe library is consumed by HUMANS making creative decisions, not by the pipeline itself

### Claude's Discretion
None — both areas fully resolved via smart discuss.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`/data/workspace/hermes-agent/plugins/kais_aigc/review_platform.py`** — DIRECT template for HMAC verification. V5.0 ReviewPlatformClient implements JWT bearer + HMAC-SHA256 callback verification + 5-minute timestamp window. Phase 42's HMAC verification should mirror this pattern (adapted: Phase 42 verifies INCOMING signatures, ReviewPlatformClient GENERATES outgoing signatures — but the primitive operations are identical).
- **`/data/workspace/hermes-agent/plugins/kais_aigc/gold_team.py`** — D-09 degrade-first contract template. Phase 42 doesn't degrade (HMAC verification is strict), but the env-var config pattern (`KAIS_FEEDBACK_PORT`, `KAIS_FEEDBACK_SECRET`) and `httpx`-client construction mirror GoldTeamClient.
- **`/data/workspace/hermes-agent/plugins/pipeline_state/recipe_library.py`** (Phase 41 — just shipped) — RecipeLibrary.update_validation() is the target method. Phase 42 calls it with `(recipe_id, platform, completion_rate, sample_size_delta=1)`. Phase 41's signature is LOCKED.
- **`/data/workspace/hermes-agent/plugins/pipeline_state/asset_bus.py`** — append_line() for JSONL slots. Phase 42 needs 2 new slots: `feedback-data` (JSONL, raw feedback records) + `feedback-rejected` (JSONL, rejection log).

### Established Patterns
- **kais_aigc plugin module structure**: each module exports a single class + module-level `__all__`; constructor takes config via env vars (read at construction time, never at module import — D-06); sync API (D-07)
- **AssetBus JSONL slot schema**: `{file: "X.jsonl", format: "jsonl", description: "...", writer_phase: "...", reader_phases: [...]}`. Append via `bus.append_line(slot, line_dict)`; read via `bus.read_lines(slot)`.
- **HMAC verification pattern** (V5.0 ReviewPlatformClient):
  ```python
  expected = hmac.new(secret.encode(), body_bytes, hashlib.sha256).hexdigest()
  if not hmac.compare_digest(expected, provided_sig):
      raise ValueError("Invalid signature")
  ```
- **httpx server (V5.0 pattern)**: Starlette + uvicorn — `from starlette.applications import Starlette; from starlette.routing import Route`. V5.0 uses this for review-platform webhook receiver.

### Integration Points
- **AssetBus write**: `FeedbackIngestClient._ingest(feedback)` calls `asset_bus.append_line("feedback-data", feedback_record)` on successful validation, `asset_bus.append_line("feedback-rejected", rejection_record)` on failure
- **RecipeLibrary call**: After successful AssetBus write, `_ingest()` calls `recipe_library.update_validation(recipe_id, platform, completion_rate, sample_size_delta=1)`. The `recipe_id` is derived from `feedback_record.episode_id` via `recipe_library.get_recipe_by_episode()` (may need to add this method in Phase 41 or Phase 42 plan; if added in Phase 42, mark it as a sibling to existing methods)
- **Server entry point**: `start_feedback_server(host, port, secret, recipe_library, asset_bus)` returns a context manager. Operators run via `python -m plugins.kais_aigc.feedback_ingest` (CLI entry point) or import + run programmatically
- **V5.0 502-test safety**: ASSET_SCHEMA append-only (2 new slots); no existing slot modified

</code_context>

<specifics>
## Specific Ideas

- `feedback_ingest.py` is **deliberately small and dull** — the entire "smart" logic is in Phase 41's RecipeLibrary (Wilson CI, convergence detection). Phase 42 is just: receive → verify → store → forward.
- The "not auto-modify pipeline" enforcement is STRUCTURAL, not configurable. There is no `auto_apply=False` flag because there is no `auto_apply` code path. The absence of imports is the invariant.
- HMAC verification happens BEFORE JSON parsing — this is a deliberate DoS mitigation (reject invalid signatures without burning CPU on potentially-malicious JSON).
- The continuous Wilson CI (passed=0.48 per feedback) is mathematically correct — Wilson score interval works for continuous `p` in [0,1], not just binary. Phase 41's implementation may need a type annotation update (`Union[int, float]` for `passed`), but the math is unchanged.
- `feedback-data` JSONL keeps raw metrics including `interaction_rate` and `follow_rate` even though only `completion_rate` feeds RecipeLibrary.update_validation(). Rationale: future Phase 43+ may extend the recipe validation schema to use these signals; storing them now is cheap future-proofing.
- The server is **single-process** (uvicorn worker=1). No horizontal scaling concerns in v6.0 — single-operator scale. If scaling is needed later, the persistence layer (feedback-data JSONL) already supports it (append-only, no in-memory state).

</specifics>

<deferred>
## Deferred Ideas

- **Multi-platform fan-out** — when the same episode is published to douyin + bilibili + youtube, current schema produces 1 recipe_id per platform (each has its own validation{} row per version). Future enhancement: cross-platform convergence detection (same structure{} validated across platforms → stronger signal). v7.0+ candidate.
- **Web dashboard for feedback trends** — operators currently read feedback-data JSONL via `jq` or Python REPL. Web dashboard showing convergence-over-time charts is out of v6.0 scope (no web UI per REQUIREMENTS Out of Scope).
- **Async message queue (Kafka/Redis Streams)** — current sync call to RecipeLibrary.update_validation() is fine for single-operator volume (<100 feedbacks/day). Async queue is operator-side concern when scaling beyond single-operator.
- **Recipe auto-application to p10b** — explicitly out of v6.0 scope. v7.0+ candidate per REQUIREMENTS.md backlog section A; only triggered if operator explicitly enables it (opt-in, never default).
- **Real platform OAuth integration** — Phase 42 only DEFINES the feedback receiver. Real douyin/bilibili API integration (auto-pull metrics) is operator-side per REQUIREMENTS Out of Scope.

</deferred>
