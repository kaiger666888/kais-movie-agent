---
phase: 10-phases-handler
plan: 01
subsystem: phases-handlers
tags: [architecture, stub, handlers, v6-alignment]
requires:
  - lib/pipeline.js (PHASES array — single source of truth for 20 phase ids)
  - lib/hermes-client.js (HermesClient — VALID_PHASES whitelist still V4.1 only)
  - lib/continuity-auditor.js (auditContinuity — used by consistency-guard stub)
  - lib/composition-engine.js (CompositionEngine — instantiated by delivery stub)
  - lib/hooks/index.js (generateTopics, assessQuality)
  - lib/hermes-adapter.js (callLLM — degraded in script-generation stub)
provides:
  - "15 new V6 phase handlers in lib/phases/index.js phaseHandlers object"
  - "100% coverage of PHASES array ids (20/20) — no more silent fallback for V6 phases"
  - "Stub JSON output files for every V6 phase (pain-report.json, selected-topic.json, outline-candidates.json, selected-outline.json, script-candidates.json, selected-script.json, character-candidates.json, soul-pack.json, scene-candidates.json, geometry-bed.json, script-locked.json, consistency-pass.json, video_tasks.json, audio-stems.json, quality-report.json)"
affects:
  - "pipeline.runPhase() now hits a real handler for every V6 phase id"
  - "Downstream phases no longer crash with ENOENT on missing outputFiles"
  - "shared/hmac_node.js now usable from both ESM import and CJS require"
tech-stack:
  added: []
  patterns:
    - "V4.1 7-step handler skeleton (hermes client → decide → business → audit → collector → return) applied to 15 V6 stubs"
    - "Three-layer degrade (service-level / task-level / phase-level) with console.warn — no fatal throw on service unavailable"
    - "Stub contract: { _stub: true, _phase, _generatedAt, _pendingRealImplementation: 'phase-X' }"
key-files:
  created: []
  modified:
    - lib/phases/index.js
    - shared/hmac_node.js
decisions:
  - "Each V6 handler uses the same 7-step skeleton as V4.1 (requirement-bible / spatio-temporal-script) — hermes decide with degrade fallback, stub data write, hermes audit fire-and-forget, EvaluationCollector.record"
  - "Stubs write empty arrays/objects only — NO fabricated content (no fake dialogues, scenes, character descriptions). _pendingRealImplementation field points to the phase that will deliver real implementation"
  - "consistency-guard stub calls auditContinuity(visuals=[]) to prove the call chain; real DINOv2 scoring deferred to Phase 12 per CONTEXT.md"
  - "delivery stub instantiates CompositionEngine + calls assessQuality but does not enforce quality gate (real quality gate deferred to Phase 13)"
  - "Rule 3 fix scope: hmac_node.js converted to proper ESM (node:crypto import) with CJS-interop fallback — fixing the preexisting CJS/ESM ambiguity was required to unblock verification of this plan"
metrics:
  duration: 434s
  completed: 2026-06-23
  tasks_completed: 2
  files_modified: 2
---

# Phase 10 Plan 01: 补完 15 个 V6 stub handler Summary

One-liner: Added 15 V6 phase handlers (pain-discovery through delivery) to `lib/phases/index.js` following the V4.1 7-step skeleton with hermes-decide degrade, stub JSON writes, and EvaluationCollector recording — achieving 100% coverage of the PHASES array (25 total handlers: 10 V4.1 preserved + 15 new V6). Also fixed a preexisting CJS/ESM import ambiguity in `shared/hmac_node.js` that was blocking all ESM imports of the handler module.

## What Was Built

### 15 New V6 Stub Handlers (lib/phases/index.js)

Each handler follows the identical 7-step skeleton borrowed from V4.1 (`requirement-bible` / `spatio-temporal-script`):

1. **`_makeHermesClient(pipeline)`** + `HERMES_DEFAULTS['<phase-id>']`
2. **`_hermesDecide`** wrapped in try/catch — HermesClient.VALID_PHASES still only lists the 10 V4.1 ids, so new V6 ids throw `Invalid phase '<phase-id>'` and the handler degrades to HERMES_DEFAULTS with `console.warn('[<phase-id>] hermes decide 降级: ... (将在 Phase 11 修复)')`
3. **Stub data write** to the phase's declared `outputFiles` (JSON only — directory-only outputs like `assets/characters/` are ensured via `mkdir recursive`)
4. **`_hermesAudit`** fire-and-forget
5. **`EvaluationCollector.record`** wrapped in try/catch — never throws fatal
6. **Return** `{ summary: stubData, metrics: { stubbed: true, _pendingRealImplementation: 'phase-X' } }`

