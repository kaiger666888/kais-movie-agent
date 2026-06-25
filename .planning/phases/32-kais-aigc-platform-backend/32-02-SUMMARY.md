---
phase: 32-kais-aigc-platform-backend
plan: 02
subsystem: review-platform-client
tags: [python, httpx, jwt, hmac, security-hardening, review-platform]
requires:
  - "Phase 31 kais_aigc plugin skeleton (tools.py + __init__.py)"
provides:
  - "ReviewPlatformClient (submit_review + query_review_status + verify_callback)"
  - "ReviewClientError exception class"
  - "HS256 JWT bearer auth on outbound requests (CRITICAL-FINDING-03)"
  - "HMAC-SHA256 callback verifier with 5min timestamp window (CRITICAL-FINDING-04)"
affects: []
tech-stack:
  added: []
  patterns:
    - "Sync httpx.Client with transport kwarg for MockTransport injection"
    - "Degrade envelope (DEGRADED_AUTO/APPROVED) on 5xx/timeout/connect-error"
    - "HS256 JWT bearer auth via PyJWT (5min expiration, iat+exp+sub claims)"
    - "Constant-time HMAC verification via hmac.compare_digest"
    - "5-minute timestamp tolerance window for callback replay protection"
key-files:
  created:
    - /data/workspace/hermes-agent/plugins/kais_aigc/review_platform.py
    - /data/workspace/hermes-agent/plugins/kais_aigc/tests/test_review_platform.py
  modified: []
decisions:
  - "JWT claims: {iat, exp=now+300, sub='kais-movie-agent'} (5min lifetime matches callback window)"
  - "Degrade envelope includes operation + reason + state + disposition fields"
  - "callback_secret defaults to '' (empty) → dev mode accepts all callbacks"
  - "verify_callback accepts both str and bytes body (callback servers may pass raw bytes)"
metrics:
  duration: "3m36s"
  completed: "2026-06-25T14:27:28Z"
  tasks: 2
  files: 2
  loc_client: 380
  loc_tests: 323
  test_count: 16
---

# Phase 32 Plan 02: ReviewPlatformClient + HMAC Verifier Summary

Python port of the review platform REST client with JWT bearer auth and 5-minute timestamp-windowed HMAC callback verification — a security hardening over the Node.js reference.

## What Was Built

**`review_platform.py`** (380 LOC) — `ReviewPlatformClient` + `ReviewClientError`. Sync `httpx.Client` with three public operations:

1. `submit_review(...)` → `POST /api/v1/reviews` with JWT bearer auth. Returns `{review_id, state, routing}` on success.
2. `query_review_status(review_id)` → `GET /api/v1/reviews/{id}`. Returns `{review_id, state, disposition, version}`.
3. `verify_callback(body, signature, timestamp)` → HMAC-SHA256 verifier with 5-minute timestamp window (replay protection) and `hmac.compare_digest` (constant-time comparison, timing-attack resistant).

Degrade envelope `{degraded: True, client: 'review_platform', operation: ..., reason: ..., state: 'DEGRADED_AUTO', disposition: 'APPROVED'}` is returned on 5xx / timeout / connect-error (pipeline auto-advances when the review service is unavailable). 4xx errors raise `ReviewClientError` (caller bug).

**`test_review_platform.py`** (323 LOC, 16 tests, all passing):

- `TestReviewPlatformClient` (8 tests): happy-path submit (verifies JWT decodes with correct secret + `exp` within 5min + `iat` present), happy-path query, degrade on 503, degrade on connect-error, degrade on read-timeout, raise on 400 with `status==400`, degrade on 500 query, no-`Authorization`-header when `jwt_secret=None`.
- `TestReviewCallbackVerifier` (8 tests): valid signature accepted, expired timestamp (>5min ago) rejected, future timestamp (>5min ahead) rejected, tampered body rejected, wrong signature format (no `sha256=` prefix / empty) rejected, dev-mode escape when `callback_secret=""`, bytes-body accepted, bad timestamp string rejected.

All HTTP tests use `httpx.MockTransport(handler)` — zero real network calls.

## CRITICAL-FINDING-03 Resolution (JWT bearer auth)

