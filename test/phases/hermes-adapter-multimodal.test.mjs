/**
 * Phase 19 D1-01: hermes-adapter multimodal + imagePathToDataUrl 单元测试
 *
 * 覆盖:
 *   1. text-only callLLM(string, options) 向后兼容
 *   2. multimodal callLLM({ prompt: Array<ContentBlock>, ... }) 路由
 *   3. imagePathToDataUrl: file 读取 + mime 检测 + base64 编码
 *   4. file:// URL 规范化到 data: URL (callLLM 内部)
 *   5. ZHIPU_VISION_MODEL env var 默认模型切换
 *   6. GLM 不可达 → null / throw (降级路径)
 *   7. callViaHermes 对 multimodal 返回 null (强制直连)
 *
 * Run: node --test test/phases/hermes-adapter-multimodal.test.mjs
 *
 * 零 npm 依赖 — 仅 node:test / node:assert / node:fs。
 * 全部 monkey-patch fetch，无真实网络调用。
 */
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  callLLM,
  callLLMJson,
  callViaHermes,
  imagePathToDataUrl,
  getDefaultVisionModel,
  getDefaultTextModel,
} from '../../lib/hermes-adapter.js';

// ─── helpers ─────────────────────────────────────────────

/** Monkey-patch global.fetch，返回固定响应。restore 返回恢复函数。 */
function mockFetch(handler) {
  const original = global.fetch;
  global.fetch = async (url, init) => {
    const req = typeof url === 'string' ? url : url.toString();
    return handler(req, init);
  };
  return () => { global.fetch = original; };
}

/** 构造 fake Response-like 对象(仅含 ok/status/text/json)。 */
function fakeResponse({ ok = true, status = 200, body = {}, text = '' }) {
  return {
    ok,
    status,
    text: async () => text || JSON.stringify(body),
    json: async () => body,
  };
}

// ─── describe 1: text-only 向后兼容 ───────────────────────

