# Phase 14: LLM-Creative Wiring — Context

**Gathered:** 2026-06-17
**Mode:** Auto-generated

<domain>
## Phase Boundary

Wire LLM-creative mechanisms per `04-LLM-CREATIVE-DISTILLATION.md`:
1. lib/state/consistency-context.js — 5-section schema (character_knowledge_state + timeline + stakes + spatial_layout + emotional_arc)
2. script_auditor — 6th dim (consistency_context_violations, threshold=0, on_violation=regenerate)
3. creative_source — outputs novelty_constraint (avoid_tropes + require_novelty_in + novelty_score_threshold + selected_template + template_choice_rationale)
4. screenplay — consumes novelty_constraint in prompt (Pattern 3+4+5 per §3.2)
5. 6 narrative arc templates
6. commercial_mode escape hatch flag

</domain>

<decisions>
## Implementation Decisions

### Pattern combinations per §3.3
- creative_source: Pattern 1 + Pattern 3 + Pattern 5
- screenplay: Pattern 2 + Pattern 3 + Pattern 4 + Pattern 6 (regenerate iter only)
- script_auditor: ConStory-Bench detection schema + CONFACTCHECK consistency check

### 6 narrative arc templates per §6.1
- classical_3_act (Field, universal, novelty=0.5)
- save_the_cat_15 (Blake Snyder, universal/长片, novelty=0.4)
- hero_journey_12 (Campbell, universal, novelty=0.4)
- kishotenketsu_4 (起承转合, 短剧+微电影, novelty=0.7)
- 短剧_爆款公式 (platform-tuned, 短剧 only, novelty=0.3)
- anti_structure (experimental, novelty=0.9, requires novelty_score >= 0.8)

### commercial_mode escape hatch
- Flag in creative_source output
- theory_critic sees flag → knows it's commercial compromise
- Documented per §7.4

### consistency_context_violations threshold = 0
- ZERO violations tolerated (per §2.2 spec)
- On violation: regenerate with explicit consistency_context reminder
- Same loop_with_critic edge (max 3 iter, ¥5/iter) — already implemented

</decisions>

<code_context>
## Existing Code Insights

### Reusable (from Phase 11-13)
- lib/v2_topology/creative_source.js — already outputs story_kernel; extend with novelty_constraint
- lib/v2_topology/screenplay.js — already accepts novelty_constraint input; extend prompt templates
- lib/v2_topology/script_auditor.js — 5-dim audit; add 6th dim
- lib/v2_topology/_invariants.js — InvariantBus already has consistency_context slot (stub)

### New files
- lib/state/consistency-context.js — 5-section schema implementation
- lib/v2_topology/_templates.js — 6 narrative arc templates

</code_context>

<specifics>
## Specific Ideas

### consistency_context 5 sections (per §2.1)
1. character_knowledge_state — what each character knows at each scene
2. timeline — event causal chain (causes + effects)
3. stakes — established stakes + payoff expectations
4. spatial_layout — scene spatial invariants
5. emotional_arc — emotional transitions

### novelty_constraint schema (per §7.2)
```yaml
avoid_tropes: [<trope_id>, ...]
require_novelty_in: [<open_dimension>, ...]
novelty_score_threshold: 0.6  # default; 0.8 for anti_structure
selected_template: <template_id>
template_choice_rationale: <CN prose>
```

### Logic-critic 6 dimensions (per §2.2)
1. character_network (existing)
2. plot_holes (existing)
3. dialogue_naturalness (existing)
4. narrative_arc (existing)
5. setup_payoff (existing)
6. consistency_context_violations (NEW) — threshold=0

</specifics>

<deferred>
## Deferred Ideas

- Trope-catalog embedding database (per Open Question §8.1 #1) — FUTURE milestone
- Novelty threshold empirical calibration (per §8.1 #2) — post-v2.0 pilot
- Anti_structure operational definition (per §8.2 #4) — Phase 11 handoff or FUTURE

</deferred>
