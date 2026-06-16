/**
 * hook_retention — Layer 5 form-specific (短剧 only)
 * v2.0 PRFP core_task (per 02-NODE-SPECS §2.13):
 *   短剧特定 — 前 3 秒 hook + 完播率 + 付费卡点 pacing + 竖屏 framing
 *
 * form_scope: short_drama only (per edges.yaml)
 * Feedback edge to screenplay (loop, not linear)
 *
 * Phase 12 native v2.0 implementation.
 */
import { NodeBase } from './_node-base.js';

const HOOK_STRENGTH_TARGET = 0.75;
const RETENTION_CURVE_FIT_TARGET = 0.7;

export class HookRetention extends NodeBase {
  constructor(spec) {
    super({
      id: 'hook_retention',
      layer: 5,
      role: 'form_specific',
      v8PassthroughTargets: [], // NEW node
      spec,
    });
    this.isV2Native = true;
  }

  async run(pipeline, inputs = {}) {
    const {
      screenplay_full,
      form_context = { form: 'short_drama' },
    } = inputs;

    // Form guard: skip if not short_drama
    if (form_context?.form !== 'short_drama') {
      return {
        node_id: this.id,
        is_v2_native: true,
        skipped: true,
        skip_reason: `form_scope=short_drama only; got form=${form_context?.form || 'unknown'}`,
        schema_version: 'design-2026-06-16-prfp',
      };
    }

    if (!screenplay_full) {
      throw new Error('[hook_retention] Missing required input: screenplay_full');
    }

    const hookAnalysis = this._analyzeHook(screenplay_full);
    const retentionCurve = this._fitRetentionCurve(screenplay_full);
    const paidCheckpointFeedback = this._checkPaidCheckpoint(screenplay_full);

    const recommendations = {
      hook_strength_score: hookAnalysis.score,
      retention_curve_fit: retentionCurve.fit,
      paid_checkpoint_feedback: paidCheckpointFeedback,
      vertical_framing_check: this._checkVerticalFraming(screenplay_full),
      first_3s_action: hookAnalysis.first_3s_action,
      suggestions: hookAnalysis.suggestions,
    };

    return {
      node_id: this.id,
      is_v2_native: true,
      hook_pacing_recommendations: recommendations,
      feedback_to_screenplay: {
        should_revise: hookAnalysis.score < HOOK_STRENGTH_TARGET,
        target_dimensions: hookAnalysis.score < HOOK_STRENGTH_TARGET ? ['hook'] : [],
      },
      success_targets: {
        hook_strength: HOOK_STRENGTH_TARGET,
        retention_curve_fit: RETENTION_CURVE_FIT_TARGET,
      },
      schema_version: 'design-2026-06-16-prfp',
    };
  }

  _analyzeHook(screenplay) {
    const firstScene = (screenplay.scene_list || [])[0] || {};
    const firstDialogue = (firstScene.dialogue || [])[0] || '';
    const firstAction = firstScene.action || '';

    // Hook strength heuristics (stub; production: LLM + reference comparison)
    let score = 0.5;
    const suggestions = [];

    if (firstAction && firstAction.length > 30) score += 0.15;
    else suggestions.push('Strengthen first-scene visual action (current too brief)');

    if (firstDialogue && firstDialogue.length < 80) score += 0.1;
    else suggestions.push('Tighten first dialogue line (current too long for short_drama)');

    if (firstScene.duration_s && firstScene.duration_s <= 5) score += 0.15;
    else suggestions.push('First scene should be ≤5s for short_drama hook');

    return {
      score: Math.min(score, 1.0),
      first_3s_action: firstAction.slice(0, 100),
      suggestions,
    };
  }

  _fitRetentionCurve(screenplay) {
    // Stub: retention curve fit (production: platform-specific retention model)
    return {
      fit: 0.75,
      curve_type: 'exponential_decay',
      predicted_completion_rate: 0.45,
    };
  }

  _checkPaidCheckpoint(screenplay) {
    // 短剧 paid checkpoint should be at midpoint
    const adaptations = screenplay.form_adaptations || {};
    return {
      checkpoint_position: adaptations.paid_checkpoint_pacing || 'midpoint',
      recommended_position: 'midpoint',
      aligned: adaptations.paid_checkpoint_pacing === 'midpoint',
    };
  }

  _checkVerticalFraming(screenplay) {
    const adaptations = screenplay.form_adaptations || {};
    return {
      vertical_required: true,
      current_setting: adaptations.vertical_framing,
      aligned: adaptations.vertical_framing === true,
    };
  }
}
