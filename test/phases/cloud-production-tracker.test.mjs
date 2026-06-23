/**
 * Phase 23 B4-05: cloud-production hash-stamping MVP test
 *
 * Verifies that the cloud-production handler stamps each successful video
 * with source_hashes (sts + character + scene content_hashes) into the
 * creative-history slot.
 *
 * Uses Pipeline + monkey-patched GoldTeamClient (same pattern as
 * cloud-production.test.mjs).
 *
 * Run: node --test test/phases/cloud-production-tracker.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Pipeline, createRequirementTemplate } from '../../lib/pipeline.js';
import { phaseHandlers } from '../../lib/phases/index.js';
import { AssetBus } from '../../lib/asset-bus.js';

async function setupPipeline({ shots }) {
  const tmpDir = await mkdtemp(join(tmpdir(), 'p23-cloud-'));
  const pipeline = new Pipeline({
    workdir: tmpDir,
    config: createRequirementTemplate({
      title: 'Phase23 测试',
      genre: '科幻',
      characters: [{ name: '主角', description: '测试角色' }],
    }),
    episode: 'P23-EP01',
  });

  const bus = new AssetBus(tmpDir);
  await bus.write('spatio-temporal-script', { shots, audio_events: [] }, { envelope: true });
  await bus.write('character-assets', { characters: [{ id: 'c1', name: '主角' }] }, { envelope: true });
  await bus.write('scene-assets', { scenes: [{ id: 's1' }] }, { envelope: true });
  // No dialogue in these shots → no voice-timeline required
  return { tmpDir, pipeline, bus };
}

describe('Phase 23 B4-05: cloud-production stamps CreativeHistoryTracker', () => {

  it('successful videos stamped with sts/char/scene content_hashes', async () => {
    const { tmpDir, pipeline, bus } = await setupPipeline({
      shots: [
        { id: 'shot-A', description: 'scene A', character: '主角' },
        { id: 'shot-B', description: 'scene B', character: '主角' },
      ],
    });

    // L1 anchor (avoid getOmniReferencePack throwing)
    const { default: CharacterAssetManager } = await import('../../lib/character-asset-manager.js');
    const assetManager = new CharacterAssetManager(join(tmpDir, 'characters'));
    await assetManager.registerIdentityAnchors('主角', ['/tmp/fake-anchor.png']);

    const { GoldTeamClient } = await import('../../lib/gold-team-client.js');
    const origPing = GoldTeamClient.prototype.ping;
    const origSubmit = GoldTeamClient.prototype.submitTask;
    const origWait = GoldTeamClient.prototype.waitForTask;

    GoldTeamClient.prototype.ping = async () => true;
    GoldTeamClient.prototype.submitTask = async function ({ params }) {
      return { taskId: `task-${params.prompt.slice(0, 4)}`, state: 'queued' };
    };
    GoldTeamClient.prototype.waitForTask = async function (taskId) {
      return { state: 'done', artifacts: [{ path: `/tmp/out-${taskId}.mp4` }] };
    };

    try {
      const phase = Pipeline.getPhases().find(p => p.id === 'cloud-production');
      const handler = phaseHandlers['cloud-production'];
      const result = await handler.after(pipeline, phase, {});
      assert.strictEqual(result.metrics.completed, 2, 'both shots completed');

      // Capture upstream content_hashes
      const stsEnv = await bus.readEnvelope('spatio-temporal-script');
      const charEnv = await bus.readEnvelope('character-assets');
      const sceneEnv = await bus.readEnvelope('scene-assets');

      // Post-condition: creative-history contains 2 stamps
      const ch = await bus.read('creative-history');
      assert.ok(ch, 'creative-history slot should exist');
      assert.ok(Array.isArray(ch.shots), 'shots array should exist');
      assert.strictEqual(ch.shots.length, 2, `expected 2 stamps, got ${ch.shots.length}`);

      // Each stamp references the 3 upstream content_hashes
      for (const stamp of ch.shots) {
        assert.strictEqual(stamp.asset_slot, 'final-shots');
        assert.ok(stamp.content_hash, 'video content_hash stamped');
        assert.ok(stamp.source_hashes.includes(stsEnv.content_hash), 'sts hash in source_hashes');
        assert.ok(stamp.source_hashes.includes(charEnv.content_hash), 'char hash in source_hashes');
        assert.ok(stamp.source_hashes.includes(sceneEnv.content_hash), 'scene hash in source_hashes');
      }
    } finally {
      GoldTeamClient.prototype.ping = origPing;
      GoldTeamClient.prototype.submitTask = origSubmit;
      GoldTeamClient.prototype.waitForTask = origWait;
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
