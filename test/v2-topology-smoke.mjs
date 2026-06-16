/**
 * v2-topology-smoke.mjs — Phase 10 wrapper integrity check
 *
 * Tests lib/v2_topology/ in isolation. Does NOT import lib/v2_pipeline.js
 * (which transitively imports lib/pipeline.js → lib/gold-team-client.js →
 * broken CommonJS hmac_node.js — pre-existing V8 baseline issue, not in scope).
 *
 * V2Pipeline class is exercised separately via describe() shape check
 * that doesn't trigger full V8 load.
 */
import assert from 'node:assert';
import {
  NODE_CLASSES,
  TOTAL_NODES,
  LINEAR_NODE_COUNT,
  CONSULTATIVE_NODE_COUNT,
  LINEAR_EXECUTION_ORDER,
  buildNodeRegistry,
  createNode,
  listNodeIds,
} from '../lib/v2_topology/index.js';
import { resolvePipelineMode } from '../lib/v2_pipeline.js';

const expectedNodeIds = [
  'creative_source', 'style_genome', 'screenplay', 'script_auditor',
  'character_designer', 'cinematographer', 'prompt_injector', 'visual_executor',
  'continuity_auditor', 'audio_pipeline', 'editor', 'colorist',
  'hook_retention', 'quality_gate', 'compliance_gate', 'theory_critic',
];

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`);
    failed++;
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`);
    failed++;
  }
}

console.log('Phase 10 Topology Wrapper — Smoke Test\n');

check('TOTAL_NODES equals 16', () => assert.equal(TOTAL_NODES, 16));
check('LINEAR_NODE_COUNT equals 15', () => assert.equal(LINEAR_NODE_COUNT, 15));
check('CONSULTATIVE_NODE_COUNT equals 1', () => assert.equal(CONSULTATIVE_NODE_COUNT, 1));
check('NODE_CLASSES has 16 entries', () => assert.equal(Object.keys(NODE_CLASSES).length, 16));

check('All expected node IDs present', () => {
  for (const id of expectedNodeIds) {
    assert.ok(NODE_CLASSES[id], `Missing node class: ${id}`);
  }
});

check('LINEAR_EXECUTION_ORDER has 15 entries (excludes theory_critic)', () => {
  assert.equal(LINEAR_EXECUTION_ORDER.length, 15);
  assert.ok(!LINEAR_EXECUTION_ORDER.includes('theory_critic'));
});

check('listNodeIds returns all 16 IDs', () => {
  const ids = listNodeIds();
  assert.equal(ids.length, 16);
});

check('createNode throws on unknown ID', () => {
  assert.throws(() => createNode('nonexistent_node'), /Unknown node ID/);
});

check('buildNodeRegistry creates all 16 nodes', () => {
  const registry = buildNodeRegistry();
  assert.equal(Object.keys(registry).length, 16);
  for (const id of expectedNodeIds) {
    assert.ok(registry[id], `Registry missing ${id}`);
    assert.equal(registry[id].id, id);
  }
});

check('Each node has correct layer/role metadata', () => {
  const registry = buildNodeRegistry();
  assert.equal(registry.creative_source.layer, 0);
  assert.equal(registry.creative_source.role, 'root');
  assert.equal(registry.style_genome.layer, 1);
  assert.equal(registry.theory_critic.role, 'consultative');
  assert.equal(registry.quality_gate.layer, 6);
});

check('All 16 nodes are native v2.0 (no V8 pass-through post Phase 11-12)', () => {
  const registry = buildNodeRegistry();
  for (const id of Object.keys(registry)) {
    // Phase 11-12 migrated all nodes; v8PassthroughTargets is empty for all
    assert.equal(registry[id].v8PassthroughTargets.length, 0, `${id} should have no V8 targets`);
    assert.equal(registry[id].isV2Native, true, `${id} should be v2 native`);
  }
});

check('resolvePipelineMode defaults to v2 (Phase 13 flip)', () => {
  delete process.env.KAI_PIPELINE_MODE;
  assert.equal(resolvePipelineMode(), 'v2');
});

check('resolvePipelineMode accepts v8/v2/parallel', () => {
  assert.equal(resolvePipelineMode('v8'), 'v8');
  assert.equal(resolvePipelineMode('v2'), 'v2');
  assert.equal(resolvePipelineMode('v2.0'), 'v2');
  assert.equal(resolvePipelineMode('parallel'), 'parallel');
  assert.equal(resolvePipelineMode('ab'), 'parallel');
});

check('resolvePipelineMode rejects unknown → falls back to v2 (Phase 13)', () => {
  assert.equal(resolvePipelineMode('garbage'), 'v2');
});

check('Each node describes() returns valid shape', () => {
  const registry = buildNodeRegistry();
  for (const [id, node] of Object.entries(registry)) {
    const d = node.describe();
    assert.equal(d.id, id);
    assert.equal(typeof d.layer, 'number');
    assert.equal(typeof d.role, 'string');
    assert.equal(d.specVersion, 'design-2026-06-16-prfp');
  }
});

await checkAsync('theory_critic + hook_retention return valid node_id markers', async () => {
  const registry = buildNodeRegistry();
  const tcResult = await registry.theory_critic.run({}, { test: true });
  assert.equal(tcResult.node_id, 'theory_critic');
  assert.equal(tcResult.consultative, true);

  // Phase 12 native hook_retention requires screenplay_full (or form!=short_drama to skip)
  const hrResult = await registry.hook_retention.run({}, {
    screenplay_full: { scene_list: [] },
    form_context: { form: 'feature' },
  });
  assert.equal(hrResult.node_id, 'hook_retention');
  assert.equal(hrResult.skipped, true); // form=feature triggers skip
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
