/**
 * quality_gate — Layer 6 final gate (quality)
 * v2.0 PRFP core_task: story-score + technical quality check
 *                      replaces V8 Toonflow review platform (per Phase 11 §5)
 *
 * Phase 10: V8 pass-through to lib/quality-gate.js + delivery review
 * Phase 12: Native quality_gate agent (replaces Toonflow)
 */
import { NodeBase } from './_node-base.js';

export class QualityGate extends NodeBase {
  constructor(spec) {
    super({
      id: 'quality_gate',
      layer: 6,
      role: 'final_gate',
      v8PassthroughTargets: ['delivery'],
      spec,
    });
  }
}
