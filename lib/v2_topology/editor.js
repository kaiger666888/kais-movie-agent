/**
 * editor — Layer 5 post-production parallel (editing)
 * v2.0 PRFP core_task: 剪辑节奏 + shot assembly
 *                      participates in editor → human_review_gate_2 edge
 *
 * Phase 10: V8 pass-through to cloud-production (edit sub-step)
 * Phase 12: Native editor agent + human gate integration
 */
import { NodeBase } from './_node-base.js';

export class Editor extends NodeBase {
  constructor(spec) {
    super({
      id: 'editor',
      layer: 5,
      role: 'post_parallel',
      v8PassthroughTargets: ['cloud-production'],
      spec,
    });
  }
}
