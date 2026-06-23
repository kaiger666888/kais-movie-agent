/**
 * Phase 24 B2-01/03/04/06: CharacterAssetManager cross-episode asset library tests
 *
 * Coverage:
 *   - _computeCostumeFingerprint: DINOv2 primary, pHash fallback, both-fail null
 *   - findByIdentity: empty library, DINOv2 match, pHash degraded reject, mixed skip, human gate
 *   - registerToLibrary: unapproved→pending, approved→index, dedup update
 *   - approvePending: grants + removes from pending
 *   - audit log: actions written
 *   - library root: default + custom
 *
 * Run: node --test test/phases/character-asset-manager-cross-episode.test.mjs
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { CharacterAssetManager } from '../../lib/character-asset-manager.js';

// ---------- fixtures ----------

/** Mock gold-team client that returns a fixed DINOv2 vector per image path. */
function makeMockGtClient(vectorsByPath = {}, opts = {}) {
  return {
    submitTask: async ({ taskType, params }) => {
      if (taskType !== 'dinov2_embedding') {
        throw new Error(`unexpected taskType ${taskType}`);
      }
      if (opts.failOn) throw new Error(opts.failOn);
      const taskId = `task-${params.image_path}-${Date.now()}`;
      // Store pending result keyed by taskId
      makeMockGtClient._pending[taskId] = vectorsByPath[params.image_path] || null;
      return { taskId };
    },
    waitForTask: async (taskId) => {
      const vec = makeMockGtClient._pending[taskId];
      if (!vec) return { artifacts: [] };
      return { artifacts: [{ embedding: vec }] };
    },
  };
}
makeMockGtClient._pending = {};

/** Mock fetchPixels: returns a 32x32 grayscale gradient derived from path hash. */
function makeMockFetchPixels() {
  return async (imagePath) => {
    // Deterministic per-path pattern
    const seed = imagePath.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const pixels = new Uint8Array(1024);
    for (let i = 0; i < 1024; i++) {
      pixels[i] = (i * 7 + seed) % 256;
    }
    return pixels;
  };
}

async function setupCharacterWithL1(baseDir, characterId = 'hero', imagePath = '/tmp/hero.png') {
  const l1Dir = join(baseDir, characterId, 'L1_identity');
  await mkdir(l1Dir, { recursive: true });
  const manifest = {
    level: 'L1',
    type: 'identity_anchor',
    characterId,
    images: [{ path: imagePath }],
  };
  await writeFile(join(l1Dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

async function seedLibrary(libraryRoot, entries) {
  await mkdir(libraryRoot, { recursive: true });
  await writeFile(
    join(libraryRoot, 'index.json'),
    JSON.stringify({ entries, version: 1, updated_at: new Date().toISOString() }, null, 2),
  );
}

// ---------- _computeCostumeFingerprint ----------

describe('Phase 24 B2-01: _computeCostumeFingerprint', () => {
  let tmpDir;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'p24-fp-'));
    await setupCharacterWithL1(tmpDir, 'hero', '/tmp/hero.png');
  });
  after(async () => { if (tmpDir) await rm(tmpDir, { recursive: true, force: true }); });

  it('DINOv2 available → returns dinov2 fingerprint', async () => {
    const vec = [0.1, 0.2, 0.3, 0.4];
    const mgr = new CharacterAssetManager(tmpDir, { libraryRoot: join(tmpDir, ".shared", "character-library"),
      gtClient: makeMockGtClient({ '/tmp/hero.png': vec }),
      fetchPixels: makeMockFetchPixels(),
    });
    const fp = await mgr._computeCostumeFingerprint('hero');
    assert.strictEqual(fp.type, 'dinov2');
    assert.deepEqual(fp.vector, vec);
    assert.strictEqual(fp.source_image, '/tmp/hero.png');
  });

  it('DINOv2 unreachable → falls back to pHash', async () => {
    const mgr = new CharacterAssetManager(tmpDir, { libraryRoot: join(tmpDir, ".shared", "character-library"),
      gtClient: makeMockGtClient({}, { failOn: 'DINOv2 service down' }),
      fetchPixels: makeMockFetchPixels(),
    });
    const fp = await mgr._computeCostumeFingerprint('hero');
    assert.strictEqual(fp.type, 'phash');
    assert.match(fp.hash, /^[0-9a-f]{16}$/);
    assert.strictEqual(fp.source_image, '/tmp/hero.png');
  });

  it('both DINOv2 and fetchPixels unavailable → returns null', async () => {
    const mgr = new CharacterAssetManager(tmpDir, { libraryRoot: join(tmpDir, ".shared", "character-library") });  // no client, no fetchPixels
    const fp = await mgr._computeCostumeFingerprint('hero');
    assert.strictEqual(fp, null);
  });

  it('character without L1 anchors → returns null', async () => {
    const mgr = new CharacterAssetManager(tmpDir, { libraryRoot: join(tmpDir, ".shared", "character-library"),
      gtClient: makeMockGtClient({}),
      fetchPixels: makeMockFetchPixels(),
    });
    const fp = await mgr._computeCostumeFingerprint('nonexistent');
    assert.strictEqual(fp, null);
  });

  it('fetchPixels available but DINOv2 wins (primary)', async () => {
    const vec = [0.5, 0.5, 0.5];
    const mgr = new CharacterAssetManager(tmpDir, { libraryRoot: join(tmpDir, ".shared", "character-library"),
      gtClient: makeMockGtClient({ '/tmp/hero.png': vec }),
      fetchPixels: makeMockFetchPixels(),
    });
    const fp = await mgr._computeCostumeFingerprint('hero');
    assert.strictEqual(fp.type, 'dinov2');  // not phash
  });
});

