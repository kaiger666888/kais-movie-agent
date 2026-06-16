# Phase 10: Topology Wrapper - Context

**Gathered:** 2026-06-17
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped)

<domain>
## Phase Boundary

Create `lib/v2_topology/` directory with 16 node API stubs (one per hermes-agent `nodes.yaml` ID), plus `lib/v2_pipeline.js` as the v2.0 entry point with `KAI_PIPELINE_MODE` env var controlling v8/v2/parallel modes. V8 baseline `734dc71c9d` is preserved as fallback (V8 lib/pipeline.js + lib/phases/index.js untouched).

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure wrapper phase. Use ROADMAP phase goal, success criteria, hermes-agent v2.0 PRFP design (`nodes.yaml` + `edges.yaml`), and existing V8 lib/ conventions to guide decisions.

Key constraints:
- ZERO edits to `lib/pipeline.js` or `lib/phases/index.js` (V8 fallback preserved)
- 16 node stubs MUST transparently pass through to existing V8 implementation
- `KAI_PIPELINE_MODE=v8` runs V8 baseline (default at Phase 10 ship)
- `KAI_PIPELINE_MODE=v2` runs v2.0 topology (transparent pass-through to V8 agents at this phase)
- `KAI_PIPELINE_MODE=parallel` runs both + emits diff for A/B validation

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/pipeline.js` — V8 orchestrator (576 lines), import as-is
- `lib/phases/index.js` — V8 phases dispatcher (1157 lines), import phaseHandlers as-is
- `lib/prompt-injector.js` — already exists, map to `prompt_injector` node directly
- `lib/quality-gate.js` — already exists, map to `quality_gate` node
- `lib/ai-scorer.js` — used by quality gate
- Existing V8 phase IDs: pain-discovery, topic-selection, outline-generation, script-generation, character-generation, scene-generation, script-lock, consistency-guard, cloud-production, final-audio, delivery

### Established Patterns
- ES module pattern (`export class`)
- Native fetch + Node.js built-ins
- `KAI_PIPELINE_MODE` env var convention (NEW for v2.0)
- Hermes + GoldTeam clients for external services

### Integration Points
- `lib/v2_pipeline.js` is the v2.0 entry point
- `lib/v2_topology/index.js` exports all 16 node stubs
- Each node stub delegates to V8 phase handler or lib/ module

</code_context>

<specifics>
## Specific Ideas

Node → V8 mapping (from `kais-migration-matrix.yaml`):

| Node | V8 Phase / lib Module |
|---|---|
| creative_source | pain-discovery + topic-selection (root layer) |
| style_genome | (extract from outline-generation art bible) |
| screenplay | outline-generation + script-generation |
| script_auditor | script-lock (auditor side of loop) |
| character_designer | character-generation |
| cinematographer | scene-generation + cloud-production (preview) |
| prompt_injector | lib/prompt-injector.js |
| visual_executor | cloud-production |
| continuity_auditor | consistency-guard |
| audio_pipeline | final-audio |
| editor | (cloud-production edit sub-step) |
| colorist | (delivery color sub-step) |
| hook_retention | (NEW — short_drama only; stub for Phase 11) |
| quality_gate | lib/quality-gate.js + delivery review |
| compliance_gate | (delivery compliance sub-step) |
| theory_critic | (NEW — consultative; stub for Phase 12) |

</specifics>

<deferred>
## Deferred Ideas

None — pure infrastructure phase, no scope creep.

</deferred>
