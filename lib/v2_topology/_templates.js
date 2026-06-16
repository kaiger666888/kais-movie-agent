/**
 * _templates.js — 6 narrative arc templates per 04-LLM-CREATIVE-DISTILLATION.md §6.1
 *
 * Per PITFALLS §4.6 + CREATIVE-06: template library must include MULTIPLE
 * narrative arc templates, not single Save-the-Cat. creative_source uses
 * Pattern 5 (select_template_first) to force template selection + rationale.
 *
 * 6 templates:
 *   1. classical_3_act (Field) — universal, novelty=0.5
 *   2. save_the_cat_15 (Blake Snyder) — universal/长片, novelty=0.4
 *   3. hero_journey_12 (Campbell) — universal, novelty=0.4
 *   4. kishotenketsu_4 (起承转合) — 短剧+微电影, novelty=0.7
 *   5. 短剧_爆款公式 (platform-tuned) — 短剧 only, novelty=0.3
 *   6. anti_structure (experimental) — experimental, novelty=0.9
 */

export const NARRATIVE_TEMPLATES = {
  classical_3_act: {
    id: 'classical_3_act',
    name: 'Classical 3-Act Structure',
    origin: 'Field《剧本》',
    applicable_forms: ['short_drama', 'micro_film', 'feature'],
    stages: [
      { id: 'act1', function: 'Setup: establish protagonist, world, inciting incident', length_share: 0.25 },
      { id: 'act2', function: 'Confrontation: rising action, midpoint, complications', length_share: 0.50 },
      { id: 'act3', function: 'Resolution: climax, falling action, denouement', length_share: 0.25 },
    ],
    novelty_default: 0.5,
    compatible_with: ['creative_source', 'screenplay'],
  },

  save_the_cat_15: {
    id: 'save_the_cat_15',
    name: 'Save the Cat! 15 Beats',
    origin: 'Blake Snyder',
    applicable_forms: ['short_drama', 'micro_film', 'feature'],
    stages: [
      { id: 'opening_image', function: 'Set tone; visual thesis', length_share: 0.03 },
      { id: 'theme_stated', function: 'Central theme hinted', length_share: 0.04 },
      { id: 'set_up', function: 'Introduce protagonist world', length_share: 0.08 },
      { id: 'catalyst', function: 'Inciting incident', length_share: 0.05 },
      { id: 'debate', function: 'Hesitation/reflection', length_share: 0.07 },
      { id: 'break_into_two', function: 'Commit to adventure', length_share: 0.05 },
      { id: 'b_story', function: 'Relationship subplot', length_share: 0.08 },
      { id: 'fun_and_games', function: 'Promise of premise delivered', length_share: 0.12 },
      { id: 'midpoint', function: 'False victory/defeat + stakes raised', length_share: 0.08 },
      { id: 'bad_guys_close_in', function: 'Antagonist pressure', length_share: 0.08 },
      { id: 'all_is_lost', function: 'Lowest point', length_share: 0.06 },
      { id: 'dark_night_of_soul', function: 'Reflection before resolution', length_share: 0.07 },
      { id: 'break_into_three', function: 'Synthesis: plan + theme', length_share: 0.05 },
      { id: 'finale', function: 'Climax: protagonist executes plan', length_share: 0.10 },
      { id: 'final_image', function: 'Callback to opening; opposite state', length_share: 0.04 },
    ],
    novelty_default: 0.4,
    compatible_with: ['creative_source', 'screenplay'],
  },

  hero_journey_12: {
    id: 'hero_journey_12',
    name: "Hero's Journey (12 stages)",
    origin: 'Joseph Campbell',
    applicable_forms: ['short_drama', 'micro_film', 'feature'],
    stages: [
      { id: 'ordinary_world', function: 'Hero before adventure', length_share: 0.08 },
      { id: 'call_to_adventure', function: 'Challenge presented', length_share: 0.06 },
      { id: 'refusal_of_call', function: 'Initial reluctance', length_share: 0.05 },
      { id: 'meeting_mentor', function: 'Wisdom/preparation', length_share: 0.07 },
      { id: 'crossing_threshold', function: 'Commit to special world', length_share: 0.08 },
      { id: 'tests_allies_enemies', function: 'Build capability + relationships', length_share: 0.12 },
      { id: 'approach_inmost_cave', function: 'Preparation for ordeal', length_share: 0.08 },
      { id: 'ordeal', function: 'Confront greatest fear', length_share: 0.10 },
      { id: 'reward', function: 'Claim treasure', length_share: 0.08 },
      { id: 'the_road_back', function: 'Begin return', length_share: 0.08 },
      { id: 'resurrection', function: 'Final test of transformation', length_share: 0.12 },
      { id: 'return_elixir', function: 'Return with gift for world', length_share: 0.08 },
    ],
    novelty_default: 0.4,
    compatible_with: ['creative_source', 'screenplay'],
  },

  kishotenketsu_4: {
    id: 'kishotenketsu_4',
    name: '起承转合 (Ki-Shō-Ten-Ketsu)',
    origin: '东亚叙事传统',
    applicable_forms: ['short_drama', 'micro_film'],
    stages: [
      { id: 'ki', function: '起 — Establish setting + characters', length_share: 0.20 },
      { id: 'sho', function: '承 — Develop expected trajectory', length_share: 0.30 },
      { id: 'ten', function: '转 — Introduce unexpected turn (the twist)', length_share: 0.30 },
      { id: 'ketsu', function: '合 — Resolve with new understanding', length_share: 0.20 },
    ],
    novelty_default: 0.7, // Higher novelty: Western LLM training data less familiar
    compatible_with: ['creative_source', 'screenplay'],
  },

  '短剧_爆款公式': {
    id: '短剧_爆款公式',
    name: '短剧爆款公式 (Platform Algorithm-Tuned)',
    origin: '中国短剧平台算法驱动',
    applicable_forms: ['short_drama'],
    stages: [
      { id: 'hook_3s', function: '3-second hook: visual shock OR conflict OR mystery', length_share: 0.05 },
      { id: 'setup_5s', function: '5-second setup: protagonist + central tension', length_share: 0.08 },
      { id: 'escalation', function: 'Escalating conflict beats (打脸 / 反转 / 升级)', length_share: 0.30 },
      { id: 'midpoint_checkpoint', function: 'Paid checkpoint: cliffhanger before paywall', length_share: 0.10 },
      { id: 'payoff_escalation', function: 'Post-paywall escalation: bigger stakes', length_share: 0.25 },
      { id: 'climax', function: 'Climax: maximal drama + identity reveal', length_share: 0.15 },
      { id: 'resolution_hook', function: 'Resolution + next-episode hook', length_share: 0.07 },
    ],
    novelty_default: 0.3, // Low novelty — formulaic
    compatible_with: ['creative_source', 'screenplay'],
    note: 'Low novelty by design; commercial_mode flag recommended when this template selected',
  },

  anti_structure: {
    id: 'anti_structure',
    name: 'Anti-Structure (Experimental)',
    origin: 'Vogler + experimental film tradition',
    applicable_forms: ['micro_film', 'feature'], // NOT short_drama (algorithm risk)
    stages: [
      { id: 'disorientation', function: 'Establish non-linear / non-causal opening', length_share: 0.30 },
      { id: 'thematic_clusters', function: 'Thematic motifs without classical plot progression', length_share: 0.40 },
      { id: 'associative_climax', function: 'Climax via association, not conflict resolution', length_share: 0.20 },
      { id: 'open_resolution', function: 'Open ending resisting closure', length_share: 0.10 },
    ],
    novelty_default: 0.9,
    compatible_with: ['creative_source', 'screenplay'],
    requires_novelty_score: 0.8, // §6.4 — anti_structure requires novelty_score >= 0.8
    requires_theory_critic_consultation: true,
    note: 'Use only with explicit experimental artistic intent; theory_critic consultation triggered',
  },
};

