/**
 * Phase 20: AssetBus V3.0 Schema Extension 单元测试
 *
 * 覆盖:
 *   - SCHEMA-01: 3 新 typed slots 注册
 *   - SCHEMA-02: envelope format (wrap/unwrap, v2.0 backward compat)
 *   - SCHEMA-03: atomic write + mtime-based cache invalidation
 *   - SCHEMA-03 ext: appendLine (JSONL) + readLines
 *
 * Run: node --test test/phases/asset-bus.test.mjs
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import AssetBus, {
  ASSET_SCHEMA,
  SCHEMA_VERSION,
  computeContentHash,
  wrapEnvelope,
  unwrapEnvelope,
} from '../../lib/asset-bus.js';

// ─── Helpers ──────────────────────────────────────────────────────────
async function makeTmpDir() {
  return mkdtemp(join(tmpdir(), 'phase20-assetbus-'));
}

// ═══════════════════════════════════════════════════════════════════
// describe 1: SCHEMA-01 — 3 new typed slots registered
// ═══════════════════════════════════════════════════════════════════
describe('SCHEMA-01: new typed slots registered', () => {

  it('ASSET_SCHEMA 含 3 个 v3.0 新 slot', () => {
    assert.ok(ASSET_SCHEMA['creative-history'], 'creative-history slot 缺失');
    assert.ok(ASSET_SCHEMA['failed-shots'], 'failed-shots slot 缺失');
    assert.ok(ASSET_SCHEMA['finetune-dataset'], 'finetune-dataset slot 缺失');
  });

  it('creative-history slot 配置正确', () => {
    const s = ASSET_SCHEMA['creative-history'];
    assert.strictEqual(s.file, 'creative-history.json');
    assert.ok(s.schema, 'schema 字段缺失');
    assert.ok(s.schema.shots, 'schema.shots 缺失');
  });

  it('failed-shots slot 配置正确', () => {
    const s = ASSET_SCHEMA['failed-shots'];
    assert.strictEqual(s.file, 'failed-shots.json');
    assert.ok(s.schema, 'schema 字段缺失');
    assert.ok(s.schema.failures, 'schema.failures 缺失');
  });

  it('finetune-dataset slot 是 jsonl 格式', () => {
    const s = ASSET_SCHEMA['finetune-dataset'];
    assert.strictEqual(s.file, 'finetune-dataset.jsonl');
    assert.strictEqual(s.format, 'jsonl', 'format 必须为 jsonl');
  });

  it('v2.0 legacy slot 仍保留且配置不变', () => {
    // 回归保护:6 个 v2.0 slot 行为不受影响
    const v2Slots = [
      'art-bible', 'character-assets', 'voice-timeline',
      'shot-list', 'scene-assets', 'prop-assets',
    ];
    for (const name of v2Slots) {
      assert.ok(ASSET_SCHEMA[name], `v2.0 slot ${name} 缺失`);
      assert.ok(ASSET_SCHEMA[name].fields, `${name}.fields 缺失`);
    }
  });

  it('listAssetNames 返回所有 slot (含 v3.0)', () => {
    const tmpDir = '/nonexistent';
    const bus = new AssetBus(tmpDir);
    const names = bus.listAssetNames();
    assert.ok(names.includes('creative-history'));
    assert.ok(names.includes('failed-shots'));
    assert.ok(names.includes('finetune-dataset'));
    assert.ok(names.includes('art-bible'), 'legacy slot 丢失');
    assert.ok(names.length >= 17, `slot 总数应 >= 17 (14 v2/v4.1 + 3 v3.0), 实际 ${names.length}`);
  });
});

// ═══════════════════════════════════════════════════════════════════
// describe 2: SCHEMA-02 — envelope format
// ═══════════════════════════════════════════════════════════════════
describe('SCHEMA-02: envelope format (wrap/unwrap)', () => {

  it('computeContentHash 返回 64 字符 SHA-256 hex', () => {
    const h1 = computeContentHash({ a: 1 });
    const h2 = computeContentHash({ a: 1 });
    const h3 = computeContentHash({ a: 2 });
    assert.strictEqual(h1.length, 64, 'SHA-256 hex 应 64 字符');
    assert.strictEqual(h1, h2, '相同输入应相同 hash');
    assert.notStrictEqual(h1, h3, '不同输入应不同 hash');
  });

  it('wrapEnvelope 生成完整 v3.0 envelope', () => {
    const value = { shots: [{ id: 's1' }] };
    const env = wrapEnvelope(value, ['upstream-hash-1']);
    assert.strictEqual(env.value, value, 'value 引用应保留');
    assert.deepStrictEqual(env.derived_from, ['upstream-hash-1']);
    assert.strictEqual(env.schema_version, SCHEMA_VERSION);
    assert.strictEqual(env.schema_version, '3.0');
    assert.strictEqual(env.content_hash, computeContentHash(value));
  });

  it('wrapEnvelope derived_from 默认为 []', () => {
    const env = wrapEnvelope({ x: 1 });
    assert.deepStrictEqual(env.derived_from, []);
  });

  it('unwrapEnvelope 检测 v3.0 envelope 返回 value', () => {
    const env = wrapEnvelope({ hello: 'world' });
    assert.deepStrictEqual(unwrapEnvelope(env), { hello: 'world' });
  });

  it('unwrapEnvelope 对非 envelope (v2.0 raw) 返回原值', () => {
    // 向后兼容:v2.0 数据无 schema_version,应原样返回
    const v2data = { style_anchor: 'test', shots: [1, 2, 3] };
    assert.strictEqual(unwrapEnvelope(v2data), v2data);
    assert.deepStrictEqual(unwrapEnvelope([1, 2, 3]), [1, 2, 3]);
    assert.strictEqual(unwrapEnvelope(null), null);
    assert.strictEqual(unwrapEnvelope('string'), 'string');
  });

  it('write → read 自动 wrap/unwrap', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      const payload = { shots: [{ shot_id: 's1', source_hash: 'abc' }], version: 1 };
      await bus.write('creative-history', payload);

      const read = await bus.read('creative-history');
      assert.deepStrictEqual(read, payload, 'read 应返回 unwrap 后的 value');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('write opts.derived_from 写入 envelope', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      await bus.write('creative-history', { v: 1 }, { derived_from: ['h1', 'h2'] });
      const env = await bus.readEnvelope('creative-history');
      assert.deepStrictEqual(env.derived_from, ['h1', 'h2']);
      assert.strictEqual(env.schema_version, '3.0');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('write opts.envelope=false 跳过 wrap (兼容 v2.0 行为)', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      const raw = { style_anchor: 'legacy', _noEnvelope: true };
      await bus.write('art-bible', raw, { envelope: false });
      const out = await bus.read('art-bible');
      assert.deepStrictEqual(out, raw);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('读取 v2.0 已有 .pipeline-assets/*.json 不破坏 (向后兼容)', async () => {
    // 模拟遗留项目:已存在 v2.0 格式的 art-bible.json
    const dir = await makeTmpDir();
    try {
      const assetsDir = join(dir, '.pipeline-assets');
      await mkdir(assetsDir, { recursive: true });
      const v2Payload = {
        style_anchor: 'v2-style',
        color_palette: ['#fff', '#000'],
        bgm_strategy: 'dual',
      };
      await writeFile(join(assetsDir, 'art-bible.json'), JSON.stringify(v2Payload));

      const bus = new AssetBus(dir);
      const out = await bus.read('art-bible');
      assert.deepStrictEqual(out, v2Payload, 'v2.0 数据应原样返回 (无 envelope)');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// describe 3: SCHEMA-03 — atomic write + mtime cache
// ═══════════════════════════════════════════════════════════════════
describe('SCHEMA-03: atomic write + mtime-based cache', () => {

  it('写入后无 .tmp 残留文件', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      await bus.write('failed-shots', { failures: [], version: 1 });

      const assetsDir = join(dir, '.pipeline-assets');
      const { readdirSync } = await import('node:fs');
      const files = readdirSync(assetsDir);
      const tmpLeftovers = files.filter(f => f.includes('.tmp.'));
      assert.deepStrictEqual(tmpLeftovers, [], `残留 tmp 文件: ${tmpLeftovers.join(', ')}`);
      assert.ok(files.includes('failed-shots.json'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('mtime-based cache: 写入后下一次 read 看到新数据 (cache 自动失效)', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      await bus.write('failed-shots', { failures: [{ shot_id: 'a' }], version: 1 });
      const r1 = await bus.read('failed-shots');
      assert.deepStrictEqual(r1.failures, [{ shot_id: 'a' }]);

      // 人工等待 mtime 分辨率 (某些文件系统 mtime 粒度较粗)
      await new Promise(r => setTimeout(r, 20));

      await bus.write('failed-shots', { failures: [{ shot_id: 'b' }], version: 2 });
      const r2 = await bus.read('failed-shots');
      assert.deepStrictEqual(r2.failures, [{ shot_id: 'b' }],
        'cache 应已失效,读到新数据');
      assert.strictEqual(r2.version, 2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('并发写入 (10 个 Promise.all) 无损坏,最终文件可解析', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      // 10 个并发写入同一个 slot 的不同 payload — 最后一个胜出
      // 关键:文件必须始终可解析 (不会出现截断的半个 JSON)
      const writes = [];
      for (let i = 0; i < 10; i++) {
        writes.push(bus.write('failed-shots', { failures: [{ idx: i }], version: i }));
      }
      await Promise.all(writes);

      // 最终文件必须可解析为合法 JSON
      const final = await bus.read('failed-shots');
      assert.ok(final, '并发后 read 不应返回 null');
      assert.ok(Array.isArray(final.failures));
      assert.strictEqual(final.failures.length, 1, '应只有一个写入胜出');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('并发写入不同 slot 互不干扰', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      await Promise.all([
        bus.write('creative-history', { shots: [{ id: 'c1' }], version: 1 }),
        bus.write('failed-shots', { failures: [{ id: 'f1' }], version: 1 }),
        bus.write('art-bible', { style_anchor: 'x' }),
      ]);

      const ch = await bus.read('creative-history');
      const fs_ = await bus.read('failed-shots');
      const ab = await bus.read('art-bible');
      assert.deepStrictEqual(ch.shots, [{ id: 'c1' }]);
      assert.deepStrictEqual(fs_.failures, [{ id: 'f1' }]);
      assert.strictEqual(ab.style_anchor, 'x');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// describe 4: SCHEMA-03 ext — appendLine / readLines (JSONL)
// ═══════════════════════════════════════════════════════════════════
describe('SCHEMA-03 ext: appendLine / readLines (JSONL)', () => {

  it('appendLine 拒绝非 jsonl slot', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      await assert.rejects(
        () => bus.appendLine('creative-history', { x: 1 }),
        /not JSONL/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('write 拒绝 jsonl slot (强制用 appendLine)', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      await assert.rejects(
        () => bus.write('finetune-dataset', { x: 1 }),
        /JSONL/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('appendLine 写入单行 JSON, readLines 解析回对象', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      await bus.appendLine('finetune-dataset', { prompt: 'p1', image: 'i1', label: 'good' });

      const lines = await bus.readLines('finetune-dataset');
      assert.strictEqual(lines.length, 1);
      assert.deepStrictEqual(lines[0], { prompt: 'p1', image: 'i1', label: 'good' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('100 次 append 产生 100 行且保持顺序', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      for (let i = 0; i < 100; i++) {
        await bus.appendLine('finetune-dataset', { idx: i });
      }

      const lines = await bus.readLines('finetune-dataset');
      assert.strictEqual(lines.length, 100, `应 100 行, 实际 ${lines.length}`);
      // 顺序保留
      for (let i = 0; i < 100; i++) {
        assert.strictEqual(lines[i].idx, i, `第 ${i} 行 idx 应为 ${i}, 实际 ${lines[i].idx}`);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('readLines 空 slot 返回 [] (不抛错)', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      const lines = await bus.readLines('finetune-dataset');
      assert.deepStrictEqual(lines, []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('readLines 跳过空行 (容错)', async () => {
    const dir = await makeTmpDir();
    try {
      const assetsDir = join(dir, '.pipeline-assets');
      await mkdir(assetsDir, { recursive: true });
      // 手工写一个含空行的 jsonl
      const content = '{"a":1}\n\n{"b":2}\n\n';
      await writeFile(join(assetsDir, 'finetune-dataset.jsonl'), content);

      const bus = new AssetBus(dir);
      const lines = await bus.readLines('finetune-dataset');
      assert.strictEqual(lines.length, 2);
      assert.deepStrictEqual(lines[0], { a: 1 });
      assert.deepStrictEqual(lines[1], { b: 2 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// describe 5: V2 backward compat — existing 6 slots unchanged
// ═══════════════════════════════════════════════════════════════════
describe('V2 backward compat: legacy slots', () => {

  it('art-bible write/read (默认 envelope 模式) 不破坏', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      const payload = { style_anchor: 'test', color_palette: ['#f00'] };
      await bus.write('art-bible', payload);
      const out = await bus.read('art-bible');
      assert.deepStrictEqual(out, payload);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('未知 slot 抛错 (向后兼容:不静默吞)', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      await assert.rejects(() => bus.write('nonexistent-xxx', { a: 1 }), /Unknown asset/);
      await assert.rejects(() => bus.read('nonexistent-xxx'), /Unknown asset/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('read 缺失文件返回 null (不抛)', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      const out = await bus.read('failed-shots');
      assert.strictEqual(out, null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('require 缺失文件抛错', async () => {
    const dir = await makeTmpDir();
    try {
      const bus = new AssetBus(dir);
      await assert.rejects(() => bus.require('failed-shots'), /Required asset/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
