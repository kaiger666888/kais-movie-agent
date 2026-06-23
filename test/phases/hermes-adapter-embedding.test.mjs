/**
 * Phase 21: callEmbedding helper 单元测试
 *
 * 覆盖:
 *   1. 成功路径: mock fetch 返回向量,验证 shape 与值透传
 *   2. 失败路径: HTTP 500 / 网络错误 → 返回 null(不 throw)
 *   3. 无凭证: ZHIPU_API_KEY 未设置 → null(降级)
 *   4. 空文本: text='' 或 null → null
 *   5. 异常响应: 缺失 data[0].embedding 字段 → null
 *
 * Run: node --test test/phases/hermes-adapter-embedding.test.mjs
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { callEmbedding } from '../../lib/hermes-adapter.js';

// ─── fetch mock 工具 ────────────────────────────────────────────

const _origFetch = globalThis.fetch;

function mockFetch(responder) {
  globalThis.fetch = async (url, init) => {
    return responder(url, init);
  };
}

function restoreFetch() {
  globalThis.fetch = _origFetch;
}

// 构造 1024 维 dummy 向量
function dummyVector(dim = 1024) {
  return Array.from({ length: dim }, (_, i) => i / dim);
}

describe('callEmbedding (Phase 21)', () => {

  // 保存/恢复 env
  const _savedEnv = { ...process.env };
  before(() => {
    // 默认给一个 key
    process.env.ZHIPU_API_KEY = 'test-key-1234';
  });
  after(() => {
    restoreFetch();
    // 恢复 env
    for (const k of Object.keys(process.env)) {
      if (!(k in _savedEnv)) delete process.env[k];
    }
    Object.assign(process.env, _savedEnv);
  });

  // ═══════════════════════════════════════════════════════════════
  // 1. 成功: 返回 1024 维向量
  // ═══════════════════════════════════════════════════════════════
  it('成功路径: HTTP 200 + data[0].embedding → 返回向量数组', async () => {
    const vec = dummyVector();
    mockFetch(async (url, init) => {
      assert.match(url, /\/embeddings$/, '应 POST 到 /embeddings');
      const body = JSON.parse(init.body);
      assert.strictEqual(body.model, 'embedding-3');
      assert.strictEqual(body.input, 'hello world');
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: vec }] }),
      };
    });

    const result = await callEmbedding('hello world');
    assert.ok(Array.isArray(result), '应返回数组');
    assert.strictEqual(result.length, 1024);
    assert.strictEqual(result[0], 0);
  });

  // ═══════════════════════════════════════════════════════════════
  // 2. HTTP 500 → null(不 throw)
  // ═══════════════════════════════════════════════════════════════
  it('HTTP 500 错误时返回 null,不 throw', async () => {
    mockFetch(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'server error' }),
    }));

    const result = await callEmbedding('test');
    assert.strictEqual(result, null);
  });

  // ═══════════════════════════════════════════════════════════════
  // 3. 网络错误(fetch reject) → null(不 throw)
  // ═══════════════════════════════════════════════════════════════
  it('fetch reject (网络错误) 时返回 null,不 throw', async () => {
    mockFetch(async () => {
      throw new Error('ECONNREFUSED');
    });

    const result = await callEmbedding('test');
    assert.strictEqual(result, null);
  });

  // ═══════════════════════════════════════════════════════════════
  // 4. 无 API key → null(降级)
  // ═══════════════════════════════════════════════════════════════
  it('ZHIPU_API_KEY 未设置时返回 null(降级,不发起请求)', async () => {
    const savedKey = process.env.ZHIPU_API_KEY;
    const savedOaiKey = process.env.OPENAI_API_KEY;
    delete process.env.ZHIPU_API_KEY;
    delete process.env.OPENAI_API_KEY;

    let fetchCalled = false;
    mockFetch(async () => { fetchCalled = true; return { ok: true, json: async () => ({}) }; });

    const result = await callEmbedding('test');
    assert.strictEqual(result, null);
    assert.strictEqual(fetchCalled, false, '无凭证时不应发起 fetch');

    process.env.ZHIPU_API_KEY = savedKey;
    process.env.OPENAI_API_KEY = savedOaiKey;
  });

  // ═══════════════════════════════════════════════════════════════
  // 5. 空文本 / 非字符串 → null
  // ═══════════════════════════════════════════════════════════════
  it('空字符串 / null / 非字符串输入 → 返回 null', async () => {
    let fetchCalled = false;
    mockFetch(async () => { fetchCalled = true; return { ok: true, json: async () => ({}) }; });

    assert.strictEqual(await callEmbedding(''), null);
    assert.strictEqual(await callEmbedding(null), null);
    assert.strictEqual(await callEmbedding(undefined), null);
    assert.strictEqual(await callEmbedding(123), null);
    assert.strictEqual(fetchCalled, false, '空/非法输入不应发起 fetch');
  });

  // ═══════════════════════════════════════════════════════════════
  // 6. 异常响应: 缺失 data[0].embedding → null
  // ═══════════════════════════════════════════════════════════════
  it('响应缺失 embedding 字段 → null', async () => {
    mockFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ /* no embedding */ }] }),
    }));

    const result = await callEmbedding('test');
    assert.strictEqual(result, null);
  });

  // ═══════════════════════════════════════════════════════════════
  // 7. options.apiKey 覆盖 env
  // ═══════════════════════════════════════════════════════════════
  it('options.apiKey / options.apiBase 显式传入时优先使用', async () => {
    mockFetch(async (url, init) => {
      assert.match(url, /custom\.example\.com\/embeddings$/, '应使用 apiBase');
      assert.strictEqual(init.headers.Authorization, 'Bearer custom-key');
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: [0.1, 0.2] }] }),
      };
    });

    const result = await callEmbedding('test', {
      apiKey: 'custom-key',
      apiBase: 'https://custom.example.com',
    });
    assert.deepEqual(result, [0.1, 0.2]);
  });
});
