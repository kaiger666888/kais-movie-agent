---
phase: 35-orchestration-skill-skeleton
plan: 04
subsystem: skills/kais-movie-pipeline (references/)
tags: [docs, v8.6, skeleton, references]
requires:
  - Phase 27 (_shared/v86-pipeline-mapping.md canonical ref)
  - Phase 33 (asset_bus.py ASSET_SCHEMA)
  - Phase 34 (review_gates runner_hooks + gates.yaml)
provides:
  - "references/pipeline-dag.md — 13-step V8.6 dependency graph"
  - "references/review-gates.md — 8-gate per-phase mapping"
  - "references/asset-bus-schema.md — slot types + lifecycle"
  - "references/expert-mapping.md — 13 phase ↔ 15 expert mapping"
affects:
  - "Phase 35-03 (p01-p03 phase modules — consume slot schema from asset-bus-schema.md)"
  - "Phase 36 (p04-p13 port — refines all 4 docs per ROADMAP Phase 36 SC#4)"
tech-stack:
  added: []
  patterns:
    - "_shared/ ref skeleton convention (Source/Copyright/Last-verified headers)"
    - "Mermaid graph + ASCII fallback table for DAG"
    - "Cross-reference single source of truth (_shared/v86-pipeline-mapping.md)"
key-files:
  created:
    - "/data/workspace/hermes-agent/skills/kais-movie-pipeline/references/pipeline-dag.md"
    - "/data/workspace/hermes-agent/skills/kais-movie-pipeline/references/review-gates.md"
    - "/data/workspace/hermes-agent/skills/kais-movie-pipeline/references/asset-bus-schema.md"
    - "/data/workspace/hermes-agent/skills/kais-movie-pipeline/references/expert-mapping.md"
  modified: []
decisions:
  - "Skeleton form per ROADMAP SC#5 — structure complete, refined per-phase content in Phase 36"
  - "Single source of truth = _shared/v86-pipeline-mapping.md; all 4 docs cross-reference it"
  - "Phase 35 scope clearly marked in each doc (p01-p03 only); Phase 36 scope marked (p04-p13)"
  - "asset-bus-schema.md documents both Phase 33 PRESERVED slots and Phase 35 NEW slots per D-35-05"
metrics:
  duration: "~25 min"
  completed: "2026-06-25"
  tasks_completed: 2
  files_created: 4
  loc: 408
---

# Phase 35 Plan 04: References/ Skeleton Docs Summary

**One-liner:** 4 skeleton reference docs for kais-movie-pipeline skill — V8.6 13-step DAG + 8-gate mapping + asset-bus slots + 13×15 phase-expert mapping — all sourced from `_shared/v86-pipeline-mapping.md` as single source of truth, ready for Phase 36 port-engineer refinement.

---

## What Was Built

Four markdown files under `hermes-agent/skills/kais-movie-pipeline/references/`:

### 1. `pipeline-dag.md` (123 lines)
- Mermaid dependency graph + ASCII fallback table for all 13 V8.6 Steps
- Atomic operations table (§1-§6 merges)
- Phase 35 vs Phase 36 scope table (p01-p03 shipped vs p04-p13 future)
- Refresh cadence (quarterly re-verification per `_shared/` convention)
- Documents `parallel_shots: 4` conditional branch (Step 10)

### 2. `review-gates.md` (79 lines)
- 8-gate table reproduced verbatim from `_shared/v86-pipeline-mapping.md`
- Hard vs Soft gate classification (compliance_gate / script_auditor <65% / continuity_auditor 4-dim = hard; theory_critic = soft)
- Gate implementation pointer to Phase 34 `runner_hooks` (pause_for_review / resolve_direct / resume_from_callback / mark_episode_failed)
- Phase 35 gate scope: only Gates 1/2/3 reachable (p01-p03)

### 3. `asset-bus-schema.md` (119 lines)
- Slot format types (JSON atomic vs JSONL append-only)
- Phase 33 PRESERVED slots (4 — creative-history / failed-shots / finetune-dataset / review-outcomes)
- Phase 35 NEW slots (6 per D-35-05 — requirement / topic-kernel / hook-design / story-framework / script-draft / audit-report)
- Phase 36 future slots (~20 placeholder names, flagged TBD)
- Envelope schema (`{value, derived_from, content_hash, schema_version}`) + naming convention (kebab-case, semantic names)

### 4. `expert-mapping.md` (87 lines)
- 13-row phase ↔ expert mapping table (Phase 35 = p01-p03 filled, Phase 36 = p04-p13 marked)
- 15 active movie-experts bullet list (one-line role each) sourced from `movie-experts/README.md` Bucket 1
- delegate_task invocation pattern per CONTEXT D-35-07 (synchronous, goal/context/toolsets schema)
- Cross-cutting experts note (theory_critic / compliance_gate / production / documentary_maker / animation_studio)

---

## Verification

Per PLAN.md `<verify>` blocks:

**Task 1** (3 docs):
- All 3 files exist
- All 3 have `**Source:**` header
- All 3 reference `Step 1`
- All 3 have See Also cross-links

**Task 2** (asset-bus-schema.md):
- File exists
- Contains `topic-kernel` (Phase 35 new slot)
- Contains `creative-history` (Phase 33 preserved slot)
- Contains `PRESERVED` (Phase 33 section marker)

All acceptance criteria PASSED.

---

## Deviations from Plan

None — plan executed exactly as written.

No auto-fixes (Rules 1-3) needed. No architectural decisions (Rule 4) surfaced. No authentication gates encountered.

**Wave 1 zero-overlap honored:** 35-01's `SKILL.md` and 35-02's `pipeline/` were already present in the skill directory (parallel Wave 1 work); 35-04 did NOT modify or commit them. Created `references/` subdir independently as scoped.

---

## TDD Gate Compliance

N/A — plan is `type: execute` with `tdd="false"` on all tasks. No RED/GREEN/REFACTOR gate required.

---

## Self-Check

**Files created:**
- `/data/workspace/hermes-agent/skills/kais-movie-pipeline/references/pipeline-dag.md` — FOUND
- `/data/workspace/hermes-agent/skills/kais-movie-pipeline/references/review-gates.md` — FOUND
- `/data/workspace/hermes-agent/skills/kais-movie-pipeline/references/asset-bus-schema.md` — FOUND
- `/data/workspace/hermes-agent/skills/kais-movie-pipeline/references/expert-mapping.md` — FOUND

**Commits:**
- `8e54bedff` (docs(35-04): kais-movie-pipeline references/ — 4 skeleton docs) — FOUND

**Self-Check: PASSED**
