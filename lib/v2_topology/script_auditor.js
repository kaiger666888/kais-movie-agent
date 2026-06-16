/**
 * script_auditor — Layer 2 critic (loop_with_critic with screenplay)
 * v2.0 PRFP core_task (per 02-NODE-SPECS §2.4):
 *   5-dim quantitative audit, decide accept/regenerate/escalate
 *
 * Loop exit condition: score ≥ 0.75 across 5 dimensions OR max 3 iter
 * Cost ceiling: ¥5/iter (per edges.yaml)
 *
 * 5 dimensions (Phase 14 adds 6th: consistency_context_violations):
 *   1. plot_coherence — three-act structure + turning points
 *   2. dialogue_quality — subtext, voice, info-dump avoidance
 *   3. character_arc — protagonist change + motivation clarity
 *   4. pacing — form envelope compliance + energy curve
 *   5. three_act_compliance — Field/McKee structure validation
 *
 * Phase 11 native v2.0 implementation.
 */
import { NodeBase } from './_node-base.js';

const SCORE_THRESHOLD = 0.75;
const MAX_ITER = 3;
const COST_PER_ITER_YUAN = 5;

export class ScriptAuditor extends NodeBase {
  constructor(spec) {
    super({
      id: 'script_auditor',
      layer: 2,
      role: 'critic',
      v8PassthroughTargets: [],
      spec,
    });
    this.isV2Native = true;
  }

  /**
   * @param {object} pipeline
   * @param {object} inputs
   * @param {object} inputs.screenplay_full — from screenplay
   * @param {number} [inputs.loop_iteration] — current loop iteration (0-based)
   * @param {number} [inputs.accumulated_cost_yuan] — running cost
   */
  async run(pipeline, inputs = {}) {
    const {
      screenplay_full,
      loop_iteration = 0,
      accumulated_cost_yuan = 0,
    } = inputs;

    if (!screenplay_full) {
      throw new Error('[script_auditor] Missing required input: screenplay_full');
    }

    const audit = await this._auditScreenplay(pipeline, screenplay_full);
    const overallScore = this._computeOverallScore(audit.scores_5dim);
    const costIncurred = accumulated_cost_yuan + COST_PER_ITER_YUAN;

    const exitConditionMet = overallScore >= SCORE_THRESHOLD;
    const maxIterReached = loop_iteration + 1 >= MAX_ITER;
    const verdict = this._decideVerdict(exitConditionMet, maxIterReached);

    return {
      node_id: this.id,
      is_v2_native: true,
      audit_score_5dim: audit.scores_5dim,
      overall_score: overallScore,
      verdict, // 'accept' | 'regenerate' | 'escalate_human'
      findings: audit.findings,
      loop_state: {
        iteration: loop_iteration + 1,
        max_iter: MAX_ITER,
        exit_condition_met: exitConditionMet,
        max_iter_reached: maxIterReached,
        cost_ceiling_per_iter_yuan: COST_PER_ITER_YUAN,
        accumulated_cost_yuan: costIncurred,
      },
      regeneration_feedback: verdict === 'regenerate' ? {
        findings: audit.findings,
        target_dimensions: audit.findings
          .filter(f => f.severity === 'high')
          .map(f => f.dimension),
      } : null,
      schema_version: 'design-2026-06-16-prfp',
    };
  }

  async _auditScreenplay(pipeline, screenplay) {
    const llm = await this._getLLM(pipeline);

    if (!llm) {
      return this._stubAudit(screenplay);
    }

    try {
      const llmOutput = await llm.call({
        prompt: `Audit this screenplay across 5 dimensions.

Screenplay: ${JSON.stringify(screenplay)}

Return JSON:
- scores_5dim: { plot_coherence: 0-1, dialogue_quality: 0-1, character_arc: 0-1, pacing: 0-1, three_act_compliance: 0-1 }
- findings: array of { dimension, severity: high|medium|low, issue, recommendation }`,
        max_tokens: 1000,
      });
      const parsed = JSON.parse(llmOutput);
      return {
        scores_5dim: parsed.scores_5dim || {},
        findings: parsed.findings || [],
      };
    } catch {
      return this._stubAudit(screenplay);
    }
  }

  _stubAudit(screenplay) {
    const hasScenes = screenplay.scene_list && screenplay.scene_list.length > 0;
    const hasThreeAct = !!screenplay.three_act_structure;
    return {
      scores_5dim: {
        plot_coherence: hasScenes ? 0.7 : 0.4,
        dialogue_quality: 0.6,
        character_arc: 0.65,
        pacing: 0.7,
        three_act_compliance: hasThreeAct ? 0.75 : 0.5,
      },
      findings: [
        ...(hasScenes ? [] : [{ dimension: 'plot_coherence', severity: 'high', issue: 'No scene list', recommendation: 'Generate scene list' }]),
        ...(hasThreeAct ? [] : [{ dimension: 'three_act_compliance', severity: 'medium', issue: 'Missing three-act structure', recommendation: 'Add explicit acts' }]),
      ],
      _stub: true,
    };
  }

  _computeOverallScore(scores5dim) {
    const values = Object.values(scores5dim).filter(v => typeof v === 'number');
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  _decideVerdict(exitMet, maxReached) {
    if (exitMet) return 'accept';
    if (maxReached) return 'escalate_human';
    return 'regenerate';
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
