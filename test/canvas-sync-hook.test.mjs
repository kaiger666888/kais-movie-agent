/**
 * canvas-sync-hook.test.mjs — V6 多产出物同步的纯函数测试。
 *
 * 验证:
 *   1. extractArtifacts 能从 P04 风格的 result 中抽出 15 个 artifact
 *      (4 characters + 6 L1 anchors + 5 downstream)
 *   2. buildPhaseGraph 生成的节点/连线 ID 匹配 project 9999 pattern
 *   3. 深层路径 (result.summary.result.outputs) 与扁平回退 (result.summary) 都能工作
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractArtifacts,
  buildPhaseGraph,
  computePhaseIndex,
  defaultPhaseMapper,
} from '../lib/canvas-sync-hook.js';

// ─── Fixtures ────────────────────────────────────────────

const P04_PHASE = {
  id: 'character-generation',
  name: '主角生成(3图一体)',
  stage: 'character-gen',
  stageOrder: 6,
  review: false,
};

/** Mock volvo P04 result — 4 characters + 6 L1 anchors + 5 downstream = 15 artifacts. */
const P04_RESULT_DEEP = {
  summary: {
    result: {
      outputs: {
        characters: [
          { name: '老林(青年)', id: 'char_laolin_young', filePath: 'assets/L1/char_laolin_young_front_bust.png', tags: ['lead'] },
          { name: '老林(中年)', id: 'char_laolin_middle', filePath: 'assets/L1/char_laolin_middle_front_bust.png' },
          { name: '林晓梅', id: 'char_xiaomei', filePath: 'assets/L1/char_xiaomei_front_bust.png' },
          { name: '林小宇', id: 'char_xiaoyu', filePath: 'assets/L1/char_xiaoyu_front_bust.png' },
        ],
        l1_anchors: [
          { name: '老林-1975 锚点', character: '老林', path: 'assets/L1/char_laolin_young_front_bust.png' },
          { name: '老林-2000 锚点', character: '老林', path: 'assets/L1/char_laolin_middle_front_bust.png' },
          { name: '林晓梅-2000 锚点', character: '林晓梅', path: 'assets/L1/char_xiaomei_front_bust.png' },
          { name: '林小宇-2025 锚点', character: '林小宇', path: 'assets/L1/char_xiaoyu_front_bust.png' },
          { name: '沃尔沃-2025 锚点', character: '红沃尔沃', path: 'assets/L1/char_red_volvo_3q_front.png' },
          { name: '沃尔沃-1975 锚点', character: '红沃尔沃', path: 'assets/L1/char_red_volvo_3q_front_1975.png' },
        ],
        downstream: [
          { label: 'character-bible.json', file: '02_design/character-bible.json' },
          { label: 'character-assets.json', file: '02_design/character-assets.json' },
          { label: 'soul-pack.json', file: '02_design/soul-pack.json' },
          { label: 'pain-report.json', file: '02_design/pain-report.json' },
          { label: 'spatio-temporal-script.json', file: '02_design/spatio-temporal-script.json' },
        ],
      },
    },
  },
  metrics: { characterCount: 4, l1Anchors: 6 },
};

/** 同样的数据但扁平放在 result.summary 顶层 (回退路径). */
const P04_RESULT_FLAT = {
  summary: { ...P04_RESULT_DEEP.summary.result.outputs },
  metrics: P04_RESULT_DEEP.metrics,
};

// ─── Tests: extractArtifacts ─────────────────────────────

test('extractArtifacts: deep path → 15 artifacts from P04-style result', () => {
  const arts = extractArtifacts(P04_RESULT_DEEP);
  assert.equal(arts.length, 15, '4 characters + 6 L1 anchors + 5 downstream');

  // 分桶计数
  const byKey = arts.reduce((acc, a) => { acc[a.output_key] = (acc[a.output_key] || 0) + 1; return acc; }, {});
  assert.equal(byKey.characters, 4);
  assert.equal(byKey.l1_anchors, 6);
  assert.equal(byKey.downstream, 5);
});

test('extractArtifacts: fallback to result.summary top-level arrays', () => {
  const arts = extractArtifacts(P04_RESULT_FLAT);
  assert.equal(arts.length, 15);
  assert.equal(arts[0].output_key, 'characters');
});

test('extractArtifacts: each artifact has required fields', () => {
  const arts = extractArtifacts(P04_RESULT_DEEP);
  for (const a of arts) {
    assert.ok('output_key' in a, 'output_key');
    assert.ok('label' in a, 'label');
    assert.ok('thumbnailUrl' in a, 'thumbnailUrl');
    assert.ok('filePath' in a, 'filePath');
    assert.ok('tags' in a, 'tags');
    assert.ok('name' in a, 'name');
    assert.ok('filename' in a, 'filename');
  }
});

test('extractArtifacts: image filePath → thumbnailUrl', () => {
  const arts = extractArtifacts(P04_RESULT_DEEP);
  const laolin = arts.find(a => a.name === '老林(青年)');
  assert.equal(laolin.thumbnailUrl, 'assets/L1/char_laolin_young_front_bust.png');
  assert.equal(laolin.filename, 'char_laolin_young_front_bust.png');
});

test('extractArtifacts: empty/missing result → []', () => {
  assert.deepEqual(extractArtifacts(null), []);
  assert.deepEqual(extractArtifacts({}), []);
  assert.deepEqual(extractArtifacts({ summary: {} }), []);
  assert.deepEqual(extractArtifacts({ summary: { foo: 'not-array' } }), []);
});

