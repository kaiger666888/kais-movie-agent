/**
 * screenplay — Layer 2 narrative node
 * v2.0 PRFP core_task: 大纲 + 场景列表 + 对白生成
 *
 * Phase 10: V8 pass-through to outline-generation + script-generation
 * Phase 11: Native v2.0 + consumes novelty_constraint (Phase 14)
 */
import { NodeBase } from './_node-base.js';

export class Screenplay extends NodeBase {
  constructor(spec) {
    super({
      id: 'screenplay',
      layer: 2,
      role: 'narrative',
      v8PassthroughTargets: ['outline-generation', 'script-generation'],
      spec,
    });
  }
}
