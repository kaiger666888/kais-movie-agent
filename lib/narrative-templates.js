/**
 * narrative-templates.js — 6种叙事弧模板库 (from V2, adapted for V8)
 *
 * 用于 Step 3 大纲生成和 Step 5 剧本生成时作为 prompt 模板参考。
 * 支持：
 *   - 手动选择模板 ID
 *   - 自动选择（基于 form_context + artistic_intent）
 *   - 获取模板结构作为 prompt 注入
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
    novelty_default: 0.7,
  },

  '短剧_爆款公式': {
    id: '短剧_爆款公式',
    name: '短剧爆款公式 (Platform Algorithm-Tuned)',
    origin: '中国短剧平台算法驱动',
    applicable_forms: ['short_drama'],
    stages: [
      { id: 'hook_3s', function: '3秒钩子：视觉冲击 OR 冲突 OR 悬念', length_share: 0.05 },
      { id: 'setup_5s', function: '5秒设定：主角 + 核心矛盾', length_share: 0.08 },
      { id: 'escalation', function: '递进冲突（打脸/反转/升级）', length_share: 0.30 },
      { id: 'midpoint_checkpoint', function: '付费卡点：付费墙前悬念', length_share: 0.10 },
      { id: 'payoff_escalation', function: '付费后递进：更大赌注', length_share: 0.25 },
      { id: 'climax', function: '高潮：极致戏剧 + 身份揭晓', length_share: 0.15 },
      { id: 'resolution_hook', function: '结局 + 下集钩子', length_share: 0.07 },
    ],
    novelty_default: 0.3,
  },

  anti_structure: {
    id: 'anti_structure',
    name: 'Anti-Structure (Experimental)',
    origin: 'Vogler + experimental film tradition',
    applicable_forms: ['micro_film', 'feature'], // NOT short_drama
    stages: [
      { id: 'disorientation', function: '非线性/非因果开场', length_share: 0.30 },
      { id: 'thematic_clusters', function: '主题集群而非经典情节推进', length_share: 0.40 },
      { id: 'associative_climax', function: '联想式高潮，非冲突解决', length_share: 0.20 },
      { id: 'open_resolution', function: '开放式结局，抗拒收束', length_share: 0.10 },
    ],
    novelty_default: 0.9,
    note: '仅用于明确实验性艺术意图，需要 novelty_score ≥ 0.8',
  },
};

// ─── API ──────────────────────────────────────────────────

export function listTemplateIds() {
  return Object.keys(NARRATIVE_TEMPLATES);
}

export function getTemplate(id) {
  return NARRATIVE_TEMPLATES[id] || null;
}

/**
 * 自动选择模板。
 * @param {object} formContext — { form: 'short_drama'|'micro_film'|'feature' }
 * @param {object} [artisticIntent] — { experimental: bool, novelty_target: number, prefer_eastern: bool }
 * @returns {{ selected: object, rationale: string }}
 */
export function selectTemplate(formContext = {}, artisticIntent = {}) {
  const form = formContext.form || 'short_drama';
  const candidates = Object.values(NARRATIVE_TEMPLATES).filter(t =>
    t.applicable_forms.includes(form)
  );

  if (artisticIntent.experimental) {
    const anti = candidates.find(c => c.id === 'anti_structure');
    if (anti) return { selected: anti, rationale: '实验性意图 → 反结构模板' };
  }

  if (artisticIntent.prefer_eastern) {
    const kisho = candidates.find(c => c.id === 'kishotenketsu_4');
    if (kisho) return { selected: kisho, rationale: '东亚美学偏好 → 起承转合' };
  }

  if (form === 'short_drama') {
    const formula = candidates.find(c => c.id === '短剧_爆款公式');
    if (formula) return { selected: formula, rationale: '短剧形式 → 平台爆款公式' };
  }

  const classical = candidates.find(c => c.id === 'classical_3_act');
  return { selected: classical || candidates[0], rationale: `通用默认 → 三幕结构 (${form})` };
}

/**
 * 将模板结构转为可注入 prompt 的文本片段。
 */
export function templateToPrompt(template) {
  const stageText = template.stages.map((s, i) =>
    `  ${i + 1}. [${s.id}] ${(s.length_share * 100).toFixed(0)}%: ${s.function}`
  ).join('\n');

  return `叙事结构模板: ${template.name} (${template.origin})
共 ${template.stages.length} 个阶段:
${stageText}
默认新颖度: ${template.novelty_default}`;
}

export default NARRATIVE_TEMPLATES;
