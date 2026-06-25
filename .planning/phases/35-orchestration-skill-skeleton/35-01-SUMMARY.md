---
phase: 35-orchestration-skill-skeleton
plan: 01
subsystem: orchestration-skill
tags: [skill, scaffold, hermes-agent, yaml-frontmatter, v86-pipeline, keystone]
requires:
  - Phase 32 (kais_aigc clients) — SHIPPED
  - Phase 33 (pipeline_state) — SHIPPED
  - Phase 34 (review_gates) — SHIPPED
provides:
  - "kais-movie-pipeline SKILL.md — discoverable manifest for /kais-movie-pipeline slash command"
  - "pipeline/ Python package markers — import root for runner (35-02) and phases (35-03)"
affects:
  - "hermes-agent skill loader (path-based discovery picks up SKILL.md automatically)"
  - "Phase 35-02 runner.py (imports pipeline.phases.PHASE_REGISTRY)"
  - "Phase 35-03 phase modules (registered in PHASE_REGISTRY)"
  - "Phase 35-05 discovery tests (mock scan finds this SKILL.md)"
tech-stack:
  added: []
  patterns:
    - "YAML frontmatter convention (mirror hook_retention/SKILL.md)"
    - "Path-based skill discovery (recursive scan, no plugin registration)"
    - "Phase 35 Wave 1 zero-overlap parallel plans (35-01 SKILL.md / 35-02 runner / 35-04 refs)"
key-files:
  created:
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/SKILL.md
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/__init__.py
    - /data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/__init__.py
  modified: []
decisions:
  - "D-35-01 confirmed: skill at hermes-agent/skills/kais-movie-pipeline/"
  - "D-35-02 confirmed: path-based discovery, external_dirs config documented in operator-setup section"
  - "related_skills ordered by DAG-step (hook_retention first as Step 1 entry) rather than alphabetical"
  - "8-gate table embedded verbatim in SKILL.md (canonical source _shared/v86-pipeline-mapping.md)"
metrics:
  duration: ~6 min
  completed: 2026-06-26
  tasks: 2/2
  files_created: 3
---

# Phase 35 Plan 01: Kais-Movie-Pipeline SKILL.md Scaffold Summary

Valid YAML-frontmatter skill manifest + Python package markers turning the V8.6 13-step short-drama pipeline into a discoverable hermes-agent skill (/kais-movie-pipeline). Keystone artifact for v5.0 — without SKILL.md the skill is invisible to skills_list / skill_view.

## What Was Built

**Task 1 — SKILL.md (263 lines):**
- Frontmatter with `name=kais-movie-pipeline`, `description` (≤1024 chars, EN+CN), `version=0.1.0`, `metadata.hermes.{tags (9), related_skills (15 movie-experts), expert_id, metrics (4), pipeline.{version:v86, step_count:13, gate_count:8, parallel_shots:4}}`
- `prerequisites.tools` lists 8 plugin tool names (advisory, documents runtime contract)
- Body sections: H1 bilingual title, When to use, References table (4 ref docs), Pipeline DAG (Mermaid + ASCII fallback), Phase ↔ Expert Mapping (13 rows), Review Gates (8 rows), Asset Bus Schema (slot lifecycle table), Runner (invocation + resume semantics + parallel_shots=4), Operator Setup (external_dirs YAML snippet + 6 env vars), What NOT to do (8 anti-patterns)
- Trigger words mirror existing kais-movie-agent SKILL.md list + add `kais-movie-pipeline` and `V8.6`
- Validation script from PLAN.md `<verify>` block passes: frontmatter parses, all mandatory fields present, body has all 8 required sections, external_dirs snippet present

**Task 2 — Python package markers:**
- `pipeline/__init__.py`: package docstring identifying this as the orchestration package
- `pipeline/phases/__init__.py`: `PHASE_REGISTRY: list[dict] = []` (empty stub for 35-03 to populate) + `__all__ = ["PHASE_REGISTRY"]`
- Verification script passes: both files import cleanly, PHASE_REGISTRY is an empty list

## Deviations from Plan

### Parallel-Wave Compatible Output (not a deviation — by design)

The `pipeline/__init__.py` and `pipeline/phases/__init__.py` files were already present in the working tree when Task 2 began, created by the parallel Wave 1 plan 35-02 (runner.py) which also needed the package markers to exist for its imports. Per Wave 1 zero-overlap design, these files are shared infrastructure.

- **Found during:** Task 2 (before Write)
- **Issue:** Files existed with content from parallel 35-02 plan; my Write tool returned "File has not been read yet" error
- **Resolution:** Verified existing files satisfy Task 2 done criteria exactly (PHASE_REGISTRY is empty list, both import cleanly, validation script passes). Committed the existing content as-is — functionally identical to my intended content. The existing `pipeline/__init__.py` docstring additionally mentions `runner` module, which is strictly more informative than my draft.
- **Files affected:** pipeline/__init__.py, pipeline/phases/__init__.py
- **Rule:** Wave 1 parallel-plan compatible output (not Rules 1-4)

No Rules 1-4 deviations. Plan executed exactly as written.

## Authentication Gates

None.

## Known Stubs

None. SKILL.md is fully populated (no placeholder text). The empty `PHASE_REGISTRY = []` is intentional per plan (35-03 populates it) and documented as such in the file's docstring.

## Self-Check: PASSED

- FOUND: /data/workspace/hermes-agent/skills/kais-movie-pipeline/SKILL.md (263 lines, frontmatter validates)
- FOUND: /data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/__init__.py
- FOUND: /data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/__init__.py
- FOUND: commit f125024d3 in hermes-agent repo (feat(skills): kais-movie-pipeline SKILL.md scaffold Phase 35-01)
