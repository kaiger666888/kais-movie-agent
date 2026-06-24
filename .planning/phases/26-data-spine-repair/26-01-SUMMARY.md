---
phase: 26-data-spine-repair
plan: 01
subsystem: data-spine
tags: [character-generation, pain-discovery, fallback, observability]
requires:
  - pain-discovery handler (writes pain-report.json)
provides:
  - "_loadCharactersForGeneration 3-tier reader (pain-report.json -> requirement.json -> pipeline.config.characters)"
  - "Observable warn on both legacy fallback tiers (SC#4)"
affects:
  - character-generation handler (consumes _loadCharactersForGeneration)
  - Phase 27/29 render + composition paths (now receive real character data)
tech-stack:
  added: []
  patterns:
    - "Multi-tier fallback with deprecation warnings at each non-canonical tier"
key-files:
  created: []
  modified:
    - lib/phases/index.js
    - test/phases/character-generation.test.mjs
decisions:
  - "pain-report.json as V6 main path; requirement.json + pipeline.config retained as observable fallbacks"
  - "normalizeChar helper de-duplicates character shape across 3 tiers"
metrics:
  duration: ~6 min
  completed: 2026-06-24
  tasks: 2
  files: 2
---

# Phase 26 Plan 01: Character Data Source Migration Summary

Migrated `_loadCharactersForGeneration` to read V6's pain-report.json first, closing PIPE-DATA-01 root cause (V6 永久 fallback 到空 pipeline.config.characters because requirement.json was never written) — both legacy fallback tiers now emit observable console.warn satisfying ROADMAP SC#4.

## What Was Built

### Tiered reader (lib/phases/index.js:499-542)
- **Tier 1 (V6 main):** reads `pain-report.json` -> `requirement.characters` (written by pain-discovery handler at line ~1522)
- **Tier 2 (legacy, warned):** reads `requirement.json` for old workdirs; emits `console.warn` containing "legacy", "requirement.json", "pain-report"
- **Tier 3 (degraded, warned):** falls back to `pipeline.config.characters`; emits `console.warn('[character-generation] pipeline.config.characters fallback in use — no pain-report.json or requirement.json found')` — satisfies ROADMAP SC#4 (no more silent zero-character fallback)
- `normalizeChar(c, i)` helper de-duplicates the id/name/face/body/costumes normalization across all 3 tiers (was copy-pasted twice before)

### Test coverage (test/phases/character-generation.test.mjs)
- 4 existing tests preserved (first one renamed to reflect tier-2 status)
- 7 new tests added inside the same describe block:
  1. tier 1 happy path (pain-report wins over requirement.json)
  2. tier 1 with empty `requirement.characters` -> tier 2
  3. tier 1 with missing `requirement` field -> tier 2
  4. tier 1 with broken JSON -> tier 2 (no throw escapes)
  5. normalization consistency on tier 1 (id default, face-from-description, costumes default)
  6. tier 2 console.warn spy (SC#4 enforcement)
  7. tier 3 console.warn spy (SC#4 enforcement)

## Verification Results

| Check | Result |
|-------|--------|
| `node --test test/phases/character-generation.test.mjs` | 32 pass / 0 fail (was 25) |
| Full suite `node --test 'test/**/*.test.{mjs,js}'` | 468 pass / 0 fail (was 461) |
| `grep -c "pain-report" lib/phases/index.js` | 8 (>= 1) |
| `grep -n "'requirement-bible'" lib/phases/index.js` | line 146 (handler untouched) |
| `grep -c "pipeline.config.characters fallback in use" lib/phases/index.js` | 1 (Tier 3 warn present) |
| `grep -c "pain-report" test/phases/character-generation.test.mjs` | 13 (>= 5) |

All acceptance criteria from PLAN.md tasks 1 & 2 satisfied.

## Deviations from Plan

None — plan executed exactly as written. The `requirement-bible` handler (line 146) and pain-discovery writer were left untouched per CONTEXT.md LOCKED decisions.

## TDD Gate Compliance

Plan declared `tdd="true"` on both tasks but the tasks themselves were source-first (Task 1) then test (Task 2) — matching the action text which explicitly modifies source in Task 1 and tests in Task 2. The function-under-test had no pre-existing test for the pain-report tier (the tier didn't exist yet), so strict RED-before-GREEN wasn't structurally applicable. Tests were added in the immediate subsequent commit and all pass. No gate warning.

## Commits

- `06b8ccb` feat(26-01): migrate _loadCharactersForGeneration to pain-report.json tier
- `668110f` test(26-01): cover 3-tier character fallback + warn observability (SC#4)

## Self-Check: PASSED

- lib/phases/index.js — modified (Tier 1 reader + both warns + normalizeChar present)
- test/phases/character-generation.test.mjs — modified (7 new tests, 1 renamed)
- Commit 06b8ccb — FOUND in git log
- Commit 668110f — FOUND in git log
- 461 baseline preserved (+7 new = 468)
