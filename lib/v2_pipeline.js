/**
 * v2_pipeline.js — v2.0 PRFP DAG pipeline entry point
 *
 * KAI_PIPELINE_MODE env var controls execution:
 *   - 'v8' (default): Delegate to V8 KaisPipeline (lib/pipeline.js) — zero changes to V8
 *   - 'v2':           Run v2.0 PRFP DAG topology via lib/v2_topology/
 *                     Phase 10: all nodes are transparent V8 pass-through
 *                     Phase 11-12: native v2.0 per-node implementations
 *   - 'parallel':     Run both v8 + v2, emit A/B diff JSON to workdir
 *
 * V8 baseline preserved: lib/pipeline.js + lib/phases/index.js UNTOUCHED
 * Per Phase 10 success criteria + HANDOFF-04 baseline_ref 734dc71c9d
 *
 * KaisPipeline imported lazily inside constructor to avoid triggering V8 baseline
 * load chain at module-import time (preserves testability + avoids pre-existing
 * V8 hmac_node.js CommonJS/ESM bug for code paths that only need mode resolver).
 */
import {
  buildNodeRegistry,
  LINEAR_EXECUTION_ORDER,
  TOTAL_NODES,
  LINEAR_NODE_COUNT,
  CONSULTATIVE_NODE_COUNT,
  InvariantBus,
} from './v2_topology/index.js';

let _KaisPipelineCtor = null;
async function _loadKaisPipeline() {
  if (_KaisPipelineCtor) return _KaisPipelineCtor;
  const mod = await import('./pipeline.js');
  _KaisPipelineCtor = mod.KaisPipeline;
  return _KaisPipelineCtor;
}

/**
 * Resolve pipeline mode from env var with safe default.
 * @param {string} [override]
 * @returns {'v8' | 'v2' | 'parallel'}
 */
export function resolvePipelineMode(override = null) {
  const raw = (override || process.env.KAI_PIPELINE_MODE || 'v8').toLowerCase().trim();
  if (raw === 'v2' || raw === 'v2.0') return 'v2';
  if (raw === 'parallel' || raw === 'ab') return 'parallel';
  if (raw === 'v8' || raw === 'v8.0' || raw === 'legacy') return 'v8';
  // Unknown value → safe default to v8
  console.warn(`[v2_pipeline] Unknown KAI_PIPELINE_MODE='${raw}' — defaulting to 'v8'`);
  return 'v8';
}

/**
 * V2Pipeline — wrapper entry point for v2.0 PRFP DAG.
 *
 * Public API matches KaisPipeline (run / getConfig) so callers can swap
 * KaisPipeline → V2Pipeline without code changes.
 */
export class V2Pipeline {
  /**
   * @param {object} config
   * @param {string} [modeOverride] — force mode (bypasses env var, for testing)
   */
  constructor(config, modeOverride = null) {
    this.config = config;
    this.mode = resolvePipelineMode(modeOverride);
    // V8 baseline — instantiated lazily (used directly in v8 mode, as backbone in v2 mode)
    this._v8Pipeline = null;
    // v2.0 DAG registry — instantiated lazily in v2/parallel modes
    this._nodeRegistry = null;
  }

  /**
   * Lazily instantiate V8 KaisPipeline. Avoids triggering V8 baseline import
   * chain at V2Pipeline construction time.
   */
  async _getV8Pipeline() {
    if (!this._v8Pipeline) {
      const KaisPipeline = await _loadKaisPipeline();
      this._v8Pipeline = new KaisPipeline(this.config);
    }
    return this._v8Pipeline;
  }

  /**
   * Sync getter for V8 pipeline (returns null if not yet built).
   * Used by describe() for status without forcing lazy load.
   */
  get v8Pipeline() {
    return this._v8Pipeline;
  }

  /**
   * Get or build the v2.0 node registry (lazy).
   */
  getNodeRegistry() {
    if (!this._nodeRegistry) {
      this._nodeRegistry = buildNodeRegistry();
    }
    return this._nodeRegistry;
  }

  /**
   * Run the pipeline in the configured mode.
   * @param {object} runInputs
   */
  async run(runInputs = {}) {
    if (this.mode === 'v8') {
      return this._runV8(runInputs);
    }
    if (this.mode === 'v2') {
      return this._runV2(runInputs);
    }
    if (this.mode === 'parallel') {
      return this._runParallel(runInputs);
    }
    throw new Error(`[v2_pipeline] Unreachable mode: ${this.mode}`);
  }

  /**
   * V8 mode — pure delegation to KaisPipeline.
   */
  async _runV8(runInputs) {
    const v8 = await this._getV8Pipeline();
    return v8.run(runInputs);
  }

