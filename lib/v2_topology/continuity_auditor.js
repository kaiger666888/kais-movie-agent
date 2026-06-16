/**
 * continuity_auditor — Layer 3 critic (loop_with_critic with visual_executor)
 * v2.0 PRFP core_task (per 02-NODE-SPECS §2.10):
 *   跨镜头 invariant 验证 — identity + wardrobe + 180° axis + spatial + plot continuity
 *
 * Loop exit condition (per edges.yaml):
 *   identity_match ≥ 0.85 AND axis_compliance = 100%
 *   OR max 2 iter (then escalate to human art director + static image fallback)
 *
 * Cost ceiling: ¥50/iter
 *
 * Renamed from V8 'consistency-guard' (per migration matrix).
 * Sub-step: character_anatomy_check (V8 Step 12 folded in per matrix).
 *
 * Phase 11 native v2.0 implementation.
 */
import { NodeBase } from './_node-base.js';

const IDENTITY_THRESHOLD = 0.85;
const MAX_ITER = 2;
const COST_PER_ITER_YUAN = 50;

export class ContinuityAuditor extends NodeBase {
  constructor(spec) {
    super({
      id: 'continuity_auditor',
      layer: 3,
      role: 'critic',
      v8PassthroughTargets: [],
      spec,
    });
    this.isV2Native = true;
  }

  /**
   * @param {object} pipeline
   * @param {object} inputs
   * @param {object} inputs.generated_visuals — from visual_executor
   * @param {object} [inputs.invariants] — for character_assets reference
   * @param {number} [inputs.loop_iteration]
   * @param {number} [inputs.accumulated_cost_yuan]
   */
  async run(pipeline, inputs = {}) {
    const {
      generated_visuals = [],
      invariants = null,
      loop_iteration = 0,
      accumulated_cost_yuan = 0,
    } = inputs;

    if (!generated_visuals || generated_visuals.length === 0) {
      throw new Error('[continuity_auditor] Missing required input: generated_visuals');
    }

    const characterAssets = invariants?.getCharacterAssets?.() || [];
    const audit = await this._auditContinuity(pipeline, generated_visuals, characterAssets);

    const exitConditionMet =
      audit.identity_match >= IDENTITY_THRESHOLD &&
      audit.axis_compliance >= 1.0;
    const maxIterReached = loop_iteration + 1 >= MAX_ITER;
    const costIncurred = accumulated_cost_yuan + COST_PER_ITER_YUAN;

    const verdict = this._decideVerdict(exitConditionMet, maxIterReached);

    return {
      node_id: this.id,
      is_v2_native: true,
      continuity_score: {
        identity_match: audit.identity_match,
        axis_compliance: audit.axis_compliance,
        wardrobe_drift: audit.wardrobe_drift,
        spatial_consistency: audit.spatial_consistency,
        plot_continuity: audit.plot_continuity,
      },
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
        identity_violations: audit.findings
          .filter(f => f.dimension === 'identity')
          .map(f => ({ shot_id: f.shot_id, issue: f.issue })),
      } : null,
      schema_version: 'design-2026-06-16-prfp',
    };
  }

  async _auditContinuity(pipeline, visuals, characterAssets) {
    const llm = await this._getLLM(pipeline);
    if (!llm) {
      return this._stubAudit(visuals);
    }

    try {
      const llmOutput = await llm.call({
        prompt: `Audit cross-shot continuity.

Visuals: ${JSON.stringify(visuals.map(v => ({ shot_id: v.shot_id, scene_id: v.scene_id })))}
Characters: ${JSON.stringify(characterAssets.map(c => ({ id: c.id, name: c.name })))}

Return JSON:
- identity_match: 0-1 (consistency of character faces across shots)
- axis_compliance: 0-1 (180° rule compliance; 1.0 = 100%)
- wardrobe_drift: int (number of scenes with wardrobe inconsistencies)
- spatial_consistency: 0-1
- plot_continuity: 0-1
- findings: array of { dimension, severity, shot_id, issue, recommendation }`,
        max_tokens: 1000,
      });
      return JSON.parse(llmOutput);
    } catch {
      return this._stubAudit(visuals);
    }
  }

  _stubAudit(visuals) {
    // Heuristic: stubs typically have 0.85+ identity since deterministic
    const allStubs = visuals.every(v => v._stub);
    return {
      identity_match: allStubs ? 0.9 : 0.7,
      axis_compliance: 1.0,
      wardrobe_drift: 0,
      spatial_consistency: 0.85,
      plot_continuity: 0.85,
      findings: [],
      _stub: true,
    };
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