// ---------- findByIdentity ----------

describe('Phase 24 B2-03: findByIdentity (two-stage matching)', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'p24-find-'));
  });
  after(async () => { if (tmpDir) await rm(tmpDir, { recursive: true, force: true }); });

  it('empty library → status no_match', async () => {
    const mgr = new CharacterAssetManager(tmpDir, { libraryRoot: join(tmpDir, ".shared", "character-library") });
    const fp = { type: 'dinov2', vector: [1, 2, 3], source_image: '/x.png' };
    const result = await mgr.findByIdentity(fp);
    assert.strictEqual(result.status, 'no_match');
    assert.strictEqual(result.matches.length, 0);
  });

  it('DINOv2 cosine match above threshold → confirmed, pending_approval (human gate)', async () => {
    const libVec = [1, 0, 0];   // unit-x
    const queryVec = [0.95, 0.05, 0];  // cosine ~0.998 with libVec
    await seedLibrary(join(tmpDir, '.shared', 'character-library'), [
      {
        characterId: 'hero-s1',
        fingerprint: { type: 'dinov2', vector: libVec, source_image: '/hero-s1.png' },
        episode_origin: { project: 'p1', episode_id: 'ep01' },
      },
    ]);
    const mgr = new CharacterAssetManager(tmpDir, { libraryRoot: join(tmpDir, ".shared", "character-library") });
    const result = await mgr.findByIdentity(
      { type: 'dinov2', vector: queryVec, source_image: '/hero-s2.png' },
    );
    assert.strictEqual(result.status, 'pending_approval');
    assert.strictEqual(result.matches.length, 1);
    assert.strictEqual(result.matches[0].characterId, 'hero-s1');
    assert.ok(result.matches[0].similarity >= 0.92);
    assert.ok(result.pending.approvalId, 'should have approvalId');
  });

  it('DINOv2 cosine below threshold → no_match', async () => {
    const libVec = [1, 0, 0];
    const queryVec = [0.3, 0.9, 0];  // cosine ~0.316
    await seedLibrary(join(tmpDir, '.shared', 'character-library'), [
      {
        characterId: 'hero-s1',
        fingerprint: { type: 'dinov2', vector: libVec, source_image: '/x.png' },
        episode_origin: { project: 'p1', episode_id: 'ep01' },
      },
    ]);
    const mgr = new CharacterAssetManager(tmpDir, { libraryRoot: join(tmpDir, ".shared", "character-library") });
    const result = await mgr.findByIdentity(
      { type: 'dinov2', vector: queryVec, source_image: '/q.png' },
    );
    assert.strictEqual(result.status, 'no_match');
  });

  it('pHash-only match → status degraded (NOT writable to library)', async () => {
    // Two identical phash hashes (similarity=1)
    await seedLibrary(join(tmpDir, '.shared', 'character-library'), [
      {
        characterId: 'hero-s1',
        fingerprint: { type: 'phash', hash: 'aabbccddeeff0011', source_image: '/x.png' },
        episode_origin: { project: 'p1', episode_id: 'ep01' },
      },
    ]);
    const mgr = new CharacterAssetManager(tmpDir, { libraryRoot: join(tmpDir, ".shared", "character-library") });
    const result = await mgr.findByIdentity(
      { type: 'phash', hash: 'aabbccddeeff0011', source_image: '/q.png' },
    );
    assert.strictEqual(result.status, 'degraded');
    assert.strictEqual(result.matches.length, 1);
    assert.match(result.reason, /phash_only_match_not_writable/);
  });

  it('skipHumanGate=true → status matched (no approval queue)', async () => {
    const libVec = [1, 0, 0];
    const queryVec = [0.99, 0.01, 0];
    await seedLibrary(join(tmpDir, '.shared', 'character-library'), [
      {
        characterId: 'hero-s1',
        fingerprint: { type: 'dinov2', vector: libVec, source_image: '/x.png' },
        episode_origin: { project: 'p1', episode_id: 'ep01' },
      },
    ]);
    const mgr = new CharacterAssetManager(tmpDir, { libraryRoot: join(tmpDir, ".shared", "character-library"), skipHumanGate: true, libraryRoot: join(tmpDir, ".shared", "character-library") });
    const result = await mgr.findByIdentity(
      { type: 'dinov2', vector: queryVec, source_image: '/q.png' },
    );
    assert.strictEqual(result.status, 'matched');
    assert.strictEqual(result.matches.length, 1);
  });

  it('dinov2 vs phash (mixed types) → skipped, no candidates', async () => {
    await seedLibrary(join(tmpDir, '.shared', 'character-library'), [
      {
        characterId: 'hero-s1',
        fingerprint: { type: 'phash', hash: 'aabbccddeeff0011', source_image: '/x.png' },
        episode_origin: { project: 'p1', episode_id: 'ep01' },
      },
    ]);
    const mgr = new CharacterAssetManager(tmpDir, { libraryRoot: join(tmpDir, ".shared", "character-library") });
    const result = await mgr.findByIdentity(
      { type: 'dinov2', vector: [1, 2, 3], source_image: '/q.png' },
    );
    assert.strictEqual(result.status, 'no_match');
  });

  it('missing fingerprint type → throws', async () => {
    const mgr = new CharacterAssetManager(tmpDir, { libraryRoot: join(tmpDir, ".shared", "character-library") });
    await assert.rejects(() => mgr.findByIdentity({}), /fingerprint.type 必填/);
  });
});

