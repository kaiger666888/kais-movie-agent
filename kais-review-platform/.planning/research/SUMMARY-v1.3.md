# Research Summary: v1.3 AI Scoring & Escalation

**Project:** Kai's Review Platform
**Domain:** Adding pluggable AI scoring bus, risk-tier timeout escalation, and PWA to an existing review platform
**Researched:** 2026-05-10
**Overall confidence:** HIGH

## Executive Summary

The v1.3 milestone adds four independent features to a well-established review platform (266 tests, 7,500+ LOC, v1.2 shipped). All four features are architecturally additive -- they extend the existing system at well-defined integration points without requiring changes to the core state machine, policy engine, or audit trail.

The pluggable scoring bus uses an ABC + in-process registry pattern. No entry points, no setuptools plugins, no external dependencies. The MetricPlugin ABC defines a `score()` coroutine and a `health_check()`. The ScoringBus registers plugins at startup and runs them concurrently via asyncio.gather. The NoOpMetricPlugin (always returns 0.5) serves as the default when no real plugins are configured.

The CLIP scoring plugin is an httpx async client that calls a GPU inference server on 192.168.71.38. The review platform never imports torch or loads models -- it is purely an HTTP client. The GPU server is a separate FastAPI deployment on the GPU machine. This separation is critical because PyTorch alone exceeds the 400MB RAM constraint.

Risk-tier timeout escalation activates the already-existing `TIMEOUT_THRESHOLDS` dict in tasks.py that was defined but never wired in. The fix is mechanical: query reviews by disposition, apply per-disposition thresholds, and escalate timed-out reviews back to POLICY_EVAL for re-evaluation. The cron interval changes from hourly to every minute to support the 5-minute AI timeout.

PWA manifest is the simplest feature: a static manifest.json, a minimal service worker caching only the app shell, and template/meta tag additions. No data caching, no offline data access -- a governance tool must always show current server state.

## Key Findings

**Stack:** No new dependencies. All four features use existing libraries (httpx for GPU client, asyncio for plugin concurrency, FastAPI StaticFiles for PWA assets). The only new code is the scoring package and static files.

**Architecture:** All four features are independent of each other and can be built in parallel after the MetricPlugin ABC is defined. The plugin bus is the highest-priority item because AI_AUDIT activation and CLIP scoring depend on it.

**Critical pitfall:** Blocking the submission request on GPU inference. AI scoring MUST run as an arq background task, not in the request handler. The submit endpoint must return 202 immediately regardless of scoring status.

## Implications for Roadmap

Based on research, suggested phase structure:

1. **Plugin Bus Foundation** - Define MetricPlugin ABC, ScoringBus, NoOpPlugin, ReviewScore table
   - Addresses: Extensible scoring interface
   - Avoids: Tight coupling to any specific scoring model
   - No external dependencies

2. **AI_AUDIT Activation + Scoring Task** - Wire AI_AUDIT disposition to enqueue scoring, implement run_ai_scoring arq task
   - Addresses: Policy engine triggers AI scoring on AI_AUDIT submissions
   - Avoids: Blocking submission on scoring (Anti-Pattern 1)
   - Depends on: Phase 1

3. **CLIP Plugin (Remote GPU Client)** - CLIPMetricPlugin httpx client, GPU server contract, feature flag
   - Addresses: Actual image quality scoring on GPU hardware
   - Avoids: Importing torch into review platform (Anti-Pattern 3)
   - Depends on: Phase 1
   - Can parallel with: Phase 2

4. **Risk-Tier Timeout Escalation** - Modify check_timeouts to use TIMEOUT_THRESHOLDS per disposition, add re_evaluate_policy task
   - Addresses: 5-minute AI timeout, 24-hour human timeout, auto-escalation
   - Avoids: Missing the fact that TIMEOUT_THRESHOLDS already exists
   - Depends on: Nothing (independent feature)

5. **PWA Manifest** - Static manifest.json, service worker, icons, template changes, Nginx config
   - Addresses: Mobile home screen install, app-like experience
   - Avoids: Over-engineering offline caching (Anti-Pattern 4)
   - Depends on: Nothing (independent feature)

6. **Integration & E2E Tests** - Full scoring lifecycle tests, timeout escalation tests, PWA verification
   - Addresses: Cross-feature integration validation
   - Depends on: Phases 2, 3, 4, 5

**Phase ordering rationale:**
- Phase 1 first because 2 and 3 depend on the MetricPlugin ABC
- Phases 4 and 5 can start as soon as Phase 1 is defined (they do not depend on 2 or 3)
- Phase 6 is the validation gate that ensures everything works together
- Total new code estimate: ~800-1200 LOC (scoring package ~400, timeout changes ~100, PWA ~50, tests ~400)

**Research flags for phases:**
- Phase 2: The auto-approve threshold logic needs careful product decision -- what score is "good enough"?
- Phase 3: GPU server implementation is out of scope but the HTTP contract needs to be agreed upon with whoever builds it
- Phase 4: Cron every minute on SQLite is fine at current scale but should be monitored

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Plugin bus design | HIGH | Standard ABC + registry, matches existing codebase patterns |
| CLIP client design | HIGH | httpx async client identical pattern to existing webhook delivery |
| Timeout escalation | HIGH | TIMEOUT_THRESHOLDS already exists, mechanical wiring |
| PWA manifest | HIGH | W3C standard, FastAPI StaticFiles well-documented |
| AI scoring integration flow | MEDIUM | Auto-approve decision logic needs product validation |
| GPU server contract | MEDIUM | Review platform side is clear; GPU server is separate deployment |

## Gaps to Address

- Auto-approve / escalate thresholds (0.85 / 0.3) are product decisions, not technical ones -- need stakeholder input
- GPU inference server implementation on 192.168.71.38 is out of scope for this repo but the API contract must be agreed upon
- Service worker scope and caching behavior should be tested on actual mobile devices (iOS Safari has specific PWA quirks)
- Whether the re_evaluate_policy task should also trigger Telegram notifications (probably yes, to match existing behavior)

---
*Research summary for: v1.3 AI Scoring, Escalation, and PWA*
*Researched: 2026-05-10*
