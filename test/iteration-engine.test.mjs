/**
 * Quick Task 260702-rg2: IterationEngine unit tests
 *
 * Covers:
 *   - module load
 *   - diagnose() with mocked llmCaller returning reroll/pipeline_adjust/upstream_fix
 *   - diagnose() strips ```json fences
 *   - diagnose() throws on invalid diagnosis.type
 *   - diagnose() throws on non-JSON LLM output
 *   - _topologicalSort() linear A→B→C
 *   - _topologicalSort() diamond A→{B,C}→D
 *   - _topologicalSort() cycle throws
 *   - plan() with mocked HTTP + mocked llmCaller
 *   - _storePlan + _readPlan round-trip
 *   - _readPlan unknown id throws
 *   - listPlans returns all rows
 *   - execute() happy path
 *   - execute() per-node failure does not abort iteration
 *   - execute() rejects when requiresApproval && !adjustmentApproved
 *   - approveAdjustment() flips flag
 *   - confirm() applies pipelineAdjustment
 *   - discard() updates plan status
 *   - _applyPipelineAdjustment() writes prompt_modification override
 *
 * Run: node --test test/iteration-engine.test.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { IterationEngine } from '../lib/iteration-engine.js';

const ORIGINAL_FETCH = global.fetch;

async function makeTmpDir() {
  return mkdtemp(join(tmpdir(), 'rg2-iter-'));
}

/**
 * Build a fetch mock from a routes map.
 * routes: { 'GET /path': body | (opts) => body, 'POST /path': ... }
 * Keys are `${method} ${urlSubstring}`.
 * Returns a function suitable for global.fetch.
 */
function mockFetch(routes) {
  return async (url, opts = {}) => {
    const urlStr = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    const key = `${method} ${urlStr}`;
    // Find matching route by substring
    let matchedKey = null;
    for (const k of Object.keys(routes)) {
      const [m, pathSub] = k.split(' ');
      if (m === method && urlStr.includes(pathSub)) {
        matchedKey = k;
        break;
      }
    }
    if (!matchedKey) {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'no mock route for ' + key }),
        text: async () => '',
      };
    }
    const handler = routes[matchedKey];
    let body;
    try {
      body = typeof opts.body === 'string' ? JSON.parse(opts.body) : (opts.body || {});
    } catch { body = {}; }
    const out = typeof handler === 'function' ? handler(body) : handler;
    return {
      ok: true,
      status: 200,
      json: async () => out,
      text: async () => (typeof out === 'string' ? out : JSON.stringify(out)),
    };
  };
}

function rerollPayload() {
  return {
    diagnosis: {
      type: 'reroll',
      rootCause: '个别镜头随机质量不稳',
      confidence: 0.7,
      evidence: ['shot-001 低分', 'shot-005 模糊'],
    },
    actions: [
      { nodeId: 'n1', action: 'regenerate', promptDelta: '+更清晰', reason: '重抽一次', dependsOn: [] },
    ],
    branchLabel: 'v2-reroll',
    requiresApproval: false,
    summary: 'reroll only',
  };
}

function pipelineAdjustPayload() {
  return {
    diagnosis: {
      type: 'pipeline_adjust',
      rootCause: '表情呆板模式遍布该 phase',
      confidence: 0.85,
      evidence: ['5 个 reject 都提到"表情呆板"'],
    },
    actions: [
      {
        nodeId: 'n1', action: 'regenerate', reason: '重生成',
        pipelineAdjustment: { type: 'prompt_modification', target: 'face-prompt', change: '+微笑' },
        dependsOn: [],
      },
    ],
    branchLabel: 'v3-expression',
    requiresApproval: true,
    summary: 'pipeline adjustment needed',
  };
}

function upstreamFixPayload() {
  return {
    diagnosis: {
      type: 'upstream_fix',
      rootCause: '角色图质量差导致下游全崩',
      confidence: 0.9,
      evidence: ['角色图低分', '下游 8 个节点 reject'],
    },
    actions: [
      { nodeId: 'char-001', action: 'regenerate', reason: '上游重生成', dependsOn: [] },
      { nodeId: 'shot-001', action: 'regenerate_after_parent', reason: '级联', dependsOn: ['char-001'] },
    ],
    branchLabel: 'v4-upstream',
    requiresApproval: false,
    summary: 'upstream fix',
  };
}

