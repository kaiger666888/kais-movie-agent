/**
 * creative_source — Layer 0 root node (intent origin)
 * v2.0 PRFP core_task (per 02-NODE-SPECS §2.1):
 *   从 6 个社会阶层的生活经验挖故事 kernel, 产出整合元意图
 *   (logline + 主角欲望 + 中央冲突 + 转折点 + 解决立场 + 风格基因)
 *
 * Phase 11 native v2.0 implementation.
 * Strategy:
 *   1. Validate creator_anecdote + lived_experience_seed (per fail_mode: lived_experience_thin)
 *   2. If thin → invoke structured-interview fallback (5 follow-up Qs)
 *   3. LLM-expand anecdote → story_kernel
 *   4. Score kernel_novelty_score (fail_mode: cliche_default → anti-trope retry)
 *   5. Persist as cross-cutting invariant (Phase 14: also sets consistency_context)
 */
import { NodeBase } from './_node-base.js';

const KERNEL_NOVELTY_THRESHOLD = 0.7;
const MAX_ANTI_TROPE_RETRIES = 2;

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
   * @param {object} [inputs.invariants] — InvariantBus instance
   */
  async run(pipeline, inputs = {}) {
    const { creator_anecdote, lived_experience_seed, invariants } = inputs;

    if (!creator_anecdote || !lived_experience_seed) {
      throw new Error(
        '[creative_source] Missing required inputs: creator_anecdote + lived_experience_seed (per NODE-02 io_contract)'
      );
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
      kernel = await this._expandToKernel(pipeline, effectiveAnecdote, effectiveSeed, antiTropeRetries);
      noveltyScore = this._scoreNovelty(kernel);

      attemptLog.push({
        attempt: attempts,
        novelty_score: noveltyScore,
        anti_trope_retry: antiTropeRetries,
      });

      if (noveltyScore >= KERNEL_NOVELTY_THRESHOLD) break;

      if (attempts > MAX_ANTI_TROPE_RETRIES) break;
      antiTropeRetries++;
    }

    const accepted = noveltyScore >= KERNEL_NOVELTY_THRESHOLD;

    return {
      node_id: this.id,
      is_v2_native: true,
      story_kernel: kernel,
      kernel_novelty_score: noveltyScore,
      creator_acceptance: 'pending_human_signoff', // per spec: pass/fail human gate
      meta: {
        interview_triggered: interviewTriggered,
        anti_trope_retries: antiTropeRetries,
        attempts,
        attempt_log: attemptLog,
        accepted,
        schema_version: 'design-2026-06-16-prfp',
      },
    };
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
   */
  async _expandToKernel(pipeline, anecdote, seed, antiTropeRetry = 0) {
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

    const antiTropeClause = antiTropeRetry > 0
      ? `\n\n[ANTI-TROPE RETRY ${antiTropeRetry}] Avoid these tropes: Save-the-Cat formulaic openings, mid-act-2 sag, mary-sue protagonist, deus-ex-machina resolution. Add ≥3 specific sensory details.`
      : '';

    const llmOutput = await llm.call({
      prompt: `Expand this lived experience into a story kernel.

Anecdote: ${anecdote}
Lived experience seed: ${seed}${antiTropeClause}

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