// ─── Tests: computePhaseIndex ────────────────────────────

test('computePhaseIndex: uses stageOrder when > 0', () => {
  assert.equal(computePhaseIndex({ id: 'character-generation', stageOrder: 6 }), 6);
});

test('computePhaseIndex: extracts number from p-IDs when stageOrder missing', () => {
  assert.equal(computePhaseIndex({ id: 'p01' }), 1);
  assert.equal(computePhaseIndex({ id: 'p04' }), 4);
  assert.equal(computePhaseIndex({ id: 'x' }), 0);
});

// ─── Tests: buildPhaseGraph (node/link IDs match 9999 pattern) ──

test('buildPhaseGraph: 3-layer structure, 17 nodes / 17 links', () => {
  const mapped = defaultPhaseMapper(P04_PHASE);
  const arts = extractArtifacts(P04_RESULT_DEEP);
  const { nodes, links } = buildPhaseGraph({
    phase: P04_PHASE,
    mapped,
    artifacts: arts,
    phaseIndex: computePhaseIndex(P04_PHASE),
    prevPhaseId: 'outline-selection',
  });

  // 1 zone + 1 summary + 15 artifacts
  assert.equal(nodes.length, 17, '1 zone + 1 summary + 15 artifacts');
  // 1 zl2 + 15 zc + 1 fl (prev)
  assert.equal(links.length, 17, '1 zl2 + 15 zc + 1 fl');
});

test('buildPhaseGraph: node IDs match 9999 pattern', () => {
  const mapped = defaultPhaseMapper(P04_PHASE);
  const { nodes } = buildPhaseGraph({
    phase: P04_PHASE,
    mapped,
    artifacts: extractArtifacts(P04_RESULT_DEEP),
    phaseIndex: 6,
  });

  const zone = nodes.find(n => n.type === 'zone');
  const summary = nodes.find(n => n.id.startsWith('sum-'));
  const artifacts = nodes.filter(n => n.id.startsWith('a-'));

  // Zone ID = phase.id (NOT n-{phase.id})
  assert.equal(zone.id, 'character-generation');
  // Summary ID
  assert.equal(summary.id, 'sum-character-generation');
  // Artifact IDs: a-{phase.id}-art{idx}
  assert.equal(artifacts[0].id, 'a-character-generation-art0');
  assert.equal(artifacts[14].id, 'a-character-generation-art14');
});

test('buildPhaseGraph: link IDs match 9999 pattern', () => {
  const mapped = defaultPhaseMapper(P04_PHASE);
  const { links } = buildPhaseGraph({
    phase: P04_PHASE,
    mapped,
    artifacts: extractArtifacts(P04_RESULT_DEEP),
    phaseIndex: 6,
    prevPhaseId: 'outline-selection',
  });

  // zone→summary
  const zl2 = links.find(l => l.source === 'character-generation' && l.target === 'sum-character-generation');
  assert.equal(zl2.id, 'zl2-character-generation-sum-character-generation');
  assert.equal(zl2.dataType, 'output');

  // zone→artifact (first)
  const zc0 = links.find(l => l.target === 'a-character-generation-art0');
  assert.equal(zc0.id, 'zc-character-generation-a-character-generation-art0');
  assert.equal(zc0.dataType, 'output');

  // prev zone → this zone (phase sequence)
  const fl = links.find(l => l.dataType === 'flow');
  assert.ok(fl, 'flow link exists');
  assert.equal(fl.id, 'fl-outline-selection-character-generation');
  assert.equal(fl.source, 'outline-selection');
  assert.equal(fl.target, 'character-generation');
});

test('buildPhaseGraph: zone position scales with phaseIndex', () => {
  const mapped = defaultPhaseMapper(P04_PHASE);
  const { nodes } = buildPhaseGraph({
    phase: P04_PHASE,
    mapped,
    artifacts: [],
    phaseIndex: 7,
  });
  const zone = nodes.find(n => n.type === 'zone');
  assert.deepEqual(zone.position, { x: 7 * 1300, y: 0 });
});

test('buildPhaseGraph: empty artifacts → still zone + summary, "0 artifacts"', () => {
  const mapped = defaultPhaseMapper(P04_PHASE);
  const { nodes, links } = buildPhaseGraph({
    phase: P04_PHASE,
    mapped,
    artifacts: [],
    phaseIndex: 6,
  });
  assert.equal(nodes.length, 2, 'only zone + summary');
  const summary = nodes.find(n => n.id.startsWith('sum-'));
  assert.equal(summary.data.description, '0 artifacts');
  // only zl2 link (no zc, no fl)
  assert.equal(links.length, 1);
  assert.equal(links[0].dataType, 'output');
});

// ─── Tests: artifact grid layout ─────────────────────────

test('buildPhaseGraph: artifact positions form a 4-wide grid', () => {
  const mapped = defaultPhaseMapper(P04_PHASE);
  const arts = extractArtifacts(P04_RESULT_DEEP);
  const { nodes } = buildPhaseGraph({
    phase: P04_PHASE,
    mapped,
    artifacts: arts,
    phaseIndex: 0, // baseX = 0 for easy math
  });
  const arts0 = nodes.find(n => n.id === 'a-character-generation-art0');
  const arts4 = nodes.find(n => n.id === 'a-character-generation-art4');
  // index 0 → col 0, row 0  → x = 0, y = 200
  assert.deepEqual(arts0.position, { x: 0, y: 200 });
  // index 4 → col 0, row 1  → x = 0, y = 200 + 280
  assert.deepEqual(arts4.position, { x: 0, y: 480 });
});
