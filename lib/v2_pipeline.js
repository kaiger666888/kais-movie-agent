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
    const results = {};
    const trace = {
      mode: 'v2',
      schema_version: 'design-2026-06-16-prfp',
      started_at: new Date().toISOString(),
      node_count: TOTAL_NODES,
      linear_node_count: LINEAR_NODE_COUNT,
      consultative_node_count: CONSULTATIVE_NODE_COUNT,
      nodes_executed: [],
      phase_10_passthrough: true, // All nodes V8 pass-through at Phase 10
    };

    // Phase 10 strategy: since all nodes are V8 pass-through, just delegate
    // the entire V8 pipeline run and emit a topology trace for A/B validation.
    // Phase 11+ will replace this with real per-node iteration.
    const v8 = await this._getV8Pipeline();
    const v8Result = await v8.run(runInputs);
    results.v8_result = v8Result;

    // Build topology manifest (proves 16 nodes are wired even if not yet executed natively)
    for (const nodeId of LINEAR_EXECUTION_ORDER) {
      const node = registry[nodeId];
      trace.nodes_executed.push({
        node_id: nodeId,
        layer: node.layer,
        role: node.role,
        is_v2_native: node.isV2Native,
        v8_passthrough_targets: node.v8PassthroughTargets,
        phase_10_status: node.isV2Native ? 'native' : 'passthrough',
      });
    }

    trace.completed_at = new Date().toISOString();
    trace.result_loc = 'v8_result (Phase 10 passthrough)';

    return {
      mode: 'v2',
      ...results,
      _v2_topology_trace: trace,
    };
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
