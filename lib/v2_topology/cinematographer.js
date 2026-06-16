/**
 * cinematographer — Layer 2 visual intent (composition_lock per Phase 7 §3.4 D3.4)
 * v2.0 PRFP core_task: scene-design + shooting-script + storyboard + cinematography planning
 *                      folded into composition_lock (single user-value layer)
 *
 * Phase 10: V8 pass-through to scene-generation
 * Phase 11: Native composition_lock with sub-steps (mise_en_scene + shot_list + composition_lock_preview)
 */
import { NodeBase } from './_node-base.js';

export class Cinematographer extends NodeBase {
  constructor(spec) {
    super({
      id: 'cinematographer',
      layer: 2,
      role: 'visual_intent',
      v8PassthroughTargets: ['scene-generation'],
      spec,
    });
  }
}
