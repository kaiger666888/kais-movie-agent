/**
 * compliance_gate — Layer 6 final gate (compliance)
 * v2.0 PRFP core_task: pre_check + final compliance (per Phase 8 §2.15)
 *                      (renamed from V8 'delivery' compliance sub-step)
 *
 * Phase 10: V8 pass-through to delivery
 * Phase 12: Native compliance_gate agent + pre_check sub-step
 */
import { NodeBase } from './_node-base.js';

export class ComplianceGate extends NodeBase {
  constructor(spec) {
    super({
      id: 'compliance_gate',
      layer: 6,
      role: 'final_gate',
      v8PassthroughTargets: ['delivery'],
      spec,
    });
  }
}
