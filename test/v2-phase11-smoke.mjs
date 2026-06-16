/**
 * v2-phase11-smoke.mjs — Phase 11 Layer 0-3 native migration coverage
 *
 * Verifies:
 *   1. All 9 Layer 0-3 nodes report is_v2_native: true
 *   2. InvariantBus propagates style_genome_5d + character_assets
 *   3. creative_source runs with required inputs
 *   4. style_genome publishes to invariants
 *   5. character_designer publishes to invariants
 *   6. screenplay + script_auditor loop terminates within 3 iter (mock)
 *   7. visual_executor + continuity_auditor loop terminates within 2 iter (mock)
 *   8. prompt_injector builds model_prompts with embedded invariants
 *   9. cinematographer implements composition_lock sub-steps
 */
import assert from 'node:assert';
import {
  buildNodeRegistry,
  InvariantBus,
} from '../lib/v2_topology/index.js';

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

console.log('Phase 11 Layer 0-3 Native Migration — Smoke Test\n');

const registry = buildNodeRegistry();

const layer03Nodes = [
  'creative_source', 'style_genome', 'character_designer',
  'screenplay', 'script_auditor', 'cinematographer',
  'prompt_injector', 'visual_executor', 'continuity_auditor',
];

check('All 9 Layer 0-3 nodes are v2 native', () => {
  for (const id of layer03Nodes) {
    assert.ok(registry[id].isV2Native, `${id} should be isV2Native=true`);
  }
});

check('Layer 4-6 nodes still V8 pass-through (NOT yet migrated)', () => {
  // Phase 11 scope is Layer 0-3 only; Layer 4-6 in Phase 12
  assert.equal(registry.audio_pipeline.isV2Native, false);
  assert.equal(registry.editor.isV2Native, false);
  assert.equal(registry.colorist.isV2Native, false);
  assert.equal(registry.hook_retention.isV2Native, false);
  assert.equal(registry.quality_gate.isV2Native, false);
  assert.equal(registry.compliance_gate.isV2Native, false);
});

check('InvariantBus validates 5D style genome', () => {
  const bus = new InvariantBus();
  assert.throws(() => bus.setStyleGenome({}), /missing dimension/);
  bus.setStyleGenome({
    palette: {}, composition: {}, rhythm: {}, texture: {}, emotional_tone: {},
  });
  const sg = bus.getStyleGenome();
  assert.ok(sg && sg.palette);
});

check('InvariantBus tracks character assets', () => {
  const bus = new InvariantBus();
  bus.setCharacterAsset('protagonist', { name: 'Hero', face: {} });
  assert.equal(bus.getCharacterAssets().length, 1);
  assert.equal(bus.getCharacterAsset('protagonist').name, 'Hero');
});

await checkAsync('creative_source runs with required inputs', async () => {
  const cs = registry.creative_source;
  const result = await cs.run({}, {
    creator_anecdote: 'A friend lost her job during the pandemic and started baking bread for neighbors. The smell of fresh bread became a symbol of community resilience.',
    lived_experience_seed: 'I watched her transformation from despair to purpose through the simple act of kneading dough every morning.',
  });
  assert.equal(result.node_id, 'creative_source');
  assert.ok(result.story_kernel, 'should produce story_kernel');
  assert.equal(typeof result.kernel_novelty_score, 'number');
});

await checkAsync('creative_source rejects missing inputs', async () => {
  const cs = registry.creative_source;
  await assert.rejects(() => cs.run({}, {}), /Missing required inputs/);
});

await checkAsync('style_genome publishes to invariants', async () => {
  const sg = registry.style_genome;
  const bus = new InvariantBus();
  const result = await sg.run({}, {
    story_kernel: { logline: 'test', style_gene: { mood: 'hopeful', genre: 'drama' } },
    invariants: bus,
  });
  assert.ok(result.style_genome_5d);
  assert.ok(result.published_to_invariants);
  assert.ok(bus.getStyleGenome(), 'invariant bus should have style genome');
  for (const dim of ['palette', 'composition', 'rhythm', 'texture', 'emotional_tone']) {
    assert.ok(dim in bus.getStyleGenome(), `bus should have ${dim}`);
  }
});

await checkAsync('character_designer publishes to invariants', async () => {
  const cd = registry.character_designer;
  const bus = new InvariantBus();
  const result = await cd.run({}, {
    story_kernel: { logline: 'test' },
    invariants: bus,
  });
  assert.ok(Array.isArray(result.character_assets));
  assert.ok(result.character_assets.length > 0);
  assert.ok(bus.getCharacterAssets().length > 0);
});

await checkAsync('screenplay runs and signals awaiting_critic', async () => {
  const sp = registry.screenplay;
  const result = await sp.run({}, {
    story_kernel: { logline: 'test' },
    form_context: { form: 'short_drama', target_platform: 'douyin' },
    loop_iteration: 0,
  });
  assert.ok(result.screenplay_full);
  assert.equal(result.awaiting_critic, true);
});

await checkAsync('script_auditor returns verdict + loop_state', async () => {
  const sa = registry.script_auditor;
  const result = await sa.run({}, {
    screenplay_full: { scene_list: [{ scene_id: 's1' }], three_act_structure: { act1: 'a', act2: 'b', act3: 'c' } },
    loop_iteration: 0,
  });
  assert.ok(['accept', 'regenerate', 'escalate_human'].includes(result.verdict));
  assert.ok(result.loop_state);
  assert.equal(result.loop_state.max_iter, 3);
  assert.equal(result.loop_state.cost_ceiling_per_iter_yuan, 5);
});

