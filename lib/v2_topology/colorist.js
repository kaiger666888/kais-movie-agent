/**
 * colorist — Layer 5 post-production parallel (color grading)
 * v2.0 PRFP core_task: 色彩分级 + tone matching to style_genome
 *
 * Phase 10: V8 pass-through to delivery (color sub-step)
 * Phase 12: Native colorist agent
 */
import { NodeBase } from './_node-base.js';

export class Colorist extends NodeBase {
  constructor(spec) {
    super({
      id: 'colorist',
      layer: 5,
      role: 'post_parallel',
      v8PassthroughTargets: ['delivery'],
      spec,
    });
  }
}
