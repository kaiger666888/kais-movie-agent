/**
 * continuity_auditor — Layer 3 critic (visual_executor ↔ continuity_auditor loop)
 * v2.0 PRFP: bidirectional loop with visual_executor,
 *            exit identity_match >= 0.85 AND axis_compliance = 100%
 *
 * Renamed from V8 'consistency-guard' per migration matrix.
 *
 * Phase 10: V8 pass-through to consistency-guard
 * Phase 11: Native loop_with_critic edge + character_anatomy_check sub-step
 */
import { NodeBase } from './_node-base.js';

export class ContinuityAuditor extends NodeBase {
  constructor(spec) {
    super({
      id: 'continuity_auditor',
      layer: 3,
      role: 'critic',
      v8PassthroughTargets: ['consistency-guard'],
      spec,
    });
  }
}