describe('D1-01 hermes-adapter: text-only 向后兼容', () => {
  let restoreFetch;
  let lastRequest;

  beforeEach(() => {
    lastRequest = null;
    restoreFetch = mockFetch((url, init) => {
      lastRequest = { url, init };
      return fakeResponse({
        body: {
          choices: [{ message: { content: 'hello from LLM' } }],
        },
      });
    });
  });
  afterEach(() => restoreFetch());

  it('callLLM(stringPrompt, options) 保持原签名', async () => {
    const result = await callLLM('ping', { system: 'sys', temperature: 0.5 });
    assert.strictEqual(result, 'hello from LLM');
    // 验证 messages 结构(text-only content 为 string)
    const body = JSON.parse(lastRequest.init.body);
    assert.deepStrictEqual(body.messages, [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'ping' },
    ]);
    assert.strictEqual(body.temperature, 0.5);
    assert.strictEqual(body.model, getDefaultTextModel(), 'text-only 默认文本模型');
  });

  it('callLLM({prompt, system}) options-only 形式', async () => {
    const result = await callLLM({ prompt: 'hi', system: 'sys2' });
    assert.strictEqual(result, 'hello from LLM');
    const body = JSON.parse(lastRequest.init.body);
    assert.deepStrictEqual(body.messages, [
      { role: 'system', content: 'sys2' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('callLLMJson(string) 解析返回 JSON object', async () => {
    restoreFetch();
    restoreFetch = mockFetch(() => fakeResponse({
      body: { choices: [{ message: { content: '{"score":0.85,"reasoning":"ok"}' } }] },
    }));
    const result = await callLLMJson('eval');
    assert.deepStrictEqual(result, { score: 0.85, reasoning: 'ok' });
  });

  it('callLLMJson({prompt, system}) options-only 形式', async () => {
    restoreFetch();
    restoreFetch = mockFetch(() => fakeResponse({
      body: { choices: [{ message: { content: '{"x":1}' } }] },
    }));
    const result = await callLLMJson({ prompt: 'q', system: 'sys' });
    assert.deepStrictEqual(result, { x: 1 });
  });

  it('callLLMJson throw 当 LLM 返回非 JSON', async () => {
    restoreFetch();
    restoreFetch = mockFetch(() => fakeResponse({
      body: { choices: [{ message: { content: 'not json at all' } }] },
    }));
    await assert.rejects(() => callLLMJson('q'), /无法解析为 JSON/);
  });
});

// ─── describe 2: multimodal 路由 ───────────────────────────

describe('D1-01 hermes-adapter: multimodal prompt 数组路由', () => {
  let restoreFetch;
  let lastBody;

  beforeEach(() => {
    lastBody = null;
    restoreFetch = mockFetch((url, init) => {
      lastBody = JSON.parse(init.body);
      return fakeResponse({
        body: { choices: [{ message: { content: '{"score":0.7}' } }] },
      });
    });
  });
  afterEach(() => restoreFetch());

  it('callLLMJson({prompt: Array}) 使用视觉模型 + 多模态 content blocks', async () => {
    const result = await callLLMJson({
      prompt: [
        { type: 'text', text: '评估一致性' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      ],
      system: '你是审查专家',
    });
    assert.deepStrictEqual(result, { score: 0.7 });
    // 验证: 默认视觉模型被选中
    assert.strictEqual(lastBody.model, getDefaultVisionModel());
    // 验证: messages 包含 multimodal content array
    assert.ok(Array.isArray(lastBody.messages[1].content), 'content 应为数组');
    assert.strictEqual(lastBody.messages[1].content[0].type, 'text');
    assert.strictEqual(lastBody.messages[1].content[1].type, 'image_url');
    assert.strictEqual(lastBody.messages[1].content[1].image_url.url, 'data:image/png;base64,AAAA');
  });

  it('callLLM({prompt: Array, model: custom}) 覆盖默认模型', async () => {
    await callLLM({
      prompt: [
        { type: 'text', text: 'q' },
        { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
      ],
      model: 'custom-vision-v1',
    });
    assert.strictEqual(lastBody.model, 'custom-vision-v1');
    // messages[0] 是 user (无 system),http URL 直传(不转换)
    assert.strictEqual(
      lastBody.messages[0].content[1].image_url.url,
      'https://example.com/a.png',
    );
  });

  it('callViaHermes 对 multimodal 返回 null(强制直连)', async () => {
    // 即使 HERMES_MCP_URL 设置了,multimodal 也不走 Hermes
    const prev = process.env.HERMES_MCP_URL;
    process.env.HERMES_MCP_URL = 'http://fake.hermes.local';
    try {
      const r = await callViaHermes(
        [{ type: 'text', text: 'x' }],
        {},
      );
      assert.strictEqual(r, null, 'multimodal Hermes 调用应返回 null');
    } finally {
      if (prev === undefined) delete process.env.HERMES_MCP_URL;
      else process.env.HERMES_MCP_URL = prev;
    }
  });
});

// ─── describe 3: imagePathToDataUrl + file:// 规范化 ───────

describe('D1-01 hermes-adapter: imagePathToDataUrl file:// → base64', () => {
  let tmpDir;

  before(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'hermes-mm-')); });
  after(async () => { if (tmpDir) await rm(tmpDir, { recursive: true, force: true }); });

  it('imagePathToDataUrl 读取 png 文件 → data:image/png;base64,...', async () => {
    const pngPath = join(tmpDir, 'test.png');
    const pngBytes = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A]);  // PNG header bytes
    await writeFile(pngPath, pngBytes);

    const dataUrl = await imagePathToDataUrl(pngPath);
    assert.match(dataUrl, /^data:image\/png;base64,/);
    const b64 = dataUrl.slice('data:image/png;base64,'.length);
    assert.strictEqual(Buffer.from(b64, 'base64').toString('hex'), pngBytes.toString('hex'));
  });

  it('imagePathToDataUrl 接受 file:// 前缀', async () => {
    const jpgPath = join(tmpDir, 'test.jpg');
    const jpgBytes = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);  // JPEG SOI
    await writeFile(jpgPath, jpgBytes);

    const dataUrl = await imagePathToDataUrl(`file://${jpgPath}`);
    assert.match(dataUrl, /^data:image\/jpeg;base64,/);
  });

  it('imagePathToDataUrl 抛错 — 文件不存在', async () => {
    await assert.rejects(
      () => imagePathToDataUrl(join(tmpDir, 'nonexistent.png')),
      /ENOENT|no such file/i,
    );
  });

  it('imagePathToDataUrl 未知扩展名 → 默认 image/png', async () => {
    const weirdPath = join(tmpDir, 'image.xyz');
    await writeFile(weirdPath, Buffer.from([0x00, 0x01]));
    const dataUrl = await imagePathToDataUrl(weirdPath);
    assert.match(dataUrl, /^data:image\/png;base64,/);
  });

  it('callLLM multimodal 自动转换本地 file:// 路径', async () => {
    const pngPath = join(tmpDir, 'autotest.png');
    const pngBytes = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
    await writeFile(pngPath, pngBytes);

    let capturedBody = null;
    const restore = mockFetch((url, init) => {
      capturedBody = JSON.parse(init.body);
      return fakeResponse({
        body: { choices: [{ message: { content: '{"ok":true}' } }] },
      });
    });
    try {
      await callLLM({
        prompt: [
          { type: 'text', text: 'see image' },
          { type: 'image_url', image_url: { url: pngPath } },
        ],
      });
      const imageBlock = capturedBody.messages[0].content.find(b => b.type === 'image_url');
      assert.ok(imageBlock, '应有 image_url block');
      assert.match(imageBlock.image_url.url, /^data:image\/png;base64,/,
        '本地路径应被转 base64 data URL');
    } finally {
      restore();
    }
  });

  it('callLLM multimodal: 本地图片读取失败时跳过该 block', async () => {
    let capturedBody = null;
    const restore = mockFetch((url, init) => {
      capturedBody = JSON.parse(init.body);
      return fakeResponse({
        body: { choices: [{ message: { content: '{"ok":true}' } }] },
      });
    });
    try {
      await callLLM({
        prompt: [
          { type: 'text', text: 'see image' },
          { type: 'image_url', image_url: { url: '/nonexistent/missing.png' } },
        ],
      });
      // 失败的 image block 被跳过,只剩 text block
      const contentBlocks = capturedBody.messages[0].content;
      assert.strictEqual(contentBlocks.length, 1);
      assert.strictEqual(contentBlocks[0].type, 'text');
    } finally {
      restore();
    }
  });
});

