/**
 * v2-phase12-smoke.mjs — Phase 12 Layer 4-6 native migration coverage
 */
import assert from 'node:assert';
import { buildNodeRegistry, InvariantBus } from '../lib/v2_topology/index.js';
import { V2Pipeline, resolvePipelineMode } from '../lib/v2_pipeline.js';

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

console.log('Phase 12 Layer 4-6 Native Migration — Smoke Test\n');

const registry = buildNodeRegistry();

const layer46Nodes = [
  'audio_pipeline', 'editor', 'colorist',
  'hook_retention', 'quality_gate', 'compliance_gate', 'theory_critic',
];

check('All 7 Layer 4-6 nodes are v2 native', () => {
  for (const id of layer46Nodes) {
    assert.ok(registry[id].isV2Native, `${id} should be isV2Native=true`);
  }
});

check('All 16 nodes now native v2.0 (no V8 pass-through remaining)', () => {
  // All Layer 0-6 nodes (15 linear + 1 consultative = 16) are native
  for (const id of Object.keys(registry)) {
    assert.ok(registry[id].isV2Native, `${id} should be isV2Native=true`);
  }
});

await checkAsync('audio_pipeline runs 5 sub-steps', async () => {
  const ap = registry.audio_pipeline;
  const result = await ap.run({}, {
    screenplay_full: { scene_list: [{ scene_id: 's1', characters: ['p'], dialogue: ['hello'], duration_s: 3 }] },
    generated_visuals: [{ shot_id: 's1', scene_id: 's1', duration_s: 3 }],
    invariants: (() => { const b = new InvariantBus(); b.setCharacterAsset('p', { name: 'P', voice_profile: { tone: 'warm' } }); return b; })(),
  });
  assert.ok(result.mixed_audio);
  assert.equal(result.mixed_audio.sub_steps_executed.length, 5);
  assert.deepEqual(result.mixed_audio.sub_steps_executed, ['voicer', 'lip_sync', 'composer', 'foley', 'mixer']);
});

await checkAsync('editor runs Murch self-audit + emits human_review_gate_2', async () => {
  const ed = registry.editor;
  const result = await ed.run({}, {
    screenplay_full: { scene_list: [{ scene_id: 's1', duration_s: 3 }], three_act_structure: { act1: 'a', act2: 'b', act3: 'c' } },
    generated_visuals: [{ shot_id: 's1' }],
    mixed_audio: { mixed_audio: { mixed_track: { mixed_track: 'stub://mix.wav' } } },
  });
  assert.ok(result.edited_sequence);
  assert.ok(result.murch_self_audit);
  assert.equal(typeof result.murch_rhythm_score, 'number');
  assert.ok(result.human_review_gate_2);
  assert.equal(result.human_review_gate_2.gate_type, 'human_review_gate_2');
  assert.equal(result.human_review_gate_2.review_budget_minutes, 5);
});

await checkAsync('colorist applies LUT based on style_genome', async () => {
  const col = registry.colorist;
  const bus = new InvariantBus();
  bus.setStyleGenome({
    palette: { primary_hex: '#FF0000' },
    composition: {}, rhythm: {}, texture: {},
    emotional_tone: { lighting_mood: 'tense', color_temperature_k: 4500 },
  });
  const result = await col.run({}, {
    edited_sequence: { cut_points: [{ scene_id: 's1' }], total_duration_s: 30 },
    invariants: bus,
  });
  assert.ok(result.color_graded_sequence.lut_applied);
  assert.match(result.color_graded_sequence.lut_applied.lut_id, /tense/);
  assert.equal(typeof result.style_alignment_score, 'number');
});

await checkAsync('hook_retention skips for non-short_drama form', async () => {
  const hr = registry.hook_retention;
  const result = await hr.run({}, {
    screenplay_full: { scene_list: [] },
    form_context: { form: 'feature' },
  });
  assert.equal(result.skipped, true);
  assert.match(result.skip_reason, /form_scope=short_drama/);
});

await checkAsync('hook_retention runs for short_drama', async () => {
  const hr = registry.hook_retention;
  const result = await hr.run({}, {
    screenplay_full: {
      scene_list: [{ scene_id: 's1', action: 'A woman walks into a dark room slowly', dialogue: ['Where am I?'], duration_s: 4 }],
      form_adaptations: { paid_checkpoint_pacing: 'midpoint', vertical_framing: true },
    },
    form_context: { form: 'short_drama' },
  });
  assert.equal(result.skipped, undefined);
  assert.ok(result.hook_pacing_recommendations);
  assert.equal(typeof result.hook_pacing_recommendations.hook_strength_score, 'number');
});

await checkAsync('quality_gate returns multi-dim score + verdict', async () => {
  const qg = registry.quality_gate;
  const result = await qg.run({}, {
    color_graded_sequence: { total_duration_s: 75 },
    mixed_audio: { mixed_audio: { lufs_final: -14 } },
    form_context: { form: 'short_drama', target_platform: 'douyin' },
  });
  assert.ok(result.quality_score_multidim);
  assert.ok(['accept', 'reject', 'escalate'].includes(result.verdict));
  assert.ok(result.quality_score_multidim.murch_six_dim);
});

await checkAsync('compliance_gate runs pre_check + final merged', async () => {
  const cg = registry.compliance_gate;
  const result = await cg.run({}, {
    quality_approved_sequence: { total_duration_s: 75 },
    form_context: { target_platform: 'douyin' },
    screenplay_full: { scene_list: [] },
  });
  assert.ok(['accept', 'reject'].includes(result.compliance_verdict));
  assert.ok(result.pre_check);
  assert.ok(result.final_check);
  assert.deepEqual(result.sub_steps_executed, ['pre_check', 'final']);
});

await checkAsync('compliance_gate short-circuits on hard violation', async () => {
  const cg = registry.compliance_gate;
  const result = await cg.run({}, {
    quality_approved_sequence: { total_duration_s: 75 },
    form_context: { target_platform: 'douyin' },
    screenplay_full: { scene_list: [{ dialogue: ['promote_gambling_platform is here'] }] },
  });
  assert.equal(result.compliance_verdict, 'reject');
  assert.ok(result.final_check_short_circuited);
});

await checkAsync('theory_critic consult() API works (creator-pulled)', async () => {
  const tc = registry.theory_critic;
  const result = await tc.consult({}, {
    consultation_question: 'Is my midpoint reversal too formulaic?',
    pipeline_state_snapshot: { phase: 'screenplay' },
  });
  assert.equal(result.consultation_invoked, true);
  assert.ok(result.theoretical_critique);
  assert.ok(result.theoretical_critique.recommendations);
});

await checkAsync('theory_critic run() returns consultative marker', async () => {
  const tc = registry.theory_critic;
  const result = await tc.run({}, {});
  assert.equal(result.consultative, true);
  assert.equal(result.auto_invocation_skipped, true);
});

await checkAsync('V2Pipeline.invokeTheoryCritic() dispatches correctly', async () => {
  const pipeline = new V2Pipeline({}, 'v2');
  const result = await pipeline.invokeTheoryCritic(
    'How do I balance artistic intent with platform algorithmic preferences?',
    { phase: 'compliance_gate' }
  );
  assert.equal(result.consultation_invoked, true);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
