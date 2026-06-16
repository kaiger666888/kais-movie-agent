/**
 * v2_topology NodeBase — shared base class for all v2.0 PRFP DAG nodes
 *
 * Per hermes-agent v2.0 PRFP design (nodes.yaml schema_version: design-2026-06-16-prfp)
 * Phase 10 strategy: transparent pass-through to existing V8 phaseHandlers.
 * Phase 11-12 will replace pass-through with full per-node implementations.
 *
 * Lazy import phaseHandlers: avoids triggering V8 baseline load chain
 * (lib/phases/index.js → lib/gold-team-client.js → broken shared/hmac_node.js
 *  CommonJS/ESM mismatch — pre-existing V8 baseline bug, not in Phase 10 scope).
 */

let _phaseHandlersCache = null;

async function _loadPhaseHandlers() {
  if (_phaseHandlersCache) return _phaseHandlersCache;
  const mod = await import('../phases/index.js');
  _phaseHandlersCache = mod.phaseHandlers;
  return _phaseHandlersCache;
}

export class NodeBase {
  /**
   * @param {object} opts
   * @param {string} opts.id — canonical node ID from nodes.yaml
   * @param {number} opts.layer — DAG layer (0-6)
   * @param {string} opts.role — semantic role (root, intent_parallel, etc.)
   * @param {string[]} opts.v8PassthroughTargets — V8 phase IDs to delegate to
   * @param {object} [opts.spec] — full node spec from nodes.yaml
   */
  constructor({ id, layer, role, v8PassthroughTargets = [], spec = null }) {
    this.id = id;
    this.layer = layer;
    this.role = role;
    this.v8PassthroughTargets = v8PassthroughTargets;
    this.spec = spec;
    this.isV2Native = false; // Phase 11-12 set true per-node when migrated
  }

  /**
   * Resolve V8 phase handler(s) for this node.
   * Returns the handler function or null if no passthrough target exists.
   * @param {string} v8PhaseId
   */
  async _resolveV8Handler(v8PhaseId) {
    const phaseHandlers = await _loadPhaseHandlers();
    const handler = phaseHandlers[v8PhaseId];
    if (!handler) {
      throw new Error(
        `[v2_topology:${this.id}] V8 phase handler '${v8PhaseId}' not found in lib/phases/index.js — ` +
        `check v8PassthroughTargets mapping`
      );
    }
    return handler;
  }

  /**
   * Pass through to V8 phase handler.
   * Phase 10 default. Phase 11-12 nodes override `run()` with native v2.0 implementation.
   *
   * @param {object} pipeline — V8 pipeline instance (KaisPipeline)
   * @param {object} inputs — node inputs per io_contract
   * @param {string} [v8PhaseIdOverride] — explicit V8 phase ID (defaults to first passthrough target)
   */
  async run(pipeline, inputs = {}, v8PhaseIdOverride = null) {
    if (this.isV2Native) {
      throw new Error(
        `[v2_topology:${this.id}] isV2Native=true but base run() called — ` +
        `subclass must override run() with native v2.0 implementation`
      );
    }

    const target = v8PhaseIdOverride || this.v8PassthroughTargets[0];
    if (!target) {
      throw new Error(
        `[v2_topology:${this.id}] No v8PassthroughTargets configured and isV2Native=false — ` +
        `Phase 11-12 migration pending for this node`
      );
    }

    const handler = await this._resolveV8Handler(target);
    return handler.call(pipeline, inputs);
  }

  /**
   * Node metadata for debugging / DAG introspection.
   */
  describe() {
    return {
      id: this.id,
      layer: this.layer,
      role: this.role,
      isV2Native: this.isV2Native,
      v8PassthroughTargets: this.v8PassthroughTargets,
      specVersion: this.spec?.schema_version || 'design-2026-06-16-prfp',
    };
  }
}
