/**
 * v2-canonical-clean.mjs — Phase 13 lint check
 *
 * Verifies canonical capability-spec layer (lib/v2_topology/ + lib/v2_pipeline.js)
 * contains ZERO hard-coded model names per NODE-08 + PITFALLS §1.3.
 *
 * Model names appear ONLY in dated annex: docs/v2-model-annex-2026-06-16.md.
 */
import assert from 'node:assert';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const V2_CANONICAL_DIRS = ['lib/v2_topology'];
const V2_CANONICAL_FILES = ['lib/v2_pipeline.js'];

const FORBIDDEN_MODEL_NAMES = [
  'Sora', 'sora',
  'Kling', 'kling',
  'Veo', 'veo',
  'CosyVoice', 'cosyvoice', 'CosyVoice2', 'cosyvoice2',
  'FLUX', 'flux-dev', 'flux_dev', 'flux-dev-ipa', 'schnell',
  'wan14b', 'wan_14b', 'wan-14b',
  'GPT-5', 'gpt-5',
  'Claude Sonnet', 'claude-sonnet',
  'Claude Haiku', 'claude-haiku',
  'Claude Opus', 'claude-opus',
  'GLM-4', 'glm-4',
  'ElevenLabs', 'elevenlabs',
  'SD4', 'sd4',
  'Suno', 'suno',
  'Udio',
];

let passed = 0;
let failed = 0;

function check(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.error(`  ✗ ${name}: ${err.message}`); failed++; }
}

async function scanFile(filePath, forbiddenNames) {
  const content = await readFile(filePath, 'utf8');
  // Strip comments to avoid matching forbidden names in explanatory comments
  const strippedContent = content
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/\/\/.*$/gm, '');          // line comments
  const hits = [];
  for (const name of forbiddenNames) {
    // Word-boundary regex to avoid matching "udio" inside "audio" etc.
    const pattern = new RegExp(`\\b${name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
    if (pattern.test(strippedContent)) {
      hits.push(name);
    }
  }
  return hits;
}

console.log('Phase 13 Canonical Clean — Lint Check\n');

const allFiles = [];

for (const dir of V2_CANONICAL_DIRS) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.js')) {
      allFiles.push(join(dir, entry.name));
    }
  }
}
for (const f of V2_CANONICAL_FILES) {
  allFiles.push(f);
}

check(`Scanned ${allFiles.length} canonical files`, () => {
  assert.ok(allFiles.length >= 17, `expected ≥17 files, got ${allFiles.length}`);
});

let totalViolations = 0;
const fileViolations = {};

for (const file of allFiles) {
  const hits = await scanFile(file, FORBIDDEN_MODEL_NAMES);
  fileViolations[file] = hits;
  if (hits.length > 0) totalViolations += hits.length;
}

check('ZERO hard-coded model names in canonical layer', () => {
  assert.equal(totalViolations, 0,
    `Found ${totalViolations} hard-coded model names.\n` +
    Object.entries(fileViolations)
      .filter(([_, hits]) => hits.length > 0)
      .map(([f, hits]) => `  ${f}: ${hits.join(', ')}`)
      .join('\n')
  );
});

check('lib/v2_topology/ has 18 files (16 nodes + base + index + invariants)', async () => {
  const entries = await readdir('lib/v2_topology');
  const jsFiles = entries.filter(f => f.endsWith('.js'));
  // 16 nodes + _node-base + index + _invariants = 19
  assert.ok(jsFiles.length >= 18, `expected ≥18 files, got ${jsFiles.length}`);
});

check('PROJECT.md has impl_targets_design frontmatter', async () => {
  const content = await readFile('.planning/PROJECT.md', 'utf8');
  assert.match(content, /impl_targets_design:\s*design-2026-06-16-prfp/);
});

check('PROJECT.md has v8_baseline_ref frontmatter', async () => {
  const content = await readFile('.planning/PROJECT.md', 'utf8');
  assert.match(content, /v8_baseline_ref:\s*734dc71c9d/);
});

check('V8-DEPRECATION.md exists', async () => {
  const content = await readFile('docs/V8-DEPRECATION.md', 'utf8');
  assert.match(content, /V8.*[Dd]eprecation/i);
});

check('v2-model-annex-2026-06-16.md exists', async () => {
  const content = await readFile('docs/v2-model-annex-2026-06-16.md', 'utf8');
  assert.match(content, /NODE-08/);
});

check('CROSS-REPO-ADR-PROCESS.md exists', async () => {
  const content = await readFile('docs/CROSS-REPO-ADR-PROCESS.md', 'utf8');
  assert.match(content, /cross.?repo.?ADR/i);
});

check('V8 lib/phases/index.js has @deprecated banner', async () => {
  const content = await readFile('lib/phases/index.js', 'utf8');
  assert.match(content, /@deprecated/);
  assert.match(content, /Phase 13.*2026-06-17/);
});

check('V8 lib/pipeline.js has @deprecated banner', async () => {
  const content = await readFile('lib/pipeline.js', 'utf8');
  assert.match(content, /@deprecated/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
