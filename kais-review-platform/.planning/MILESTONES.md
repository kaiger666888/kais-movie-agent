# Milestones

## v1.2 External System Integration (Shipped: 2026-05-10)

**Phases completed:** 7 phases, 13 plans, 21 tasks

**Key accomplishments:**

- Per-review callback fields with RFC1918 SSRF validation, Telegram config, and migration script for external system integration
- deliver_review_callback arq task with HMAC-SHA256 signing, 3x exponential backoff retry (1s/5s/30s), and Telegram failure notification stub wired into emit_state_change on COMPLETE state
- Telegram bot lifecycle, InlineKeyboard approve/reject callbacks, Chinese notifications, and command handlers using python-telegram-bot v22
- Telegram bot wired into FastAPI lifespan with APPROVING notifications, timeout reminders at 80% threshold, and real admin notification delivery
- YAML risk-tier routing policy (blender/facefusion=HUMAN, tts/woosh/acestep=AUTO) plus async ReviewPlatformClient with JWT auth, auto risk scoring, and 14 unit tests
- Guardian GPU task review interception with REVIEWING state, /callback/review_result endpoint, 30s polling loop, and crash recovery via checkpoint files
- Node.js ReviewPlatformClient with native fetch JWT auth, pipeline remote review submission replacing 6 local review gates, and HMAC-verified callback server spawning pipeline resume/rollback
- Telegram Bot sends up to 3 base64-decoded preview images as photo messages before the InlineKeyboard approve/reject notification for movie-agent reviews entering APPROVING state
- Documented single-channel Bot coordination pattern and created shared E2E test fixtures (aiohttp mock callback server, gold-team/movie-agent review payloads) for Plan 02 integration tests.
- 6 E2E integration tests covering gold-team/movie-agent approval and rejection lifecycle, callback retry resilience, and HMAC-SHA256 signature verification
- Fixed cross-system contract gaps: review_check.py with correct access_token auth field, raw-body HMAC callback endpoint, and pipeline.js CLI resume entry point
- tests/integration/conftest.py:

---

## v1.1 Integration Tests & Tech Debt (Shipped: 2026-05-07)

**Phases completed:** 3 phases, 6 plans, 9 tasks

**Key accomplishments:**

- POST /api/v1/reviews/{id}/token endpoint generating one-time review tokens with JWT auth, plus verification that audit log UPDATE/DELETE protection works correctly
- Login page with API key form, httpOnly JWT cookie, and dashboard redirect for unauthenticated users (DEBT-02)
- 14 integration tests via httpx.AsyncClient covering full review lifecycle: submit with AUTO/HUMAN/BLOCK disposition, approve/reject transitions, audit trail, 401/404/409 status codes, and concurrent submission independence
- 7 SSE integration tests via event_manager queue pipeline plus production fix: SSE endpoints migrated to FastAPI 0.136 async generator pattern with response_class=EventSourceResponse
- 9 integration tests verifying HMAC-SHA256 webhook signatures, exponential backoff retry (1s/5s/30s), failure after max retries, and source_system filtering via HTTP CRUD + direct deliver_webhook testing
- Standalone bash test script verifying Docker Compose stack end-to-end through Nginx with 7 black-box tests covering health, Redis integration, SSE, memory limits, and container security

---
