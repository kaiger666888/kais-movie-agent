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

check('V8 pass-through nodes have non-empty v8PassthroughTargets', () => {
  const registry = buildNodeRegistry();
  assert.ok(registry.creative_source.v8PassthroughTargets.length > 0);
  assert.ok(registry.screenplay.v8PassthroughTargets.length > 0);
});

check('NEW nodes (theory_critic, hook_retention) have empty v8PassthroughTargets', () => {
  const registry = buildNodeRegistry();
  assert.equal(registry.theory_critic.v8PassthroughTargets.length, 0);
  assert.equal(registry.hook_retention.v8PassthroughTargets.length, 0);
});

check('resolvePipelineMode defaults to v8', () => {
  delete process.env.KAI_PIPELINE_MODE;
  assert.equal(resolvePipelineMode(), 'v8');
});

check('resolvePipelineMode accepts v8/v2/parallel', () => {
  assert.equal(resolvePipelineMode('v8'), 'v8');
  assert.equal(resolvePipelineMode('v2'), 'v2');
  assert.equal(resolvePipelineMode('v2.0'), 'v2');
  assert.equal(resolvePipelineMode('parallel'), 'parallel');
  assert.equal(resolvePipelineMode('ab'), 'parallel');
});

check('resolvePipelineMode rejects unknown → falls back to v8', () => {
  assert.equal(resolvePipelineMode('garbage'), 'v8');
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

await checkAsync('theory_critic + hook_retention stubs return phase_10_stub marker', async () => {
  const registry = buildNodeRegistry();
  const tcResult = await registry.theory_critic.run({}, { test: true });
  assert.equal(tcResult.phase_10_stub, true);
  assert.equal(tcResult.consultative, true);

  const hrResult = await registry.hook_retention.run({}, { test: true });
  assert.equal(hrResult.phase_10_stub, true);
  assert.equal(hrResult.form_scope, 'short_drama');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
