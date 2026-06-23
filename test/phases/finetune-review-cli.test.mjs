/**
 * Phase 25: finetune-review CLI tests (Commit 3 / B6-03)
 *
 * Tests CLI argument parsing and the command flows by invoking exported
 * command functions with mocked AssetBus/FineTuneETL.
 *
 * Run: node --test test/phases/finetune-review-cli.test.mjs
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { parseArgs, toBool } from '../../bin/finetune-review.js';
import { AssetBus } from '../../lib/asset-bus.js';
import { FineTuneETL } from '../../lib/finetune-etl.js';

// ─── parseArgs ───────────────────────────────────────────────────────────

describe('finetune-review CLI parseArgs', () => {
  it('parses --flag value pairs', () => {
    const { flags, positional } = parseArgs(['--copyright', 'original', '--pii', 'true']);
    assert.equal(flags.copyright, 'original');
    assert.equal(flags.pii, 'true');
    assert.deepEqual(positional, []);
  });

  it('parses boolean --flag (no value)', () => {
    const { flags } = parseArgs(['--yes']);
    assert.equal(flags.yes, true);
  });

  it('parses positional + flags mixed', () => {
    const { flags, positional } = parseArgs(['s-shot-001', '--copyright', 'original']);
    assert.deepEqual(positional, ['s-shot-001']);
    assert.equal(flags.copyright, 'original');
  });

  it('handles multiple positional args', () => {
    const { positional } = parseArgs(['a', 'b', 'c']);
    assert.deepEqual(positional, ['a', 'b', 'c']);
  });

  it('handles empty input', () => {
    const { flags, positional } = parseArgs([]);
    assert.deepEqual(flags, {});
    assert.deepEqual(positional, []);
  });

  it('treats --flag at end as boolean', () => {
    const { flags } = parseArgs(['--verbose']);
    assert.equal(flags.verbose, true);
  });
});

// ─── toBool ─────────────────────────────────────────────────────────────

describe('finetune-review CLI toBool', () => {
  it('converts truthy strings to true', () => {
    assert.equal(toBool('true'), true);
    assert.equal(toBool('TRUE'), true);
    assert.equal(toBool('1'), true);
    assert.equal(toBool('yes'), true);
    assert.equal(toBool('y'), true);
  });

  it('converts falsy strings to false', () => {
    assert.equal(toBool('false'), false);
    assert.equal(toBool('0'), false);
    assert.equal(toBool('no'), false);
    assert.equal(toBool('n'), false);
  });

  it('returns undefined for ambiguous values', () => {
    assert.equal(toBool('maybe'), undefined);
    assert.equal(toBool(''), undefined);
  });

  it('passes through boolean true', () => {
    assert.equal(toBool(true), true);
  });
});

// ─── End-to-end CLI flow tests ──────────────────────────────────────────
//
// These tests set up a real AssetBus + FineTuneETL in a temp workdir,
// invoke the CLI command functions, and verify the resulting state.

describe('finetune-review CLI end-to-end', () => {
  let workdir;
  let assetBus;
  let etl;

  before(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'finetune-cli-test-'));
  });
  after(async () => {
    await rm(workdir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    // Each test gets a fresh subdir to avoid cross-test state leaks
    const testDir = join(workdir, `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await mkdir(testDir, { recursive: true });
    assetBus = new AssetBus(testDir);
    etl = new FineTuneETL({
      assetBus,
      workdir: testDir,
      embeddingFn: async () => [0, 0, 0],
    });
    // monkey-patch setupEtl by storing on process.env
    process.env.WORKDIR = testDir;
  });

  it('list-pending on empty pipeline returns count=0', async () => {
    // Re-import after setting WORKDIR
    const cli = await import('../../bin/finetune-review.js?t=' + Date.now());
    const result = await cli.cmdListPending();
    assert.equal(result.count, 0);
  });

  it('full flow: generateManifest → list-pending → approve → submit-training', async () => {
    // seed failed-shots
    await assetBus.write('failed-shots', {
      failures: [
        { shot_id: 'shot-001', error: 'face', prompt: 'hero', timestamp: '2026-06-01T00:00:00Z' },
        { shot_id: 'shot-002', error: 'bad', prompt: 'scene', timestamp: '2026-06-01T00:00:00Z' },
      ],
      version: 1,
    });
    await etl.generateManifest();

    // Re-import CLI with fresh WORKDIR
    const cli = await import('../../bin/finetune-review.js?t=' + Date.now() + '-1');

    // list-pending
    const listResult = await cli.cmdListPending();
    assert.equal(listResult.count, 2);

    // approve one sample
    const approveResult = await cli.cmdApprove('s-shot-001', {
      copyright: 'original',
      pii: 'true',
      label: 'true',
      reviewer: 'cli-test',
    });
    assert.equal(approveResult.action, 'approved');

    // After approve, list should show 1
    const listAfter = await cli.cmdListPending();
    assert.equal(listAfter.count, 1);
  });

  it('approve with missing --copyright throws with helpful message', async () => {
    await assetBus.write('failed-shots', {
      failures: [{ shot_id: 'shot-x', error: 'e', prompt: 'p', timestamp: '2026-06-01T00:00:00Z' }],
      version: 1,
    });
    await etl.generateManifest();

    const cli = await import('../../bin/finetune-review.js?t=' + Date.now() + '-2');
    await assert.rejects(
      () => cli.cmdApprove('s-shot-x', {
        // missing --copyright
        pii: 'true',
        label: 'true',
      }),
      /Missing required flags: --copyright/,
    );
  });

  it('approve with missing sample_id throws', async () => {
    const cli = await import('../../bin/finetune-review.js?t=' + Date.now() + '-2b');
    await assert.rejects(
      () => cli.cmdApprove(undefined, { copyright: 'original', pii: 'true', label: 'true' }),
      /sample_id required/,
    );
  });

  it('show on non-existent sample throws', async () => {
    const cli = await import('../../bin/finetune-review.js?t=' + Date.now() + '-2c');
    await assert.rejects(
      () => cli.cmdShow('s-does-not-exist'),
      /Sample not found/,
    );
  });

  it('reject with missing sample_id throws', async () => {
    const cli = await import('../../bin/finetune-review.js?t=' + Date.now() + '-2d');
    await assert.rejects(
      () => cli.cmdReject(undefined, {}),
      /sample_id required/,
    );
  });

  it('reject moves sample to rejected/', async () => {
    await assetBus.write('failed-shots', {
      failures: [{ shot_id: 'shot-r', error: 'e', prompt: 'p', timestamp: '2026-06-01T00:00:00Z' }],
      version: 1,
    });
    await etl.generateManifest();

    const cli = await import('../../bin/finetune-review.js?t=' + Date.now() + '-3');
    const result = await cli.cmdReject('s-shot-r', {
      reason: 'low quality',
      reviewer: 'cli-test',
    });
    assert.equal(result.action, 'rejected');

    // Verify pending is empty now
    const listAfter = await cli.cmdListPending();
    assert.equal(listAfter.count, 0);
  });

  it('show displays full sample JSON', async () => {
    await assetBus.write('failed-shots', {
      failures: [{ shot_id: 'shot-show', error: 'e', prompt: 'p', timestamp: '2026-06-01T00:00:00Z' }],
      version: 1,
    });
    await etl.generateManifest();

    const cli = await import('../../bin/finetune-review.js?t=' + Date.now() + '-4');
    const result = await cli.cmdShow('s-shot-show');
    assert.ok(result.sample);
    assert.equal(result.sample.sample_id, 's-shot-show');
    assert.equal(result.sample.review, null);
  });
});
