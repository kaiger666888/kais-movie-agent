/**
 * prompt_injector — Layer 3 cross-call consistency context (NEW, no V8 precedent)
 * v2.0 PRFP core_task: cross-call consistency context per Phase 8 §2.7
 *                      injects style_genome + character_designer invariants into visual_executor prompts
 *
 * Phase 10: V8 pass-through to lib/prompt-injector.js (existing module)
 * Phase 11: Native cross-cutting invariant injection
 */
import { NodeBase } from './_node-base.js';

export class PromptInjector extends NodeBase {
  constructor(spec) {
    super({
      id: 'prompt_injector',
      layer: 3,
      role: 'cross_cutting',
      v8PassthroughTargets: [], // Phase 11 native; Phase 10 uses lib/prompt-injector.js directly
      spec,
    });
  }

  async run(pipeline, inputs = {}) {
    // Phase 10: import existing lib/prompt-injector.js directly
    const { PromptInjector: V8PromptInjector } = await import('../prompt-injector.js');
    const injector = new V8PromptInjector(pipeline.config);
    return injector.inject(inputs);
  }
}
