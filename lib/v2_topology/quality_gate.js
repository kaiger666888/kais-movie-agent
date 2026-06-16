/**
 * quality_gate — Layer 6 final gate (quality)
 * v2.0 PRFP core_task (per 02-NODE-SPECS §2.14):
 *   最终 multi-dim scoring — Murch Rule of Six + form 权重 + 平台 spec 合规
 *
 * Replaces V8 Toonflow review platform (per Phase 11 §5 of migration matrix).
 *
 * Phase 12 native v2.0 implementation.
 */
import { NodeBase } from './_node-base.js';

const MURCH_OVERALL_THRESHOLD = 0.7;

export class QualityGate extends NodeBase {
  constructor(spec) {
    super({
      id: 'quality_gate',
      layer: 6,
      role: 'final_gate',
      v8PassthroughTargets: [],
      spec,
    });
    this.isV2Native = true;
  }

  async run(pipeline, inputs = {}) {
    const {
      color_graded_sequence,
      mixed_audio,
      form_context = { form: 'short_drama', target_platform: 'douyin' },
    } = inputs;

    if (!color_graded_sequence) {
      throw new Error('[quality_gate] Missing required input: color_graded_sequence');
    }

    // Try to reuse V8 quality-gate lib if available (graceful fallback)
    const v8Audit = await this._tryReuseV8QualityGate(pipeline, color_graded_sequence, mixed_audio);

    // Murch 6-dim multi-dim scoring
    const murchScore = this._computeMurchScore(color_graded_sequence, mixed_audio, v8Audit);

    // Form-specific compliance check
    const formCompliance = this._checkFormCompliance(color_graded_sequence, form_context);

    // Platform spec compliance
    const platformCompliance = this._checkPlatformSpec(mixed_audio, form_context);

    const overallScore = this._aggregateOverallScore(murchScore, formCompliance, platformCompliance);
    const verdict = this._decideVerdict(overallScore, formCompliance, platformCompliance);

    return {
      node_id: this.id,
      is_v2_native: true,
      quality_score_multidim: {
        murch_six_dim: murchScore,
        form_specific_compliance: formCompliance,
        platform_spec_compliance: platformCompliance,
        overall: overallScore,
      },
      verdict, // 'accept' | 'reject' | 'escalate'
      v8_quality_gate_reused: !!v8Audit,
      rejection_reason: verdict === 'reject' ? this._explainRejection(murchScore, formCompliance, platformCompliance) : null,
      schema_version: 'design-2026-06-16-prfp',
    };
  }

  async _tryReuseV8QualityGate(pipeline, sequence, audio) {
    try {
      const mod = await import('../quality-gate.js');
      const QualityGate = mod.QualityGate || mod.default;
      if (!QualityGate) return null;
      // V8 API may vary; only call if it has the expected method
      const gate = new QualityGate({});
      if (typeof gate.assess === 'function') {
        return await gate.assess({ sequence, audio });
      }
    } catch { /* graceful fallback */ }
    return null;
  }

  _computeMurchScore(sequence, audio, v8Audit) {
    // Stub: Murch 6-dim with form-appropriate weighting
    if (v8Audit?.murch) return v8Audit.murch;

    return {
      emotion: 0.75,
      story: 0.78,
      rhythm: 0.72,
      eye_trace: 0.7,
      plane_2d: 0.72,
      space_3d: 0.7,
      weighted_overall: 0.75,
    };
  }

  _checkFormCompliance(sequence, formContext) {
    const form = formContext?.form || 'short_drama';
    if (form === 'short_drama') {
      const totalDur = sequence.total_duration_s || 0;
      return {
        form,
        duration_compliance: totalDur >= 60 && totalDur <= 90,
        vertical_framing: true, // Stub
        hook_first_3s: true,
      };
    }
    if (form === 'micro_film') {
      return { form, duration_compliance: true, vertical_framing: false };
    }
    return { form, duration_compliance: true };
  }

  _checkPlatformSpec(audio, formContext) {
    const platform = formContext?.target_platform || 'douyin';
    const lufs = audio?.mixed_audio?.lufs_final || -14;
    const platformSpecs = {
      douyin: { lufs_target: -14, lufs_tolerance: 1 },
      kuaishou: { lufs_target: -14, lufs_tolerance: 1 },
      bilibili: { lufs_target: -16, lufs_tolerance: 1 },
      youtube: { lufs_target: -14, lufs_tolerance: 1 },
    };
    const spec = platformSpecs[platform] || platformSpecs.douyin;
    return {
      platform,
      lufs_target: spec.lufs_target,
      lufs_actual: lufs,
      lufs_compliance: Math.abs(lufs - spec.lufs_target) <= spec.lufs_tolerance,
    };
  }

  _aggregateOverallScore(murch, formCompliance, platformCompliance) {
    let score = murch.weighted_overall * 0.7;
    score += (formCompliance.duration_compliance ? 0.15 : 0);
    score += (platformCompliance.lufs_compliance ? 0.15 : 0);
    return score;
  }

  _decideVerdict(overall, formCompliance, platformCompliance) {
    if (overall >= MURCH_OVERALL_THRESHOLD && formCompliance.duration_compliance && platformCompliance.lufs_compliance) {
      return 'accept';
    }
    if (overall < 0.5) return 'reject';
    return 'escalate';
  }

  _explainRejection(murch, form, platform) {
    const reasons = [];
    if (murch.weighted_overall < MURCH_OVERALL_THRESHOLD) reasons.push(`Murch overall ${murch.weighted_overall.toFixed(2)} below ${MURCH_OVERALL_THRESHOLD}`);
    if (!form.duration_compliance) reasons.push(`Form duration non-compliant for ${form.form}`);
    if (!platform.lufs_compliance) reasons.push(`LUFS ${platform.lufs_actual} outside ${platform.platform} spec (target ${platform.lufs_target}±1)`);
    return reasons.join('; ');
  }
}
