# Architecture Research: v1.3 AI Scoring, Escalation, and PWA

**Domain:** Extending the existing review platform with pluggable AI scoring, risk-tier timeout escalation, and PWA support
**Researched:** 2026-05-10
**Confidence:** HIGH (codebase-driven, architecture inferred from 7,500+ LOC existing implementation)

## Executive Summary

This document covers ONLY the new architectural components for the v1.3 milestone. The existing system (FastAPI + SQLite WAL + Redis 7 + HTMX + arq) is well-established with 266 tests passing across 12 phases. The new features add four distinct subsystems that integrate at specific, well-defined points in the existing code.

The core architectural insight: all four features are independent of each other and can be built in parallel, but they share a dependency on the existing Policy Engine + State Machine. The plugin bus is the highest-priority item because AI_AUDIT tier activation and CLIP scoring depend on it.

## Current System Architecture (As-Built)

The existing codebase diverges in some naming from the original research. Here is what actually exists:

```
State Machine (4 states):
  PENDING -> POLICY_EVAL -> {APPROVING, COMPLETE}
  APPROVING -> {COMPLETE, PENDING, POLICY_EVAL}
  COMPLETE (terminal)

Disposition routing:
  AUTO   -> POLICY_EVAL -> COMPLETE (auto-approve)
  HUMAN  -> POLICY_EVAL -> APPROVING (wait for human)
  AI_AUDIT -> POLICY_EVAL -> APPROVING (same as HUMAN today -- not yet activated)
  BLOCK  -> POLICY_EVAL -> COMPLETE (blocked)

Existing timeout:
  - check_timeouts arq cron (every hour, minute 0)
  - Single DEFAULT_TIMEOUT = 86400s (24h) for ALL APPROVING reviews
  - Escalates: APPROVING -> POLICY_EVAL (re-evaluation)
  - TIMEOUT_THRESHOLDS dict exists in tasks.py but is UNUSED
```

Key integration points for v1.3:

| Integration Point | File | What Changes |
|---|---|---|
| Policy evaluation | `app/core/policy.py` | No change -- policy engine evaluates rules, returns disposition. AI_AUDIT is already a valid disposition. |
| Submission routing | `app/api/v1/reviews.py:155` | The `elif disposition in (Disposition.HUMAN, Disposition.AI_AUDIT)` block currently treats them identically. This is where AI scoring activation hooks in. |
| State machine | `app/core/state_machine.py` | No change to transitions. AI scoring happens WITHIN the APPROVING state, not as a separate state. |
| Timeout cron | `app/workers/tasks.py:32-86` | `check_timeouts` currently uses `DEFAULT_TIMEOUT` for all reviews. Must become risk-tier-aware. |
| Settings | `app/core/config.py` | Must add GPU server URL, scoring config. |
| Frontend templates | `app/templates/base.html` | Must add PWA manifest link and meta tags. |
| Nginx config | `nginx/nginx.conf` | Must serve manifest.json and service worker with correct headers. |
| FastAPI lifespan | `app/main.py` | Must initialize scoring bus and register default plugins. |

## New Component Architecture

### Component 1: Scoring Plugin Bus

**Purpose:** Extensible scoring interface that lets the review platform invoke arbitrary scoring plugins (CLIP aesthetic scoring, future toxicity detection, NSFW filtering, etc.) without modifying core routing logic.

**Design: Abstract base class + in-process registry (no entry points, no pluggy, no setuptools plugins)**

Why this approach:
- The review platform is a single-process, single-team application. Entry-point-based plugin discovery adds complexity for zero benefit.
- The "plugin" abstraction exists so that new scoring models can be added without touching the policy engine or submission flow. This is a team-scaling concern, not a runtime-extensibility concern.
- ABC + dict registry is the simplest pattern that provides the needed abstraction.

**Component boundaries:**

```python
# app/scoring/__init__.py
# app/scoring/base.py       -- MetricPlugin ABC
# app/scoring/bus.py        -- ScoringBus singleton (registry + executor)
# app/scoring/noop.py       -- NoOpMetricPlugin (default, always succeeds)
# app/scoring/clip_client.py -- CLIP scoring plugin (remote GPU HTTP client)
```