  /**
   * V2 mode — run v2.0 PRFP DAG topology.
   * Phase 10: all 16 nodes are V8 pass-through (transparent delegation).
   * Phase 11-12: nodes execute native v2.0 implementations.
   *
   * Strategy: iterate LINEAR_EXECUTION_ORDER, invoke each node's run()
   * with the V8 pipeline as backbone (for state, workdir, config).
   */
  async _runV2(runInputs) {
    const registry = this.getNodeRegistry();
    const invariants = new InvariantBus();
    const results = {};
    const trace = {
      mode: 'v2',
      schema_version: 'design-2026-06-16-prfp',
      started_at: new Date().toISOString(),
      node_count: TOTAL_NODES,
      linear_node_count: LINEAR_NODE_COUNT,
      consultative_node_count: CONSULTATIVE_NODE_COUNT,
      nodes_executed: [],
      loops_executed: [],
      phase_11_native_layer_0_3: true,
    };

    // Layer 0 — root
    await this._execNode('creative_source', registry, runInputs, results, trace, invariants);

    // Layer 1 — intent parallel (style_genome + character_designer can run in parallel)
    const storyKernel = results.creative_source?.story_kernel || runInputs.story_kernel;
    await this._execNode('style_genome', registry, { story_kernel: storyKernel }, results, trace, invariants);
    await this._execNode('character_designer', registry, { story_kernel: storyKernel }, results, trace, invariants);

    // Layer 2 — narrative + critic loop (screenplay ↔ script_auditor)
    await this._execLoopWithCritic(
      'screenplay', 'script_auditor',
      { story_kernel: storyKernel },
      registry, results, trace, invariants
    );

    // Layer 2 — visual intent
    await this._execNode('cinematographer', registry, {
      screenplay_full: results.screenplay?.screenplay_full,
    }, results, trace, invariants);

    // Layer 3 — prompt injection
    await this._execNode('prompt_injector', registry, {
      visual_intent: results.cinematographer?.visual_intent,
    }, results, trace, invariants);

    // Layer 3 — visual_executor ↔ continuity_auditor loop
    await this._execLoopWithCritic(
      'visual_executor', 'continuity_auditor',
      {
        model_prompts: results.prompt_injector?.model_prompts,
        consistency_context: results.prompt_injector?.consistency_context,
      },
      registry, results, trace, invariants
    );

    // Layer 4-6 nodes remain V8 pass-through at Phase 11 (Phase 12 migrates them)
    // For Phase 11 native scope, we stop here — downstream layers can be optionally delegated
    // to V8 via KAI_PIPELINE_MODE=v8 if full end-to-end execution is needed.
    trace.phase_11_layer_4_6_note = 'Layer 4-6 nodes still V8 pass-through; native migration in Phase 12';

    trace.completed_at = new Date().toISOString();
    trace.invariants_snapshot = invariants.snapshot();

    return {
      mode: 'v2',
      ...results,
      _v2_topology_trace: trace,
    };
  }

  /**
   * Execute a single node (linear). Phase 11+ pattern for native nodes.
   */
  async _execNode(nodeId, registry, inputs, results, trace, invariants) {
    const node = registry[nodeId];
    if (!node) throw new Error(`[v2_pipeline] Node '${nodeId}' not in registry`);

    const startedAt = Date.now();
    const result = await node.run(this, { ...inputs, invariants });
    const elapsedMs = Date.now() - startedAt;

    results[nodeId] = result;
    trace.nodes_executed.push({
      node_id: nodeId,
      layer: node.layer,
      role: node.role,
      is_v2_native: node.isV2Native,
      elapsed_ms: elapsedMs,
      verdict: result.verdict || null,
    });
    return result;
  }

