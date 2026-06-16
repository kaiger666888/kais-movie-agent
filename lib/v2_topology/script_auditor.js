/**
 * script_auditor — Layer 2 critic node (screenplay ↔ script_auditor loop)
 * v2.0 PRFP: bidirectional loop with screenplay, exit score >= 0.75 across 5 dimensions
 *            (Phase 14 adds 6th dim: consistency_context_violations)
 *
 * Phase 10: V8 pass-through to script-lock
 * Phase 11: Native loop_with_critic edge (max 3 iter, ¥5/iter ceiling)
 */
import { NodeBase } from './_node-base.js';

export class ScriptAuditor extends NodeBase {
  constructor(spec) {
    super({
      id: 'script_auditor',
      layer: 2,
      role: 'critic',
      v8PassthroughTargets: ['script-lock'],
      spec,
    });
  }
}