**MetricPlugin interface:**

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True)
class ScoreResult:
    """Immutable result from a scoring plugin."""
    plugin_name: str
    score: float            # 0.0 - 1.0 normalized
    label: str              # e.g. "aesthetic_quality", "nsfw_probability"
    metadata: dict          # plugin-specific details (model version, latency, etc.)


class MetricPlugin(ABC):
    """Base class for all scoring plugins.

    Plugins must be stateless and thread-safe. The bus calls score()
    for each review routed to AI_AUDIT. Plugins must not raise
    exceptions -- return ScoreResult with score=0.0 and error metadata
    instead.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique plugin identifier (e.g. 'clip_aesthetic')."""
        ...

    @abstractmethod
    async def score(self, content_ref: str, metadata: dict) -> ScoreResult:
        """Score a review item.

        Args:
            content_ref: URI/path to the content being reviewed.
            metadata: Review metadata dict (may contain image URLs, etc.)

        Returns:
            ScoreResult with normalized 0.0-1.0 score.
        """
        ...

    @abstractmethod
    async def health_check(self) -> bool:
        """Check if the plugin backend is available."""
        ...
```

**ScoringBus:**

```python
class ScoringBus:
    """Singleton registry for scoring plugins.

    Thread-safe, in-process registry. Plugins are registered at startup
    and can be added/removed at runtime (for hot-reload scenarios).
    """

    def __init__(self) -> None:
        self._plugins: dict[str, MetricPlugin] = {}

    def register(self, plugin: MetricPlugin) -> None:
        self._plugins[plugin.name] = plugin

    def unregister(self, name: str) -> bool:
        return self._plugins.pop(name, None) is not None

    def list_plugins(self) -> list[str]:
        return sorted(self._plugins.keys())

    def get_plugin(self, name: str) -> MetricPlugin | None:
        return self._plugins.get(name)

    async def score_all(
        self, content_ref: str, metadata: dict
    ) -> list[ScoreResult]:
        """Run all registered plugins concurrently, collect results.

        Plugins that raise exceptions are caught and converted to
        ScoreResult(score=0.0, metadata={"error": str(e)}).

        Returns:
            List of ScoreResult from all registered plugins.
        """
        import asyncio
        import structlog
        logger = structlog.get_logger()

        tasks = []
        for plugin in self._plugins.values():
            tasks.append(self._safe_score(plugin, content_ref, metadata))

        results = await asyncio.gather(*tasks, return_exceptions=False)
        return results

    async def _safe_score(
        self, plugin: MetricPlugin, content_ref: str, metadata: dict
    ) -> ScoreResult:
        try:
            return await plugin.score(content_ref, metadata)
        except Exception as e:
            return ScoreResult(
                plugin_name=plugin.name,
                score=0.0,
                label="error",
                metadata={"error": str(e)},
            )
```

**Where it integrates in the submission flow:**

```
Current flow (reviews.py:141-176):
  Policy eval -> disposition
  if AUTO   -> COMPLETE
  if HUMAN  -> APPROVING
  if AI_AUDIT -> APPROVING (same as HUMAN today)

New flow:
  Policy eval -> disposition
  if AUTO   -> COMPLETE
  if HUMAN  -> APPROVING
  if AI_AUDIT -> APPROVING + enqueue arq job "run_ai_scoring"
