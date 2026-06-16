# Phase 11: Migrate Layer 0-3 Agents — Context

**Gathered:** 2026-06-17
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure migration phase)

<domain>
## Phase Boundary

Refactor 9 Layer 0-3 node agents from V8 pass-through to native v2.0 PRFP per-node implementations per `02-NODE-SPECS.md §2.1-§2.10`. Implement two loop_with_critic edges (`screenplay ↔ script_auditor`, `visual_executor ↔ continuity_auditor`). Create `prompt_injector` natively. Establish cross-cutting invariant pattern.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
Per Phase 10 pattern, native v2.0 nodes:
- Set `isV2Native = true` on migrated nodes
- Override `run()` method with native implementation
- Implement spec's `core_task` directly using Node.js native fetch + existing lib/ modules where reusable
- Emit structured outputs per `io_contract` (story_kernel, style_genome_5d, etc.)
- For loop_with_critic: implement explicit iteration counter + cost ceiling + exit condition

### Loop semantics (per edges.yaml)
- `screenplay ↔ script_auditor`: max 3 iter, ¥5/iter ceiling, exit score ≥ 0.75 across 5 dimensions
- `visual_executor ↔ continuity_auditor`: max 2 iter, ¥50/iter ceiling, exit identity_match ≥ 0.85 AND axis_compliance = 100%

### Native v2.0 nodes (9):
1. `creative_source` (Layer 0 root) — kernel mining from creator_anecdote + lived_experience_seed
2. `style_genome` (Layer 1) — 5D vector encoding (色调/构图/节奏/材质/情感基调)
3. `screenplay` (Layer 2) — narrative expansion + loop participant
4. `script_auditor` (Layer 2 critic) — 5-dim quantitative audit
5. `character_designer` (Layer 1) — identity asset + 4D anchor
6. `cinematographer` (Layer 2) — composition_lock + sub-steps (mise_en_scene + shot_list + preview)
7. `prompt_injector` (Layer 3 NEW) — cross-call consistency context
8. `visual_executor` (Layer 3) — generation + loop participant
9. `continuity_auditor` (Layer 3 critic) — identity + axis + wardrobe + spatial + plot continuity

### Reusable V8 modules (import as-is)
- lib/llm.js, lib/hermes-adapter.js, lib/hermes-client.js — LLM calls
- lib/gold-team-client.js — GPU scheduling
- lib/asset-bus.js — asset state propagation
- lib/prompt-injector.js — existing injector (extend or wrap)
- lib/composition-engine.js, lib/scene-reverb-manager.js — composition helpers

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- lib/v2_topology/_node-base.js — base class (Phase 10)
- lib/hooks/ — V8 story-score + audience match + topic generation (LLM hooks)
- lib/asset-bus.js — JSON asset propagation (V8 invariant bus)
- lib/composition-engine.js — composition lock helpers
- lib/llm.js — LLM dispatch wrapper
- lib/hermes-adapter.js — callLLM wrapper

### Established Patterns
- ES module pattern (export class)
- All nodes have async run(pipeline, inputs) signature
- Outputs land in workdir via pipeline.writeFile (V8 pattern)

### Integration Points
- v2_pipeline.js _runV2 will iterate nodes natively once all migrated
- Cross-cutting invariant bus: style_genome + character_designer outputs → all downstream consumers
- Loop_with_critic edges: v2_pipeline orchestrates max-iter loop

</code_context>

<specifics>
## Specific Ideas

### Cross-cutting invariant pattern (success criterion 6)
The V8 pattern uses JSON asset bus. v2.0 requires explicit invariant ownership:
- style_genome owns 5D style vector → flows to cinematographer, prompt_injector, visual_executor, editor, colorist, audio_pipeline
- character_designer owns identity asset → flows to cinematographer, prompt_injector, visual_executor, continuity_auditor

Implementation: Each native node appends its outputs to a shared `invariants` object passed through `inputs.invariants`. Downstream nodes consume via `inputs.invariants.style_genome_5d` etc.

### prompt_injector native (success criterion 5)
NEW node, no V8 precedent. Implements cross-call consistency context per Phase 8 §2.7:
- Inputs: visual_intent + style_genome + character_assets
- Outputs: model_prompts + consistency_context
- Strategy: build prompt template that carries style + identity invariants across calls

</specifics>

<deferred>
## Deferred Ideas

- LLM-creative wiring (consistency_context + novelty_constraint) — Phase 14
- Layer 4-6 migration (audio_pipeline, editor, colorist, hook_retention, quality_gate, compliance_gate, theory_critic) — Phase 12
- V8 cleanup — Phase 13

</deferred>
