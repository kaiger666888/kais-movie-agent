/**
 * character_designer — Layer 1 intent_parallel (character identity)
 * v2.0 PRFP core_task: 角色设计 + identity anchor (4D anchor system per STACK §3.4)
 *
 * Phase 10: V8 pass-through to character-generation
 * Phase 11: Native identity_anchor sub-step (4D Blender anchor)
 */
import { NodeBase } from './_node-base.js';

export class CharacterDesigner extends NodeBase {
  constructor(spec) {
    super({
      id: 'character_designer',
      layer: 1,
      role: 'intent_parallel',
      v8PassthroughTargets: ['character-generation'],
      spec,
    });
  }
}
