/**
 * creative_source — Layer 0 root node (intent origin)
 * v2.0 PRFP core_task: 从社会阶层生活经验挖故事 kernel, 产出整合元意图
 *
 * Phase 10: V8 pass-through to pain-discovery + topic-selection
 * Phase 11: Native v2.0 implementation (kernel mining + structured interview)
 */
import { NodeBase } from './_node-base.js';

export class CreativeSource extends NodeBase {
  constructor(spec) {
    super({
      id: 'creative_source',
      layer: 0,
      role: 'root',
      v8PassthroughTargets: ['pain-discovery', 'topic-selection'],
      spec,
    });
  }
}
