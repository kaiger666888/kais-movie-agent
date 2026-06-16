/**
 * screenplay — Layer 2 narrative node (loop_with_critic with script_auditor)
 * v2.0 PRFP core_task (per 02-NODE-SPECS §2.3):
 *   把元意图展开为可执行叙事结构 (scene list + dialogue + form 适配)
 *
 * Loop participant: screenplay ↔ script_auditor (max 3 iter, ¥5/iter, exit ≥ 0.75)
 *
 * Phase 14: consumes novelty_constraint per 04-LLM-CREATIVE-DISTILLATION.md §3.2
 *   - Pattern 2 (reason_before_write)
 *   - Pattern 3 (explicit_anti_trope) — from novelty_constraint.avoid_tropes
 *   - Pattern 4 (respect_consistency_context) — from consistency_context input
 *   - Pattern 5 (template_aware) — from novelty_constraint.selected_template
 *   - Pattern 6 (regenerate_with_audit_feedback) — from script_auditor on iter > 0
 */
import { NodeBase } from './_node-base.js';
import { getTemplate } from './_templates.js';

export class Screenplay extends NodeBase {
  constructor(spec) {
    super({
      id: 'screenplay',
      layer: 2,
      role: 'narrative',
      v8PassthroughTargets: [],
      spec,
    });
    this.isV2Native = true;
  }

  /**
   * @param {object} pipeline
   * @param {object} inputs
   * @param {object} inputs.story_kernel — from creative_source
   * @param {object} [inputs.novelty_constraint] — Phase 14 input from creative_source
   * @param {object} [inputs.consistency_context] — Phase 14 input (ConsistencyContext or snapshot)
   * @param {object} [inputs.form_context] — { form, target_platform }
   * @param {object} [inputs.regeneration_feedback] — from script_auditor (loop iter > 0)
   * @param {number} [inputs.loop_iteration]
   */
  async run(pipeline, inputs = {}) {
    const {
      story_kernel,
      form_context = { form: 'short_drama', target_platform: 'douyin' },
      novelty_constraint = null,
      consistency_context = null,
      regeneration_feedback = null,
      loop_iteration = 0,
    } = inputs;

    if (!story_kernel) {
      throw new Error('[screenplay] Missing required input: story_kernel');
    }

    const screenplay = await this._expandToScreenplay(
      pipeline,
      story_kernel,
      form_context,
      novelty_constraint,
      consistency_context,
      regeneration_feedback,
      loop_iteration
    );

    return {
      node_id: this.id,
      is_v2_native: true,
      screenplay_full: screenplay,
      consistency_context_updated: this._extractFacts(screenplay),
      novelty_constraint_applied: novelty_constraint,
      loop_iteration,
      awaiting_critic: true, // signals v2_pipeline to invoke script_auditor next
      schema_version: 'design-2026-06-16-prfp',
    };
  }

  async _expandToScreenplay(pipeline, kernel, formContext, novelty, consistencyCtx, feedback, loopIter) {
    const llm = await this._getLLM(pipeline);

    if (!llm) {
      return this._stubScreenplay(kernel, formContext, loopIter);
    }

    // Phase 14 Pattern 2: reason_before_write
    const reasoningClause = `\n\n[REASON BEFORE WRITE] Before each scene, output reasoning block: setup (callback to prior), payoff (foreshadow), character motivation, consistency_context impact.`;

    // Phase 14 Pattern 3: explicit_anti_trope (from novelty_constraint)
    const antiTropeClause = novelty?.avoid_tropes?.length
      ? `\n\n[ANTI-TROPE] Avoid these tropes explicitly: ${novelty.avoid_tropes.join(', ')}`
      : '';

    // Phase 14 Pattern 4: respect_consistency_context
    const consistencyClause = consistencyCtx
      ? `\n\n[CONSISTENCY CONTEXT] Respect established facts:\n${
          typeof consistencyCtx.toJSON === 'function'
            ? consistencyCtx.toJSON()
            : JSON.stringify(consistencyCtx.snapshot ? consistencyCtx.snapshot() : consistencyCtx, null, 2).slice(0, 2000)
        }\nViolations = failure.`
      : '';

    // Phase 14 Pattern 5: template_aware (from novelty_constraint.selected_template)
    const templateId = novelty?.selected_template;
    const template = templateId ? getTemplate(templateId) : null;
    const templateClause = template
      ? `\n\n[TEMPLATE ${template.id}] Structure scenes around these stages:\n${
          template.stages.map(s => `  - ${s.id}: ${s.function} (${Math.round(s.length_share * 100)}%)`).join('\n')
        }`
      : '';

    // Phase 14 Pattern 6: regenerate_with_audit_feedback
    const feedbackClause = feedback
      ? `\n\n[REGENERATION iter ${loopIter}] Address these audit findings: ${JSON.stringify(feedback.findings || [])}`
      : '';

    const noveltyClause = novelty
      ? `\n\n[NOVELTY] Apply: require_novelty_in=${JSON.stringify(novelty.require_novelty_in || [])}, threshold=${novelty.novelty_score_threshold}`
      : '';

    try {
      const llmOutput = await llm.call({
        prompt: `Expand this story kernel into a screenplay.

Kernel: ${JSON.stringify(kernel)}
Form: ${formContext.form} for ${formContext.target_platform}${reasoningClause}${antiTropeClause}${consistencyClause}${templateClause}${feedbackClause}${noveltyClause}

Return JSON with:
- scene_list: array of { scene_id, location, characters, action, dialogue, duration_s }
- form_adaptations: { hook_first_3s, vertical_framing, paid_checkpoint_pacing }
- three_act_structure: { act1, act2, act3 }

Form constraints:
- short_drama: 60-90s total, vertical 9:16, hook in first 3s, paid checkpoint at midpoint
- micro_film: 5-10min total, horizontal 16:9, slow burn allowed
- feature: 90+ min, full three-act structure`,
        max_tokens: 2000,
      });
      return JSON.parse(llmOutput);
    } catch {
      return this._stubScreenplay(kernel, formContext, loopIter);
    }
  }

  /**
   * Phase 14 §2.1 io_contract revision: screenplay outputs consistency_context_updated
   * reflecting facts established in this draft. Stub returns empty; production
   * extracts structured facts from LLM output.
   */
  _extractFacts(screenplay) {
    return {
      extracted_at: new Date().toISOString(),
      facts_count: 0,
      note: 'Stub — production: extract structured facts from screenplay output for consistency_context propagation',
    };
  }

  _stubScreenplay(kernel, formContext, loopIter) {
    return {
      scene_list: [
        {
          scene_id: 'scene_1',
          location: '[stub] opening location',
          characters: ['protagonist'],
          action: '[stub] opening action based on ' + (kernel?.logline || 'kernel'),
          dialogue: ['[stub] opening line'],
          duration_s: formContext.form === 'short_drama' ? 5 : 30,
        },
      ],
      form_adaptations: {
        hook_first_3s: formContext.form === 'short_drama',
        vertical_framing: formContext.form === 'short_drama',
        paid_checkpoint_pacing: formContext.form === 'short_drama' ? 'midpoint' : 'none',
      },
      three_act_structure: {
        act1: '[stub] setup',
        act2: '[stub] confrontation',
        act3: '[stub] resolution',
      },
      _stub: true,
      _loop_iteration: loopIter,
    };
  }

  async _getLLM(pipeline) {
    try {
      const mod = await import('../llm.js');
      return mod.llm || mod.default || null;
    } catch {
      return null;
    }
  }
}
