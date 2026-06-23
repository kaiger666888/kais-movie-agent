/**
 * Phase 23 B4-01: AssetBus.write derivedFrom extension 单元测试
 *
 * 验证:
 *   - write with derivedFrom produces envelope (auto-wrap)
 *   - write without derivedFrom is raw backward-compat (when envelope=false)
 *   - content_hash deterministic
 *   - snake_case derived_from alias still works
 *
 * Run: node --test test/phases/asset-bus-derived-from.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import AssetBus, { computeContentHash } from '../../lib/asset-bus.js';

async function makeTmpDir() {
  return mkdtemp(join(tmpdir(), 'phase23-derived-'));
}

describe('Phase 23 B4-01: write derivedFrom extension', () => {

  it('write with derivedFrom produces envelope with content_hash', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      const payload = { shots: [{ id: 's1' }] };
      await bus.write('creative-history', payload, { derivedFrom: ['upstream-hash-abc'] });

      const env = await bus.readEnvelope('creative-history');
      assert.ok(env.content_hash, 'envelope 应含 content_hash');
      assert.strictEqual(env.content_hash, computeContentHash(payload));
      assert.deepStrictEqual(env.derived_from, ['upstream-hash-abc']);
      assert.strictEqual(env.schema_version, '3.0');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('write without derivedFrom and envelope=false is raw (backward compat)', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      const raw = { legacy: true, noEnvelope: true };
      await bus.write('art-bible', raw, { envelope: false });

      const env = await bus.readEnvelope('art-bible');
      assert.strictEqual(env.legacy, true, '无 envelope wrap');
      assert.strictEqual(env.content_hash, undefined);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('derivedFrom forces envelope even when envelope=false', async () => {
    // Phase 23 invariant: content_hash linkage required when derived
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      await bus.write('art-bible', { x: 1 }, {
        envelope: false,
        derivedFrom: ['h1'],
      });
      const env = await bus.readEnvelope('art-bible');
      assert.ok(env.content_hash, 'derivedFrom 非空时必须 envelope');
      assert.deepStrictEqual(env.derived_from, ['h1']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('content_hash deterministic for same payload', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      const payload = { a: 1, b: [2, 3] };
      await bus.write('creative-history', payload, { derivedFrom: [] });
      const h1 = (await bus.readEnvelope('creative-history')).content_hash;

      const dir2 = await makeTmpDir();
      try {
        const bus2 = new AssetBus(dir2);
        await bus2.write('creative-history', payload, { derivedFrom: [] });
        const h2 = (await bus2.readEnvelope('creative-history')).content_hash;
        assert.strictEqual(h1, h2, '相同 payload 应生成相同 hash');
      } finally {
        await rm(dir2, { recursive: true, force: true });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('snake_case derived_from alias still works', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      await bus.write('creative-history', { v: 1 }, { derived_from: ['snake-1'] });
      const env = await bus.readEnvelope('creative-history');
      assert.deepStrictEqual(env.derived_from, ['snake-1']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('camelCase derivedFrom takes precedence over snake_case when both set', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      await bus.write('creative-history', { v: 1 }, {
        derivedFrom: ['camel-1'],
        derived_from: ['snake-1'],
      });
      const env = await bus.readEnvelope('creative-history');
      assert.deepStrictEqual(env.derived_from, ['camel-1']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
