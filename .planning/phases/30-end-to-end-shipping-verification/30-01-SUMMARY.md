---
phase: 30-end-to-end-shipping-verification
plan: 01
subsystem: e2e-verification
tags: [testing, e2e, degraded-mode, shipping, sc1]
dependency_graph:
  requires:
    - "Phase 29 P01 composition handler (master.mp4 writer)"
    - "Phase 29 P02 delivery handler (_composition.delivered_mastermp4 marker)"
  provides:
    - "Automated SC#1 verification — degraded E2E produces master.mp4"
  affects: []
tech_stack:
  added: []
  patterns:
    - "v2.0 Phase 17 degraded config pattern (degradedMode + qualityGate.bypass + 127.0.0.1:0 endpoints)"
key_files:
  created:
    - test/e2e/degraded-shipping.test.mjs
  modified: []
decisions:
  - "Rule 3 deviation: subprocess CLI invocation replaced with direct Pipeline construction — plan's interface contract did not match codebase (no --to flag; degraded mode is config-driven, not env-driven)"
  - "Test asserts SC#1 via the established v2.0 degraded pattern rather than architectural CLI changes (Rule 4 — out of scope for verification-only phase)"
metrics:
  duration: 5min
  completed: 2026-06-24
  tasks: 1
  files: 1
acceptance_scs: [SC1, SC3]
---

# Phase 30 Plan 01: Degraded E2E Shipping Test Summary

End-to-end test verifying the v4.0 pipeline in degraded mode flows through all 20 stages (composition PIPE-COMPOSE-01 + delivery PIPE-COMPOSE-02) and produces the shippable master.mp4 placeholder plus the operator-visibility `_composition.delivered_mastermp4` marker.

## What Was Built

**`test/e2e/degraded-shipping.test.mjs`** — 3-test suite:

1. **Happy path** — spawns the Pipeline in a temp workdir with degraded config (all external services at `127.0.0.1:0` → ECONNREFUSED → degraded fallbacks). Asserts `result.success === true`, `master.mp4` exists at `join(workdir, 'master.mp4')`, soft-asserts `web-preview.mp4` (degrade-tolerant per PIPE-COMPOSE-02).
2. **No repo pollution** — asserts the unique `EP30-E2E-SMOKE` episode id does not appear under repo `output/` after the run.
3. **Degraded marker** — parses `quality-report.json` and asserts `_composition.delivered_mastermp4 === true`.

Hermetic isolation: `fs.mkdtempSync(os.tmpdir(), 'kmai-e2e-30-')` + `fs.rmSync(..., {recursive:true, force:true})` teardown (T-30-01 mitigation). Subprocess timeout 120s guards hangs (T-30-02 mitigation); actual run completes in ~10s.

## Deviations from Plan

### Rule 3 — Blocking Issue: Plan interface contract did not match codebase

**Found during:** Task 1 (test design)

**Issue:** The plan's `<interfaces>` block specified the test invoke `bin/pipeline.js run --episode <EP> --to delivery` with `DEGRADED=1` env as a `child_process.spawnSync` subprocess. The actual codebase:

- `bin/pipeline.js` has **no `--to` flag** — it runs the full pipeline (all 20 phases).
- Degraded mode is **config-object-driven**, not env-driven. `DEGRADED=1` is not read anywhere in `lib/`.
- The composition quality-gate bypass at `lib/phases/index.js:1484` requires `pipeline.config.degradedMode === true` OR `pipeline.config.qualityGate?.bypass === true`. These are only settable via the `Pipeline` constructor config object.
- Without these flags, composition's quality gate **throws** on the guaranteed-fail degraded score (`质量门控未通过`) and aborts the run before delivery — so the test could never reach the master.mp4 assertion.
- The CLI exposes no config-injection flag (no `--config`, no `--degraded`).

**Why not Rule 4 (architectural):** Adding a `--config` or `DEGRADED=1` env handler to `bin/pipeline.js` would be an architectural CLI surface change, out of scope for a verification-only phase. The plan explicitly states Phase 30 "不修复任何 bug（前 4 个 phase 已修），仅做集成验证 + 文档."