await checkAsync('cinematographer implements 3 sub-steps', async () => {
  const cin = registry.cinematographer;
  const bus = new InvariantBus();
  bus.setStyleGenome({ palette: {}, composition: {}, rhythm: {}, texture: {}, emotional_tone: {} });
  bus.setCharacterAsset('p', { name: 'P', face: {} });
  const result = await cin.run({}, {
    screenplay_full: { scene_list: [{ scene_id: 's1', location: 'room' }] },
    invariants: bus,
  });
  assert.ok(result.visual_intent);
  assert.ok(result.visual_intent.mise_en_scene);
  assert.ok(result.visual_intent.shot_list);
  assert.ok(result.visual_intent.composition_lock);
});

await checkAsync('prompt_injector embeds invariants into prompts', async () => {
  const pi = registry.prompt_injector;
  const bus = new InvariantBus();
  bus.setStyleGenome({
    palette: { primary_hex: '#3A506B' },
    composition: { framing_pattern: 'rule_of_thirds' },
    rhythm: { pacing_pattern: 'legato', avg_shot_duration_s: 4 },
    texture: { finish_quality: 'glossy', grain_level: 0.3 },
    emotional_tone: { lighting_mood: 'hopeful', color_temperature_k: 5500 },
  });
  bus.setCharacterAsset('p', {
    name: 'Hero', face: { ethnicity: 'Asian', age_range: '30-40' },
    wardrobe: { primary_outfit: 'jacket', color_palette: ['blue'] },
    tics: ['smiles'],
  });
  const result = await pi.run({}, {
    visual_intent: { shot_list: [{ shot_id: 's1', scene_id: 'sc1', shot_type: 'wide' }] },
    invariants: bus,
  });
  assert.ok(result.model_prompts);
  assert.equal(result.model_prompts.length, 1);
  assert.match(result.model_prompts[0].prompt, /#3A506B/);
  assert.match(result.model_prompts[0].prompt, /Hero/);
  assert.ok(result.consistency_context);
});

await checkAsync('visual_executor runs with stubs (no GPU)', async () => {
  const ve = registry.visual_executor;
  const result = await ve.run({}, {
    model_prompts: [{ shot_id: 's1', scene_id: 'sc1', prompt: 'test' }],
    consistency_context: { carry_strategy: 'per_shot_prompt_suffix' },
    loop_iteration: 0,
  });
  assert.ok(result.generated_visuals);
  assert.equal(result.generated_visuals.length, 1);
  assert.equal(result.awaiting_critic, true);
});

await checkAsync('continuity_auditor returns verdict + loop_state', async () => {
  const ca = registry.continuity_auditor;
  const bus = new InvariantBus();
  bus.setCharacterAsset('p', { name: 'Hero', face: {} });
  const result = await ca.run({}, {
    generated_visuals: [{ shot_id: 's1', _stub: true }],
    invariants: bus,
    loop_iteration: 0,
  });
  assert.ok(['accept', 'regenerate', 'escalate_human'].includes(result.verdict));
  assert.ok(result.loop_state);
  assert.equal(result.loop_state.max_iter, 2);
  assert.equal(result.loop_state.cost_ceiling_per_iter_yuan, 50);
});

await checkAsync('Mock screenplay↔script_auditor loop terminates within 3 iter', async () => {
  // Simulate the loop logic directly (v2_pipeline._execLoopWithCritic in production)
  const sp = registry.screenplay;
  const sa = registry.script_auditor;
  const kernel = { logline: 'test' };
  let iter = 0;
  let lastCritic = null;
  const maxSafety = 10;

  while (iter < maxSafety) {
    const spResult = await sp.run({}, {
      story_kernel: kernel,
      loop_iteration: iter,
      regeneration_feedback: lastCritic?.regeneration_feedback || null,
    });
    lastCritic = await sa.run({}, {
      screenplay_full: spResult.screenplay_full,
      loop_iteration: iter,
    });
    iter++;
    if (lastCritic.verdict === 'accept' || lastCritic.verdict === 'escalate_human') break;
    if (lastCritic.loop_state.max_iter_reached) break;
  }

  assert.ok(iter <= 3, `loop should terminate within 3 iter (got ${iter})`);
});

await checkAsync('Mock visual_executor↔continuity_auditor loop terminates within 2 iter', async () => {
  const ve = registry.visual_executor;
  const ca = registry.continuity_auditor;
  const bus = new InvariantBus();
  bus.setCharacterAsset('p', { name: 'Hero', face: {} });
  const prompts = [{ shot_id: 's1', scene_id: 'sc1', prompt: 'test' }];
  const consistencyCtx = { carry_strategy: 'stub' };

  let iter = 0;
  let lastCritic = null;
  const maxSafety = 10;

  while (iter < maxSafety) {
    const veResult = await ve.run({}, {
      model_prompts: prompts,
      consistency_context: consistencyCtx,
      loop_iteration: iter,
      regeneration_feedback: lastCritic?.regeneration_feedback || null,
    });
    lastCritic = await ca.run({}, {
      generated_visuals: veResult.generated_visuals,
      invariants: bus,
      loop_iteration: iter,
    });
    iter++;
    if (lastCritic.verdict === 'accept' || lastCritic.verdict === 'escalate_human') break;
    if (lastCritic.loop_state.max_iter_reached) break;
  }

  assert.ok(iter <= 2, `loop should terminate within 2 iter (got ${iter})`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
