# V8 Deprecation Notice

**Deprecation Date:** 2026-06-17 (kais-movie-agent Phase 13)
**V8 Baseline Reference:** `734dc71c9d5ff20d55dbd0255f367030962cf329`
**Replacement:** v2.0 PRFP DAG topology (`KAI_PIPELINE_MODE=v2`)
**Source of Truth:** hermes-agent v2-pipeline-design suite (`design-2026-06-16-prfp`)

---

## Summary

The V8 20-step linear pipeline is **deprecated** as of Phase 13. The default `KAI_PIPELINE_MODE` is now `v2` (the v2.0 PRFP DAG topology). V8 remains available via explicit `KAI_PIPELINE_MODE=v8` for backward compatibility.

## What's Deprecated

### 1. OpenClaw single-LLM orchestration (per Phase 7 §3.1 D1.4)
**V8 pattern:** Single-LLM orchestration through OpenClaw bridge, all LLM calls routed through stdio MCP.
**v2.0 replacement:** Layered LLM calls per node — each node makes its own LLM dispatch decisions based on its core_task. No single-LLM bottleneck.

### 2. Sketch-then-render强制两阶段 (per Phase 7 §3.3 D3.4)
**V8 pattern:** Forced two-phase visual generation: sketch first, then render.
**v2.0 replacement:** `composition_lock` (user-value layer) + instantiation annex (engineering detail). The two-phase split was instantiation, not user-value — folded into single cinematographer node.

### 3. Toonflow review platform (per Phase 11 §5 of migration matrix)
**V8 pattern:** External Toonflow review platform for human review of generated content.
**v2.0 replacement:** `quality_gate` + `compliance_gate` nodes (Layer 6 final gates). Quality_gate does Murch 6-dim + form-specific scoring; compliance_gate does CN regulation pre_check + final merged.

### 4. Hard-coded model names in canonical node specs (per NODE-08 + PITFALLS §1.3)
**V8 pattern:** Hard-coded model names (flux-dev, wan14b, CosyVoice2, Sora, Kling, Veo) embedded in pipeline configuration as if they were canonical.
**v2.0 replacement:** Canonical node specs in `lib/v2_topology/` are **model-agnostic** (verified by lint check). Model names appear ONLY in dated annex: `docs/v2-model-annex-2026-06-16.md`. The DAG must remain valid even if every model is swapped.

### 5. 20-step linear pipeline structure
**V8 pattern:** 20 sequential steps (Steps 1-11 creative立项 + Steps 12-20 production execution).
**v2.0 replacement:** 16-node hybrid topology (15 linear + 1 consultative):
- Layer 0: root
- Layer 1: intent parallel (style + character)
- Layer 2: narrative + visual intent (with loop_with_critic edges)
- Layer 3: visual execution (with loop_with_critic edges)
- Layer 4: audio
- Layer 5: post parallel + form-specific
- Layer 6: final gates + consultative

---

## Backward Compatibility Guarantee

`KAI_PIPELINE_MODE=v8` continues to work for the duration of v2.0. Code paths:
- `lib/pipeline.js` — V8 orchestrator (preserved)
- `lib/phases/index.js` — V8 phases dispatcher (preserved)
- All V8 lib/ modules (preserved)

To migrate from V8 to v2.0:
1. Set `KAI_PIPELINE_MODE=v2` (now the default as of Phase 13)
2. Use `lib/v2_pipeline.js` `V2Pipeline` class (or `createPipeline()` factory)
3. Outputs are equivalent at Phase 10-12; native v2.0 behavior at Phase 13+

---

## Known V8 Issues (NOT v2.0 regressions)

### Pre-existing: lib/gold-team-client.js → shared/hmac_node.js CommonJS/ESM mismatch
- **Symptom:** `SyntaxError: The requested module '../shared/hmac_node.js' does not provide an export named 'sign'` when V8 modules loaded via ESM
- **Cause:** `shared/hmac_node.js` uses CommonJS (`require`); `lib/gold-team-client.js` imports via ESM (`import`)
- **Status:** Pre-existing V8 baseline bug; NOT addressed in v2.0 scope
- **Workaround:** v2.0 lazy-loads V8 modules; tests run without triggering this bug
- **Fix path:** Separate V8 maintenance issue (would require touching V8 baseline)

---

## Migration Path

| From | To | Action |
|---|---|---|
| V8 default | v2.0 default | Already done in Phase 13 (default flipped) |
| V8 explicit (`KAI_PIPELINE_MODE=v8`) | v2.0 explicit | Unset env var or change to `KAI_PIPELINE_MODE=v2` |
| V8 webhook + Telegram notifications | Same (preserved) | V8 lib/pipeline.js unchanged; notifications work in both modes |
| V8 Toonflow integration | quality_gate + compliance_gate | V8 Toonflow code remains but is bypassed in v2.0 mode |
| V8 sketch-then-render | cinematographer composition_lock | V8 path remains; v2.0 uses single-node flow |

---

## Future (Beyond v2.0)

After v2.0 ships and a deprecation period (target: 6 months post-v2.0 GA):
- V8 lib/pipeline.js + lib/phases/index.js may be removed entirely
- `KAI_PIPELINE_MODE=v8` may be removed
- V8-specific lib/ modules (Toonflow integration, sketch-then-render helpers) may be archived

This is **not** in v2.0 scope.

---

## References

- v2.0 design source: `/data/workspace/hermes-agent/.planning/research/v2-pipeline-design/`
- Migration matrix: `kais-migration-matrix.yaml`
- V8 architecture: `docs/V8-ARCHITECTURE.md` (frozen at baseline ref)
- Phase 13 plan: `.planning/phases/13-v8-legacy-cleanup-cross-repo-validation/`