The Node.js `submitReview` and `queryReviewStatus` methods in `lib/review-platform-client.js` do **NOT** attach any `Authorization` header (the `queryReviewStatus` docstring falsely claims "with JWT auth" — the implementation has none). The Python port generates a short-lived HS256 JWT via PyJWT (already in `pyproject.toml` as `PyJWT[crypto]==2.13.0`) with claims `{iat, exp=now+300, sub="kais-movie-agent"}` and attaches `Authorization: Bearer <jwt>` on every outbound request when `KAIS_REVIEW_JWT_SECRET` is set. When the secret is unset/empty, no JWT is generated (dev mode — matches Node.js behavior of "no auth"). This is a v5.0 security hardening required by GPU-DIRECT-02.

## CRITICAL-FINDING-04 / D-11 Resolution (5min timestamp window)

The Node.js `verifyHmac()` in `bin/callback-server.js` (lines 47-51) is a plain body HMAC match — no timestamp, no constant-time comparison. The Python `verify_callback` implements the three-step GPU-DIRECT-02 / D-11 contract:

1. **Dev-mode escape:** empty `callback_secret` → accept all (mirrors Node.js line 48).
2. **5-minute timestamp window:** `abs(int(time.time()) - int(timestamp)) > 300` → reject (replay protection in BOTH directions — expired AND future timestamps rejected).
3. **Constant-time HMAC match:** `expected = "sha256=" + hmac_sha256(secret, body)`; return `hmac.compare_digest(expected, signature)`.

The `sha256=<hex>` signature format matches the Node.js ref and the `shared/hmac_node.js` convention. `verify_callback` accepts both `str` and `bytes` bodies (callback servers may pass raw bytes from the wire).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test factory kwargs collision**
- **Found during:** Task 2 verification
- **Issue:** `_client(handler, **kw)` factory passed `jwt_secret="test-jwt-secret"` as a fixed arg, then `test_no_jwt_header_when_secret_unset` passed `jwt_secret=None` via `**kw` → `TypeError: got multiple values for keyword argument 'jwt_secret'`.
- **Fix:** Refactored factory to use `kw.setdefault("jwt_secret", "test-jwt-secret")` so callers can override any constructor kwarg.
- **Files modified:** `tests/test_review_platform.py`
- **Commit:** 174c186cb (folded into Task 2 commit)

No other deviations — plan executed as written.

## Known Stubs

None. The client is fully wired — all methods perform real (mocked-HTTP in tests) work and return real payloads. No placeholder data, no TODOs, no hardcoded empty values that flow to callers.

## Handoff to Plan 32-05

Plan 32-05 (`tools.py` handler dispatch) can wire `ReviewPlatformClient` into `_handle_kais_review_submit` as follows:

```python
from plugins.kais_aigc.review_platform import ReviewPlatformClient, ReviewClientError

def _review_platform_client() -> ReviewPlatformClient:
    return ReviewPlatformClient()  # reads KAIS_REVIEW_URL/JWT_SECRET/CALLBACK_SECRET env

def _handle_kais_review_submit(args: dict, **kw) -> str:
    from tools.registry import tool_result
    try:
        with _review_platform_client() as c:
            result = c.submit_review(
                type=args["type"],
                content_ref=args["content_ref"],
                metadata=args.get("metadata"),
                priority=args.get("priority", "normal"),
                risk_score=args.get("risk_score", 0.5),
            )
        return tool_result(result)
    except ReviewClientError as exc:
        return _kais_tool_error("review_platform", exc)
```

The `KAIS_REVIEW_SUBMIT_SCHEMA` declared in Phase 31 is unchanged. Degrade envelopes flow through `tool_result`; exceptions flow through `_kais_tool_error`. The `verify_callback` method is consumed by the callback receiver (separate concern — likely wired in Phase 34 gate lifecycle).

## Self-Check: PASSED

- `plugins/kais_aigc/review_platform.py` — FOUND (380 LOC)
- `plugins/kais_aigc/tests/test_review_platform.py` — FOUND (323 LOC, 16 tests)
- Commit `3ffeec073` (Task 1) — FOUND in git log
- Commit `174c186cb` (Task 2) — FOUND in git log
- All 16 tests pass: `pytest plugins/kais_aigc/tests/test_review_platform.py -v` → 16 passed
- `pyproject.toml` unchanged (PyJWT already present)
- No real network calls in test suite (all use `httpx.MockTransport`)
