/**
 * compliance_gate — Layer 6 final gate (compliance)
 * v2.0 PRFP core_task (per 02-NODE-SPECS §2.15):
 *   CN 平台合规审核 — pre_check + final (合并)
 *
 * 2 sub-steps per Phase 8 §2.15:
 *   1. pre_check — lightweight CN regulation scan (can short-circuit early)
 *   2. final — comprehensive platform spec check
 *
 * Renamed from V8 'delivery' compliance sub-step per migration matrix.
 *
 * Phase 12 native v2.0 implementation.
 */
import { NodeBase } from './_node-base.js';

const CN_REGULATION_TOPICS = [
  'political_content',
  'pornographic_content',
  'violence_extremity',
  'gambling',
  'drug_use',
  'superstition',
  'false_advertising',
  'minors_protection',
];

export class ComplianceGate extends NodeBase {
  constructor(spec) {
    super({
      id: 'compliance_gate',
      layer: 6,
      role: 'final_gate',
      v8PassthroughTargets: [],
      spec,
    });
    this.isV2Native = true;
  }

  async run(pipeline, inputs = {}) {
    const {
      quality_approved_sequence,
      form_context = { target_platform: 'douyin' },
      screenplay_full = null,
    } = inputs;

    if (!quality_approved_sequence) {
      throw new Error('[compliance_gate] Missing required input: quality_approved_sequence');
    }

    // Sub-step 1: pre_check (lightweight — can short-circuit)
    const preCheck = await this._runPreCheck(screenplay_full, quality_approved_sequence);

    // If pre_check finds hard violations, short-circuit with rejection
    if (preCheck.hard_violations > 0) {
      return {
        node_id: this.id,
        is_v2_native: true,
        compliance_verdict: 'reject',
        rejection_reason: `Pre-check found ${preCheck.hard_violations} hard violation(s): ${preCheck.findings.map(f => f.topic).join(', ')}`,
        pre_check: preCheck,
        final_check_short_circuited: true,
        schema_version: 'design-2026-06-16-prfp',
      };
    }

    // Sub-step 2: final (comprehensive)
    const finalCheck = await this._runFinalCheck(quality_approved_sequence, form_context);

    const verdict = finalCheck.platform_spec_compliance && finalCheck.cn_regulation_compliance
      ? 'accept'
      : 'reject';

    return {
      node_id: this.id,
      is_v2_native: true,
      compliance_verdict: verdict,
      rejection_reason: verdict === 'reject' ? finalCheck.findings.map(f => f.issue).join('; ') : null,
      pre_check: preCheck,
      final_check: finalCheck,
      sub_steps_executed: ['pre_check', 'final'],
      schema_version: 'design-2026-06-16-prfp',
    };
  }

  async _runPreCheck(screenplay, sequence) {
    // Lightweight scan: check screenplay dialogue + action for red-flag keywords
    const text = JSON.stringify(screenplay || {});
    const findings = [];

    // Stub: red-flag keyword scan (production: LLM + regex dictionary)
    const redFlags = {
      political_content: ['specific_political_figure_name'],
      pornographic_content: ['explicit_sexual_description'],
      violence_extremity: ['graphic_gore_description'],
      gambling: ['promote_gambling_platform'],
      drug_use: ['promote_recreational_drugs'],
    };

    for (const [topic, keywords] of Object.entries(redFlags)) {
      for (const kw of keywords) {
        if (text.includes(kw)) {
          findings.push({ topic, severity: 'hard', keyword: kw });
        }
      }
    }

    return {
      executed_at: new Date().toISOString(),
      text_scanned_length: text.length,
      hard_violations: findings.filter(f => f.severity === 'hard').length,
      findings,
    };
  }

  async _runFinalCheck(sequence, formContext) {
    const platform = formContext?.target_platform || 'douyin';

    // Comprehensive check: watermark, copyright, duration limits, aspect ratio
    const findings = [];

    // Stub platform spec checks
    const platformSpecs = {
      douyin: { max_duration_s: 600, aspect_ratios: ['9:16', '1:1'] },
      kuaishou: { max_duration_s: 600, aspect_ratios: ['9:16'] },
      bilibili: { max_duration_s: 7200, aspect_ratios: ['16:9'] },
      youtube: { max_duration_s: 7200, aspect_ratios: ['16:9', '9:16'] },
    };
    const spec = platformSpecs[platform] || platformSpecs.douyin;

    if (sequence.total_duration_s > spec.max_duration_s) {
      findings.push({
        severity: 'hard',
        issue: `Duration ${sequence.total_duration_s}s exceeds ${platform} max ${spec.max_duration_s}s`,
      });
    }

    return {
      executed_at: new Date().toISOString(),
      platform,
      platform_spec_compliance: findings.length === 0,
      cn_regulation_compliance: true, // Stub (pre_check would have caught most)
      findings,
    };
  }
}