  /**
   * Execute loop_with_critic edge (generator ↔ critic).
   * Per edges.yaml: max iter + cost ceiling + exit condition.
   */
  async _execLoopWithCritic(
    generatorId, criticId,
    baseInputs,
    registry, results, trace, invariants
  ) {
    const generator = registry[generatorId];
    const critic = registry[criticId];
    if (!generator || !critic) {
      throw new Error(`[v2_pipeline] Loop nodes missing: ${generatorId} or ${criticId}`);
    }

    let loopIteration = 0;
    let accumulatedCostYuan = 0;
    let generatorResult = null;
    let criticResult = null;
    const loopTrace = {
      generator: generatorId,
      critic: criticId,
      iterations: [],
    };

    // Loop: max iter is determined by critic's spec (encoded in result.loop_state)
    while (true) {
      // Generator run
      const genInputs = {
        ...baseInputs,
        loop_iteration: loopIteration,
        regeneration_feedback: criticResult?.regeneration_feedback || null,
        invariants,
      };
      // Special-case: pass critic-validated structure to next iter of generator
      if (generatorId === 'screenplay' && criticResult?.regeneration_feedback) {
        genInputs.regeneration_feedback = criticResult.regeneration_feedback;
      }
      if (generatorId === 'visual_executor' && criticResult?.regeneration_feedback) {
        genInputs.regeneration_feedback = criticResult.regeneration_feedback;
      }

      generatorResult = await generator.run(this, genInputs);
      results[generatorId] = generatorResult;

      // Critic run
      const criticInputs = this._buildCriticInputs(generatorId, generatorResult, loopIteration, accumulatedCostYuan, invariants);
      criticResult = await critic.run(this, criticInputs);
      results[criticId] = criticResult;

      accumulatedCostYuan = criticResult?.loop_state?.accumulated_cost_yuan || accumulatedCostYuan;

      loopTrace.iterations.push({
        iter: loopIteration + 1,
        generator_verdict: generatorResult.verdict || null,
        critic_verdict: criticResult.verdict,
        critic_score: criticResult.overall_score || criticResult.continuity_score,
        accumulated_cost_yuan: accumulatedCostYuan,
      });

      // Exit conditions
      if (criticResult.verdict === 'accept') break;
      if (criticResult.verdict === 'escalate_human') break;
      if (criticResult.loop_state?.max_iter_reached) break;

      loopIteration++;
      // Safety: hard cap at 5 iterations regardless of spec
      if (loopIteration >= 5) {
        loopTrace.safety_cap_hit = true;
        break;
      }
    }

    trace.loops_executed.push(loopTrace);
    return { generatorResult, criticResult };
  }

  _buildCriticInputs(generatorId, generatorResult, loopIter, accumulatedCost, invariants) {
    if (generatorId === 'screenplay') {
      return {
        screenplay_full: generatorResult.screenplay_full,
        loop_iteration: loopIter,
        accumulated_cost_yuan: accumulatedCost,
        invariants,
      };
    }
    if (generatorId === 'visual_executor') {
      return {
        generated_visuals: generatorResult.generated_visuals,
        loop_iteration: loopIter,
        accumulated_cost_yuan: accumulatedCost,
        invariants,
      };
    }
    return generatorResult;
  }

  /**
   * Parallel mode — run both v8 + v2, emit A/B diff.
   * Per Phase 10 success criterion 6.
   */
  async _runParallel(runInputs) {
    const v8 = await this._getV8Pipeline();
    const v8Start = Date.now();
    const v8Result = await v8.run(runInputs);
    const v8Duration = Date.now() - v8Start;

    const v2Start = Date.now();
    const v2Result = await this._runV2(runInputs);
    const v2Duration = Date.now() - v2Start;

    const diff = {
      mode: 'parallel',
      schema_version: 'design-2026-06-16-prfp',
      generated_at: new Date().toISOString(),
      v8: {
        duration_ms: v8Duration,
        result_keys: Object.keys(v8Result || {}),
      },
      v2: {
        duration_ms: v2Duration,
        result_keys: Object.keys(v2Result || {}),
        topology_trace: v2Result._v2_topology_trace,
      },
      phase_10_note: 'Phase 10 v2 mode is transparent V8 pass-through — diff is structural (topology manifest) not behavioral.',
    };

    // Write diff JSON to workdir
    try {
      const { writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const workdir = this.config?.workdir || process.cwd();
      const diffPath = join(workdir, 'v2-vs-v8-diff.json');
      await writeFile(diffPath, JSON.stringify(diff, null, 2));
      diff.written_to = diffPath;
    } catch (err) {
      diff.write_error = err.message;
    }

    return { v8: v8Result, v2: v2Result, diff };
  }

  /**
   * Forward config getter to V8 pipeline (API parity). Lazily loads V8.
   */
  async getConfig() {
    const v8 = await this._getV8Pipeline();
    return v8.getConfig();
  }

  /**
   * Describe current mode + topology state (sync — does not trigger lazy loads).
   */
  describe() {
    return {
      mode: this.mode,
      v8_pipeline_ready: !!this._v8Pipeline,
      node_registry_built: !!this._nodeRegistry,
      total_nodes: TOTAL_NODES,
      linear_node_count: LINEAR_NODE_COUNT,
      consultative_node_count: CONSULTATIVE_NODE_COUNT,
      schema_version: 'design-2026-06-16-prfp',
    };
  }
}

/**
 * Convenience factory — picks V2Pipeline or raw V8 KaisPipeline based on env.
 * Use this for new code; existing code can keep importing KaisPipeline directly.
 *
 * Note: returns V2Pipeline wrapper even in v8 mode (with mode='v8') so callers
 * get uniform API. Raw KaisPipeline only needed if you import it directly.
 */
export function createPipeline(config) {
  const mode = resolvePipelineMode();
  return new V2Pipeline(config, mode);
}
