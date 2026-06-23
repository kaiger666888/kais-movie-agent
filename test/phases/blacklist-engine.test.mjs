/**
 * Phase 21: BlacklistEngine 单元测试
 *
 * 覆盖 CONTEXT.md B5-01, B5-02, B5-04, B5-05, B5-06:
 *   B5-01 record → check hit
 *   B5-02 record → check miss (不相似)
 *   B5-04 TTL pruneExpired
 *   B5-05 escape hatch (env / config)
 *   B5-05 degraded mode (embedding 不可达)
 *   B5-06 audit log entries
 *
 * Run: node --test test/phases/blacklist-engine.test.mjs
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { AssetBus } from '../../lib/asset-bus.js';
import { BlacklistEngine, _cosineSimilarity } from '../../lib/blacklist-engine.js';

// 构造 deterministic embedding (用于测试): 单词 → 1024-dim pseudo-vector
// 相同单词产生相同向量,不同单词产生不同向量
function fakeEmbedding(text) {
  const N = 1024;
  const vec = new Array(N).fill(0);
  if (!text) return vec;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    vec[i % N] = (vec[i % N] || 0) + (ch / 128);
  }
  // 归一化
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? vec : vec.map(x => x / norm);
}

// 相同文本 → 相同向量(高 cosine similarity)
// 1 字之差 → 仍然很高(因为大部分字符相同)
// 完全不同 → 低
function makeFakeEmbeddingFn() {
  return async (text) => fakeEmbedding(text);
}

// 失败的 embedding fn(模拟 GLM 不可达)
function failingEmbeddingFn() {
  return async () => null;
}

async function freshSetup() {
  const dir = await mkdtemp(join(tmpdir(), 'phase21-blacklist-'));
  const bus = new AssetBus(dir);
  const engine = new BlacklistEngine({
    assetBus: bus,
    workdir: dir,
    embeddingFn: makeFakeEmbeddingFn(),
  });
  return { dir, bus, engine, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

describe('BlacklistEngine (Phase 21)', () => {

  const _savedEnv = { ...process.env };

  after(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in _savedEnv)) delete process.env[k];
    }
    Object.assign(process.env, _savedEnv);
  });

  // ═══════════════════════════════════════════════════════════════
  // B5-01: record → check hit (语义命中)
  // ═══════════════════════════════════════════════════════════════
  it('B5-01 record 后 check 同 prompt 应命中 (hit)', async () => {
    const { engine, cleanup } = await freshSetup();
    try {
      await engine.record({
        shot_id: 'shot-001',
        error: 'GPU OOM',
        prompt: '小女孩在月光下的森林中奔跑',
        run_id: 'run-1',
      });

      const status = await engine.check({ prompt: '小女孩在月光下的森林中奔跑' });
      assert.strictEqual(status, 'hit');
    } finally {
      await cleanup();
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // B5-02: record → check miss (完全不同的 prompt)
  // ═══════════════════════════════════════════════════════════════
  it('B5-02 record 后 check 完全不同的 prompt 应 miss', async () => {
    const { engine, cleanup } = await freshSetup();
    try {
      await engine.record({
        shot_id: 'shot-001',
        error: 'GPU OOM',
        prompt: '战火纷飞的战场全貌,炮弹爆炸硝烟弥漫',
      });

      // 完全不同的内容(虽然字符不同,但我们的 fakeEmbedding 基于字符,
      // 不同字符序列相似度应低于 0.92 阈值)
      const status = await engine.check({ prompt: '宇宙飞船穿越虫洞,星辰扭曲' });
      assert.strictEqual(status, 'miss');
    } finally {
      await cleanup();
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // B5-04: TTL 过期清理
  // ═══════════════════════════════════════════════════════════════
  it('B5-04 pruneExpired 清理超过 TTL 的条目', async () => {
    const { dir, bus, cleanup } = await freshSetup();
    try {
      // 写入一条 35 天前的 failure(直接写 envelope 绕过 record)
      const oldTs = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
      await bus.write('failed-shots', {
        failures: [
          { shot_id: 'old-001', prompt: 'x', timestamp: oldTs },
          { shot_id: 'fresh-001', prompt: 'y', timestamp: new Date().toISOString() },
        ],
        version: 1,
      });

      // ttlDays 默认 30
      const engine = new BlacklistEngine({
        assetBus: bus,
        workdir: dir,
        embeddingFn: makeFakeEmbeddingFn(),
      });

      const result = await engine.pruneExpired();
      assert.strictEqual(result.pruned, 1);
      assert.strictEqual(result.remaining, 1);

      // 确认落盘只剩 1 条 fresh-001
      const after = await bus.read('failed-shots');
      assert.strictEqual(after.failures.length, 1);
      assert.strictEqual(after.failures[0].shot_id, 'fresh-001');
    } finally {
      await cleanup();
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // B5-04b: TTL 通过 ttlDays 配置生效
  // ═══════════════════════════════════════════════════════════════
  it('B5-04 ttlDays=7 配置下,8 天前的条目被清理', async () => {
    const { dir, bus, cleanup } = await freshSetup();
    try {
      const ts8 = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      const ts3 = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      await bus.write('failed-shots', {
        failures: [
          { shot_id: 'old8', prompt: 'a', timestamp: ts8 },
          { shot_id: 'recent3', prompt: 'b', timestamp: ts3 },
        ],
        version: 1,
      });

      const engine = new BlacklistEngine({
        assetBus: bus,
        workdir: dir,
        ttlDays: 7,
        embeddingFn: makeFakeEmbeddingFn(),
      });
      const result = await engine.pruneExpired();
      assert.strictEqual(result.pruned, 1);
      assert.strictEqual(result.remaining, 1);
    } finally {
      await cleanup();
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // B5-05a: escape hatch via env
  // ═══════════════════════════════════════════════════════════════
  it('B5-05 BLACKLIST_DISABLED=1 → check 返回 disabled', async () => {
    const { engine, cleanup } = await freshSetup();
    try {
      process.env.BLACKLIST_DISABLED = '1';
      // 重新构造以读取 env
      const bus = engine.assetBus;
      const disabledEngine = new BlacklistEngine({
        assetBus: bus,
        workdir: engine._workdir,
        embeddingFn: makeFakeEmbeddingFn(),
      });
      // 已 record 过的状态下仍允许
      const status = await disabledEngine.check({ prompt: 'anything' });
      assert.strictEqual(status, 'disabled');
    } finally {
      delete process.env.BLACKLIST_DISABLED;
      await cleanup();
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // B5-05b: escape hatch via config
  // ═══════════════════════════════════════════════════════════════
  it('B5-05 config.blacklist.disabled=true → check 返回 disabled', async () => {
    const { dir, bus, cleanup } = await freshSetup();
    try {
      const engine = new BlacklistEngine({
        assetBus: bus,
        workdir: dir,
        config: { blacklist: { disabled: true } },
        embeddingFn: makeFakeEmbeddingFn(),
      });
      const status = await engine.check({ prompt: 'x' });
      assert.strictEqual(status, 'disabled');
    } finally {
      await cleanup();
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // B5-05c: opts.disabled=true 直接生效
  // ═══════════════════════════════════════════════════════════════
  it('B5-05 opts.disabled=true 直接禁用', async () => {
    const { dir, bus, cleanup } = await freshSetup();
    try {
      const engine = new BlacklistEngine({
        assetBus: bus,
        workdir: dir,
        disabled: true,
        embeddingFn: makeFakeEmbeddingFn(),
      });
      assert.strictEqual(await engine.check({ prompt: 'x' }), 'disabled');
      // record 在 disabled 模式下不写入
      const result = await engine.record({ shot_id: 's1', prompt: 'x', error: 'e' });
      assert.strictEqual(result.recorded, false);
    } finally {
      await cleanup();
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // B5-05d: degraded mode — embedding 不可达
  // ═══════════════════════════════════════════════════════════════
  it('B5-05 embedding 不可达时 check 返回 degraded(允许通过)', async () => {
    const { dir, bus, cleanup } = await freshSetup();
    try {
      // 先正常 record 一条(用 working embedding)
      const rec = new BlacklistEngine({
        assetBus: bus,
        workdir: dir,
        embeddingFn: makeFakeEmbeddingFn(),
      });
      await rec.record({ shot_id: 's1', prompt: '失败 shot', error: 'err' });

      // 改用 failing embedding 重新 check
      const degr = new BlacklistEngine({
        assetBus: bus,
        workdir: dir,
        embeddingFn: failingEmbeddingFn(),
      });
      const status = await degr.check({ prompt: '失败 shot' });
      assert.strictEqual(status, 'degraded');
    } finally {
      await cleanup();
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // B5-05e: record 在 embedding 不可达时仍记录(只是无 embedding 字段)
  // ═══════════════════════════════════════════════════════════════
  it('record 在 embedding 不可达时仍记录条目(只是无 embedding 字段)', async () => {
    const { dir, bus, cleanup } = await freshSetup();
    try {
      const engine = new BlacklistEngine({
        assetBus: bus,
        workdir: dir,
        embeddingFn: failingEmbeddingFn(),
      });
      const result = await engine.record({
        shot_id: 's1', prompt: '某 shot', error: 'err',
      });
      assert.strictEqual(result.recorded, true);
      assert.strictEqual(result.embedding_computed, false);

      // 数据落盘
      const data = await bus.read('failed-shots');
      assert.strictEqual(data.failures.length, 1);
      assert.strictEqual(data.failures[0].embedding, undefined);
    } finally {
      await cleanup();
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // B5-06: audit log 各操作均记录
  // ═══════════════════════════════════════════════════════════════
  it('B5-06 record / check_hit / prune 均写 audit log', async () => {
    const { dir, bus, engine, cleanup } = await freshSetup();
    try {
      await engine.record({ shot_id: 's1', prompt: '某 shot abc', error: 'err' });
      await engine.check({ prompt: '某 shot abc' });  // hit
      await engine.pruneExpired();  // 无过期,但若 30 天前记录则会被清理

      const log = await engine._readAuditLog();
      const actions = log.map(e => e.action);

      assert.ok(actions.includes('record'), '应包含 record 条目');
      assert.ok(actions.includes('check_hit'), '应包含 check_hit 条目');
      // record 条目应有 failure_count
      const recEntry = log.find(e => e.action === 'record');
      assert.ok(recEntry.failure_count >= 1);
      // check_hit 应含 matched_shot_id
      const hitEntry = log.find(e => e.action === 'check_hit');
      assert.strictEqual(hitEntry.matched_shot_id, 's1');
      assert.ok(typeof hitEntry.similarity === 'number');
    } finally {
      await cleanup();
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // B5-06b: audit log 文件路径与命名
  // ═══════════════════════════════════════════════════════════════
  it('B5-06 audit log 文件位于 .pipeline-assets/blacklist-audit.jsonl', async () => {
    const { dir, engine, cleanup } = await freshSetup();
    try {
      await engine.record({ shot_id: 's1', prompt: 'x', error: 'e' });
      const logPath = join(dir, '.pipeline-assets', 'blacklist-audit.jsonl');
      assert.ok(existsSync(logPath), 'audit log 文件应存在');
      const raw = await readFile(logPath, 'utf-8');
      const lines = raw.split('\n').filter(l => l.trim().length > 0);
      assert.ok(lines.length >= 1);
      // 每行可解析为 JSON
      for (const line of lines) {
        const obj = JSON.parse(line);
        assert.ok(obj.timestamp, '每行应含 timestamp');
        assert.ok(obj.action, '每行应含 action');
      }
    } finally {
      await cleanup();
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // record 去重: 同 shot_id + prompt_hash → 更新而非追加
  // ═══════════════════════════════════════════════════════════════
  it('record 去重: 相同 shot_id + prompt_hash → 更新而非追加', async () => {
    const { bus, engine, cleanup } = await freshSetup();
    try {
      await engine.record({ shot_id: 's1', prompt: '同一段 prompt', error: 'err1' });
      await engine.record({ shot_id: 's1', prompt: '同一段 prompt', error: 'err2' });

      const data = await bus.read('failed-shots');
      assert.strictEqual(data.failures.length, 1, '同 shot_id + prompt 应去重');
      assert.strictEqual(data.failures[0].error, 'err2', '应保留最新条目');
    } finally {
      await cleanup();
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 空 prompt → check 返回 miss(无法匹配)
  // ═══════════════════════════════════════════════════════════════
  it('check 空 prompt → miss (无法语义匹配)', async () => {
    const { engine, cleanup } = await freshSetup();
    try {
      await engine.record({ shot_id: 's1', prompt: 'x', error: 'e' });
      assert.strictEqual(await engine.check({ prompt: '' }), 'miss');
      assert.strictEqual(await engine.check({}), 'miss');
    } finally {
      await cleanup();
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 无 failed-shots → check 直接 miss
  // ═══════════════════════════════════════════════════════════════
  it('无 failed-shots 记录时 check 直接 miss', async () => {
    const { engine, cleanup } = await freshSetup();
    try {
      assert.strictEqual(await engine.check({ prompt: 'something' }), 'miss');
    } finally {
      await cleanup();
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // cosineSimilarity 工具函数
  // ═══════════════════════════════════════════════════════════════
  it('_cosineSimilarity 正确计算余弦相似度', () => {
    // 同向 → 1
    assert.ok(Math.abs(_cosineSimilarity([1, 2, 3], [2, 4, 6]) - 1) < 1e-6);
    // 正交 → 0
    assert.ok(Math.abs(_cosineSimilarity([1, 0], [0, 1])) < 1e-6);
    // 反向 → -1
    assert.ok(Math.abs(_cosineSimilarity([1, 0], [-1, 0]) - (-1)) < 1e-6);
    // 不等长 / 空 → 0
    assert.strictEqual(_cosineSimilarity([1, 2], [1]), 0);
    assert.strictEqual(_cosineSimilarity([], []), 0);
    assert.strictEqual(_cosineSimilarity(null, [1]), 0);
  });
});