// ---------- registerToLibrary ----------

describe('Phase 24 B2-04: registerToLibrary (human gate)', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'p24-reg-'));
  });
  after(async () => { if (tmpDir) await rm(tmpDir, { recursive: true, force: true }); });

  it('approved=false (default) → writes to pending-approvals/, NOT index.json', async () => {
    const mgr = new CharacterAssetManager(tmpDir, { libraryRoot: join(tmpDir, ".shared", "character-library") });
    const fp = { type: 'dinov2', vector: [1, 0, 0], source_image: '/hero.png' };
    const result = await mgr.registerToLibrary('hero-s1', fp, {
      project: 'p1',
      episode_id: 'ep01',
    });

    assert.strictEqual(result.registered, false);
    assert.ok(result.approval_id, 'should have approval_id');

    // index.json should NOT have the entry
    const idx = await mgr._loadLibraryIndex();
    assert.strictEqual(idx.entries.length, 0);

    // pending-approvals/ should have a file
    const { readdir } = await import('node:fs/promises');
    const pendingFiles = await readdir(join(tmpDir, '.shared', 'character-library', 'pending-approvals'));
    assert.ok(pendingFiles.some(f => f.includes(result.approval_id)));
  });

  it('approved=true → writes to index.json with entry', async () => {
    const mgr = new CharacterAssetManager(tmpDir, { libraryRoot: join(tmpDir, ".shared", "character-library") });
    const fp = { type: 'dinov2', vector: [1, 0, 0], source_image: '/hero.png' };
    const result = await mgr.registerToLibrary('hero-s1', fp,
      { project: 'p1', episode_id: 'ep01' },
      { approved: true, reviewed_by: 'operator-1' },
    );

    assert.strictEqual(result.registered, true);
    assert.strictEqual(result.entry.characterId, 'hero-s1');
    assert.strictEqual(result.entry.approved_by, 'operator-1');
    assert.ok(result.entry.approved_at);

    const idx = await mgr._loadLibraryIndex();
    assert.strictEqual(idx.entries.length, 1);
    assert.strictEqual(idx.entries[0].characterId, 'hero-s1');
  });

  it('re-register same characterId → updates entry (dedup)', async () => {
    const mgr = new CharacterAssetManager(tmpDir, { libraryRoot: join(tmpDir, ".shared", "character-library") });
    const fp1 = { type: 'dinov2', vector: [1, 0, 0], source_image: '/a.png' };
    const fp2 = { type: 'dinov2', vector: [0.9, 0.1, 0], source_image: '/b.png' };

    await mgr.registerToLibrary('hero', fp1, { project: 'p1', episode_id: 'e1' }, { approved: true });
    await mgr.registerToLibrary('hero', fp2, { project: 'p1', episode_id: 'e2' }, { approved: true });

    const idx = await mgr._loadLibraryIndex();
    assert.strictEqual(idx.entries.length, 1, 'should dedup to 1 entry');
    assert.strictEqual(idx.entries[0].source_image || idx.entries[0].fingerprint.source_image, '/b.png');
  });

  it('pHash fingerprint registered with approved=true → allowed (operator explicit approval)', async () => {
    const mgr = new CharacterAssetManager(tmpDir, { libraryRoot: join(tmpDir, ".shared", "character-library") });
    const fp = { type: 'phash', hash: 'aabbccddeeff0011', source_image: '/hero.png' };
    const result = await mgr.registerToLibrary('hero', fp,
      { project: 'p1', episode_id: 'ep01' },
      { approved: true });
    assert.strictEqual(result.registered, true);
  });

  it('missing characterId → throws', async () => {
    const mgr = new CharacterAssetManager(tmpDir, { libraryRoot: join(tmpDir, ".shared", "character-library") });
    await assert.rejects(
      () => mgr.registerToLibrary(null, { type: 'dinov2', vector: [] }, {}),
      /characterId 必填/,
    );
  });

  it('missing fingerprint.type → throws', async () => {
    const mgr = new CharacterAssetManager(tmpDir, { libraryRoot: join(tmpDir, ".shared", "character-library") });
    await assert.rejects(
      () => mgr.registerToLibrary('hero', {}, {}),
      /fingerprint.type 必填/,
    );
  });
});

