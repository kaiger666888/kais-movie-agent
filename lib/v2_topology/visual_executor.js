/**
 * visual_executor — Layer 3 visual asset generation (drawer + animator merged)
 * v2.0 PRFP core_task: 视觉资产生成 (sketch-then-render is instantiation, not user-value per Phase 7 §3.3 D3.4)
 *                      participates in visual_executor ↔ continuity_auditor loop
 *
 * Phase 10: V8 pass-through to cloud-production
 * Phase 11: Native + loop_with_critic edge with continuity_auditor (max 2 iter, ¥50/iter)
 */
import { NodeBase } from './_node-base.js';

export class VisualExecutor extends NodeBase {
  constructor(spec) {
    super({
      id: 'visual_executor',
      layer: 3,
      role: 'generation',
      v8PassthroughTargets: ['cloud-production'],
      spec,
    });
  }
}
