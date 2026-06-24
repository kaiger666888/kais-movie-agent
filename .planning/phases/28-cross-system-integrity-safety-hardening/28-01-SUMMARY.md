---
phase: 28-cross-system-integrity-safety-hardening
plan: 01
subsystem: canvas-content-sync
tags: [integrity, http-api, degrade, canvas-graph, race-condition]
requires:
  - lib/canvas-client.js (CanvasClient.saveCanvas)
provides:
  - lib/canvas-content-sync.js saveGraph via HTTP API (single write path)
  - test/phases/canvas-content-sync-http.test.mjs (mock-fetch regression)
affects:
  - lib/canvas-content-sync.js syncScreenplayToCanvas (transitive caller of saveGraph)
  - lib/canvas-content-sync.js syncCharactersToCanvas (transitive caller of saveGraph)
tech-stack:
  added: []
  patterns:
    - "degrade-on-unreachable via try/catch + console.warn greppable marker"
    - "test-only __test_saveGraph export (established Phase 27 P02 pattern)"
key-files:
  created:
    - test/phases/canvas-content-sync-http.test.mjs
  modified:
    - lib/canvas-content-sync.js
decisions:
  - "D-PIPE-INTEGRITY-01 honored: write path migrated to HTTP API, read path stays sqlite direct"
  - "Degrade warn marker '[canvas-sync] HTTP API unreachable' chosen for greppability (T-28-04)"
  - "CANVAS_API_BASE_URL env override added to match canvas-sync-hook.js default"
metrics:
  duration: 3.4min
  completed: 2026-06-24
  tasks: 2
  files: 2
---

# Phase 28 Plan 01: Canvas saveGraph HTTP API Migration Summary

Migrated `lib/canvas-content-sync.js` `saveGraph` from direct `execSync('sqlite3 ... UPDATE')` DB writes to `CanvasClient.saveCanvas` HTTP API (`POST /api/canvas/v2/save-v2`), eliminating the canvasGraph double-write race (PIPE-INTEGRITY-01) where kais-aigc-platform truncates `content`→150 / `signature_shot`→200 and overwrites our repo's complete data.

## What Was Built

### Task 1: saveGraph HTTP API migration + degrade-on-unreachable (commit 8b6e80b)

- **Replaced** the sqlite UPDATE direct write path with `new CanvasClient({ baseUrl, projectId, episodesId }).saveCanvas(graph)`.
- **Preserved** the `graph.meta.updatedAt = Date.now()` stamping before send (existing behavior).
- **Degrade path**: HTTP failures (fetch reject / 5xx / AbortSignal timeout) are caught, emit `console.warn('[canvas-sync] HTTP API unreachable, skipping canvas write: <reason>')`, and `saveGraph` resolves without throwing — pipeline continues (T-28-02, T-28-04 mitigations).
- **loadGraph UNCHANGED** — still uses `execSync('sqlite3 ... SELECT')` direct read (read-only, no migration per D-PIPE-INTEGRITY-01).
- **Removed unused imports** `writeFileSync` / `readFileSync` (writeFileSync was only used by old saveGraph; readFileSync was already dead).
- **Added** `CANVAS_API_BASE_URL` env override constant matching canvas-sync-hook.js default (`http://192.168.71.176:10588`).
- **Added** test-only `__test_saveGraph` named export (established Phase 27 P02 pattern).
- **Updated** top-of-file JSDoc to document the write path migration + read-path retention.
- **Signature preserved** `async function saveGraph(projectId, episodesId, graph)` — no caller changes needed for `syncScreenplayToCanvas` / `syncCharactersToCanvas`.

### Task 2: mock-fetch regression test (commit f396395)

Created `test/phases/canvas-content-sync-http.test.mjs` with 4 test cases:

1. **Happy path**: verifies `fetch` called exactly once, URL ends `/api/canvas/v2/save-v2`, method `POST`, body contains `projectId: 1800`, `episodesId: 2`, the graph object, and `graph.meta.updatedAt` stamped; no degrade warn fires.
2. **Degrade on network error** (fetch rejects with `ECONNREFUSED`): asserts saveGraph resolves without throwing and `console.warn` called with `[canvas-sync] HTTP API unreachable` + `ECONNREFUSED`.
3. **Degrade on HTTP 500**: asserts saveGraph resolves without throwing and warn mentions HTTP 500.
4. **Degrade on AbortSignal timeout**: asserts saveGraph resolves without throwing and warn mentions timeout.

Tests use `beforeEach`/`afterEach` to install/restore `globalThis.fetch`, `console.warn`, and `process.env.CANVAS_API_BASE_URL` stubs deterministically.

## Verification

All gates from `28-01-PLAN.md` `<verification>` block:

| Gate | Expected | Actual |
|------|----------|--------|
| `grep -c "execSync.*UPDATE" lib/canvas-content-sync.js` | 0 | 0 ✓ |
| `grep -c "saveCanvas\|save-v2" lib/canvas-content-sync.js` | ≥1 | 2 ✓ |
| `grep -c "HTTP API unreachable" lib/canvas-content-sync.js` | ≥1 | 1 ✓ |
| `node --test test/phases/canvas-content-sync-http.test.mjs` | all pass | 4/4 pass ✓ |
| `npm test` baseline preserved | ≥483 | 487/487 pass ✓ (483 baseline + 4 new) |
| `loadGraph` retains sqlite direct read | present | present ✓ |

## Scope Boundary Honored

No touches to protected subsystems (git diff `main~2..HEAD`):
- motion-preview: none
- character-gen: none
- scene-gen: none
- composition: none
- consistency-guard: none
- data-spine: none

Only `lib/canvas-content-sync.js` (modified) and `test/phases/canvas-content-sync-http.test.mjs` (created).

## Decisions Made

1. **HTTP write + sqlite read asymmetry** — locked by D-PIPE-INTEGRITY-01. Write path races with platform; read path is safe and fast, so left as sqlite direct.
2. **Degrade warn marker `[canvas-sync] HTTP API unreachable`** — greppable for audit (T-28-04 mitigation). Matches Phase 26/27 degrade-warn convention.
3. **No mutex / serialization** — single HTTP write path inherently avoids last-write-wins race; no extra coordination needed.
4. **Test-only export** `__test_saveGraph` instead of testing via `syncScreenplayToCanvas` — direct unit test of saveGraph is cleaner (no sqlite dependency in test, no screenplay fixture needed). Established Phase 27 P02 pattern.

## Deviations from Plan

None — plan executed exactly as written. No Rule 1-4 deviations triggered.

## Known Stubs

None — no placeholder data or unwired code paths introduced.

## Threat Flags

None — no new security surface beyond what the plan's `<threat_model>` already covers. T-28-01 (Tampering, race condition) mitigated by HTTP single write path. T-28-02 (DoS on unreachable) mitigated by degrade-warn-no-throw. T-28-03 (info disclosure in warn) accepted per plan. T-28-04 (repudiation on silent skip) mitigated by greppable warn marker.

## Self-Check: PASSED

- `lib/canvas-content-sync.js` modified: FOUND
- `test/phases/canvas-content-sync-http.test.mjs` created: FOUND
- commit `8b6e80b`: FOUND
- commit `f396395`: FOUND
