/**
 * Phase 23 B4-03 / B4-04: CreativeHistoryTracker 单元测试
 *
 * 覆盖:
 *   - single stamp
 *   - chain A → B → C reverse BFS
 *   - blast radius cap (truncated flag)
 *   - depth cap
 *   - degraded mode (AssetBus unreachable)
 *   - diff batch
 *
 * Run: node --test test/phases/creative-history-tracker.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import AssetBus from '../../lib/asset-bus.js';
import { CreativeHistoryTracker } from '../../lib/creative-history-tracker.js';

async function makeTmpDir() {
  return mkdtemp(join(tmpdir(), 'phase23-tracker-'));
}

describe('Phase 23 B4-03: CreativeHistoryTracker.stamp', () => {

  it('single stamp appends to creative-history slot', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      const tracker = new CreativeHistoryTracker({ assetBus: bus });

      const ok = await tracker.stamp({
        asset_slot: 'final-shots',
        asset_id: 'shot-001',
        source_hashes: ['upstream-hash-sts'],
        content_hash: 'video-hash-001',
      });
      assert.strictEqual(ok, true);

      const stored = await bus.read('creative-history');
      assert.ok(Array.isArray(stored.shots));
      assert.strictEqual(stored.shots.length, 1);
      assert.strictEqual(stored.shots[0].asset_id, 'shot-001');
      assert.deepStrictEqual(stored.shots[0].source_hashes, ['upstream-hash-sts']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('multiple stamps accumulate (atomic appends)', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      const tracker = new CreativeHistoryTracker({ assetBus: bus });

      for (let i = 0; i < 5; i++) {
        await tracker.stamp({
          asset_slot: 'final-shots',
          asset_id: `shot-${i}`,
          source_hashes: [`src-${i}`],
          content_hash: `v-${i}`,
        });
      }
      const stored = await bus.read('creative-history');
      assert.strictEqual(stored.shots.length, 5);
      for (let i = 0; i < 5; i++) {
        assert.strictEqual(stored.shots[i].asset_id, `shot-${i}`);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('degraded mode: AssetBus unreachable returns false, does not throw', async () => {
    const brokenBus = {
      read: async () => { throw new Error('ECONNREFUSED'); },
      write: async () => { throw new Error('ECONNREFUSED'); },
    };
    const tracker = new CreativeHistoryTracker({ assetBus: brokenBus });
    const ok = await tracker.stamp({
      asset_slot: 'final-shots',
      asset_id: 'shot-x',
      source_hashes: [],
      content_hash: 'h',
    });
    assert.strictEqual(ok, false, '降级应返回 false');
  });

  it('rejects entry missing required fields', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      const tracker = new CreativeHistoryTracker({ assetBus: bus });
      await assert.rejects(
        () => tracker.stamp({ asset_id: 'x' }),
        /asset_slot and asset_id required/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('Phase 23 B4-04: findAffected reverse BFS', () => {

  it('chain A → B → C: change A returns both B and C', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      const tracker = new CreativeHistoryTracker({ assetBus: bus });

      // A (source, no upstream) → B → C
      // A content_hash: 'hash-A'
      // B derives from A
      // C derives from B
      await tracker.stamp({
        asset_slot: 'layer-1', asset_id: 'A',
        source_hashes: [], content_hash: 'hash-A',
      });
      await tracker.stamp({
        asset_slot: 'layer-2', asset_id: 'B',
        source_hashes: ['hash-A'], content_hash: 'hash-B',
      });
      await tracker.stamp({
        asset_slot: 'layer-3', asset_id: 'C',
        source_hashes: ['hash-B'], content_hash: 'hash-C',
      });

      const result = await tracker.findAffected('hash-A');
      assert.strictEqual(result.affected.length, 2, 'A 变更应影响 B 和 C');
      const ids = result.affected.map(a => a.asset_id).sort();
      assert.deepStrictEqual(ids, ['B', 'C']);
      assert.strictEqual(result.truncated, false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('depth=0 leaf: change C returns nothing', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      const tracker = new CreativeHistoryTracker({ assetBus: bus });
      await tracker.stamp({
        asset_slot: 'l', asset_id: 'A',
        source_hashes: [], content_hash: 'hash-A',
      });

      const result = await tracker.findAffected('hash-A');
      assert.strictEqual(result.affected.length, 0);
      assert.strictEqual(result.truncated, false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('blast radius cap: truncated=true when exceeding maxBlastRadius', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      const tracker = new CreativeHistoryTracker({
        assetBus: bus,
        maxBlastRadius: 3,
      });
      // 1 source hash → 5 derived assets → exceeds cap of 3
      for (let i = 0; i < 5; i++) {
        await tracker.stamp({
          asset_slot: 'derived', asset_id: `d-${i}`,
          source_hashes: ['src-1'], content_hash: `h-${i}`,
        });
      }
      const result = await tracker.findAffected('src-1');
      assert.strictEqual(result.affected.length, 3, 'cap 应限制为 3');
      assert.strictEqual(result.truncated, true, '应 truncated');
      assert.strictEqual(result.blast_radius, 3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('depth cap: BFS limited to maxDepth layers', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      const tracker = new CreativeHistoryTracker({
        assetBus: bus,
        maxDepth: 2,
      });
      // Chain: root → L1 → L2 → L3 → L4
      // maxDepth=2 means only L1, L2 reachable from root
      const chain = ['root', 'L1', 'L2', 'L3', 'L4'];
      for (let i = 0; i < chain.length; i++) {
        await tracker.stamp({
          asset_slot: 'layer', asset_id: chain[i],
          source_hashes: i === 0 ? [] : [`h-${chain[i - 1]}`],
          content_hash: `h-${chain[i]}`,
        });
      }
      const result = await tracker.findAffected('h-root');
      // depth 1 = L1, depth 2 = L2; depth 3 = L3 should NOT be reached
      const ids = result.affected.map(a => a.asset_id);
      assert.ok(ids.includes('L1'));
      assert.ok(ids.includes('L2'));
      assert.ok(!ids.includes('L3'), `L3 不应在 maxDepth=2 内, got: ${ids.join(',')}`);
      assert.ok(!ids.includes('L4'));
      assert.strictEqual(result.max_depth, 2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('diamond DAG: deduplicates shared descendants', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      const tracker = new CreativeHistoryTracker({ assetBus: bus });
      // A → B, A → C, B → D, C → D (D derived from both B and C)
      await tracker.stamp({ asset_slot: 'l', asset_id: 'A', source_hashes: [], content_hash: 'hA' });
      await tracker.stamp({ asset_slot: 'l', asset_id: 'B', source_hashes: ['hA'], content_hash: 'hB' });
      await tracker.stamp({ asset_slot: 'l', asset_id: 'C', source_hashes: ['hA'], content_hash: 'hC' });
      await tracker.stamp({ asset_slot: 'l', asset_id: 'D', source_hashes: ['hB', 'hC'], content_hash: 'hD' });

      const result = await tracker.findAffected('hA');
      const ids = result.affected.map(a => a.asset_id).sort();
      assert.deepStrictEqual(ids, ['B', 'C', 'D'], 'D should appear once despite 2 paths');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('Phase 23 B4-04: diff batch', () => {

  it('diff multiple hashes returns union with per_hash breakdown', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      const tracker = new CreativeHistoryTracker({ assetBus: bus });
      await tracker.stamp({ asset_slot: 'l', asset_id: 'B', source_hashes: ['hA'], content_hash: 'hB' });
      await tracker.stamp({ asset_slot: 'l', asset_id: 'C', source_hashes: ['hX'], content_hash: 'hC' });

      const r = await tracker.diff(['hA', 'hX']);
      assert.strictEqual(r.affected.length, 2);
      assert.strictEqual(r.per_hash.size, 2);
      assert.strictEqual(r.per_hash.get('hA').affected.length, 1);
      assert.strictEqual(r.per_hash.get('hX').affected.length, 1);
      assert.strictEqual(r.truncated, false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('diff empty array returns empty', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      const tracker = new CreativeHistoryTracker({ assetBus: bus });
      const r = await tracker.diff([]);
      assert.deepStrictEqual(r.affected, []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
