/**
 * audio_pipeline — Layer 4 audio (5 sub-steps merged + lip_sync sub-step)
 * v2.0 PRFP core_task (per Phase 8 §2.9):
 *   voicer + lip_sync + composer + foley + mixer
 *
 * Phase 10: V8 pass-through to final-audio
 * Phase 12: Native 5 sub-step orchestration
 */
import { NodeBase } from './_node-base.js';

export class AudioPipeline extends NodeBase {
  constructor(spec) {
    super({
      id: 'audio_pipeline',
      layer: 4,
      role: 'audio_parallel',
      v8PassthroughTargets: ['final-audio'],
      spec,
    });
  }
}
