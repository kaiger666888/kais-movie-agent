/**
 * style_genome — Layer 1 intent_parallel (visual DNA)
 * v2.0 PRFP core_task: 提取 + 编码 + 复用视觉 DNA (5D style genome)
 *
 * Phase 10: V8 pass-through to outline-generation (art bible extraction)
 * Phase 11: Native 5D vector encoding (色调/构图/节奏/材质/情感基调)
 */
import { NodeBase } from './_node-base.js';

export class StyleGenome extends NodeBase {
  constructor(spec) {
    super({
      id: 'style_genome',
      layer: 1,
      role: 'intent_parallel',
      v8PassthroughTargets: ['outline-generation'],
      spec,
    });
  }
}
