/**
 * Phase 28 28-01: canvas-content-sync saveGraph HTTP API migration regression test
 *
 * 验证:
 *   - happy path: saveGraph 调用 POST /api/canvas/v2/save-v2 + 正确 body
 *   - degrade on network error (fetch reject): warn 触发, 不抛错
 *   - degrade on HTTP 500: warn 触发, 不抛错
 *   - degrade on timeout (AbortSignal): warn 触发, 不抛错
 *
 * 通过 test-only export __test_saveGraph 访问私有 saveGraph。
 *
 * Run: node --test test/phases/canvas-content-sync-http.test.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { __test_saveGraph as saveGraph } from '../../lib/canvas-content-sync.js';

const TEST_BASE_URL = 'http://test.local:9999';
const SAVE_URL_SUFFIX = '/api/canvas/v2/save-v2';

function makeOkResponse(data = null) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify({ code: 0, msg: 'ok', data }),
  };
}

function make500Response() {
  return {
    ok: false,
    status: 500,
    statusText: 'Internal Server Error',
    text: async () => 'boom',
  };
}

describe('Phase 28 28-01: saveGraph HTTP API migration', () => {
  let originalFetch;
  let originalWarn;
  let originalEnv;
  let fetchMock;
  let warnCalls;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalWarn = console.warn;
    originalEnv = process.env.CANVAS_API_BASE_URL;
    process.env.CANVAS_API_BASE_URL = TEST_BASE_URL;
    warnCalls = [];
    console.warn = (...args) => {
      warnCalls.push(args.map(String).join(' '));
    };
    fetchMock = null;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    if (originalEnv === undefined) delete process.env.CANVAS_API_BASE_URL;
    else process.env.CANVAS_API_BASE_URL = originalEnv;
  });

  it('happy path: saveGraph calls POST /api/canvas/v2/save-v2 with correct body', async () => {
    let capturedUrl = null;
    let capturedInit = null;
    let callCount = 0;
    fetchMock = async (url, init) => {
      callCount++;
      capturedUrl = String(url);
      capturedInit = init;
      return makeOkResponse();
    };
    globalThis.fetch = fetchMock;

    const graph = { nodes: [{ id: 'n1' }], meta: {} };
    await saveGraph(1800, 2, graph);

    assert.strictEqual(callCount, 1, 'fetch should be called exactly once');
    assert.ok(
      capturedUrl.endsWith(SAVE_URL_SUFFIX),
      `URL should end with ${SAVE_URL_SUFFIX}, got: ${capturedUrl}`,
    );
    assert.strictEqual(capturedInit.method, 'POST');
    assert.ok(capturedInit.body, 'request body should be present');
    const body = JSON.parse(capturedInit.body);
    assert.strictEqual(body.projectId, 1800);
    assert.strictEqual(body.episodesId, 2);
    assert.deepStrictEqual(body.graph.nodes, [{ id: 'n1' }]);
    // updatedAt stamp preserved
    assert.ok(
      typeof body.graph.meta.updatedAt === 'number',
      'graph.meta.updatedAt should be stamped',
    );
    // No degrade warn on happy path
    assert.strictEqual(
      warnCalls.length,
      0,
      'no degrade warn on successful HTTP write',
    );
  });

  it('degrade on network error (fetch reject): warn fired, no throw', async () => {
    fetchMock = async () => {
      throw new Error('ECONNREFUSED');
    };
    globalThis.fetch = fetchMock;

    const graph = { nodes: [], meta: {} };
    // Should resolve without throwing
    await assert.doesNotReject(() => saveGraph(1800, 2, graph));

    assert.ok(warnCalls.length >= 1, 'console.warn should fire on network error');
    assert.match(
      warnCalls.join('\n'),
      /\[canvas-sync\] HTTP API unreachable/,
      'warn should include degrade marker',
    );
    assert.match(
      warnCalls.join('\n'),
      /ECONNREFUSED/,
      'warn should include the underlying error message',
    );
  });

  it('degrade on HTTP 500: warn fired mentioning HTTP 500, no throw', async () => {
    fetchMock = async () => make500Response();
    globalThis.fetch = fetchMock;

    const graph = { nodes: [], meta: {} };
    await assert.doesNotReject(() => saveGraph(1800, 2, graph));

    assert.ok(warnCalls.length >= 1, 'console.warn should fire on HTTP 500');
    assert.match(
      warnCalls.join('\n'),
      /\[canvas-sync\] HTTP API unreachable/,
      'warn should include degrade marker',
    );
    assert.match(
      warnCalls.join('\n'),
      /500/,
      'warn should mention HTTP 500 status',
    );
  });

  it('degrade on AbortSignal timeout: warn fired, no throw', async () => {
    // Simulate AbortSignal.timeout expiry — fetch rejects with a TimeoutError-like error
    fetchMock = async () => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    };
    globalThis.fetch = fetchMock;

    const graph = { nodes: [], meta: {} };
    await assert.doesNotReject(() => saveGraph(1800, 2, graph));

    assert.ok(warnCalls.length >= 1, 'console.warn should fire on timeout');
    assert.match(
      warnCalls.join('\n'),
      /\[canvas-sync\] HTTP API unreachable/,
      'warn should include degrade marker',
    );
    assert.match(
      warnCalls.join('\n'),
      /aborted due to timeout/,
      'warn should include timeout reason',
    );
  });
});