```

The AI scoring does NOT block the submission response. The review enters APPROVING immediately, and the arq job runs asynchronously. When scoring completes, it either:
1. Stores scores in a new `ReviewScore` table (not blocking, not changing state)
2. If scores exceed thresholds, the scoring task can auto-approve (transition APPROVING -> COMPLETE) or escalate to HUMAN by updating the disposition

**This is critical:** AI scoring is an async background task, not synchronous in the request path. The review submission returns 202 immediately regardless of AI scoring status.

### Component 2: Remote GPU Inference Client (CLIP)

**Purpose:** HTTP client that sends image data to the CLIP/aesthetic scoring server running on 192.168.71.38 and receives quality scores.

**Design: httpx async client pointed at a FastAPI inference server on the GPU machine**

The GPU server at 192.168.71.38 will run its own FastAPI inference service (separate from the review platform). The review platform is a CLIENT of that service, not the host. This is the correct boundary because:
- The GPU machine has different resource profiles (CUDA, high VRAM, high power consumption)
- The inference server can serve multiple consumers, not just the review platform
- Failures in GPU inference must not crash the review platform

**Architecture:**

```
Review Platform (192.168.71.140)          GPU Server (192.168.71.38)
+-------------------------------+        +-------------------------------+
| arq task: run_ai_scoring      |  HTTP  | FastAPI Inference Server      |
|   -> ScoringBus.score_all()   | -----> |   POST /score/aesthetic       |
|   -> CLIPMetricPlugin.score() | <----- |   -> CLIP model inference     |
|                               |        |   -> return {score, metadata} |
+-------------------------------+        +-------------------------------+
```

**CLIPMetricPlugin implementation:**

```python
class CLIPMetricPlugin(MetricPlugin):
    """CLIP aesthetic scoring via remote GPU inference server."""

    def __init__(self, gpu_server_url: str, timeout: float = 30.0) -> None:
        self._url = gpu_server_url.rstrip("/")
        self._timeout = timeout
        self._client: httpx.AsyncClient | None = None

    @property
    def name(self) -> str:
        return "clip_aesthetic"

    async def score(self, content_ref: str, metadata: dict) -> ScoreResult:
        client = self._get_client()
        # Send image URL or base64 data to GPU server
        payload = {
            "image_url": content_ref,
            "metadata": metadata,
        }
        response = await client.post(
            f"{self._url}/score/aesthetic",
            json=payload,
            timeout=self._timeout,
        )
        response.raise_for_status()
        data = response.json()
        return ScoreResult(
            plugin_name=self.name,
            score=data["score"],
            label="aesthetic_quality",
            metadata=data.get("metadata", {}),
        )

    async def health_check(self) -> bool:
        try:
            client = self._get_client()
            resp = await client.get(f"{self._url}/health", timeout=5.0)
            return resp.status_code == 200
        except Exception:
            return False

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=self._timeout)
        return self._client
```

**GPU server contract (what 192.168.71.38 must provide):**

```
POST /score/aesthetic
  Request: { "image_url": "...", "metadata": {...} }
  Response: { "score": 0.85, "label": "aesthetic_quality", "metadata": { "model": "clip-vit-base-patch32", "inference_ms": 120 } }

GET /health
  Response: { "status": "ok", "model_loaded": true, "gpu": "NVIDIA RTX 3090" }
```

The GPU server is NOT part of this repository. It is a separate deployment on the GPU machine. The review platform only needs the HTTP contract above.

**Settings additions:**

```python
# In app/core/config.py
class Settings(BaseSettings):
    # ... existing fields ...
    gpu_inference_url: str = ""  # e.g. "http://192.168.71.38:8001"
    gpu_inference_timeout: float = 30.0
    ai_scoring_enabled: bool = False  # Feature flag for CLIP scoring
    ai_auto_approve_threshold: float = 0.85  # Score above this = auto-approve
    ai_escalate_threshold: float = 0.3  # Score below this = escalate to HUMAN
```

### Component 3: Risk-Tier Timeout Escalation

**Purpose:** Replace the current single 24h timeout with per-route-type timeouts: AI_AUDIT = 5 minutes, HUMAN = 24 hours. Auto-escalate when timeout fires.

**Current state (from tasks.py):**

```python
TIMEOUT_THRESHOLDS: dict[str, int] = {
    "AI_AUDIT": 300,    # 5 minutes for AI review
    "HUMAN": 86400,     # 24 hours for human review
}
DEFAULT_TIMEOUT = 86400  # 24 hours default
```

This dict EXISTS but is UNUSED. The `check_timeouts` function uses only `DEFAULT_TIMEOUT`. The fix is straightforward: look up the review's disposition to determine which threshold applies.

**Modified check_timeouts flow:**

```
1. Query reviews in APPROVING state with updated_at < cutoff
2. For EACH review:
   a. Read review.disposition (HUMAN or AI_AUDIT)
   b. Look up timeout from TIMEOUT_THRESHOLDS[disposition] or DEFAULT_TIMEOUT
   c. Calculate per-review cutoff: updated_at + threshold
   d. If now() > per-review cutoff -> escalate
