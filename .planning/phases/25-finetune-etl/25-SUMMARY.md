---
phase: 25
plan: 25
subsystem: finetune-etl
tags: [lora, training, pii, poisoning, launch-blocker, regression]
requires:
  - lib/asset-bus.js (finetune-dataset + failed-shots slots, Phase 20)
  - lib/blacklist-engine.js (_cosineSimilarity for outlier detection)
  - lib/hermes-adapter.js (callEmbedding for poisoning prompt embedding)
  - lib/gold-team-client.js (submitTask for LoRA training)
  - test/golden-set/ (Phase 19 framework extended to 60 prompts)
provides:
  - lib/finetune-etl.js (FineTuneETL class with full ETL pipeline)
  - bin/finetune-review.js (operator CLI: list/show/approve/reject/submit-training)
  - test/golden-set/regression-baseline.json (60-prompt baseline framework)
  - delivery handler → FineTuneETL optional trigger (config.finetune.auto_generate)
affects:
  - lib/phases/index.js (delivery handler — optional ETL trigger)
tech-stack:
  added: []
  patterns:
    - launch-blocker (4 required fields enforced hard, not soft)
    - warn-only poisoning detection (mark suspicious, don't block)
    - PII scrubber (Luhn-validated bank card detection)
    - golden-set regression baseline (50-100 prompts, pre/post training diff)
key-files:
  created:
    - lib/finetune-etl.js
    - bin/finetune-review.js
    - test/golden-set/regression-baseline.json
    - test/phases/finetune-etl.test.mjs
    - test/phases/finetune-etl-submit-regression.test.mjs
    - test/phases/finetune-review-cli.test.mjs
    - test/phases/finetune-delivery-integration.test.mjs
  modified:
    - lib/phases/index.js
decisions:
  - Launch blocker contract: 4 review fields enforced hard (throw on missing)
  - PII scrubber: Luhn validation filters false-positive bank card matches
  - Poisoning detection: warn-only (mark suspicious, don't block manifest generation)
  - Golden-set baseline: 60 placeholder prompts (operator must replace with real prompts)
  - Delivery integration: opt-in via config.finetune.auto_generate (default false)
metrics:
  duration: ~12 minutes
  completed: 2026-06-23
  tasks: 5 commits
  files: 7 created + 1 modified
  tests: 79 new (382 baseline → 461 total, all passing)
---

# Phase 25: FineTuningETL Summary

LoRA training manifest ETL with hard launch-blocker review gate, PII scrubber (Luhn-validated), dataset poisoning detection (embedding outlier + pHash near-duplicate + trigger pattern), and 60-prompt golden-set regression baseline.

## What Was Built

### Commit 1: FineTuneETL core (6dec2c8)
- `lib/finetune-etl.js` — FineTuneETL class with `generateManifest`, `approveSample`, `_scrubPii`, `_detectPoisoning`, `_phashSimilarity`, `_luhnValid`, `_meanStd`, `_detectTriggerTokens`
- **Launch blocker**: `approveSample` enforces 4 required fields (copyright_status, pii_scrubbed, label_correct, approved_for_training) — throws on any missing/null/wrong-type
- **PII scrubber**: detects id_card_cn (18-digit), phone_cn (11-digit), email, bank_card (13-19 digit with Luhn validation to filter false positives)
- **Poisoning detection** (SilentBadDiffusion NeurIPS 2023 defense):
  - Outlier: cosine similarity to centroid > 2σ
  - Near-duplicate: pHash similarity > 0.95
  - Trigger pattern: token frequency > 3× median (excludes stopwords)
  - Warn-only — marks suspicious samples, does not block manifest generation
- `test/golden-set/regression-baseline.json` — 60 placeholder prompts across 5 categories (portrait/scene/action/lighting/style/character)
- 43 tests covering B6-01 (generateManifest), B6-03 (approveSample launch blocker), B6-04 (PII), B6-06 (poisoning)

### Commit 2: submitTrainingJob + runGoldenRegression tests (0a8890a)
- `submitTrainingJob` integration via gold-team `submitTask({task_type: 'lora_training'})` — throws when no approved samples or client missing
- `runGoldenRegression` loads `regression-baseline.json`, compares pre/post training scores, flags regressions > 5% with minor/moderate/severe severity
- 14 new tests (B6-02 submit, B6-05 regression)

### Commit 3: Operator CLI bin/finetune-review.js (f30d803)
- Commands: `list-pending` / `show <id>` / `approve <id>` / `reject <id>` / `submit-training` / `help`
- `approve` enforces 4 review fields via CLI flags (`--copyright`, `--pii`, `--label`, `--reviewer`, `--notes`)
- `reject` defaults `approved_for_training=false` with sensible defaults for other fields
- Commands throw testable errors (main() catches and exits 1)
- 18 new CLI tests (parseArgs / toBool / end-to-end flows / error paths)

### Commit 4: Delivery handler integration (22e98de)
- `lib/phases/index.js` delivery handler invokes `FineTuneETL.generateManifest` when `config.finetune.auto_generate=true`
- Default: false (operator opt-in)
- Errors caught and reported as degraded (delivery does not fail)
- Metrics expose `finetune_auto_generated` + `finetune_pending_count`
- 4 new tests (false default / true trigger / empty failed-shots / degraded path)

### Commit 5: SUMMARY + VERIFICATION (this commit)

## Launch Blocker Compliance

Per CONTEXT.md Pitfalls 陷阱 6 (SilentBadDiffusion — data poisoning is irreversible):

| Constraint | Implementation | Verified |
|---|---|---|
| 4 required fields (copyright_status, pii_scrubbed, label_correct, approved_for_training) | `approveSample` throws on any missing/null/wrong-type | 8 tests |
| Missing ANY field rejects sample hard, not soft warning | Hard throw — sample never written to finetune-dataset slot | Yes |
| copyright_status must be valid enum | `ALLOWED_COPYRIGHT_VALUES` array checked | Yes |
| pii_scrubbed / label_correct / approved_for_training must be boolean | Type check throws on non-boolean | Yes |
| PII scrubber detects id_card_cn / phone_cn / email / bank_card | `_scrubPii` with 4 regex patterns | 9 tests |
| Bank card validation uses Luhn (filters false positives) | `_luhnValid` helper | Yes |
| Poisoning detection: outlier (>2σ) + near-dup (pHash >0.95) + trigger (token freq) | `_detectPoisoning` with 3 detection modes | 8 tests |
| Poisoning detection is warn-only (marks suspicious, doesn't block) | Marks via `_markSuspicious`, no throw | Yes |
| Golden-set regression: 50-100 prompts, pre/post training diff | 60-prompt baseline, >5% threshold | Yes |
| Operator CLI: list-pending / approve / reject / show / submit-training | `bin/finetune-review.js` | 18 tests |
| No actual training — only manifest + submit capability | `submitTrainingJob` only submits, no training execution | Yes |
| Degraded: Hermes audit unreachable → best-effort using failed_shots data | `generateManifest` uses only failed-shots slot | Yes |
| All 382 existing tests still pass | 461 total (382 + 79 new), 0 fail | Yes |

## Deviations from Plan

None — plan executed exactly as written. All 5 commits follow the execution_protocol precisely:

1. FineTuneETL core + PII + poisoning ✓
2. LoRA training submit + golden-set regression ✓
3. Operator CLI ✓
4. Delivery handler integration ✓
5. SUMMARY + VERIFICATION ✓

### Minor implementation choices (within Claude's Discretion per CONTEXT.md)

- **Launch blocker error reporting**: Added type validation (boolean check) on top of presence check for extra safety — throws on `pii_scrubbed: 'yes'` (string) not just missing.
- **CLI commands throw instead of `process.exit` directly**: Made testable without `process.exit` monkey-patching. `main()` catches and exits 1.
- **Test isolation**: Commit 2's `submitTrainingJob` tests use fresh workdir per test to avoid `finetune-dataset` slot state leaking between tests.

## Known Stubs

- `test/golden-set/regression-baseline.json` — 60 prompts are illustrative placeholders with synthetic scores. **Operator must**:
  1. Replace with real prompts from past productions
  2. Run baseline against `flux-dev-base-v1` to populate real scores
  3. Re-run baseline after LoRA training and compare
- `_recommendAction` rule mapping is heuristic based on error string matching — operator may need to refine rules after first batch.

## Self-Check: PASSED

Files verified to exist:
- FOUND: lib/finetune-etl.js
- FOUND: bin/finetune-review.js
- FOUND: test/golden-set/regression-baseline.json
- FOUND: test/phases/finetune-etl.test.mjs
- FOUND: test/phases/finetune-etl-submit-regression.test.mjs
- FOUND: test/phases/finetune-review-cli.test.mjs
- FOUND: test/phases/finetune-delivery-integration.test.mjs

Commits verified in git log:
- FOUND: 6dec2c8 (feat: FineTuneETL core)
- FOUND: 0a8890a (test: submit + regression)
- FOUND: f30d803 (feat: CLI)
- FOUND: 22e98de (feat: delivery integration)

Test count verified: 461 total / 461 pass / 0 fail