// ─── describe 4: 默认模型 / env var 切换 ──────────────────

describe('D1-01 hermes-adapter: 默认模型 + env var 切换', () => {
  it('ZHIPU_VISION_MODEL env var 覆盖默认视觉模型', async () => {
    const prev = process.env.ZHIPU_VISION_MODEL;
    process.env.ZHIPU_VISION_MODEL = 'glm-4.6v-flash';
    try {
      assert.strictEqual(getDefaultVisionModel(), 'glm-4.6v-flash');
    } finally {
      if (prev === undefined) delete process.env.ZHIPU_VISION_MODEL;
      else process.env.ZHIPU_VISION_MODEL = prev;
    }
    assert.strictEqual(getDefaultVisionModel(), 'glm-4.6v', '默认恢复 glm-4.6v');
  });

  it('multimodal 自动选择视觉模型(不需要显式传 model)', async () => {
    let capturedBody = null;
    const restore = mockFetch((url, init) => {
      capturedBody = JSON.parse(init.body);
      return fakeResponse({
        body: { choices: [{ message: { content: '{"x":1}' } }] },
      });
    });
    try {
      await callLLM({
        prompt: [{ type: 'text', text: 'q' }],
      });
      assert.strictEqual(capturedBody.model, getDefaultVisionModel());
    } finally {
      restore();
    }
  });

  it('text-only 自动选择文本模型', async () => {
    let capturedBody = null;
    const restore = mockFetch((url, init) => {
      capturedBody = JSON.parse(init.body);
      return fakeResponse({
        body: { choices: [{ message: { content: 'ok' } }] },
      });
    });
    try {
      await callLLM('text prompt');
      assert.strictEqual(capturedBody.model, getDefaultTextModel());
    } finally {
      restore();
    }
  });
});

// ─── describe 5: 降级 / 错误路径 ──────────────────────────

describe('D1-01 hermes-adapter: 降级与错误路径', () => {
  it('LLM API 返回非 200 → throw', async () => {
    const restore = mockFetch(() => fakeResponse({
      ok: false,
      status: 401,
      text: 'Unauthorized',
    }));
    try {
      await assert.rejects(() => callLLM('q'), /LLM 调用失败: 401/);
    } finally {
      restore();
    }
  });

  it('LLM API 返回空 choices → 空字符串(不 throw)', async () => {
    const restore = mockFetch(() => fakeResponse({
      body: { choices: [] },
    }));
    try {
      const result = await callLLM('q');
      assert.strictEqual(result, '');
    } finally {
      restore();
    }
  });

  it('网络错误 → throw(fetch rejected)', async () => {
    const restore = mockFetch(() => {
      throw new Error('network unreachable');
    });
    try {
      await assert.rejects(() => callLLM('q'), /network unreachable/);
    } finally {
      restore();
    }
  });
});
