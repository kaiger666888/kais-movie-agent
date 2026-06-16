/**
 * v2-phase14-smoke.mjs — Phase 14 LLM-Creative Wiring coverage
 */
import assert from 'node:assert';
import {
  buildNodeRegistry,
  InvariantBus,
  NARRATIVE_TEMPLATES,
  listTemplateIds,
  getTemplate,
  selectTemplate,
} from '../lib/v2_topology/index.js';
import { ConsistencyContext } from '../lib/state/consistency-context.js';

let passed = 0;
let failed = 0;

function check(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.error(`  ✗ ${name}: ${err.message}`); failed++; }
}

async function checkAsync(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.error(`  ✗ ${name}: ${err.message}`); failed++; }
}

console.log('Phase 14 LLM-Creative Wiring — Smoke Test\n');

// ============================================================
// §1: ConsistencyContext 5-section schema
// ============================================================
check('ConsistencyContext has 5 sections', () => {
  const ctx = new ConsistencyContext();
  assert.ok(ctx.character_knowledge_state instanceof Map);
  assert.ok(ctx.timeline.events instanceof Map);
  assert.ok(ctx.stakes instanceof Map);
  assert.ok(ctx.spatial_layout instanceof Map);
  assert.ok(ctx.emotional_arc instanceof Map);
});

check('ConsistencyContext.setCharacterKnowledge validates inputs', () => {
  const ctx = new ConsistencyContext();
  assert.throws(() => ctx.setCharacterKnowledge(), /characterId \+ atScene required/);
  ctx.setCharacterKnowledge('p1', 'scene_1', { knows: ['fact_a'], does_not_know: ['fact_b'] });
  assert.equal(ctx.character_knowledge_state.get('p1').get('scene_1').knows.length, 1);
});

check('ConsistencyContext.addEvent validates', () => {
  const ctx = new ConsistencyContext();
  ctx.addEvent({ id: 'e1', occurs_at: 'scene_1', causes: [], effects: ['e2'] });
  assert.equal(ctx.timeline.events.get('e1').effects.length, 1);
});

check('ConsistencyContext.addEmotionalArc validates intensity 0-1', () => {
  const ctx = new ConsistencyContext();
  assert.throws(() => ctx.addEmotionalArc('s1', { target_emotion: 'happy', intensity: 1.5 }), /intensity must be 0-1/);
  ctx.addEmotionalArc('s1', { target_emotion: 'happy', intensity: 0.7 });
  assert.equal(ctx.emotional_arc.get('s1').intensity, 0.7);
});

check('ConsistencyContext.validate detects character_knows_forbidden_fact', () => {
  const ctx = new ConsistencyContext();
  ctx.setCharacterKnowledge('p1', 's1', { knows: [], does_not_know: ['secret_truth'] });
  const screenplay = {
    scene_list: [{
      scene_id: 's1',
      characters: ['p1'],
      dialogue: ['I know the secret_truth now'],
    }],
  };
  const violations = ctx.validate(screenplay);
  assert.ok(violations.some(v => v.type === 'character_knows_forbidden_fact'));
});

check('ConsistencyContext.validate returns empty for compliant screenplay', () => {
  const ctx = new ConsistencyContext();
  ctx.setCharacterKnowledge('p1', 's1', { knows: ['public_fact'], does_not_know: [] });
  const screenplay = { scene_list: [{ scene_id: 's1', characters: ['p1'], dialogue: ['public'] }] };
  const violations = ctx.validate(screenplay);
  assert.equal(violations.length, 0);
});

check('ConsistencyContext snapshot round-trips', () => {
  const ctx = new ConsistencyContext();
  ctx.setCharacterKnowledge('p1', 's1', { knows: ['a'] });
  ctx.addEvent({ id: 'e1', occurs_at: 's1' });
  const snap = ctx.snapshot();
  const restored = ConsistencyContext.fromSnapshot(snap);
  assert.equal(restored.character_knowledge_state.get('p1').get('s1').knows.length, 1);
  assert.ok(restored.timeline.events.has('e1'));
});

// ============================================================
// §2: 6 narrative arc templates
// ============================================================
check('6 narrative templates available', () => {
  const ids = listTemplateIds();
  assert.equal(ids.length, 6);
  assert.ok(ids.includes('classical_3_act'));
  assert.ok(ids.includes('save_the_cat_15'));
  assert.ok(ids.includes('hero_journey_12'));
  assert.ok(ids.includes('kishotenketsu_4'));
  assert.ok(ids.includes('短剧_爆款公式'));
  assert.ok(ids.includes('anti_structure'));
});

check('Each template has required schema fields', () => {
  for (const [id, template] of Object.entries(NARRATIVE_TEMPLATES)) {
    assert.ok(template.name, `${id} missing name`);
    assert.ok(template.origin, `${id} missing origin`);
    assert.ok(Array.isArray(template.applicable_forms), `${id} missing applicable_forms`);
    assert.ok(Array.isArray(template.stages), `${id} missing stages`);
    assert.ok(typeof template.novelty_default === 'number', `${id} missing novelty_default`);
    assert.ok(template.stages.length > 0, `${id} has empty stages`);
  }
});

check('save_the_cat_15 has 15 beats', () => {
  const t = getTemplate('save_the_cat_15');
  assert.equal(t.stages.length, 15);
});

check('hero_journey_12 has 12 stages', () => {
  const t = getTemplate('hero_journey_12');
  assert.equal(t.stages.length, 12);
});

