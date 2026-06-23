/**
 * Phase 23 B4-04 verification: performance + blast-radius-report
 *
 * Requirements:
 *   - 1000 mock assets, BFS < 500ms
 *   - writeBlastRadiusReport produces JSON for operator review
 *
 * Run: node --test test/phases/creative-history-perf.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';

import AssetBus from '../../lib/asset-bus.js';
import { CreativeHistoryTracker, writeBlastRadiusReport } from '../../lib/creative-history-tracker.js';

async function makeTmpDir() {
  return mkdtemp(join(tmpdir(), 'phase23-perf-'));
}

describe('Phase 23 B4-04 perf: 1000 assets BFS < 500ms', () => {

  it('1000 stamps: BFS over chain completes under 500ms', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      const tracker = new CreativeHistoryTracker({
        assetBus: bus,
        maxBlastRadius: 1000, // no cap for perf test
        maxDepth: 20,
      });

      // Build a wide DAG: root hash → 1000 leaf assets
      // (worst case for blast radius)
      const rootHash = 'root-hash-perf';
      for (let i = 0; i < 1000; i++) {
        await tracker.stamp({
          asset_slot: 'perf-leaf',
          asset_id: `leaf-${i}`,
          source_hashes: [rootHash],
          content_hash: `leaf-h-${i}`,
        });
      }

      // Warm-up (build index once)
      await tracker.findAffected(rootHash);

      // Timed BFS
      const start = performance.now();
      const result = await tracker.findAffected(rootHash);
      const elapsed = performance.now() - start;

      assert.strictEqual(result.affected.length, 1000);
      assert.strictEqual(result.truncated, false);
      assert.ok(elapsed < 500, `BFS took ${elapsed.toFixed(1)}ms (must be < 500ms)`);
      console.log(`  perf: 1000-asset BFS = ${elapsed.toFixed(2)}ms`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('deep chain (depth 10): BFS completes under 500ms', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      const tracker = new CreativeHistoryTracker({
        assetBus: bus,
        maxBlastRadius: 1000,
        maxDepth: 20,
      });

      // 10-layer chain: h0 → h1 → h2 → ... → h9
      for (let i = 0; i < 10; i++) {
        await tracker.stamp({
          asset_slot: 'chain',
          asset_id: `node-${i}`,
          source_hashes: i === 0 ? [] : [`h-${i - 1}`],
          content_hash: `h-${i}`,
        });
      }

      await tracker.findAffected('h-0'); // warm-up
      const start = performance.now();
      const result = await tracker.findAffected('h-0');
      const elapsed = performance.now() - start;

      assert.strictEqual(result.affected.length, 9); // h-1..h-9
      assert.ok(elapsed < 500, `deep BFS took ${elapsed.toFixed(1)}ms`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('Phase 23 B4-04: writeBlastRadiusReport', () => {

  it('writes JSON report with affected list + truncation note', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      const tracker = new CreativeHistoryTracker({
        assetBus: bus,
        maxBlastRadius: 2,
      });
      for (let i = 0; i < 5; i++) {
        await tracker.stamp({
          asset_slot: 'final-shots', asset_id: `shot-${i}`,
          source_hashes: ['src-1'], content_hash: `h-${i}`,
        });
      }
      const result = await tracker.findAffected('src-1');
      assert.strictEqual(result.truncated, true);

      const reportPath = join(dir, '.pipeline-assets', 'blast-radius-report.json');
      const written = await writeBlastRadiusReport(result, reportPath, 'src-1');

      const raw = await readFile(written, 'utf-8');
      const parsed = JSON.parse(raw);
      assert.strictEqual(parsed.changed_hash, 'src-1');
      assert.strictEqual(parsed.truncated, true);
      assert.strictEqual(parsed.affected_count, 2);
      assert.ok(parsed.note.includes('exceeded'), `note should explain truncation: ${parsed.note}`);
      assert.ok(Array.isArray(parsed.affected));
      assert.strictEqual(parsed.affected.length, 2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('non-truncated result produces "all captured" note', async () => {
    const dir = await makeTmpDir();
    try {
      const fakeResult = {
        affected: [{ asset_slot: 'x', asset_id: 'y', content_hash: 'z' }],
        truncated: false,
        blast_radius: 1,
        max_depth: 1,
        cap: { maxBlastRadius: 20, maxDepth: 5 },
      };
      const reportPath = join(dir, 'report.json');
      await writeBlastRadiusReport(fakeResult, reportPath);
      const parsed = JSON.parse(await readFile(reportPath, 'utf-8'));
      assert.ok(parsed.note.includes('captured'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