| Phase ID | outputFile | `_pendingRealImplementation` |
|----------|------------|------------------------------|
| pain-discovery | pain-report.json | phase-11 |
| topic-selection | selected-topic.json | phase-11 |
| outline-generation | outline-candidates.json | phase-11 |
| outline-selection | selected-outline.json | phase-11 |
| script-generation | script-candidates.json | phase-11 |
| script-selection | selected-script.json | phase-11 |
| character-generation | character-candidates.json | phase-14 |
| character-selection | soul-pack.json | phase-14 |
| scene-generation | scene-candidates.json | phase-14 |
| scene-selection | geometry-bed.json | phase-14 |
| script-lock | script-locked.json | phase-11 |
| consistency-guard | consistency-pass.json | phase-12 |
| cloud-production | video_tasks.json | phase-15 |
| final-audio | audio-stems.json | phase-15 |
| delivery | quality-report.json | phase-13 |

### Preexisting hmac_node.js CJS/ESM Ambiguity Fix (Rule 3)

**File:** `shared/hmac_node.js`

**Preexisting issue (not caused by this plan):** The project root has `"type": "module"` in package.json (ESM). The old `shared/hmac_node.js` used `const crypto = require('crypto')` and `module.exports = {...}` (CJS) — but `lib/gold-team-client.js:11` did `import { sign, verify } from '../shared/hmac_node.js'`. When loaded as ESM, Node rejected `require()`, producing `SyntaxError: The requested module '../shared/hmac_node.js' does not provide an export named 'sign'`. This blocked ALL dynamic `import('./lib/phases/index.js')` and therefore blocked this plan's verification step.

**Fix:** Rewrote `shared/hmac_node.js` as proper ESM with `import crypto from 'node:crypto'`, named `export function sign/verify/getSecret`, and a CJS interop block guarded by `typeof module !== 'undefined'` for legacy callers. Verified both `import` and `require` paths continue to work.

## Verification Results

**Task 1 — handler presence (PHASES array coverage):**
```
✓ All 15 new V6 handlers present
✓ All 10 V4.1 handlers preserved
Total handlers: 25
```

**Task 2 — degraded-mode execution (no hermes / gold-team / jimeng / LLM configured):**
```
All 15 new handlers executed without fatal in degraded mode
All outputFiles created
_stub marker present
```

Observed degrade behavior (expected — services not configured in test env):
- `[script-generation] LLM 降级: LLM 调用失败: 401` → stub wrote empty candidates array
- `[pipeline] Review submission failed ... 401 Unauthorized` → review-platform-client degrade, pipeline continues
- `[quality-gate] LLM 调用失败: 401` (6x) → delivery handler's assessQuality call degraded, stub still written
- All 15 phases completed with `event: phase_completed` log