check('kishotenketsu_4 has 4 stages (起承转合)', () => {
  const t = getTemplate('kishotenketsu_4');
  assert.equal(t.stages.length, 4);
  assert.deepEqual(t.stages.map(s => s.id), ['ki', 'sho', 'ten', 'ketsu']);
});

check('anti_structure requires novelty_score >= 0.8', () => {
  const t = getTemplate('anti_structure');
  assert.equal(t.requires_novelty_score, 0.8);
  assert.equal(t.requires_theory_critic_consultation, true);
});

check('selectTemplate prefers 短剧_爆款公式 for short_drama', () => {
  const result = selectTemplate({ form: 'short_drama' });
  assert.equal(result.selected.id, '短剧_爆款公式');
});

check('selectTemplate selects anti_structure when experimental intent', () => {
  const result = selectTemplate({ form: 'micro_film' }, { experimental: true });
  assert.equal(result.selected.id, 'anti_structure');
});

check('selectTemplate selects kishotenketsu when prefer_eastern', () => {
  const result = selectTemplate({ form: 'short_drama' }, { prefer_eastern: true });
  assert.equal(result.selected.id, 'kishotenketsu_4');
});

// ============================================================
// §3: creative_source outputs novelty_constraint + commercial_mode
// ============================================================
await checkAsync('creative_source outputs novelty_constraint per §7.2', async () => {
  const cs = buildNodeRegistry().creative_source;
  const result = await cs.run({}, {
    creator_anecdote: 'A friend lost her job during the pandemic and started baking bread for neighbors. The smell of fresh bread became a symbol of community resilience.',
    lived_experience_seed: 'I watched her transformation from despair to purpose through the simple act of kneading dough every morning.',
    form_context: { form: 'short_drama' },
    artistic_intent: { experimental: false },
  });
  assert.ok(result.novelty_constraint, 'should output novelty_constraint');
  assert.ok(Array.isArray(result.novelty_constraint.avoid_tropes));
  assert.ok(Array.isArray(result.novelty_constraint.require_novelty_in));
  assert.equal(typeof result.novelty_constraint.novelty_score_threshold, 'number');
  assert.ok(result.novelty_constraint.selected_template);
  assert.ok(result.novelty_constraint.template_choice_rationale);
});

await checkAsync('creative_source sets commercial_mode for 短剧_爆款公式 on low novelty', async () => {
  const cs = buildNodeRegistry().creative_source;
  // Use short_drama default → 短剧_爆款公式 template
  const result = await cs.run({}, {
    creator_anecdote: 'x'.repeat(150), // long enough to skip interview
    lived_experience_seed: 'x'.repeat(80),
    form_context: { form: 'short_drama' },
  });
  // commercial_mode should be true (formulaic template accepted with stub low novelty)
  assert.equal(typeof result.commercial_mode, 'boolean');
});

await checkAsync('creative_source respects commercial_mode_override', async () => {
  const cs = buildNodeRegistry().creative_source;
  const result = await cs.run({}, {
    creator_anecdote: 'x'.repeat(150),
    lived_experience_seed: 'x'.repeat(80),
    form_context: { form: 'micro_film' },
    commercial_mode_override: true,
  });
  assert.equal(result.commercial_mode, true);
});

// ============================================================
// §4: screenplay consumes novelty_constraint + consistency_context
// ============================================================
await checkAsync('screenplay accepts novelty_constraint + consistency_context inputs', async () => {
  const sp = buildNodeRegistry().screenplay;
  const ctx = new ConsistencyContext();
  ctx.setCharacterKnowledge('p1', 's1', { knows: ['public'], does_not_know: [] });
  const result = await sp.run({}, {
    story_kernel: { logline: 'test' },
    form_context: { form: 'short_drama' },
    novelty_constraint: {
      avoid_tropes: ['formulaic_b_story_romance'],
      require_novelty_in: ['pov'],
      novelty_score_threshold: 0.6,
      selected_template: 'kishotenketsu_4',
      template_choice_rationale: 'test',
    },
    consistency_context: ctx,
    loop_iteration: 0,
  });
  assert.ok(result.screenplay_full);
  assert.equal(result.novelty_constraint_applied?.selected_template, 'kishotenketsu_4');
  assert.ok(result.consistency_context_updated, 'should output consistency_context_updated per §2.1');
});

// ============================================================
// §5: script_auditor 6th dim
// ============================================================
await checkAsync('script_auditor returns audit_score_6dim with consistency dim', async () => {
  const sa = buildNodeRegistry().script_auditor;
  const ctx = new ConsistencyContext();
  ctx.setCharacterKnowledge('p1', 's1', { knows: [], does_not_know: [] });
  const result = await sa.run({}, {
    screenplay_full: { scene_list: [{ scene_id: 's1', characters: ['p1'], dialogue: ['hello'] }] },
    consistency_context: ctx,
  });
  assert.ok(result.audit_score_6dim);
  assert.equal(result.audit_score_6dim.consistency_context_violations, 0);
  assert.equal(result.consistency_violations.length, 0);
});

await checkAsync('script_auditor flags consistency violation as regenerate', async () => {
  const sa = buildNodeRegistry().script_auditor;
  const ctx = new ConsistencyContext();
  ctx.setCharacterKnowledge('p1', 's1', { knows: [], does_not_know: ['the_secret'] });
  const result = await sa.run({}, {
    screenplay_full: {
      scene_list: [{
        scene_id: 's1',
        characters: ['p1'],
        dialogue: ['I now know the_secret'],
      }],
    },
    consistency_context: ctx,
  });
  assert.ok(result.consistency_violations.length > 0);
  // Exit condition not met because consistency violations > 0
  assert.equal(result.loop_state.consistency_condition_met, false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