3. Escalate: APPROVING -> POLICY_EVAL with audit entry
```

**Why this approach:**
- The disposition field on the Review model already stores the routing decision (HUMAN, AI_AUDIT, AUTO, BLOCK)
- No schema changes needed -- just use existing data
- The TIMEOUT_THRESHOLDS dict is already correct, just needs to be wired in
- The cron interval matters: for AI_AUDIT (5min timeout), checking every hour is too slow. Must change cron to run every 1-2 minutes.

**Changes to WorkerSettings:**

```python
# Current:
cron_jobs = [
    cron(check_timeouts, minute={0}),  # Every hour
    cron(check_timeout_reminders, minute={0, 30}),  # Every 30 min
]

# New:
cron_jobs = [
    cron(check_timeouts, second=0),  # Every minute (for 5-min AI timeout)
    cron(check_timeout_reminders, minute={0, 30}),
]
```

**Modified check_timeouts implementation approach:**

```python
async def check_timeouts(ctx: dict) -> list[int]:
    """Scan for reviews in APPROVING state that exceeded their
    disposition-specific timeout threshold."""
    # ... (setup same as before)

    async with async_session_factory() as session:
        # Query ALL reviews in APPROVING state (not filtered by single cutoff)
        query = select(Review).where(
            Review.state == ReviewState.APPROVING.value,
        )
        result = await session.execute(query)
        all_approving = result.scalars().all()

        now = datetime.now(timezone.utc)
        for review in all_approving:
            # Determine threshold from disposition
            disposition = review.disposition or "HUMAN"
            threshold_seconds = TIMEOUT_THRESHOLDS.get(
                disposition, DEFAULT_TIMEOUT
            )
            updated_at = review.updated_at
            if updated_at.tzinfo is None:
                updated_at = updated_at.replace(tzinfo=timezone.utc)

            elapsed = (now - updated_at).total_seconds()
            if elapsed >= threshold_seconds:
                # Escalate
                try:
                    await transition_state(
                        session, review.id,
                        ReviewState.APPROVING, ReviewState.POLICY_EVAL,
                        review.version,
                        actor="timeout",
                        action="auto_escalate",
                        payload={
                            "reason": "Review exceeded timeout threshold",
                            "timeout_seconds": threshold_seconds,
                            "disposition": disposition,
                            "elapsed_seconds": int(elapsed),
                        },
                    )
                    escalated.append(review.id)
                except Exception as e:
                    logger.error("escalation_failed", review_id=review.id, error=str(e))
    return escalated
```

**Performance note:** Querying ALL APPROVING reviews every minute sounds expensive, but in practice the APPROVING queue is typically < 100 items. SQLite can scan that in < 1ms. If it ever becomes a concern, add an index on `(state, updated_at)` -- but the existing `ix_reviews_state_created` index already covers this.

### Component 4: PWA Manifest

**Purpose:** Allow mobile reviewers to "Add to Home Screen" for app-like access to the review dashboard.

**Design: Static manifest.json + minimal service worker for offline caching of the shell (not data).**

This is the simplest of the four features. It touches only the frontend layer.

**Files to add/modify:**

```
app/static/                   # NEW directory
  manifest.json               # Web app manifest
  sw.js                       # Service worker (cache shell only)
  icons/                      # PWA icons (192x192, 512x512)
    icon-192.png
    icon-512.png

