---
phase: 39-e2e-validation-v5-audit
plan: master
type: execute
wave: N/A
depends_on: [38]
files_modified:
  - hermes-agent/skills/kais-movie-pipeline/tests/test_e2e_degraded.py
  - kais-movie-agent/.planning/milestones/v5.0-MILESTONE-AUDIT.md
autonomous: true
requirements: [CANVAS-IN-HERMES-04, OPENCLAW-REMOVE-04, OPENCLAW-REMOVE-05]
user_setup: []

must_haves:
  truths:
    - "openclaw 进程未运行时,phase 完成 / gate 通过后 mocked :10588 仍能收到 canvas save-v2 调用(证明完全脱离 openclaw,CANVAS-IN-HERMES-04)"
    - "openclaw 进程 OFF + gold-team/review/jimeng 服务 mock,跑通全 13 phase DAG 产出 master.mp4(degraded mode,OPENCLAW-REMOVE-04 继承 v4.0 PIPE-COMPOSE-01)"
    - ".planning/milestones/v5.0-MILESTONE-AUDIT.md 文档化:0 openclaw grep 结果 + 解耦验证清单 + 9 phase 验收 trace + 测试基线(OPENCLAW-REMOVE-05)"
    - "v5.0 full regression 测试基线 ≥ 501(498 Phase 38 baseline + ≥3 new E2E tests in test_e2e_degraded.py)"
  artifacts:
    - path: "hermes-agent/skills/kais-movie-pipeline/tests/test_e2e_degraded.py"
      provides: "Full 13-phase E2E test — openclaw OFF + all 4 clients mocked + canvas subscriber fires + master.mp4 produced. Reuses Phase 36 mocked-delegate spy pattern (CF-39-01)."
      contains: "test_e2e_degraded_full_dag_produces_master_mp4"
    - path: "kais-movie-agent/.planning/milestones/v5.0-MILESTONE-AUDIT.md"
      provides: "Comprehensive v5.0 migration audit — 0 openclaw grep results + 4-dir decoupling checklist + 9 phase verification trace + test baseline + ship recommendation"
      contains: "v5.0"
  key_links:
    - from: "test_e2e_degraded.py"
      to: "pipeline.runner.run_episode"
      via: "direct import + invoke with mocked inject dict"
      pattern: "from pipeline.runner import run_episode"
    - from: "test_e2e_degraded.py"
      to: "canvas_sync.CanvasSyncSubscriber"
      via: "RunnerConfig.on_phase_complete callback injection"
      pattern: "on_phase_complete"
    - from: "v5.0-MILESTONE-AUDIT.md"
      to: "Phase 31-39 VERIFICATION.md files"
      via: "9-phase trace table linking each phase's verification evidence"
      pattern: "VERIFICATION"
---

<objective>
Phase 39 is the v5.0 ship decision point. Two deliverables close the milestone:

