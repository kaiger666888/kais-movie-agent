# Feature Landscape: v1.3

**Domain:** AI Scoring Bus, Remote GPU Inference, Timeout Escalation, PWA
**Researched:** 2026-05-10

## Table Stakes

Features the review platform needs to feel "complete" for AI-assisted governance. Missing = the AI_AUDIT disposition is a dead letter.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| MetricPlugin ABC + ScoringBus | Without it, AI_AUDIT is just HUMAN with a different label | Low | ABC + dict registry, ~200 LOC |
| NoOpMetricPlugin default | Platform must not crash if GPU server is unavailable | Low | Always returns score=0.5, ~30 LOC |
| run_ai_scoring arq task | AI_AUDIT submissions must actually trigger scoring | Medium | Background task with score storage + auto-approve/escalate decision |
| Risk-tier timeout (AI 5min / Human 24h) | 5-minute AI timeout is the core value of automated scoring | Low | TIMEOUT_THRESHOLDS already defined, just needs wiring |
| Auto-escalation on timeout | Timed-out reviews must not sit forever in APPROVING | Medium | APPROVING -> POLICY_EVAL -> re-evaluate, not just a state change |
| ReviewScore table | Scoring results must be persisted for audit trail | Low | New table, ~20 LOC model |
| PWA manifest + home screen install | Reviewers use mobile phones; "Add to Home Screen" is expected UX | Low | Static files, template changes, ~50 LOC |

## Differentiators

Features that set the platform apart from a simple human-review queue.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| CLIP aesthetic scoring on GPU | AI pre-scores image quality before human review, auto-approving high-quality submissions | Medium | httpx client to GPU server, ~150 LOC |
| Auto-approve on high AI score | Low-risk images bypass human review entirely if AI scores above threshold | Low | Threshold comparison in scoring task, ~20 LOC |
| Concurrent plugin execution | Multiple scoring models run in parallel (aesthetic + NSFW + future plugins) | Low | asyncio.gather in ScoringBus, already designed |
| Score-influenced routing | AI scores feed back into routing decisions (AUTO -> AI_AUDIT -> HUMAN escalation chain) | Medium | re_evaluate_policy task, ~80 LOC |

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Local model inference in review platform | PyTorch alone is 800MB+, violates 400MB RAM constraint | Remote GPU server on 192.168.71.38, review platform is HTTP client only |
| AI_SCORING state in state machine | AI scoring is an internal process, not a user-visible state | Reviews stay in APPROVING; scoring status tracked in ReviewScore table |
| Full offline PWA with data caching | Stale review data leads to wrong governance decisions | Cache app shell only; all data fetched live from server |
| Complex plugin dependency injection | Single-team, single-process application does not need DI frameworks | Simple ABC + dict registry in ScoringBus |
| Real-time WebSocket scoring updates | SSE already provides real-time; scoring is a one-shot async operation | Score results appear via existing SSE when state changes |
| Multi-model GPU server management | The GPU server is a separate project, not review platform concern | Define HTTP contract; GPU server is independently deployed |

## Feature Dependencies

```
MetricPlugin ABC + ScoringBus
  |
  +---> NoOpMetricPlugin (default, no deps)
  |
  +---> CLIPMetricPlugin (depends on httpx, GPU server running)
  |
  +---> run_ai_scoring arq task (depends on ScoringBus + ReviewScore table)
         |
         +---> Auto-approve logic (depends on threshold config)
         +---> re_evaluate_policy task (depends on policy engine + scoring results)

Risk-Tier Timeout Escalation (independent)
  |
  +---> check_timeouts modification (depends on TIMEOUT_THRESHOLDS + disposition field)
  +---> re_evaluate_policy task (shared with AI scoring)

PWA Manifest (independent, no deps)
```

## MVP Recommendation

Prioritize:
1. MetricPlugin ABC + ScoringBus + NoOpPlugin (foundation for everything)
2. run_ai_scoring arq task + AI_AUDIT activation (makes AI_AUDIT disposition functional)
3. Risk-tier timeout escalation (activates existing unused TIMEOUT_THRESHOLDS)

Defer:
- CLIPMetricPlugin: Can ship with NoOpPlugin first, add CLIP when GPU server is ready
- PWA manifest: Independent, can ship anytime, no blocking dependency
- re_evaluate_policy: Can use simple re-queue to POLICY_EVAL in v1, add smart re-evaluation later

## Sources

- Existing codebase analysis: `app/core/policy.py`, `app/workers/tasks.py`, `app/api/v1/reviews.py`, `app/models/schema.py` (HIGH confidence)
- TIMEOUT_THRESHOLDS dict found in `app/workers/tasks.py:19-22` -- already defined, just unused (HIGH confidence)
- AI_AUDIT disposition handling at `app/api/v1/reviews.py:155` -- treats same as HUMAN (HIGH confidence)
- Python ABC patterns -- standard library, well-established (HIGH confidence)

---
*Feature landscape for: v1.3 AI Scoring, Escalation, and PWA*
*Researched: 2026-05-10*