**Existing V4.1 handlers:** No unguarded `throw` paths found in V4.1 handlers (the only explicit `throw` is `composition`'s quality gate, which is intentional). No V4.1 hardening changes needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Fixed CJS/ESM import ambiguity in shared/hmac_node.js**
- **Found during:** Task 1 verification
- **Issue:** `lib/gold-team-client.js:11` does `import { sign, verify } from '../shared/hmac_node.js'` but the target file used CommonJS `module.exports` + `require('crypto')`. Because the project root has `"type": "module"`, Node's ESM loader rejected the CJS syntax: `SyntaxError: The requested module '../shared/hmac_node.js' does not provide an export named 'sign'`. This was a **preexisting** error unrelated to this plan's edits — confirmed by reverting changes and reproducing. It blocked all dynamic `import('./lib/phases/index.js')` and thereby blocked verification of the plan's own success criteria.
- **Fix:** Rewrote `shared/hmac_node.js` as proper ESM with `import crypto from 'node:crypto'`, named exports, and a CJS interop fallback guarded by `typeof module !== 'undefined' && module.exports`. Verified both ESM `import` and CJS `require` work.
- **Files modified:** `shared/hmac_node.js`
- **Commit:** 4abed05

No other deviations — plan executed exactly as written otherwise.

## Success Criteria Status

- [x] **ARCH-01 SC-1:** `phaseHandlers` covers all 20 PHASES array ids (15 new V6 + 5 already-present V4.1 ids that overlap with PHASES = composition, geometry-bed, spatio-temporal-script, seed-skeleton, motion-preview, ai-preview)
- [x] **ARCH-01 SC-2:** Any new V6 phase calling `runPhase()` hits a real handler — no more silent fallback / no-handler
- [x] Each stub handler writes its declared `outputFiles` JSON with `_stub: true` marker
- [x] Degrade chain (hermes / gold-team / jimeng / LLM / review unavailable) does not throw fatal
- [x] All 10 existing V4.1 handlers preserved (no code changes to V4.1 handler bodies)

## Decisions Made

1. **7-step skeleton:** Every new handler mirrors the V4.1 `requirement-bible` / `spatio-temporal-script` structure (hermes decide + audit + EvaluationCollector.record) rather than a slimmed-down stub, so Phase 11/12/13/14/15 can swap the stub body for real implementation without touching the surrounding structure.

2. **No fabricated content:** Stubs write empty arrays/objects only. The plan's `<action>` section strictly forbade inventing dialogue/scenes/characters, and we honored that — `candidates: []`, `pain_points: []`, `episodes: []`, etc. The only stub fields with non-empty data are metadata (`_stub`, `_phase`, `_generatedAt`, `_pendingRealImplementation`).

3. **`_pendingRealImplementation` mapping** follows the CONTEXT.md `<deferred>` section: phases 11 (pain-topic-outline-script-lock), 12 (consistency-guard), 13 (delivery quality gate), 14 (character/scene generation), 15 (cloud-production / final-audio).

4. **`auditContinuity` call in consistency-guard** uses `visuals: []` so it returns early with `{ scores: {}, overall: 0, passed: false, findings: [] }` — no LLM/DINOv2 calls. This proves the import chain works without doing real (expensive) scoring work that Phase 12 owns.

5. **`assessQuality` call in delivery** does invoke LLM (which 401'd in test env) but the handler catches the error and still writes the stub `quality-report.json`. The CompositionEngine is instantiated but `runQualityCheck` is only checked for existence — the actual call is deferred to Phase 13.

## Known Stubs

All 15 new handlers are intentional stubs — this is the entire purpose of plan 10-01. Each will be replaced by real implementation in its assigned future phase. The `_pendingRealImplementation` field in every stub output file makes this contract explicit and machine-readable.

| Stub file | Future phase |
|-----------|--------------|
| lib/phases/index.js — pain-discovery handler body | Phase 11 |
| lib/phases/index.js — topic-selection handler body | Phase 11 |
| lib/phases/index.js — outline-generation handler body | Phase 11 |
| lib/phases/index.js — outline-selection handler body | Phase 11 |
| lib/phases/index.js — script-generation handler body | Phase 11 |
| lib/phases/index.js — script-selection handler body | Phase 11 |
| lib/phases/index.js — script-lock handler body | Phase 11 |
| lib/phases/index.js — consistency-guard handler body | Phase 12 |
| lib/phases/index.js — delivery handler body | Phase 13 |
| lib/phases/index.js — character-generation handler body | Phase 14 |
| lib/phases/index.js — character-selection handler body | Phase 14 |
| lib/phases/index.js — scene-generation handler body | Phase 14 |
| lib/phases/index.js — scene-selection handler body | Phase 14 |
| lib/phases/index.js — cloud-production handler body | Phase 15 |
| lib/phases/index.js — final-audio handler body | Phase 15 |

## TDD Gate Compliance

N/A — this plan is `type: execute`, not `type: tdd`. No RED/GREEN/REFACTOR cycle required. Verification was done via runtime execution of all 15 new handlers in degraded mode (see Verification Results above).

## Self-Check: PASSED

- FOUND: lib/phases/index.js (modified)
- FOUND: shared/hmac_node.js (modified)
- FOUND: .planning/phases/10-phases-handler/10-01-SUMMARY.md (created)
- FOUND: commit 4abed05 in git log
- FOUND: 25 handlers in phaseHandlers object (15 new V6 + 10 V4.1 preserved)
