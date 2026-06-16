/**
 * visual_executor — Layer 3 visual asset generation
 * v2.0 PRFP core_task (per 02-NODE-SPECS §2.8):
 *   执行视觉资产生成 — 静态图 + 动态视频 (drawer + animator merged per PITFALLS §2.1)
 *
 * Loop participant: visual_executor ↔ continuity_auditor (max 2 iter, ¥50/iter, exit identity ≥ 0.85)
 *
 * Phase 11 native v2.0 implementation.
 * Uses GoldTeamClient for GPU scheduling (existing lib/).
 */
import { NodeBase } from './_node-base.js';

const MAX_LOOP_ITER = 2;

export class VisualExecutor extends NodeBase {
  constructor(spec) {
    super({
      id: 'visual_executor',
      layer: 3,
      role: 'generation',
      v8PassthroughTargets: [],
      spec,
    });
    this.isV2Native = true;
  }

  /**
   * @param {object} pipeline
   * @param {object} inputs
   * @param {object} inputs.model_prompts — from prompt_injector
   * @param {object} inputs.consistency_context — from prompt_injector
   * @param {object} [inputs.regeneration_feedback] — from continuity_auditor (loop iter > 0)
   * @param {number} [inputs.loop_iteration]
   */
  async run(pipeline, inputs = {}) {
    const {
      model_prompts = [],
      consistency_context,
      regeneration_feedback = null,
      loop_iteration = 0,
    } = inputs;

    if (!model_prompts || model_prompts.length === 0) {
      throw new Error('[visual_executor] Missing required input: model_prompts (empty or null)');
    }

    // GPU schedule + generate per-shot
    const generatedVisuals = await this._generateVisuals(
      pipeline,
      model_prompts,
      consistency_context,
      regeneration_feedback,
      loop_iteration
    );

    return {
      node_id: this.id,
      is_v2_native: true,
      generated_visuals: generatedVisuals,
      loop_iteration,
      awaiting_critic: true, // signals v2_pipeline to invoke continuity_auditor next
      cost_estimate_yuan: generatedVisuals.length * 50, // ~¥50/shot rough estimate
      schema_version: 'design-2026-06-16-prfp',
    };
  }

  async _generateVisuals(pipeline, modelPrompts, consistencyCtx, feedback, loopIter) {
    // Try to use existing GoldTeamClient for GPU scheduling
    let goldTeamClient = null;
    try {
      const mod = await import('../gold-team-client.js');
      const GTClass = mod.GoldTeamClient || mod.default;
      if (pipeline?.config?.goldTeam) {
        goldTeamClient = new GTClass(pipeline.config.goldTeam);
      }
    } catch {
      // Module load may fail due to pre-existing V8 baseline bug; fall through to stub
    }

    const results = [];
    for (const promptSpec of modelPrompts) {
      // Apply regeneration feedback if present
      const adjustedPrompt = feedback
        ? this._applyFeedback(promptSpec, feedback, loopIter)
        : promptSpec;

      const visual = await this._generateSingle(
        goldTeamClient,
        adjustedPrompt,
        consistencyCtx,
        loopIter
      );
      results.push(visual);
    }

    return results;
  }

  async _generateSingle(goldTeamClient, promptSpec, consistencyCtx, loopIter) {
    // Production path: dispatch to GoldTeam GPU runtime
    if (goldTeamClient) {
      try {
        const result = await goldTeamClient.dispatch({
          task_type: 'image+video',
          prompt: promptSpec.prompt,
          negative_prompt: promptSpec.negative_prompt,
          metadata: { consistency_context: consistencyCtx, loop_iter: loopIter },
        });
        return {
          shot_id: promptSpec.shot_id,
          scene_id: promptSpec.scene_id,
          image_asset: result.image_url || result.image_asset,
          video_asset: result.video_url || result.video_asset,
          gpu_dispatch_id: result.dispatch_id,
          loop_iteration: loopIter,
        };
      } catch (err) {
        // Fall through to stub on GPU dispatch failure
      }
    }

    // Stub path (no GPU configured, or dispatch failed)
    return {
      shot_id: promptSpec.shot_id,
      scene_id: promptSpec.scene_id,
      image_asset: `stub://${promptSpec.shot_id}.png`,
      video_asset: `stub://${promptSpec.shot_id}.mp4`,
      gpu_dispatch_id: null,
      loop_iteration: loopIter,
      _stub: true,
    };
  }

  _applyFeedback(promptSpec, feedback, loopIter) {
    if (!feedback?.identity_violations) return promptSpec;
    // Strengthen identity anchor on retry
    return {
      ...promptSpec,
      prompt: `${promptSpec.prompt}\n\n[REGEN iter ${loopIter}] Reinforce identity: ${JSON.stringify(feedback.identity_violations)}`,
    };
  }

  _maxLoopIter() {
    return MAX_LOOP_ITER;
  }
}
