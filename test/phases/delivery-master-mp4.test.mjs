/**
 * Phase 29-02 PIPE-COMPOSE-02 regression test:
 * delivery handler MUST check master.mp4 (not final.mp4), MUST degrade-tolerate
 * web-preview.mp4 absence, and MUST write `_composition.delivered_mastermp4`
 * marker into quality-report.json.
 *
 * Background (the audit finding this guards against):
 *   - composition handler now writes master.mp4 (Plan 29-01), but delivery was
 *     still checking `final.mp4` → silent miss on every successful composition.
 *   - web-preview.mp4 is best-effort in degraded mode; its absence MUST NOT
 *     fail delivery (degrade-tolerant warn per CONTEXT D-PIPE-COMPOSE-02).
 *   - operators have no single field telling them whether composition actually
 *     delivered — `_composition.delivered_mastermp4` in quality-report.json is
 *     the operator-visibility marker.
 *
 * This test will fail if:
 *   - delivery handler references final.mp4 instead of master.mp4
 *   - delivery handler throws when web-preview.mp4 is absent
 *   - quality-report.json omits the `_composition.delivered_mastermp4` marker
 *   - the marker value disagrees with actual master.mp4 presence
 *
 * Run: node --test test/phases/delivery-master-mp4.test.mjs
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Pipeline } from '../../lib/pipeline.js';
import { phaseHandlers } from '../../lib/phases/index.js';

let workdir;

before(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'delivery-master-mp4-'));
});

after(async () => {
  await rm(workdir, { recursive: true, force: true });
});

const deliveryPhase = { id: 'delivery', stageOrder: 19, name: '质检与交付' };

async function runDelivery(dir) {
  const pipeline = new Pipeline({ workdir: dir, config: { degradedMode: true } });
  // delivery.after is the handler that writes quality-report.json and stats
  // the master.mp4 / web-preview.mp4 files.
  await phaseHandlers.delivery.after(pipeline, deliveryPhase, {});
  const raw = await readFile(join(dir, 'quality-report.json'), 'utf8');
  return JSON.parse(raw);
}

describe('delivery handler master.mp4 alignment + degrade-tolerant web-preview (PIPE-COMPOSE-02)', () => {

  it('Test 1: master.mp4 present → _composition.delivered_mastermp4: true', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'delivery-master-present-'));
    try {
      // Touch a 0-byte master.mp4 — delivery only checks existence/size.
      await writeFile(join(dir, 'master.mp4'), Buffer.alloc(0));
      const report = await runDelivery(dir);

      assert.equal(
        report._composition?.delivered_mastermp4, true,
        '_composition.delivered_mastermp4 MUST be true when master.mp4 exists',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('Test 2: master.mp4 absent → _composition.delivered_mastermp4: false (no throw, degrade note)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'delivery-master-absent-'));
    try {
      // No master.mp4 written — delivery MUST NOT throw.
      const report = await runDelivery(dir);

      assert.equal(
        report._composition?.delivered_mastermp4, false,
        '_composition.delivered_mastermp4 MUST be false when master.mp4 is absent',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('Test 3: web-preview.mp4 absent (master present) → delivery succeeds, delivered_webpreview: false', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'delivery-webpreview-absent-'));
    try {
      // master.mp4 present, web-preview.mp4 intentionally NOT written.
      await writeFile(join(dir, 'master.mp4'), Buffer.alloc(0));
      const report = await runDelivery(dir);

      // Delivery MUST still succeed (no throw above).
      assert.ok(existsSync(join(dir, 'quality-report.json')),
        'quality-report.json MUST be written even when web-preview is absent');
      assert.equal(
        report._composition?.delivered_mastermp4, true,
        'master.mp4 presence independent of web-preview',
      );
      assert.equal(
        report._composition?.delivered_webpreview, false,
        'web-preview absence MUST be reflected as delivered_webpreview: false',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('Test 4: both present → delivered_mastermp4 + delivered_webpreview both true', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'delivery-both-present-'));
    try {
      await writeFile(join(dir, 'master.mp4'), Buffer.alloc(0));
      await writeFile(join(dir, 'web-preview.mp4'), Buffer.alloc(0));
      const report = await runDelivery(dir);

      assert.equal(report._composition?.delivered_mastermp4, true);
      assert.equal(report._composition?.delivered_webpreview, true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