// ---------- approvePending ----------

describe('Phase 24 B2-06: approvePending flow', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'p24-appr-'));
  });
  after(async () => { if (tmpDir) await rm(tmpDir, { recursive: true, force: true }); });

  it('register pending → approve → entry in index, pending removed', async () => {
    const mgr = new CharacterAssetManager(tmpDir, { libraryRoot: join(tmpDir, ".shared", "character-library") });
    const fp = { type: 'dinov2', vector: [1, 0, 0], source_image: '/hero.png' };

    const pending = await mgr.registerToLibrary('hero', fp,
      { project: 'p1', episode_id: 'ep01' });
    assert.strictEqual(pending.registered, false);

    const approval = await mgr.approvePending(pending.approval_id, { reviewed_by: 'op-1' });
    assert.strictEqual(approval.registered, true);

    const idx = await mgr._loadLibraryIndex();
    assert.strictEqual(idx.entries.length, 1);
    assert.strictEqual(idx.entries[0].characterId, 'hero');

    // pending file should be deleted
    const stillPending = await mgr._readPendingApproval(pending.approval_id);
    assert.strictEqual(stillPending, null);
  });

  it('approve non-existent approvalId → throws', async () => {
    const mgr = new CharacterAssetManager(tmpDir, { libraryRoot: join(tmpDir, ".shared", "character-library") });
    await assert.rejects(
      () => mgr.approvePending('appr-nonexistent'),
      /不存在/,
    );
  });
});

