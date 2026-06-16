/**
 * editor — Layer 5 post-production parallel (editing)
 * v2.0 PRFP core_task (per 02-NODE-SPECS §2.11):
 *   把素材 + 音频 + screenplay 整合为最终 cut (节奏 + 场景过渡 + pacing)
 *
 * Murch Rule of Six in-node self-critic (per spec):
 *   emotion (50%) + story (25%) + rhythm (10%) + eye_trace (5%) + 2D_plane (4%) + 3D_space (3%)
 *
 * Triggers human_review_gate_2 (5-min review budget per edges.yaml).
 *
 * Phase 12 native v2.0 implementation.
 */
import { NodeBase } from './_node-base.js';

const HUMAN_REVIEW_BUDGET_MIN = 5;

export class Editor extends NodeBase {
  constructor(spec) {
    super({
      id: 'editor',
      layer: 5,
      role: 'post_parallel',
      v8PassthroughTargets: [],
      spec,
    });
    this.isV2Native = true;
  }

  async run(pipeline, inputs = {}) {
    const {
      screenplay_full,
      generated_visuals = [],
      mixed_audio = null,
      invariants = null,
    } = inputs;

    if (!screenplay_full) {
      throw new Error('[editor] Missing required input: screenplay_full');
    }

    const styleGenome = invariants?.getStyleGenome?.() || null;

    // Generate cut-point suggestions
    const cutPoints = await this._selectCutPoints(screenplay_full, generated_visuals, styleGenome);

    // Assemble final sequence
    const editedSequence = this._assembleSequence(generated_visuals, cutPoints, mixed_audio);

    // In-node self-critic: Murch 6-dim quick audit
    const murchSelfAudit = this._murchSelfAudit(editedSequence, screenplay_full);

    // Emit human_review_gate_2 (per edges.yaml)
    const humanGate = this._emitHumanGate2(editedSequence, murchSelfAudit);

    return {
      node_id: this.id,
      is_v2_native: true,
      edited_sequence: editedSequence,
      cut_points: cutPoints,
      murch_rhythm_score: murchSelfAudit.weighted_score,
      murch_self_audit: murchSelfAudit,
      human_review_gate_2: humanGate,
      schema_version: 'design-2026-06-16-prfp',
    };
  }

  async _selectCutPoints(screenplay, visuals, styleGenome) {
    const shots = visuals.length;
    const targetRhythm = styleGenome?.rhythm?.pacing_pattern || 'legato';
    const avgShotDur = styleGenome?.rhythm?.avg_shot_duration_s || 5;

    return (screenplay.scene_list || []).map((scene, i) => ({
      scene_id: scene.scene_id,
      cut_in_at_s: i * avgShotDur,
      cut_out_at_s: (i + 1) * avgShotDur,
      transition: i === 0 ? 'fade_in' : (targetRhythm === 'staccato' ? 'hard_cut' : 'cross_dissolve'),
      shot_count_estimate: Math.ceil((scene.duration_s || avgShotDur) / avgShotDur),
    }));
  }

  _assembleSequence(visuals, cutPoints, mixedAudio) {
    return {
      total_duration_s: cutPoints.reduce((sum, cp) => sum + (cp.cut_out_at_s - cp.cut_in_at_s), 0),
      shot_order: visuals.map(v => v.shot_id),
      cut_points: cutPoints,
      audio_track: mixedAudio?.mixed_audio?.mixed_track?.mixed_track || null,
      assembled_at: new Date().toISOString(),
    };
  }

  /**
   * Murch Rule of Six self-audit (per spec in-node self-critic).
   * Weights: emotion 50% / story 25% / rhythm 10% / eye_trace 5% / 2D_plane 4% / 3D_space 3%.
   */
  _murchSelfAudit(editedSequence, screenplay) {
    // Stub scoring (production: LLM + reference comparison)
    const emotion = 0.75;
    const story = screenplay?.three_act_structure ? 0.8 : 0.6;
    const rhythm = editedSequence.total_duration_s > 0 ? 0.7 : 0.4;
    const eyeTrace = 0.65;
    const plane2D = 0.7;
    const space3D = 0.7;

    const weighted_score =
      emotion * 0.50 + story * 0.25 + rhythm * 0.10 +
      eyeTrace * 0.05 + plane2D * 0.04 + space3D * 0.03;

    return {
      emotion, story, rhythm, eye_trace: eyeTrace, plane_2d: plane2D, space_3d: space3D,
      weighted_score,
      pass_threshold: weighted_score >= 0.7,
    };
  }

  _emitHumanGate2(editedSequence, murchAudit) {
    return {
      gate_type: 'human_review_gate_2',
      review_budget_minutes: HUMAN_REVIEW_BUDGET_MIN,
      reviewer_role: 'Director or assigned reviewer',
      pending_review: true,
      auto_accept_in_autonomous_mode: true, // autonomous workflows auto-accept
      on_reject_options: ['revise editor rhythm', 'escalate to theory_critic'],
      artifact_reviewed: 'edited_sequence',
      murch_audit_attached: murchAudit,
    };
  }
}