1. **SC#1 + SC#2 — E2E degraded validation (OPENCLAW-REMOVE-04 + CANVAS-IN-HERMES-04):** Add `test_e2e_degraded.py` to `hermes-agent/skills/kais-movie-pipeline/tests/`. The test runs the real 13-phase `PHASE_REGISTRY` via `run_episode()` with all external services mocked (delegate_task spy from Phase 36 + mocked gold_team/review_platform/canvas/jimeng clients via `inject={}`). It asserts:
   - The full DAG p01→p13 completes without throwing (degraded mode).
   - `p13_delivery` produces a `master.mp4` artifact (placeholder acceptable per D-39-03, inheriting v4.0 PIPE-COMPOSE-01).
   - The Phase 37 `canvas_sync.CanvasSyncSubscriber` (registered as `RunnerConfig.on_phase_complete`) invokes the mocked canvas client's HTTP save-v2 call at least once per phase — proving canvas updates reach `:10588` without any openclaw process.
   - No real openclaw process is spawned (implicit — the v5.0 deliverables have zero openclaw code paths per Phase 38 SC#1).

2. **SC#3 — v5.0 milestone audit (OPENCLAW-REMOVE-05):** Write `.planning/milestones/v5.0-MILESTONE-AUDIT.md` following the v3.0-MILESTONE-AUDIT.md format (D-39-05). The audit documents:
   - 0 openclaw grep results across the 4 v5.0 deliverable dirs (re-affirms Phase 38 SC#1 at audit time)
   - 4-dir × multi-keyword decoupling checklist (openclaw / OpenClaw / sessions_spawn / Toonflow / Node.js require)
   - 9-phase verification trace (Phase 31-39, each phase's SC evidence condensed into a trace table)
   - Test baseline (post-Phase-39 count: 498 + N new E2E tests)
   - Ship recommendation (v5.0 is internally complete; real-GPU validation deferred to operator)

Output: 1 new E2E test file + 1 new audit doc. Single sub-plan (39-01). This is the FINAL v5.0 phase.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/39-e2e-validation-v5-audit/CONTEXT.md

# Phase 36 E2E test pattern to extend (CF-39-01)
@/data/workspace/hermes-agent/skills/kais-movie-pipeline/tests/test_runner_full_dag.py

# Phase 37 canvas_sync subscriber (CF-39-02 — the canvas-update path to assert)
@/data/workspace/hermes-agent/plugins/kais_aigc/canvas_sync.py

# v4.0 degraded E2E reference (CF-39-03 — placeholder master.mp4 acceptable)
@/data/workspace/kais-movie-agent/test/e2e/degraded-shipping.test.mjs

# Audit doc format reference (D-39-05)
@/data/workspace/kais-movie-agent/.planning/milestones/v3.0-MILESTONE-AUDIT.md

<interfaces>
E2E test target shape:

```python
# hermes-agent/skills/kais-movie-pipeline/tests/test_e2e_degraded.py
"""Phase 39 E2E degraded-mode validation (SC#1 + SC#2).

Proves:
  - 13-phase DAG runs end-to-end with mocked delegate + mocked clients
  - Canvas subscriber fires HTTP save-v2 per phase (CANVAS-IN-HERMES-04)
  - p13_delivery produces master.mp4 placeholder (OPENCLAW-REMOVE-04)
  - No real openclaw process needed (implicit — structural guarantee
    from Phase 38 SC#1; runtime proof via canvas subscriber path)
"""
from unittest.mock import MagicMock
from pipeline.runner import RunnerConfig, run_episode
from pipeline.phases import PHASE_REGISTRY  # noqa: F401 (sanity import)


def _build_mock_clients():
    """Return 4 mocked clients (gold_team / review / canvas / jimeng) +
    a delegate spy that returns canned payloads per phase."""
    canvas_client = MagicMock()
    canvas_client.save_graph.return_value = {"ok": True}
    # ... delegate spy reuses Phase 36 _make_full_dag_delegate_spy pattern
    return {"canvas_client": canvas_client, "delegate_task": delegate_spy, ...}


def test_e2e_degraded_full_dag_produces_master_mp4(tmp_path):
    """SC#2 — full 13-phase DAG runs in degraded mode, master.mp4 produced."""
    workdir = tmp_path / "e2e-workdir"
    workdir.mkdir()
    mocks = _build_mock_clients()

    config = RunnerConfig(workdir=str(workdir), enable_gates=False,
                          on_phase_complete=_make_subscriber(mocks["canvas_client"]))
    result = run_episode("EP39-E2E", config=config, inject=mocks)

    assert len(result["phases"]) == 13
    assert (workdir / "master.mp4").exists()


def test_e2e_canvas_subscriber_fires_without_openclaw(tmp_path):
    """SC#1 — canvas save-v2 invoked per phase, no openclaw process needed."""
    # ... set up mocks, run episode, assert canvas_client.save_graph
    # call_count >= 13 (once per phase completion)
```

Audit doc target shape (see v3.0-MILESTONE-AUDIT.md for full format):

```markdown
# v5.0 Hermes-Native Migration — Milestone Audit

**Auditor:** Claude Code (cross-phase integration auditor)
**Audited:** 2026-06-26
**Milestone scope:** Phases 31–39 (9 phases, 25 REQ-IDs)
**Status:** `shipped` — all 25 REQ-IDs covered, 9/9 phases pass VERIFICATION,
~501+ tests green, 0 BLOCKER gaps.
**Recommendation:** Ship v5.0.

## 0. Executive Summary
...

## 1. Requirements Coverage
| REQ-ID | Traceability | VERIFICATION claim | Code reality | Audit verdict |
...

## 3. 9-Phase Verification Trace
| Phase | SC Met? | Tests | Key Evidence |
| 31 | ✓ | 21 | loader + 3 plugins + smoke imports |
| 32 | ✓ | ~50 | 4 clients + 17 task types + HMAC |
...
| 39 | ✓ | ~501 | E2E degraded + this audit |

## 4. Test Baseline
- Pre-Phase-39: 498
- Post-Phase-39: <actual>
- 0 regressions

## 5. Ship Recommendation
v5.0 ships. Real-GPU validation deferred to operator (PROJECT.md Out of Scope).
```
</interfaces>
</context>

<tasks>

This phase is a single sub-plan (39-01). The audit doc depends on the E2E test passing (its "Test Baseline" section needs the post-test count).

| Plan | Wave | Objective | Files |
|------|------|-----------|-------|
| 39-01 | 1 | (a) Add `test_e2e_degraded.py` (SC#1 + SC#2), (b) write `v5.0-MILESTONE-AUDIT.md` (SC#3), (c) final regression run + ship decision summary | 1 new test + 1 new audit doc |

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Mocked clients → real services | The E2E test must NOT accidentally hit real :8002/:8090/:5100/:10588 endpoints. Mitigation: use `unittest.mock.MagicMock` for all 4 clients (no real HTTP); run in `tmp_path` workdir (no writes to repo). |
| Audit doc → ship decision | The audit's ship recommendation must be honest about deferred items (real GPU, multi-platform export). Mitigation: follow v3.0 precedent — explicit "operator-deferred" section. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-39-01 | DoS | E2E test makes real HTTP calls | mitigate | All 4 clients are `MagicMock`; no real HTTP. Test asserts on mock call counts, not real endpoints. |
| T-39-02 | Info disclosure | Audit overstates completion | mitigate | Audit follows v3.0-MILESTONE-AUDIT.md format with explicit "operator-deferred" + "v6.0+" sections. Ship recommendation cites internal completeness, not real-GPU validation. |
| T-39-03 | Repudiation | master.mp4 assertion too strict | mitigate | D-39-03: 0-byte placeholder acceptable (inherits v4.0 Phase 30 contract). Assert EXISTS, not playable. |

No new packages, no Node.js bridges, no LLM code.
</threat_model>

<verification>
## Phase-level verification (after 39-01 completes)

```bash
# 1. SC#1 + SC#2 — E2E test passes
cd /data/workspace/hermes-agent && python3 -m pytest skills/kais-movie-pipeline/tests/test_e2e_degraded.py -v
# Expect: PASSED (3-5 test functions)

# 2. SC#3 — v5.0-MILESTONE-AUDIT.md exists with required sections
test -f /data/workspace/kais-movie-agent/.planning/milestones/v5.0-MILESTONE-AUDIT.md
grep -E "## 0. Executive Summary|## 1. Requirements Coverage|## 3. 9-Phase Verification Trace|## 4. Test Baseline|## 5. Ship Recommendation" \
  /data/workspace/kais-movie-agent/.planning/milestones/v5.0-MILESTONE-AUDIT.md
# Expect: 5 section headers present

# 3. Full v5.0 regression still green (498 baseline + ≥3 new E2E tests)
cd /data/workspace/hermes-agent && python3 -m pytest skills/kais-movie-pipeline/tests/ plugins/kais_aigc/tests/ plugins/pipeline_state/tests/ plugins/review_gates/tests/ 2>&1 | tail -3
# Expect: 501+ passed

# 4. Re-affirm Phase 38 SC#1 (audit-time grep — should still be 0)
grep -ri "openclaw\|OpenClaw\|sessions_spawn(runtime=\"acp\")\|Toonflow" \
  /data/workspace/hermes-agent/skills/kais-movie-pipeline/ \
  /data/workspace/hermes-agent/plugins/kais_aigc/ \
  /data/workspace/hermes-agent/plugins/pipeline_state/ \
  /data/workspace/hermes-agent/plugins/review_gates/ \
  --include="*.py" 2>&1 | grep -v "test_\|__pycache__\|no openclaw\|No openclaw" | wc -l
# Expect: 0
```
</verification>

<success_criteria>
All 3 ROADMAP Phase 39 SC met:

1. **SC#1 (CANVAS-IN-HERMES-04)**: E2E test asserts `canvas_sync.CanvasSyncSubscriber` invokes mocked canvas client's `save_graph` HTTP call ≥13 times (once per phase completion) — proving canvas updates reach `:10588` without any openclaw process. Verified by: `test_e2e_canvas_subscriber_fires_without_openclaw` PASSED.

2. **SC#2 (OPENCLAW-REMOVE-04)**: E2E test runs the full 13-phase `PHASE_REGISTRY` via `run_episode()` with mocked delegate + mocked clients, completes without throwing, and `p13_delivery` produces a `master.mp4` artifact in the tmp workdir. Verified by: `test_e2e_degraded_full_dag_produces_master_mp4` PASSED.

3. **SC#3 (OPENCLAW-REMOVE-05)**: `.planning/milestones/v5.0-MILESTONE-AUDIT.md` exists with 5 required sections (Executive Summary / Requirements Coverage / 9-Phase Verification Trace / Test Baseline / Ship Recommendation), documents 0 openclaw grep results at audit time, and lists the 4-dir decoupling checklist + 25-REQ-ID coverage. Verified by: file exists + grep confirms section headers.
</success_criteria>

<output>
Create `.planning/phases/39-e2e-validation-v5-audit/39-01-SUMMARY.md` when the sub-plan completes.
Master SUMMARY (`.planning/phases/39-e2e-validation-v5-audit/39-SUMMARY.md`) is created by the orchestrator after the sub-plan finishes (single-plan phase — master SUMMARY optional).
</output>

<source_audit>

## Multi-Source Coverage Audit (mandatory)

### GOAL (ROADMAP Phase 39 goal)
- "openclaw 进程 OFF + 服务 mock 环境下,13 phase degraded E2E 产出 master.mp4,v5.0-MILESTONE-AUDIT.md 文档化完整解耦验证 + 9 phase 验收 trace — v5.0 ship 决策点"
- **COVERED by:** Sub-plan 39-01 covers all three clauses (E2E test for master.mp4 + canvas subscriber + audit doc)

### REQ (REQUIREMENTS.md phase_req_ids for Phase 39)
- **CANVAS-IN-HERMES-04** (E2E — openclaw OFF, canvas updates still reach :10588) → **39-01** `test_e2e_canvas_subscriber_fires_without_openclaw`
- **OPENCLAW-REMOVE-04** (E2E — openclaw OFF + mocked services, 13 phase produces master.mp4) → **39-01** `test_e2e_degraded_full_dag_produces_master_mp4`
- **OPENCLAW-REMOVE-05** (v5.0-MILESTONE-AUDIT.md with 0 grep + checklist + 9 phase trace + test baseline) → **39-01** audit doc
- **Coverage: 3/3 REQ IDs mapped. No gaps.**

### CONTEXT (decisions from CONTEXT.md)
All decisions covered:
- D-39-01 (single plan, no decomposition) → 39-01
- D-39-02 (reuse Phase 36 mocked-delegate spy pattern) → 39-01
- D-39-03 (master.mp4 placeholder acceptable) → 39-01
- D-39-04 (openclaw OFF is implicit, canvas subscriber is the proof) → 39-01
- D-39-05 (audit doc follows v3.0 format) → 39-01

### Phase 38 carry-forward (CF-39-04)
- CF-39-04 (498 tests pre-Phase-39 baseline; audit records post-Phase-39 count) → **39-01**

**Audit result: 0 gaps. Plan set is complete.**
</source_audit>