// ---------- audit log ----------

describe('Phase 24: audit log persistence', () => {
  let tmpDir;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'p24-audit-'));
  });
  after(async () => { if (tmpDir) await rm(tmpDir, { recursive: true, force: true }); });

  it('all operations write to audit-log.jsonl', async () => {
    const mgr = new CharacterAssetManager(tmpDir, { libraryRoot: join(tmpDir, ".shared", "character-library") });
    const fp = { type: 'dinov2', vector: [1, 0, 0], source_image: '/x.png' };

    // Register (pending)
    const r1 = await mgr.registerToLibrary('hero', fp, { project: 'p1', episode_id: 'e1' });
    // Approve
    await mgr.approvePending(r1.approval_id, { reviewed_by: 'op-1' });

    const log = await mgr._readAuditLog();
    const actions = log.map(e => e.action);
    assert.ok(actions.includes('register_pending_approval'));
    assert.ok(actions.includes('approval_granted'));
    assert.ok(actions.includes('register_approved'));
  });

  it('findByIdency match writes audit entry', async () => {
    await seedLibrary(join(tmpDir, '.shared', 'character-library'), [
      {
        characterId: 'hero',
        fingerprint: { type: 'dinov2', vector: [1, 0, 0], source_image: '/x.png' },
        episode_origin: { project: 'p1', episode_id: 'e1' },
      },
    ]);
    const mgr = new CharacterAssetManager(tmpDir, { libraryRoot: join(tmpDir, ".shared", "character-library"), skipHumanGate: true, libraryRoot: join(tmpDir, ".shared", "character-library") });
    await mgr.findByIdentity({ type: 'dinov2', vector: [0.99, 0.01, 0], source_image: '/y.png' });

    const log = await mgr._readAuditLog();
    assert.ok(log.some(e => e.action === 'find_identity_matched'));
  });
});

// ---------- library root ----------

describe('Phase 24 B2-06: library root configuration', () => {
  it('default libraryRoot derived from baseDir parent/.shared/character-library', () => {
    // Real layout: baseDir=<workdir>/characters, library=<workdir>/.shared/character-library
    const mgr = new CharacterAssetManager('/data/work/characters');
    assert.strictEqual(mgr.libraryRoot, '/data/work/.shared/character-library');
  });

  it('custom libraryRoot overrides default', () => {
    const mgr = new CharacterAssetManager('/data/work/characters', {
      libraryRoot: '/custom/lib',
    });
    assert.strictEqual(mgr.libraryRoot, '/custom/lib');
  });

  it('index.json created on first approved register', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'p24-root-'));
    try {
      // Mimic real layout: baseDir=tmp/characters, libraryRoot=tmp/.shared/...
      const baseDir = join(tmp, 'characters');
      const { mkdir: mk } = await import('node:fs/promises');
      await mk(baseDir, { recursive: true });
      const mgr = new CharacterAssetManager(baseDir);
      await mgr.registerToLibrary('hero',
        { type: 'dinov2', vector: [1, 0, 0], source_image: '/x.png' },
        { project: 'p1', episode_id: 'e1' },
        { approved: true });
      const raw = await readFile(join(tmp, '.shared', 'character-library', 'index.json'), 'utf-8');
      const parsed = JSON.parse(raw);
      assert.strictEqual(parsed.entries.length, 1);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