app/templates/base.html       # MODIFY: add manifest link, meta tags, SW registration
nginx/nginx.conf              # MODIFY: serve /static/ correctly
app/main.py                   # MODIFY: mount StaticFiles for /static/
```

**manifest.json:**

```json
{
  "name": "Kai's Review Platform",
  "short_name": "Review",
  "description": "AI production pipeline review dashboard",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#f9fafb",
  "theme_color": "#2563eb",
  "icons": [
    {
      "src": "/static/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/static/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

**base.html additions (inside `<head>`):**

```html
<link rel="manifest" href="/static/manifest.json">
<meta name="theme-color" content="#2563eb">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="apple-touch-icon" href="/static/icons/icon-192.png">
```

**Service worker (sw.js) -- minimal, cache-shell-only:**

```javascript
const CACHE_NAME = 'review-platform-v1';
const SHELL_URLS = ['/', '/login', '/static/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Network-first for API calls, cache-first for shell
  if (event.request.url.includes('/api/') || event.request.url.includes('/events/')) {
    return; // Let browser handle API/SSE requests normally
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
```

**base.html SW registration (before `</body>`):**

```html
<script>
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/static/sw.js').catch(() => {});
  }
</script>
```

**Nginx additions:**

```nginx
# Static files for PWA
location /static/ {
    proxy_pass http://api;
    expires 7d;
    add_header Cache-Control "public, immutable";
}

# Service worker must be served with correct MIME type
location = /static/sw.js {
    proxy_pass http://api;
    add_header Content-Type "application/javascript";
    add_header Service-Worker-Allowed "/";
}
```

**FastAPI static files mount (in main.py):**

```python
from fastapi.staticfiles import StaticFiles
app.mount("/static", StaticFiles(directory="app/static"), name="static")
```

**Important:** The static mount must come AFTER all router registrations, otherwise it catches all `/static/*` routes and breaks things.

## Data Flow Changes

### New Flow: AI_AUDIT Submission with Scoring

```
kais-movie-agent POST /api/v1/reviews
  { type: "scene_image", content_ref: "http://192.168.71.38/renders/frame_001.jpg",
    metadata: { preview_images: [...] }, source_system: "kais-movie-agent" }
    |
    v
[reviews.py:submit_review]
    |
    | Policy Engine evaluates -> Disposition.AI_AUDIT
    |
    | transition_state: PENDING -> POLICY_EVAL -> APPROVING
    |   (action: "route_ai_audit", payload: { disposition: "AI_AUDIT" })
    |
    | enqueue arq job: "run_ai_scoring"
    |   { review_id, content_ref, metadata }
    |
    v  Return 202 { review_id, state: "APPROVING", routing: "AI_AUDIT" }

--- Async background ---

[arq worker: run_ai_scoring]
    |
    | ScoringBus.score_all(content_ref, metadata)
    |   -> CLIPMetricPlugin.score() -> HTTP POST to 192.168.71.38:8001/score/aesthetic
    |   -> Returns ScoreResult { score: 0.92, label: "aesthetic_quality" }
    |
    | Store scores in review_scores table
    |
    | Decision:
    |   score >= 0.85 -> auto-approve
    |     transition_state: APPROVING -> COMPLETE (actor: "ai_scoring", action: "ai_auto_approve")
    |   score <= 0.3  -> escalate to human (keep in APPROVING, update disposition to HUMAN)
    |     update review.disposition = "HUMAN" + audit entry
    |   0.3 < score < 0.85 -> keep in APPROVING (wait for human, but show AI score)
    |
    v  Event emitted via emit_state_change (SSE + webhook)
```

### New Flow: Risk-Tier Timeout Escalation

```
[arq cron: check_timeouts, every 1 minute]
    |
    | Query: SELECT * FROM reviews WHERE state = 'APPROVING'
    |
    | For each review:
    |   timeout = TIMEOUT_THRESHOLDS[review.disposition] || 86400
    |   elapsed = now - review.updated_at
    |
    |   if elapsed >= timeout:
    |     transition_state: APPROVING -> POLICY_EVAL
    |       (actor: "timeout", action: "auto_escalate",
    |        payload: { disposition: "AI_AUDIT", timeout_seconds: 300 })
    |
    |     Event emitted: SSE broadcast + webhook delivery
    |     Telegram notification: "Review X timed out (AI_AUDIT 5min), re-evaluating"
    |
    v  Next cron cycle: check_timeouts runs again
```

**Escalation chain after timeout:**

When a review times out and transitions to POLICY_EVAL, what happens next? Currently, nothing -- it stays in POLICY_EVAL. The v1.3 design should add re-evaluation logic:

```
POLICY_EVAL after timeout escalation:
  1. Re-run policy engine with updated data (including AI scores if available)
  2. If AI score is good enough -> AUTO -> COMPLETE
  3. If AI score is bad or missing -> HUMAN -> APPROVING (second chance for human review)
  4. If already escalated from HUMAN -> HUMAN -> APPROVING with "escalated" priority
```

This requires adding a new arq task or extending `check_timeouts` to call the policy engine after escalation. The simplest approach: after the APPROVING -> POLICY_EVAL transition, enqueue a "re_evaluate_policy" arq job that mirrors the submission routing logic.

## New Database Schema

### review_scores table

```python
class ReviewScore(Base):
    __tablename__ = "review_scores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    review_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("reviews.id"), nullable=False
    )
    plugin_name: Mapped[str] = mapped_column(String(50), nullable=False)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index("ix_review_scores_review", "review_id", "plugin_name"),
    )
```

No changes to the existing Review table are needed. The disposition field already stores HUMAN/AI_AUDIT/AUTO/BLOCK. The scoring results are a separate table to maintain normalization and keep the audit-friendly append-only pattern.

## New arq Tasks

### run_ai_scoring

```python
async def run_ai_scoring(ctx: dict, review_id: int) -> dict:
    """Run all registered scoring plugins for a review.

    Triggered when review is routed to AI_AUDIT. Stores scores and
    may auto-approve or escalate based on score thresholds.
    """
```

### re_evaluate_policy

```python
async def re_evaluate_policy(ctx: dict, review_id: int) -> dict:
    """Re-evaluate a review's policy after timeout escalation.

    Called when a review transitions APPROVING -> POLICY_EVAL due
    to timeout. Uses any available AI scores to make a routing decision.
    """
```

## Component Dependency Graph

```
                    EXISTING (no changes needed)
                    ============================
                    SQLite Schema
                    State Machine (transition map)
                    Policy Engine (YAML rules)
                    Audit Trail
                    Auth (JWT + tokens)
                    SSE + Webhook delivery
                    HTMX Frontend (structure)

                    NEW COMPONENTS
                    ==============

                    MetricPlugin ABC
                         |
                         v
                    ScoringBus (registry)
                         |
                    +----+----+
                    |         |
                    v         v
              NoOpPlugin  CLIPMetricPlugin
              (default)   (remote GPU client)
                              |
                              v
                         GPU Server (192.168.71.38)
                         (separate deployment)

                    INDEPENDENT OF SCORING:
                    - Risk-tier timeout escalation (modifies existing check_timeouts)
                    - PWA manifest (pure frontend addition)
```

## Build Order

The features can be partially parallelized. Here is the dependency-aware build order:

```
Phase A: Plugin Bus Foundation (no dependencies on external systems)
  1. Create app/scoring/ package (base.py, bus.py, noop.py)
  2. Add MetricPlugin ABC and ScoringBus
  3. Add NoOpMetricPlugin (always returns score=0.5)
  4. Unit tests for bus registration/unregistration/score_all
  5. Add ReviewScore table to schema.py
  6. Add scoring-related Settings fields to config.py

Phase B: AI_AUDIT Activation (depends on Phase A)
  7. Add run_ai_scoring arq task (uses ScoringBus)
  8. Modify submit_review to enqueue AI scoring for AI_AUDIT disposition
  9. Add auto-approve / escalate logic based on score thresholds
  10. Integration tests: submit AI_AUDIT -> scoring -> auto-approve

Phase C: CLIP Plugin (depends on Phase A, can parallel with Phase B)
  11. Create CLIPMetricPlugin (httpx client for GPU server)
  12. Add gpu_inference_url to Settings
  13. Register CLIP plugin in FastAPI lifespan (conditional on ai_scoring_enabled)
  14. Unit tests with mock GPU server
  15. Integration test with real GPU server (manual/optional)

Phase D: Risk-Tier Timeout Escalation (independent of A/B/C)
  16. Modify check_timeouts to use TIMEOUT_THRESHOLDS per disposition
  17. Change cron interval from hourly to every minute
  18. Add re_evaluate_policy arq task
  19. Integration tests: AI_AUDIT timeout -> escalation -> re-evaluation

Phase E: PWA Manifest (independent of everything)
  20. Create app/static/ directory with manifest.json, sw.js, icons
  21. Modify base.html to add manifest link and meta tags
  22. Mount StaticFiles in main.py
  23. Update nginx.conf to serve /static/ with correct headers
  24. Test on mobile: Add to Home Screen, verify standalone mode

Phase F: Integration & Polish (depends on B, C, D, E)
  25. End-to-end test: submit -> AI_AUDIT -> CLIP scoring -> auto-approve -> callback
  26. End-to-end test: submit -> AI_AUDIT -> timeout -> escalation
  27. Health endpoint: add scoring bus status
  28. Dashboard: show AI scores in review detail view
```

**Parallelization:** Phases C, D, and E can all run in parallel after Phase A completes. Phase B depends on A but not C/D/E.

## Integration Points Summary

### New Files

| File | Purpose |
|------|---------|
| `app/scoring/__init__.py` | Package init |
| `app/scoring/base.py` | MetricPlugin ABC, ScoreResult dataclass |
| `app/scoring/bus.py` | ScoringBus singleton registry |
| `app/scoring/noop.py` | NoOpMetricPlugin default |
| `app/scoring/clip_client.py` | CLIP remote GPU HTTP client |
| `app/static/manifest.json` | PWA web app manifest |
| `app/static/sw.js` | Service worker (shell caching) |
| `app/static/icons/icon-192.png` | PWA icon |
| `app/static/icons/icon-512.png` | PWA icon |

### Modified Files

| File | Change |
|------|--------|
| `app/models/schema.py` | Add ReviewScore table |
| `app/core/config.py` | Add GPU inference + scoring settings |
| `app/workers/tasks.py` | Modify check_timeouts, add run_ai_scoring, add re_evaluate_policy |
| `app/api/v1/reviews.py` | Enqueue AI scoring for AI_AUDIT disposition |
| `app/main.py` | Initialize ScoringBus, register plugins, mount StaticFiles |
| `app/templates/base.html` | Add PWA manifest link, meta tags, SW registration |
| `nginx/nginx.conf` | Serve /static/ with caching headers |
| `docker-compose.yml` | No changes needed (static files in app container) |
| `pyproject.toml` | No new dependencies needed (httpx already listed) |

### No Changes Required

| File | Why No Change |
|------|---------------|
| `app/core/policy.py` | AI_AUDIT already a valid disposition; policy rules unchanged |
| `app/core/state_machine.py` | State transitions unchanged; scoring is async within APPROVING |
| `app/core/events.py` | emit_state_change already fires on every transition |
| `app/core/auth.py` | No auth changes |
| `app/core/audit.py` | Audit trail pattern unchanged; new actions logged automatically |
| `app/web/routes.py` | Dashboard works as-is; AI scores shown in detail view via metadata |

## Anti-Patterns to Avoid

### Anti-Pattern 1: Blocking AI Scoring in the Request Path

**What goes wrong:** Calling the GPU server synchronously during submit_review.
**Why it happens:** "We need the score to make the routing decision."
**Why it is wrong:** GPU inference takes 1-30 seconds. The submit endpoint returns 202 in < 50ms today. Blocking on GPU inference makes submissions unreliable -- if the GPU server is down, submissions fail entirely.
**Do this instead:** Submit returns 202 immediately. AI scoring runs as an arq background task. The scoring task makes the auto-approve / escalate decision AFTER the review is already in APPROVING state.

### Anti-Pattern 2: Adding AI_SCORING as a State Machine State

**What goes wrong:** Adding a new "AI_SCORING" state between POLICY_EVAL and APPROVING.
**Why it happens:** "The review is being scored, it should be in a scoring state."
**Why it is wrong:** The state machine tracks the HUMAN workflow, not the internal processing pipeline. AI scoring is an implementation detail of the AI_AUDIT tier, not a user-visible state. The reviewer should see "APPROVING" with a note that AI scoring is in progress.
**Do this instead:** Reviews enter APPROVING regardless of AI/HUMAN routing. AI scoring status is tracked in the ReviewScore table, not in the state machine.

### Anti-Pattern 3: Coupling the Review Platform to a Specific GPU Server Implementation

**What goes wrong:** Importing torch or transformers in the review platform to run CLIP locally.
**Why it happens:** "It is simpler to just call the model directly."
**Why it is wrong:** Violates the 400MB RAM constraint (PyTorch alone is 800MB+). The review platform and GPU inference have fundamentally different resource profiles. Mixing them means neither can be deployed independently.
**Do this instead:** The review platform is an HTTP client. The GPU server is a separate deployment. They communicate over the LAN. This is already the intended design (GPU at 192.168.71.38, platform at 192.168.71.140).

### Anti-Pattern 4: Over-Engineering the Service Worker

**What goes wrong:** Building an offline-first PWA with full data caching and sync.
**Why it happens:** "PWAs should work offline."
**Why it is wrong:** The review platform requires real-time data from the server. Offline caching of review data creates stale views that can lead to wrong decisions (approving a review that was already rejected). The only thing worth caching is the app shell (HTML/CSS/JS).
**Do this instead:** Service worker caches only the shell (base HTML, CSS CDN, icons). All data requests go directly to the server. If the server is unreachable, the user sees a "no connection" message -- this is correct behavior for a governance tool.

### Anti-Pattern 5: Polling the GPU Server from the Request Handler

**What goes wrong:** The submit endpoint polls the GPU server every 2 seconds waiting for a result.
**Why it happens:** "We need the score before we can route."
**Why it is wrong:** Couples the request lifecycle to GPU inference time. Creates unnecessary load. Same problem as Anti-Pattern 1 but with a polling veneer.
**Do this instead:** Use arq's task queue. The `run_ai_scoring` task handles the entire scoring lifecycle including retries and escalation.

## Scalability Considerations

| Concern | Current Scale | After v1.3 | Mitigation |
|---------|---------------|------------|------------|
| GPU inference throughput | N/A | ~2 req/sec (CLIP on 3090) | GPU server handles batching; review platform sends one request per arq job |
| check_timeouts load | ~100 reviews, every hour | ~100 reviews, every minute | SQLite scan < 1ms; acceptable |
| ScoringBus concurrent plugins | N/A | 1-3 plugins | asyncio.gather with safe_score wrapper; no scaling concern |
| Service worker cache size | N/A | < 50KB (shell only) | No concern |
| Static file serving | N/A | < 100KB total | FastAPI StaticFiles handles this fine behind Nginx |

## Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| Plugin bus design | HIGH | ABC + registry is well-understood, no external dependencies, matches existing codebase patterns |
| Remote GPU client | HIGH | httpx async client is already used for webhooks; CLIPMetricPlugin follows same pattern |
| Risk-tier timeout | HIGH | TIMEOUT_THRESHOLDS dict already exists; modification is mechanical |
| PWA manifest | HIGH | Standard web specification; FastAPI StaticFiles is well-documented |
| AI scoring integration flow | MEDIUM | The auto-approve / escalate decision logic needs careful testing to avoid premature auto-approval |
| GPU server contract | MEDIUM | The review platform side is clear, but the actual GPU server implementation is out of scope and may evolve |

## Sources

- Existing codebase: `app/core/policy.py`, `app/workers/tasks.py`, `app/api/v1/reviews.py`, `app/core/state_machine.py`, `app/core/events.py` (HIGH confidence -- direct code reading)
- `app/core/config.py` Settings pattern (HIGH confidence -- existing pattern)
- `app/integrations/gold_team/client.py` -- reference for httpx async client pattern (HIGH confidence)
- `app/web/sse.py` -- reference for FastAPI SSE pattern (HIGH confidence)
- `app/templates/base.html` -- current frontend structure (HIGH confidence)
- Python ABC + registry pattern -- standard library, well-established (HIGH confidence)
- PWA Web App Manifest specification (HIGH confidence -- W3C standard)
- FastAPI StaticFiles documentation (HIGH confidence -- built-in feature)
- arq cron job patterns -- from existing WorkerSettings class (HIGH confidence)

---
*Architecture research for: v1.3 AI Scoring, Escalation, and PWA*
*Researched: 2026-05-10*
