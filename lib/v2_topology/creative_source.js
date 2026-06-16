/**
 * creative_source — Layer 0 root node (intent origin)
 * v2.0 PRFP core_task (per 02-NODE-SPECS §2.1):
 *   从 6 个社会阶层的生活经验挖故事 kernel, 产出整合元意图
 *   (logline + 主角欲望 + 中央冲突 + 转折点 + 解决立场 + 风格基因)
 *
 * Phase 14: outputs novelty_constraint (per 04-LLM-CREATIVE-DISTILLATION.md §7.2)
 *           + commercial_mode escape hatch (per §7.4)
 *           + Pattern 5 select_template_first
 *           + publishes initial consistency_context to InvariantBus (Phase 14 fix)
 *
 * Phase 11 native v2.0 implementation (extended in Phase 14).
 */
import { NodeBase } from './_node-base.js';
import { selectTemplate, getTemplate } from './_templates.js';

const KERNEL_NOVELTY_THRESHOLD = 0.7;
const MAX_ANTI_TROPE_RETRIES = 2;
const DEFAULT_NOVELTY_THRESHOLD = 0.6;

export class CreativeSource extends NodeBase {
  constructor(spec) {
    super({
      id: 'creative_source',
      layer: 0,
      role: 'root',
      v8PassthroughTargets: [], // Phase 11: native, no V8 fallback
      spec,
    });
    this.isV2Native = true;
  }

  /**
   * @param {object} pipeline — V2Pipeline (provides config, workdir, LLM dispatch)
   * @param {object} inputs
   * @param {string} inputs.creator_anecdote — required
   * @param {string} inputs.lived_experience_seed — required
   * @param {object} [inputs.form_context] — { form: 'short_drama'|'micro_film'|'feature', target_platform }
   * @param {object} [inputs.artistic_intent] — { experimental, novelty_target, prefer_eastern, anti_patterns }
   * @param {object} [inputs.commercial_mode_override] — explicit creator override
   * @param {object} [inputs.invariants] — InvariantBus instance
   */
  async run(pipeline, inputs = {}) {
    const {
      creator_anecdote,
      lived_experience_seed,
      form_context = { form: 'short_drama', target_platform: 'douyin' },
      artistic_intent = {},
      commercial_mode_override = null,
      invariants,
    } = inputs;

    if (!creator_anecdote || !lived_experience_seed) {
      throw new Error(
        '[creative_source] Missing required inputs: creator_anecdote + lived_experience_seed (per NODE-02 io_contract)'
      );
    }

    // Phase 14 Pattern 5: select_template_first
    const templateSelection = selectTemplate(form_context, artistic_intent);
    const selectedTemplate = templateSelection.selected;

    // Determine novelty threshold based on template + artistic intent
    let noveltyThreshold = artistic_intent.novelty_target || DEFAULT_NOVELTY_THRESHOLD;
    if (selectedTemplate.requires_novelty_score) {
      noveltyThreshold = Math.max(noveltyThreshold, selectedTemplate.requires_novelty_score);
    }

    // Detect thin input → structured-interview fallback
    const isThin = this._detectThinInput(creator_anecdote, lived_experience_seed);
    let effectiveAnecdote = creator_anecdote;
    let effectiveSeed = lived_experience_seed;
    let interviewTriggered = false;

    if (isThin) {
      const interview = await this._structuredInterview(pipeline, creator_anecdote, lived_experience_seed);
      effectiveAnecdote = interview.expanded_anecdote;
      effectiveSeed = interview.expanded_seed;
      interviewTriggered = true;
    }

    // Expand to story_kernel with anti-trope retry loop
    let kernel;
    let noveltyScore = 0;
    let attempts = 0;
    let antiTropeRetries = 0;
    const attemptLog = [];

    while (attempts <= MAX_ANTI_TROPE_RETRIES) {
      attempts++;
      kernel = await this._expandToKernel(
        pipeline, effectiveAnecdote, effectiveSeed,
        antiTropeRetries, selectedTemplate, artistic_intent
      );
      noveltyScore = this._scoreNovelty(kernel);

      attemptLog.push({
        attempt: attempts,
        novelty_score: noveltyScore,
        anti_trope_retry: antiTropeRetries,
      });

      if (noveltyScore >= noveltyThreshold) break;

      if (attempts > MAX_ANTI_TROPE_RETRIES) break;
      antiTropeRetries++;
    }

    const accepted = noveltyScore >= noveltyThreshold;

    // Phase 14 §7.4: commercial_mode escape hatch
    // Auto-set when:
    //   - 短剧_爆款公式 template selected (formulaic by design)
    //   - OR explicit creator override
    //   - AND novelty score < threshold (accepted commercial compromise)
    let commercialMode = false;
    if (commercial_mode_override !== null) {
      commercialMode = commercial_mode_override;
    } else if (selectedTemplate.id === '短剧_爆款公式' && !accepted) {
      commercialMode = true;
    }

    // Build novelty_constraint per §7.2 schema
    const noveltyConstraint = {
      avoid_tropes: this._buildAvoidTropes(selectedTemplate, artistic_intent),
      require_novelty_in: artistic_intent.require_novelty_in || ['pov', 'thematic_angle', 'structural_inversion'],
      novelty_score_threshold: noveltyThreshold,
      selected_template: selectedTemplate.id,
      template_choice_rationale: templateSelection.rationale,
    };

    // Phase 14 fix: publish initial consistency_context to InvariantBus.
    // creative_source is the root; downstream screenplay + script_auditor need
    // an initial context (empty 5-section schema) that gets populated as the
    // pipeline establishes facts. Production: LLM extraction of character/timeline/spatial
    // facts from kernel; here we publish an empty-but-valid context so downstream
    // consumers receive a real ConsistencyContext instance rather than null.
    if (invariants && typeof invariants.setConsistencyContext === 'function') {
      let consistencyContext;
      try {
        const { ConsistencyContext } = await import('../state/consistency-context.js');
        consistencyContext = new ConsistencyContext();
        // Seed: register protagonist knowledge state (scene_1 baseline)
        // Production will populate fully via LLM extraction in a later iteration
        if (kernel?.protagonist_desire) {
          consistencyContext.setCharacterKnowledge('protagonist', 'scene_1', {
            knows: ['own_desire'],
            does_not_know: [],
          });
        }
      } catch {
        consistencyContext = null;
      }
      if (consistencyContext) {
        invariants.setConsistencyContext(consistencyContext);
      }
    }

    return {
      node_id: this.id,
      is_v2_native: true,
      story_kernel: kernel,
      novelty_constraint: noveltyConstraint,
      commercial_mode: commercialMode,
      kernel_novelty_score: noveltyScore,
      creator_acceptance: 'pending_human_signoff', // per spec: pass/fail human gate
      meta: {
        interview_triggered: interviewTriggered,
        anti_trope_retries: antiTropeRetries,
        attempts,
        attempt_log: attemptLog,
        accepted,
        selected_template: selectedTemplate,
        schema_version: 'design-2026-06-16-prfp',
      },
    };
  }

