/**
 * theory_critic — Layer 6 consultative vertical (creator-pulled, not auto-invoked)
 * v2.0 PRFP: consultative edge per META-06 — not a linear blocking gate
 *            creator pulls theory_critic for narrative-theory consultation on demand
 *
 * NEW consultative node — no V8 precedent.
 *
 * Phase 10: Stub only (no-op when not invoked); Phase 12 implements consultative API
 */
import { NodeBase } from './_node-base.js';

export class TheoryCritic extends NodeBase {
  constructor(spec) {
    super({
      id: 'theory_critic',
      layer: 6,
      role: 'consultative',
      v8PassthroughTargets: [], // NEW consultative node
      spec,
    });
  }

  async run(pipeline, inputs = {}) {
    // Phase 10 stub — consultative API (creator-pulled) implemented in Phase 12
    return {
      node_id: this.id,
      phase_10_stub: true,
      consultative: true,
      message: 'theory_critic consultative API deferred to Phase 12',
      inputs_preserved: inputs,
    };
  }
}