describe('IterationEngine', () => {
  let tmpDir;

  beforeEach(async () => { tmpDir = await makeTmpDir(); });
  afterEach(async () => {
    global.fetch = ORIGINAL_FETCH;
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('module load', () => {
    it('IterationEngine is a class and constructs', () => {
      assert.strictEqual(typeof IterationEngine, 'function');
      const e = new IterationEngine(tmpDir);
      assert.ok(e instanceof IterationEngine);
    });
  });

  describe('diagnose()', () => {
    it('parses reroll LLM JSON into valid IterationPlan', async () => {
      const e = new IterationEngine(tmpDir, { episodesId: 'ep1', llmCaller: async () => JSON.stringify(rerollPayload()) });
      const plan = await e.diagnose({ byNode: {}, topology: {}, summary: {} });
      assert.strictEqual(plan.diagnosis.type, 'reroll');
      assert.ok(plan.id && plan.id.startsWith('iter-'));
      assert.strictEqual(plan.requiresApproval, false);
      assert.strictEqual(plan.adjustmentApproved, false);
      assert.strictEqual(plan.status, 'pending');
      assert.strictEqual(plan.actions.length, 1);
      assert.strictEqual(plan.branchLabel, 'v2-reroll');
    });

    it('parses pipeline_adjust and sets requiresApproval=true', async () => {
      const e = new IterationEngine(tmpDir, { episodesId: 'ep1', llmCaller: async () => JSON.stringify(pipelineAdjustPayload()) });
      const plan = await e.diagnose({ byNode: {}, topology: {}, summary: {} });
      assert.strictEqual(plan.diagnosis.type, 'pipeline_adjust');
      assert.strictEqual(plan.requiresApproval, true);
    });

    it('parses upstream_fix with dependsOn preserved', async () => {
      const e = new IterationEngine(tmpDir, { llmCaller: async () => JSON.stringify(upstreamFixPayload()) });
      const plan = await e.diagnose({ byNode: {}, topology: {}, summary: {} });
      assert.strictEqual(plan.diagnosis.type, 'upstream_fix');
      assert.deepStrictEqual(plan.actions[1].dependsOn, ['char-001']);
    });

    it('strips ```json fences defensively', async () => {
      const payload = rerollPayload();
      const e = new IterationEngine(tmpDir, {
        llmCaller: async () => '```json\n' + JSON.stringify(payload) + '\n```',
      });
      const plan = await e.diagnose({ byNode: {}, topology: {}, summary: {} });
      assert.strictEqual(plan.diagnosis.type, 'reroll');
    });

    it('throws on invalid diagnosis.type', async () => {
      const payload = rerollPayload();
      payload.diagnosis.type = 'unknown';
      const e = new IterationEngine(tmpDir, { llmCaller: async () => JSON.stringify(payload) });
      await assert.rejects(() => e.diagnose({ byNode: {}, topology: {}, summary: {} }), Error);
    });

    it('throws on non-JSON LLM output', async () => {
      const e = new IterationEngine(tmpDir, { llmCaller: async () => 'sorry I cannot help' });
      await assert.rejects(() => e.diagnose({ byNode: {}, topology: {}, summary: {} }), Error);
    });
  });

  describe('_topologicalSort()', () => {
    it('linear chain A→B→C', () => {
      const e = new IterationEngine(tmpDir);
      const sorted = e._topologicalSort([
        { nodeId: 'A' },
        { nodeId: 'B', dependsOn: ['A'] },
        { nodeId: 'C', dependsOn: ['B'] },
      ]);
      const ids = sorted.map((a) => a.nodeId);
      assert.deepStrictEqual(ids, ['A', 'B', 'C']);
    });

    it('diamond A→{B,C}→D', () => {
      const e = new IterationEngine(tmpDir);
      const sorted = e._topologicalSort([
        { nodeId: 'A' },
        { nodeId: 'B', dependsOn: ['A'] },
        { nodeId: 'C', dependsOn: ['A'] },
        { nodeId: 'D', dependsOn: ['B', 'C'] },
      ]);
      const ids = sorted.map((a) => a.nodeId);
      assert.strictEqual(ids[0], 'A');
      assert.strictEqual(ids[ids.length - 1], 'D');
      assert.strictEqual(ids.length, 4);
      // B and C both after A, before D
      const aIdx = ids.indexOf('A');
      const bIdx = ids.indexOf('B');
      const cIdx = ids.indexOf('C');
      const dIdx = ids.indexOf('D');
      assert.ok(bIdx > aIdx && cIdx > aIdx);
      assert.ok(dIdx > bIdx && dIdx > cIdx);
    });

    it('throws on cycle', () => {
      const e = new IterationEngine(tmpDir);
      assert.throws(() => e._topologicalSort([
        { nodeId: 'A', dependsOn: ['B'] },
        { nodeId: 'B', dependsOn: ['A'] },
      ]), /cycle/);
    });
  });

  describe('plan() with mocked HTTP + LLM', () => {
    it('collectFeedback → diagnose → _storePlan returns plan and persists JSONL', async () => {
      global.fetch = mockFetch({
        'GET /feedback/project/': { success: true, data: [
          { assetId: 'n1', verdict: 'reject', content: 'blurry' },
        ] },
        'GET /feedback/propagation/': { success: true, data: { downstream: ['n2', 'n3'], upstream: [] } },
      });
      const e = new IterationEngine(tmpDir, {
        projectId: 42, episodesId: 'ep1',
        llmCaller: async () => JSON.stringify(rerollPayload()),
      });
      const plan = await e.plan();
      assert.ok(plan.id);
      // Verify JSONL persisted
      const raw = await readFile(join(tmpDir, '.pipeline-assets', 'iteration-plans.jsonl'), 'utf-8');
      const rows = raw.trim().split('\n').filter(Boolean).map(JSON.parse);
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].id, plan.id);
    });
  });

  describe('storage round-trip', () => {
    it('_storePlan + _readPlan round-trip', async () => {
      const e = new IterationEngine(tmpDir);
      const plan = { id: 'iter-test-1', status: 'pending', actions: [] };
      await e._storePlan(plan);
      const read = await e._readPlan('iter-test-1');
      assert.strictEqual(read.id, 'iter-test-1');
    });

    it('_readPlan unknown id throws', async () => {
      const e = new IterationEngine(tmpDir);
      await e._storePlan({ id: 'x', status: 'pending' });
      await assert.rejects(() => e._readPlan('does-not-exist'), Error);
    });

    it('listPlans returns all rows', async () => {
      const e = new IterationEngine(tmpDir);
      await e._storePlan({ id: 'a', status: 'pending' });
      await e._storePlan({ id: 'b', status: 'pending' });
      const all = await e.listPlans();
      assert.strictEqual(all.length, 2);
    });
  });

  describe('execute()', () => {
    it('happy path — all nodes succeed', async () => {
      const e = new IterationEngine(tmpDir, { projectId: 1 });
      const plan = {
        id: 'iter-exec-1', status: 'pending', requiresApproval: false,
        branchLabel: 'v2-test', actions: [
          { nodeId: 'n1', action: 'regenerate', reason: 'r', dependsOn: [] },
          { nodeId: 'n2', action: 'regenerate', reason: 'r', dependsOn: ['n1'] },
        ],
      };
      await e._storePlan(plan);

      global.fetch = mockFetch({
        'POST /branches': { success: true, data: { id: 'br-1' } },
        'POST /execute': { success: true, data: { outputUrl: 'http://x/y.mp4' } },
        'POST /events': { success: true },
      });

      const result = await e.execute('iter-exec-1');
      assert.strictEqual(result.branchId, 'br-1');
      assert.strictEqual(result.regeneratedNodes.length, 2);
      assert.ok(result.regeneratedNodes.every((n) => n.status === 'success'));
    });

    it('per-node failure does not abort iteration', async () => {
      const e = new IterationEngine(tmpDir, { projectId: 1 });
      const plan = {
        id: 'iter-exec-2', status: 'pending', requiresApproval: false,
        branchLabel: 'v2-fail', actions: [
          { nodeId: 'n1', action: 'regenerate', reason: 'r', dependsOn: [] },
          { nodeId: 'n2', action: 'regenerate', reason: 'r', dependsOn: ['n1'] },
        ],
      };
      await e._storePlan(plan);

      let callCount = 0;
      global.fetch = mockFetch({
        'POST /branches': { success: true, data: { id: 'br-2' } },
        'POST /execute': () => {
          callCount++;
          if (callCount === 1) {
            return { success: false, data: null, __httpStatus: 500 };
          }
          return { success: true, data: { outputUrl: 'http://ok' } };
        },
      });

      // Make first execute call actually fail by overriding fetch with custom logic
      let execInvocations = 0;
      global.fetch = async (url, opts = {}) => {
        const urlStr = String(url);
        const method = (opts.method || 'GET').toUpperCase();
        if (method === 'POST' && urlStr.includes('/branches')) {
          return { ok: true, status: 200, json: async () => ({ success: true, data: { id: 'br-2' } }), text: async () => '' };
        }
        if (method === 'POST' && urlStr.includes('/execute')) {
          execInvocations++;
          if (execInvocations === 1) {
            return { ok: false, status: 500, json: async () => ({ error: 'engine down' }), text: async () => '' };
          }
          return { ok: true, status: 200, json: async () => ({ success: true, data: { outputUrl: 'http://ok' } }), text: async () => '' };
        }
        if (method === 'POST' && urlStr.includes('/events')) {
          return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
        }
        return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
      };

      const result = await e.execute('iter-exec-2');
      assert.strictEqual(result.regeneratedNodes.length, 2);
      const failed = result.regeneratedNodes.find((n) => n.status === 'failed');
      const success = result.regeneratedNodes.find((n) => n.status === 'success');
      assert.ok(failed, 'one node should be failed');
      assert.ok(success, 'one node should be success');
    });

    it('rejects when requiresApproval=true && adjustmentApproved=false', async () => {
      const e = new IterationEngine(tmpDir);
      const plan = {
        id: 'iter-exec-3', status: 'pending', requiresApproval: true, adjustmentApproved: false,
        branchLabel: 'v-adj', actions: [],
      };
      await e._storePlan(plan);
      await assert.rejects(() => e.execute('iter-exec-3'), /approval/);
    });
  });

  describe('approveAdjustment()', () => {
    it('flips adjustmentApproved flag on plan row', async () => {
      const e = new IterationEngine(tmpDir);
      await e._storePlan({ id: 'p-adj', status: 'pending', requiresApproval: true, adjustmentApproved: false });
      await e.approveAdjustment('p-adj');
      const read = await e._readPlan('p-adj');
      assert.strictEqual(read.adjustmentApproved, true);
      assert.strictEqual(read.status, 'approved');
    });
  });

  describe('confirm()', () => {
    it('applies pipelineAdjustment when plan has one', async () => {
      const e = new IterationEngine(tmpDir, { projectId: 1 });
      const plan = {
        id: 'p-confirm', status: 'executed',
        branchLabel: 'v-confirm',
        actions: [
          { nodeId: 'n1', action: 'regenerate', reason: 'r',
            pipelineAdjustment: { type: 'prompt_modification', target: 'face-prompt', change: '+smile' } },
        ],
        result: { branchId: 'br-confirm' },
      };
      await e._storePlan(plan);

      let patchStatus = null;
      global.fetch = async (url, opts = {}) => {
        const urlStr = String(url);
        const method = (opts.method || 'GET').toUpperCase();
        if (method === 'PATCH' && urlStr.includes('/branches/')) {
          let body = {};
          try { body = JSON.parse(opts.body); } catch {}
          patchStatus = body.status;
          return { ok: true, status: 200, json: async () => ({ success: true }), text: async () => '' };
        }
        return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
      };

      await e.confirm('br-confirm');
      assert.strictEqual(patchStatus, 'active');
      const overrides = JSON.parse(await readFile(join(tmpDir, '.pipeline-assets', 'prompt-overrides.json'), 'utf-8'));
      assert.ok(overrides['face-prompt'], 'override written for target');
    });
  });

  describe('discard()', () => {
    it('updates plan row status to discarded', async () => {
      const e = new IterationEngine(tmpDir, { projectId: 1 });
      const plan = {
        id: 'p-discard', status: 'executed', branchLabel: 'v-d',
        actions: [],
        result: { branchId: 'br-discard' },
      };
      await e._storePlan(plan);

      let patchBody = null;
      global.fetch = async (url, opts = {}) => {
        const method = (opts.method || 'GET').toUpperCase();
        if (method === 'PATCH') {
          try { patchBody = JSON.parse(opts.body); } catch {}
          return { ok: true, status: 200, json: async () => ({ success: true }), text: async () => '' };
        }
        return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
      };

      await e.discard('br-discard', 'not good');
      const read = await e._readPlan('p-discard');
      assert.strictEqual(read.status, 'discarded');
      assert.strictEqual(read.discardReason, 'not good');
      assert.strictEqual(patchBody.status, 'rejected');
    });
  });

  describe('_applyPipelineAdjustment()', () => {
    it('writes prompt_modification override keyed by target', async () => {
      const e = new IterationEngine(tmpDir);
      const plan = {
        actions: [
          { pipelineAdjustment: { type: 'prompt_modification', target: 'style/bible', change: '+cinematic' } },
        ],
      };
      await e._applyPipelineAdjustment(plan);
      const overrides = JSON.parse(await readFile(join(tmpDir, '.pipeline-assets', 'prompt-overrides.json'), 'utf-8'));
      assert.ok(Array.isArray(overrides['style/bible']));
      assert.strictEqual(overrides['style/bible'][0].change, '+cinematic');
    });
  });
});
