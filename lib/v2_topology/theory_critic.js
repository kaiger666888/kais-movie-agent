/**
 * theory_critic — Layer 6 consultative vertical (creator-pulled, not auto-invoked)
 * v2.0 PRFP core_task (per 02-NODE-SPECS §2.16):
 *   咨询式理论批判 — 创作者手动拉, 艺术价值 vs 平台优化张力平衡
 *
 * META-06: NOT a linear blocking gate. Creator-pulled only.
 *
 * Phase 12 native v2.0 implementation.
 *
 * NOT in LINEAR_EXECUTION_ORDER (already excluded in Phase 10 index).
 * Invoked via V2Pipeline.invokeTheoryCritic(question) from creator UI.
 */
import { NodeBase } from './_node-base.js';

export class TheoryCritic extends NodeBase {
  constructor(spec) {
    super({
      id: 'theory_critic',
      layer: 6,
      role: 'consultative',
      v8PassthroughTargets: [],
      spec,
    });
    this.isV2Native = true;
  }

  /**
   * Standard run() returns inactive marker when called from DAG iteration
   * (theory_critic is consultative — not auto-invoked).
   */
  async run(pipeline, inputs = {}) {
    return {
      node_id: this.id,
      is_v2_native: true,
      consultative: true,
      auto_invocation_skipped: true,
      message: 'theory_critic is consultative per META-06 — invoke via V2Pipeline.invokeTheoryCritic(question)',
      hint: 'Pass { consultation_question, pipeline_state_snapshot } and call consult() directly',
      schema_version: 'design-2026-06-16-prfp',
    };
  }

  /**
   * Consultative API — creator-pulled.
   * @param {object} pipeline
   * @param {object} args
   * @param {string} args.consultation_question — creator's question
   * @param {object} args.pipeline_state_snapshot — current pipeline state for context
   */
  async consult(pipeline, args = {}) {
    const { consultation_question, pipeline_state_snapshot = {} } = args;

    if (!consultation_question) {
      throw new Error('[theory_critic.consult] Missing required input: consultation_question');
    }

    const critique = await this._generateCritique(
      pipeline,
      consultation_question,
      pipeline_state_snapshot
    );

    return {
      node_id: this.id,
      is_v2_native: true,
      consultation_invoked: true,
      consultation_question,
      theoretical_critique: critique,
      schema_version: 'design-2026-06-16-prfp',
    };
  }

  async _generateCritique(pipeline, question, stateSnapshot) {
    const llm = await this._getLLM(pipeline);

    if (!llm) {
      return this._stubCritique(question, stateSnapshot);
    }

    try {
      const llmOutput = await llm.call({
        prompt: `Provide a theoretical critique as a film/literary theorist.

Creator's question: ${question}

Pipeline state (for context):
${JSON.stringify(stateSnapshot).slice(0, 2000)}

Return JSON with:
- artistic_value_assessment: { strengths: [], weaknesses: [], theoretical_frame: '...' }
- commercial_drift_analysis: { tension_level: 0-1, drift_factors: [] }
- recommendations: array of 3-5 concrete suggestions
- balanced_perspective: how to reconcile artistic + commercial goals`,
        max_tokens: 1500,
      });
      return JSON.parse(llmOutput);
    } catch {
      return this._stubCritique(question, stateSnapshot);
    }
  }

  _stubCritique(question, stateSnapshot) {
    return {
      artistic_value_assessment: {
        strengths: ['Clear protagonist desire established', 'Coherent three-act structure'],
        weaknesses: ['Potential for cliché in midpoint reversal', 'Risk of emotional manipulation in climax'],
        theoretical_frame: 'McKee story paradigm + Murch emotional rhythm',
      },
      commercial_drift_analysis: {
        tension_level: 0.4,
        drift_factors: ['Platform algorithmic preferences may push toward formulaic hooks'],
      },
      recommendations: [
        'Strengthen subtext in midpoint scene to resist formula',
        'Consider kishotenketsu 4-act structure as alternative to classical 3-act',
        'Anchor climax in character-specific choice rather than trope',
      ],
      balanced_perspective:
        'Pursue artistic specificity within commercial form constraints — short_drama can support both.',
      _stub: true,
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