/**
 * List all 6 template IDs.
 */
export function listTemplateIds() {
  return Object.keys(NARRATIVE_TEMPLATES);
}

/**
 * Get a template by ID.
 */
export function getTemplate(id) {
  return NARRATIVE_TEMPLATES[id] || null;
}

/**
 * Select appropriate template based on form context + artistic intent.
 * @param {object} formContext — { form: 'short_drama'|'micro_film'|'feature' }
 * @param {object} [artisticIntent] — { experimental: bool, novelty_target: number, prefer_eastern: bool }
 * @returns {object} selected template + rationale
 */
export function selectTemplate(formContext = {}, artisticIntent = {}) {
  const form = formContext.form || 'short_drama';
  const candidates = Object.values(NARRATIVE_TEMPLATES).filter(t =>
    t.applicable_forms.includes(form)
  );

  // Experimental intent → prefer anti_structure
  if (artisticIntent.experimental) {
    const anti = candidates.find(c => c.id === 'anti_structure');
    if (anti) {
      return {
        selected: anti,
        rationale: 'Experimental artistic intent detected; anti_structure template selected. Requires novelty_score >= 0.8 + theory_critic consultation.',
      };
    }
  }

  // Eastern aesthetic preference → kishotenketsu
  if (artisticIntent.prefer_eastern) {
    const kisho = candidates.find(c => c.id === 'kishotenketsu_4');
    if (kisho) {
      return {
        selected: kisho,
        rationale: 'Eastern aesthetic preference; kishotenketsu 4-act selected (higher novelty against Western training data).',
      };
    }
  }

  // Short drama default → 短剧_爆款公式
  if (form === 'short_drama') {
    const formula = candidates.find(c => c.id === '短剧_爆款公式');
    if (formula) {
      return {
        selected: formula,
        rationale: 'Short drama form; platform algorithm-tuned formula selected. commercial_mode flag recommended.',
      };
    }
  }

  // Universal fallback → classical_3_act
  const classical = candidates.find(c => c.id === 'classical_3_act');
  return {
    selected: classical || candidates[0],
    rationale: `Classical 3-act structure selected as universal default for form=${form}.`,
  };
}