  /**
   * Build list of tropes to avoid (per Pattern 3 explicit_anti_trope).
   * Combines template defaults + creator's anti_patterns.
   */
  _buildAvoidTropes(template, artisticIntent) {
    const defaults = {
      'classical_3_act': [],
      'save_the_cat_15': ['formulaic_b_story_romance'],
      'hero_journey_12': ['refusal_of_call_cliche'],
      'kishotenketsu_4': [],
      '短剧_爆款公式': [], // accepts tropes by design (commercial)
      'anti_structure': ['all_classical_tropes'],
    };
    const list = [...(defaults[template.id] || [])];
    if (Array.isArray(artisticIntent?.anti_patterns)) {
      list.push(...artisticIntent.anti_patterns);
    }
    return list;
  }

  /**
   * Heuristic: lived experience thin if anecdote < 100 chars or seed < 50 chars
   * (per fail_mode: lived_experience_thin trigger).
   */
  _detectThinInput(anecdote, seed) {
    return anecdote.length < 100 || seed.length < 50;
  }

  /**
   * Structured-interview fallback per fallback_strategy.
   * Generates 5 follow-up questions to draw out specificity.
   */
  async _structuredInterview(pipeline, anecdote, seed) {
    const questions = [
      '具体发生了什么?用 5 个感官细节描述当时的场景(看/听/触/嗅/味)。',
      '你当时的情绪是什么?哪一句话或动作最让你触动?',
      '这件事发生的物理空间是哪里?有哪些标志性物件?',
      '主角(或你自己)在那之后行为发生了什么变化?',
      '如果用一句话总结这件事的"反转"或"教训",会是什么?',
    ];

    // LLM-assisted expansion simulating creator's answers (production: human answers via UI)
    const llm = await this._getLLM(pipeline);
    if (llm) {
      try {
        const expanded = await llm.call({
          prompt: `Expand this anecdote using the structured interview questions.
Anecdote: ${anecdote}
Seed: ${seed}
Questions: ${questions.join(' | ')}

Return expanded_anecdote (200+ chars) and expanded_seed (100+ chars) as JSON.`,
          max_tokens: 800,
        });
        const parsed = JSON.parse(expanded);
        return {
          expanded_anecdote: parsed.expanded_anecdote || anecdote,
          expanded_seed: parsed.expanded_seed || seed,
          interview_questions: questions,
        };
      } catch (err) {
        // Fallback: passthrough original inputs
      }
    }

    return {
      expanded_anecdote: anecdote,
      expanded_seed: seed,
      interview_questions: questions,
      llm_unavailable: true,
    };
  }

