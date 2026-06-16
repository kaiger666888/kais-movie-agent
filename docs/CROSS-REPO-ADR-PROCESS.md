# Cross-Repo ADR Process — kais-movie-agent ↔ hermes-agent

**Status:** Active (Phase 13)
**Co-owners:** kais-movie-agent (implementation layer) + hermes-agent (design-intent layer)

---

## Co-Ownership Matrix (per HANDOFF-05)

| Repo | Role | Owns |
|---|---|---|
| **kais-movie-agent** | Implementation layer | lib/ (V8 baseline + v2.0 topology), production code, GPU integration, webhook/Telegram |
| **hermes-agent** | Design-intent layer | skills/, design docs (v2-pipeline-design suite), nodes.yaml, edges.yaml, narrative theory |
| **Co-owned (DAG structure)** | Both must sign off | nodes.yaml topology, edges.yaml edges, NODE-SPECS structure |

---

## When Cross-Repo ADR Is Required

A cross-repo ADR is required when proposing changes to:

1. **Structural DAG changes** — adding/removing/renaming nodes in `nodes.yaml`
2. **Edge structure changes** — adding/removing/retyping edges in `edges.yaml`
3. **Node spec structure changes** — changing the 15 spec fields schema
4. **Layer reorganization** — moving nodes between layers
5. **Form-scope changes** — adding/removing form-specific nodes (e.g., hook_retention)

---

## When Cross-Repo ADR Is NOT Required

These changes can be made unilaterally by the implementing repo:

1. **Instantiation changes** (model swaps) — dated annex only, per NODE-08
2. **Implementation refactors** within a node (no spec change)
3. **Bug fixes** that don't change behavior contract
4. **Documentation** that doesn't change contracts
5. **Test additions**
6. **Performance optimizations** that preserve semantics
7. **v2.0 frozen DAG** — no structural changes during v2.0 milestone (by design)

---

## ADR Template

```markdown
# ADR-XXXX: [Title]

**Status:** proposed | accepted | rejected | superseded by ADR-YYYY
**Date:** YYYY-MM-DD
**Repos affected:** kais-movie-agent, hermes-agent

## Context
[Why is this decision needed? What problem does it solve?]

## Decision
[What is being decided? Be specific about structural changes.]

## Consequences
- **kais-movie-agent impact:** [impl changes needed]
- **hermes-agent impact:** [design doc updates needed]
- **Migration cost:** [estimate]
- **Backward compatibility:** [preserved or broken]

## Alternatives Considered
[What else was on the table? Why rejected?]

## Sign-off
- [ ] kais-movie-agent owner: @kaiger666888
- [ ] hermes-agent owner: [TBD]
```

---

## ADR Lifecycle

1. **Propose:** Open ADR markdown file in both repos (or shared workspace)
2. **Discuss:** Both owners review; iterate on the proposal
3. **Accept/Reject:** Both owners must sign off (no unilateral structural changes)
4. **Implement:** Coordinated implementation across repos
5. **Verify:** Both repos' tests pass; cross-repo integration validated
6. **Archive:** ADR marked `accepted` or `superseded` as appropriate

---

## v2.0 Frozen DAG

For the v2.0 milestone (and through extended deprecation), the v2.0 PRFP DAG is **frozen**:

- `nodes.yaml`: 16 nodes locked (15 linear + 1 consultative)
- `edges.yaml`: 28 edges locked (17 linear + 2 loop_with_critic + 2 human_gate + 1 consultative + 6 cross_cutting_invariant)
- `schema_version: design-2026-06-16-prfp` — referenced in PROJECT.md frontmatter

No structural changes will be entertained during v2.0. Future structural evolution requires:
1. v2.0 milestone completion
2. Production validation (live runs, budget analysis)
3. New cross-repo ADR proposing v2.1 or v3.0

---

## Current References

- **kais-movie-agent baseline:** `734dc71c9d5ff20d55dbd0255f367030962cf329` (this repo at v2.0 design time)
- **hermes-agent baseline:** `85965c393f44deae29a833f2ae98af66d26548ce` (hermes-agent at v2.0 PRFP design ship)
- **Design source of truth:** `/data/workspace/hermes-agent/.planning/research/v2-pipeline-design/`
- **Migration matrix:** `kais-migration-matrix.yaml` (non-binding recommendation)
- **Handoff plan:** `07-HANDOFF-PLAN.md` (non-binding recommendation)

---

## Process Notes

- v2.0 milestone uses **manual ADR** (no tooling yet). FUTURE-K3 (out of v2.0 scope) will provide tooling.
- Live statistical GO/NO-GO (FUTURE-08) requires both repos + actual budget — deferred to operator at v2.0 close.
- Cross-repo ADRs are **collaborative**, not adversarial — both owners share the goal of correct DAG evolution.

---

*Process version: 1.0 (Phase 13 of v2.0 milestone)*
*Last updated: 2026-06-17*
