# Domain Pitfalls: v1.3

**Domain:** AI Scoring Bus, Remote GPU Inference, Timeout Escalation, PWA
**Researched:** 2026-05-10

## Critical Pitfalls

Mistakes that cause rewrites or major issues.

### Pitfall 1: Blocking Submission on AI Scoring

**What goes wrong:** The submit_review endpoint calls ScoringBus.score_all() synchronously, waiting for the GPU server to return before sending the 202 response.
**Why it happens:** "We need the score to decide routing" feels intuitive.
**Consequences:** Submit endpoint latency jumps from 50ms to 5-30 seconds. If GPU server is down, submissions fail entirely. The entire review pipeline becomes dependent on GPU availability.
**Prevention:** AI scoring is ALWAYS an arq background task. Submit returns 202 immediately. The scoring task makes routing decisions asynchronously.
**Detection:** If submit_review takes > 200ms, something is wrong.

### Pitfall 2: Adding AI_SCORING as a State Machine State

**What goes wrong:** Adding a new ReviewState.AI_SCORING between POLICY_EVAL and APPROVING.
**Why it happens:** "The review is being scored, it should be in a scoring state."
**Consequences:** Every piece of code that checks state (dashboard, SSE, Telegram bot, timeout checker, approve/reject handlers) needs to be updated. The state machine's simplicity is its strength -- adding states for internal processes breaks that.
**Prevention:** Reviews enter APPROVING regardless of AI/HUMAN routing. AI scoring status lives in the ReviewScore table, not in the state machine. Use metadata (audit entries, review_scores) for scoring status.
**Detection:** Any PR that adds a new value to the ReviewState enum.

### Pitfall 3: Importing torch/transformers in the Review Platform

**What goes wrong:** `pip install torch` in the review platform's Docker image.
**Why it happens:** "We can just load the CLIP model directly, it is simpler."
**Consequences:** Docker image balloons from ~200MB to 2GB+. RAM usage exceeds 400MB constraint just from model loading. Build times increase dramatically. The review platform becomes coupled to CUDA availability.
**Prevention:** The review platform is an HTTP client. Period. All ML model code lives on 192.168.71.38. The only import in the review platform is httpx.
**Detection:** `torch`, `transformers`, `PIL`, `cv2`, or any ML library in pyproject.toml or imports.

### Pitfall 4: Premature Auto-Approval Threshold

**What goes wrong:** Setting the auto-approve threshold too low (e.g., 0.5), causing low-quality images to bypass human review.
**Why it happens:** "We want to reduce human review load."
**Consequences:** The governance platform fails its core purpose -- letting bad content through. Once trust is lost, reviewers will second-guess the system.
**Prevention:** Start with a HIGH threshold (0.85+) and lower it gradually based on observed data. Log every auto-approve decision with the score. Include auto-approved items in a "reviewed by AI" dashboard tab so humans can spot-check.
**Detection:** Auto-approve rate > 80% of AI_AUDIT submissions = threshold too low.

## Moderate Pitfalls

### Pitfall 1: GPU Server Timeout Too Short

**What goes wrong:** Setting httpx timeout to 5 seconds. CLIP inference on a busy GPU can take 10-30 seconds.
**Why it happens:** Copying the webhook timeout (10s) to scoring.
**Prevention:** Use 30-second timeout for GPU inference. Add retry logic (1 retry after timeout). The scoring task is already async, so waiting 30 seconds is fine.
**Detection:** Scoring failures with "Timeout" error at > 5% rate.

### Pitfall 2: Cron Every Minute is Too Aggressive

**What goes wrong:** check_timeouts runs every second or every 10 seconds, creating excessive SQLite read load.
**Why it happens:** "We need to catch 5-minute AI timeouts immediately."
**Prevention:** Every 60 seconds is sufficient for 5-minute timeouts (you catch them between 5:00 and 5:59 elapsed). Do not go below 30 seconds.
**Detection:** SQLite busy errors in logs during cron execution.

### Pitfall 3: Service Worker Caching API Responses

