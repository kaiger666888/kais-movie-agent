/**
 * hook_retention — Layer 5 form-specific (短剧 only)
 * v2.0 PRFP core_task: 短剧 hook design + pacing feedback loop with screenplay
 *                      (form_scope: short_drama per edges.yaml)
 *
 * NEW node — no V8 precedent.
 *
 * Phase 10: Stub only (returns null); Phase 12 implements natively
 * Phase 12: Native + form_scope=short_drama gating + feedback edge to screenplay
 */
import { NodeBase } from './_node-base.js';

export class HookRetention extends NodeBase {
  constructor(spec) {
    super({
      id: 'hook_retention',
      layer: 5,
      role: 'form_specific',
      v8PassthroughTargets: [], // NEW node, no V8 precedent
      spec,
    });
  }

  async run(pipeline, inputs = {}) {
    // Phase 10 stub — form-specific gating + native impl in Phase 12
    return {
      node_id: this.id,
      phase_10_stub: true,
      form_scope: 'short_drama',
      message: 'hook_retention native implementation deferred to Phase 12',
      inputs_preserved: inputs,
    };
  }
}
