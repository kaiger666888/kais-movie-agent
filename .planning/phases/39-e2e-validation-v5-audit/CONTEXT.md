# Phase 39 CONTEXT — E2E Validation + v5.0 Audit

**Phase:** 39 — E2E Validation + v5.0 Audit (FINAL v5.0 phase)
**Status:** planning
**Depends on:** Phase 38 (decoupling complete — code frozen, 498 tests pass, OPENCLAW-REMOVE-01/02/03 satisfied)
**Cross-repo:** Code deliverables in `/data/workspace/hermes-agent/`; audit doc + planning in `/data/workspace/kais-movie-agent/`.

---

## Goal (outcome, not task)

**As a** v5.0 ship-decision stakeholder,
**I want** E2E verification that the 13-phase Python pipeline runs to completion (degraded mode) without the openclaw process, producing `master.mp4`, and a single audit document that traces the full 9-phase migration with grep evidence,
**so that** I can make the v5.0 ship decision based on observable runtime evidence, not on unit tests alone.

After Phase 39, v5.0 ships. There is no Phase 40.

---

## Scope (locked)

### In scope

1. **E2E degraded test (SC#1 + SC#2)** — `hermes-agent/skills/kais-movie-pipeline/tests/test_e2e_degraded.py`:
   - Full 13-phase DAG run via `run_episode()`
   - All external services mocked (gold-team, review-platform, jimeng, canvas) via `inject={}`
   - openclaw process NOT running — assert canvas updates still reach `:10588` via the canvas_sync subscriber (CANVAS-IN-HERMES-04)
   - Pipeline reaches p13_delivery, producing a `master.mp4` placeholder (OPENCLAW-REMOVE-04, inherits v4.0 PIPE-COMPOSE-01 semantics)

2. **v5.0 milestone audit doc (SC#3)** — `kais-movie-agent/.planning/milestones/v5.0-MILESTONE-AUDIT.md`:
   - 0 openclaw grep results (re-affirms Phase 38 SC#1 at audit time)
   - Decoupling checklist (4 dirs × multiple openclaw keywords)
   - 9 phase verification trace (Phase 31-39, each phase's SC verification evidence)
   - Test baseline (498+ tests pass)
   - OPENCLAW-REMOVE-05 satisfied

### Out of scope

- **Real GPU E2E** (real ZHIPU_API_KEY, real Seedance GPU) — deferred per PROJECT.md (operator-side validation)
- **v6.0 work** (TypeScript migration, CI/CD, multi-platform export) — explicitly out of v5.0 scope
- **Performance benchmarking** — not in any v5.0 SC
- **Physical archival of kais-movie-agent repo** — operator decision post-ship

---

## Decisions (locked — DO NOT revisit)

### D-39-01: Single sub-plan, no decomposition

**Decision:** Phase 39 is one sub-plan (39-01). The two work items (E2E test + audit doc) are small and the audit depends on the test passing.

**Rationale:** ~300 LOC test + ~300-line audit doc. Well under decomposition threshold. The audit's "test baseline" section needs the test to pass first.

### D-39-02: Reuse Phase 36 mocked-delegate spy pattern

**Decision:** The E2E test uses the same `_make_full_dag_delegate_spy` pattern as `test_runner_full_dag.py` (Phase 36-05). Delegate is replaced with a canned-JSON spy; no real subagent spawn, no real HTTP/LLM.

**Rationale:** Phase 36 already proved this pattern runs the full 13-phase DAG with mocked delegate. Phase 39 extends it by also mocking the 4 external clients and the canvas subscriber, then asserting observable side effects (canvas HTTP calls + master.mp4 artifact).

### D-39-03: master.mp4 is a placeholder, not a real video

**Decision:** In degraded mode, `p12_composition` and `p13_delivery` produce a 0-byte or stub `master.mp4`. The E2E test asserts the artifact EXISTS, not that it's playable.

**Rationale:** Inherits v4.0 Phase 30 SC#1 contract ("0-byte placeholder acceptable" — see `test/e2e/degraded-shipping.test.mjs` line 11). Real video rendering requires real GPU, which is operator-side per PROJECT.md.

### D-39-04: openclaw OFF assertion is implicit

**Decision:** The E2E test does NOT spawn or check for an openclaw process. Instead, it asserts that canvas updates reach the mocked `:10588` endpoint via `canvas_sync.CanvasSyncSubscriber` — proving the pipeline no longer depends on openclaw to drive canvas sync.

**Rationale:** openclaw was never a Python process; "openclaw OFF" means the v5.0 deliverables have zero code paths that spawn or require it (verified structurally in Phase 38). The runtime proof is that canvas sync still works without any openclaw-shaped side channel — which is what the mocked-canvas HTTP assertion demonstrates.

### D-39-05: Audit doc format follows v3.0-MILESTONE-AUDIT.md

**Decision:** `v5.0-MILESTONE-AUDIT.md` follows the structure of `v3.0-MILESTONE-AUDIT.md`:
- §0 Executive Summary (headline numbers)
- §1 Requirements Coverage (3-source cross-reference: REQ-ID → traceability → verification claim → code reality → audit verdict)
- §2 Cross-Phase Integration Findings
- §3 9-phase verification trace
- §4 Test baseline
- §5 Deferred items + ship recommendation

**Rationale:** Consistency with prior milestone audits. v4.0 had no MILESTONE-AUDIT.md (Phase 30 was acceptance gate only), so v3.0 is the format reference.

---

## Critical Findings from Prior Phases (carry forward)

### CF-39-01: Phase 36 `test_runner_full_dag.py` is the E2E skeleton

Phase 36-05 already shipped a 13-phase mocked-delegate integration test that runs the real `PHASE_REGISTRY` end-to-end. Phase 39's `test_e2e_degraded.py` extends this by also mocking the 4 clients (gold_team / review_platform / canvas / jimeng) and asserting the canvas subscriber fires + master.mp4 artifact is produced. **Do not re-implement the DAG runner mechanics** — import from `pipeline.runner`.

### CF-39-02: Phase 37 canvas_sync subscriber is the canvas-update path

`plugins/kais_aigc/canvas_sync.py::CanvasSyncSubscriber` is registered as `RunnerConfig.on_phase_complete` callback (Phase 37-02). When the runner finishes a phase, the subscriber fires and calls `canvas_client.save_graph(...)` via HTTP `:10588/api/canvas/v2/save-v2`. Phase 39 mocks the canvas client and asserts the subscriber invokes it — proving CANVAS-IN-HERMES-04 (no openclaw needed).

### CF-39-03: p12_composition + p13_delivery are the master.mp4 producers

Per Phase 36 reference port, `p12_composition` writes the composed asset, `p13_delivery` stamps `master.mp4` as the shippable artifact. In degraded mode (mocked delegate returns empty payloads), both phases must still complete without throwing and produce the placeholder file.

### CF-39-04: 498 tests is the pre-Phase-39 baseline

Phase 38 left v5.0 at 498 tests. Phase 39 adds 1 E2E test file (estimated 3-5 test functions) → expected final baseline ~501-503 tests. The audit doc records the post-Phase-39 number.

---

## Claude's Discretion areas

- **E2E test decomposition**: 1 test function with multiple assertions, or 3-5 smaller functions (one per observable claim: full-DAG-runs, canvas-fires, master.mp4-produced, gates-suppressed-when-disabled). Recommend smaller functions for debuggability.
- **Mock client construction**: use plain `unittest.mock.Mock` or hand-written stub callables. Either is fine — match Phase 36 style.
- **Audit doc grep commands**: choose `grep -ri` or `rg` — must produce machine-checkable zero-hit output for the audit's "Decoupling Checklist" section.

---

## Out of Phase 39 Scope (v6.0+ or operator-side)

- Real GPU E2E (operator side, PROJECT.md "Out of Scope")
- TypeScript migration / CI/CD pipeline (v6.0+)
- Multi-platform export (v6.0+)
- Multi-language dubbing (v6.0+)
- Physical archival of kais-movie-agent repo (operator decision post-ship)