**What goes wrong:** The service worker caches /api/* responses, showing stale review data.
**Why it happens:** "The service worker should cache everything for offline."
**Prevention:** Service worker ONLY caches the app shell (/, /login, manifest, icons). All /api/* and /events/* routes are excluded from caching. The fetch handler explicitly skips API and SSE requests.
**Detection:** Review data shown after server restart = cached API responses.

### Pitfall 4: PWA Icons Not Matching Display Requirements

**What goes wrong:** Icons are screenshots, not proper app icons. Or icons have transparent backgrounds on iOS (which renders them on white, not theme_color).
**Why it happens:** "Just use any PNG."
**Prevention:** Use proper maskable icons with safe-area padding. Test on both iOS Safari and Android Chrome. iOS requires apple-touch-icon with solid background.
**Detection:** Icon looks wrong on home screen or in app switcher.

## Minor Pitfalls

### Pitfall 1: Forgetting to Register NoOpPlugin

**What goes wrong:** ScoringBus.score_all() returns empty list because no plugins registered.
**Prevention:** Always register NoOpMetricPlugin in FastAPI lifespan, even when CLIP is enabled. It serves as a baseline.
**Detection:** Empty scoring results in review_scores table.

### Pitfall 2: StaticFiles Mount Order

**What goes wrong:** `app.mount("/static", ...)` placed before router registrations, catching routes that should go to API handlers.
**Prevention:** Mount StaticFiles AFTER all `app.include_router()` calls in main.py. FastAPI matches mounts in order.
**Detection:** API routes under /static/ path return HTML instead of JSON.

### Pitfall 3: Nginx Buffering Service Worker

**What goes wrong:** Nginx buffers the service worker response, breaking SW update detection.
**Prevention:** Add explicit `Cache-Control: no-cache` header for sw.js in Nginx config. Service workers must always be fetched fresh.
**Detection:** Service worker never updates after deployment.

### Pitfall 4: ReviewScore Table Growing Unbounded

**What goes wrong:** Every scoring run inserts rows. Over months, this table grows large.
**Prevention:** Not a real problem at current scale (10-50 reviews/day, 1-3 scores each = < 5,000 rows/month). Add an index on (review_id, plugin_name) and forget about it until it becomes a concern.
**Detection:** Query performance degradation on review detail page.

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Plugin bus design | Over-abstracting with Protocol instead of ABC | Use ABC -- it provides clear error messages when methods are missing, better for a small team |
| AI scoring task | Task retry on GPU server failure causes duplicate scores | Use idempotency key (review_id + plugin_name) in ReviewScore table, INSERT OR IGNORE |
| CLIP client | GPU server returns non-standard error format | Validate response schema with Pydantic before using score value |
| Timeout escalation | Escalation loops (APPROVING -> POLICY_EVAL -> APPROVING -> ...) | Track escalation count in audit entries; max 2 escalations before forcing COMPLETE |
| PWA manifest | iOS Safari ignores theme_color and background_color | Use apple-mobile-web-app-status-bar-style meta tag and solid-color apple-touch-icon |
| Docker deployment | Static files not included in Docker image | Ensure Dockerfile COPY includes app/static/ directory |

## Sources

- Existing timeout code: `app/workers/tasks.py` check_timeouts function (HIGH confidence -- direct code reading)
- Existing routing code: `app/api/v1/reviews.py` submit_review function (HIGH confidence)
- Python async pitfalls with asyncio.gather: well-documented behavior, exceptions propagate correctly with return_exceptions=False (HIGH confidence)
- FastAPI StaticFiles ordering: documented in FastAPI docs (HIGH confidence)
- PWA icon requirements: W3C Web App Manifest spec + Apple Safari documentation (HIGH confidence)
- CLIP inference latency: training data knowledge, typical inference 50-200ms on RTX 3090 (MEDIUM confidence)

---
*Domain pitfalls for: v1.3 AI Scoring, Escalation, and PWA*
*Researched: 2026-05-10*