  /**
   * Expand anecdote → story_kernel via LLM.
   * Anti-trope retry: add explicit anti-trope constraint in prompt on retry.
   * Phase 14: Pattern 5 (template structure) + Pattern 3 (anti-trope) wired in.
   */
  async _expandToKernel(pipeline, anecdote, seed, antiTropeRetry = 0, template = null, artisticIntent = {}) {
    const baseKernel = {
      logline: '',
      protagonist_desire: '',
      central_conflict: '',
      turning_points: [],
      resolution_stance: '',
      style_gene: {},
    };

    const llm = await this._getLLM(pipeline);
    if (!llm) {
      // Test/stub path: return placeholder kernel
      return {
        ...baseKernel,
        logline: `[stub] story from: ${anecdote.slice(0, 60)}...`,
        protagonist_desire: '[stub] protagonist wants something specific',
        central_conflict: '[stub] protagonist vs opposing force',
        turning_points: ['[stub] midpoint reversal'],
        resolution_stance: '[stub] bittersweet acceptance',
        style_gene: { mood: '[stub]', genre: '[stub]' },
        _stub: true,
      };
    }

    // Phase 14 Pattern 5: template structure guidance
    const templateStages = template?.stages
      ? `\n\n[TEMPLATE ${template.id}] Structure your kernel around these stages:\n${
          template.stages.map(s => `  - ${s.id}: ${s.function} (${Math.round(s.length_share * 100)}%)`).join('\n')
        }`
      : '';

    // Phase 14 Pattern 1: force_author_assistance_mode
    const authorAssistanceClause = `\n\n[AUTHOR ASSISTANCE MODE] You are NOT inventing a new story. You are the creator's condensation assistant. Use ONLY elements from the anecdote. Do NOT introduce characters, places, or events not present in the anecdote.`;

    const antiTropeClause = antiTropeRetry > 0
      ? `\n\n[ANTI-TROPE RETRY ${antiTropeRetry}] Avoid: ${this._buildAvoidTropes(template, artisticIntent).join(', ')}. Add ≥3 specific sensory details.`
      : '';

    const llmOutput = await llm.call({
      prompt: `Expand this lived experience into a story kernel.

Anecdote: ${anecdote}
Lived experience seed: ${seed}${authorAssistanceClause}${templateStages}${antiTropeClause}

Return JSON with: logline, protagonist_desire, central_conflict, turning_points (array of 3+), resolution_stance, style_gene {mood, genre, tone}.`,
      max_tokens: 1200,
    });

    try {
      return JSON.parse(llmOutput);
    } catch {
      return { ...baseKernel, _parse_error: true, raw_llm_output: llmOutput };
    }
  }

  /**
   * Score kernel novelty (stub: heuristic; production: trope-catalog embedding).
   */
  _scoreNovelty(kernel) {
    if (!kernel || kernel._stub) return 0.5;
    let score = 0.5;
    if (kernel.turning_points && kernel.turning_points.length >= 3) score += 0.1;
    if (kernel.style_gene && kernel.style_gene.mood && kernel.style_gene.mood.length > 10) score += 0.1;
    if (kernel.central_conflict && kernel.central_conflict.length > 30) score += 0.1;
    if (kernel._parse_error) score = 0.3;
    return Math.min(score, 1.0);
  }

  /**
   * Get LLM dispatch (lazy + optional — supports test mode without LLM).
   */
  async _getLLM(pipeline) {
    try {
      const mod = await import('../llm.js');
      return mod.llm || mod.default || null;
    } catch {
      return null;
    }
  }
}