**Fix:** The test constructs `Pipeline` directly with the established v2.0 Phase 17 degraded config pattern (mirrors the sibling `test/e2e/pipeline-degraded-e2e.test.mjs`), exercising the **real composition + delivery handler bodies in `lib/phases/index.js`**. SC#1 is still verified end-to-end: composition writes `master.mp4`, delivery reads it and stamps the marker. The plan's "NOT import" intent (exercise the real handler path, not mock it) is preserved — the test does not mock composition or delivery; it runs the actual handler code.

**Files modified:** `test/e2e/degraded-shipping.test.mjs` (documented in test header).

**Commit:** `494bbe9`

### Plan Success Criterion Refinement: Baseline count semantics

**Issue:** The plan stated "Full suite still passes: npm test (baseline 508 → 509+)". The npm test glob (`test/**/*.test.mjs`) historically **does not include** the `test/e2e/` subdirectory — the sibling `pipeline-degraded-e2e.test.mjs` (committed in Phase 17) is also absent from the 508 count.

**Verified:**
- `npm test` baseline: **508/508 pass** (unchanged — no regression).
- `node --test 'test/e2e/**/*.test.mjs'` baseline: was **7 tests** (Phase 17 sibling only), now **10 tests** (+3 from this plan).

Both baselines are healthy. The plan's "509+" literal is incorrect; the e2e suite grows 7 → 10.

## Acceptance Criteria Status

| SC | Description | Status |
|----|-------------|--------|
| SC#1 | Degraded E2E produces master.mp4 | **VERIFIED** — Test 1 + Test 3 pass; pipeline run completed in 10.3s with master.mp4 produced and marker set |
| SC#3 | Test baseline preserved + new tests added | **VERIFIED** — npm test 508/508 (no regression); e2e suite 7 → 10 |

## Verification Results

```
▶ Phase 30 SC#1: degraded E2E shipping produces master.mp4
  ✔ runs all 20 stages in degraded mode and produces master.mp4 (10325.012ms)
  ✔ does not pollute the repo working tree (smoke episode dir absent) (0.276ms)
  ✔ quality-report.json carries _composition.delivered_mastermp4 === true (0.152ms)
✔ tests 3, pass 3, fail 0
```

`npm test`: **508/508 pass** (baseline preserved, no regression).

## Threat Model Mitigations

| Threat | Mitigation | Verified |
|--------|------------|----------|
| T-30-01 (Tampering — temp workdir cleanup) | `fs.rmSync(workdir, {recursive:true, force:true})` in `after()` hook + unique `EP30-E2E-SMOKE` id | Yes — Test 2 confirms no repo pollution |
| T-30-02 (DoS — pipeline subprocess timeout) | `E2E_TIMEOUT_MS = 120_000` (test timeout); actual run ~10s | Yes — Test 1 completes in 10.3s |

## TDD Gate Compliance

This plan is a **verification-only test plan** — the feature under test (composition master.mp4 writer + delivery marker) was shipped in Phase 29 P01/P02. There is no implementation step; the test asserts existing shipped behavior. A single `test(...)` commit is appropriate and sufficient. No RED/GREEN separation applies because there is no new production code to write.

- Commit `494bbe9`: `test(30-01): degraded E2E shipping test asserts master.mp4 + delivery marker`

## Known Stubs

None. The test runs against real composition + delivery handlers (no mocks of the handlers under test). Degraded-mode placeholders (0-byte master.mp4) are the **expected** production behavior in degraded mode, not test stubs.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes introduced — the test only consumes existing handler outputs.

## Self-Check: PASSED

- FOUND: `test/e2e/degraded-shipping.test.mjs` (146 lines)
- FOUND: commit `494bbe9` in `git log`
- FOUND: 3/3 tests pass via `node --test test/e2e/degraded-shipping.test.mjs`
- FOUND: npm test 508/508 (no regression)
- FOUND: e2e suite 7 → 10 (baseline grows)
