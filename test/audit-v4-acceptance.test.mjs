/**
 * audit-v4-acceptance.test.mjs — 9-finding audit regression suite (Phase 30 P02, SC#2)
 *
 * Replaces the manual grep-based audit closure checklist (2026-06-23 memory
 * project_pipeline-audit_2026-06-23.md) with an executable contract. Each of
 * the 9 audit findings from the V6 pipeline audit maps 1:1 to one test() block
 * that reads the relevant source file(s) at HEAD and asserts the
 * regression-prevention signal is present. If any of the Phase 26-29 fixes
 * silently regresses (refactor, revert, partial undo), the matching F-test
 * fails and pinpoints the exact finding.
 *
 * ## Audit matrix (2026-06-23 → closure phase)
 *
 *   F1 composition phase has no handler              → Phase 29 P01
 *   F2 delivery checks final.mp4, not master.mp4     → Phase 29 P02
 *   F3 motion-preview submitTask field case wrong    → Phase 27 P01
 *   F4 V6 no longer writes requirement.json          → Phase 26 P01
 *   F5 scene ↔ spatio-temporal-script ordering flip  → Phase 26 P02
 *   F6 consistency-guard non-blocking + dead code    → Phase 29 P03
 *   F7 jimeng-client deprecated but still called     → Phase 27 P02
 *   F8 canvasGraph double-write race                → Phase 28 P01
 *   F9 repair-canvas SQL injection surface           → Phase 28 P02
 *
 * ## Adding future findings (F10+)
 *
 * Mechanical: add one test() block named `F<n>: <short description>` that
 * reads the closing fix file and asserts the regression-prevention signal.
 * Keep assertions strict (assert.strictEqual / assert.ok) — soft assertions
 * defeat the regression-prevention purpose.
 *
 * Run: node --test test/audit-v4-acceptance.test.mjs
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const PHASES_INDEX_PATH = join(REPO_ROOT, 'lib', 'phases', 'index.js');
const PIPELINE_PATH = join(REPO_ROOT, 'lib', 'pipeline.js');
const CANVAS_SYNC_PATH = join(REPO_ROOT, 'lib', 'canvas-content-sync.js');
const REPAIR_CANVAS_PATH = join(REPO_ROOT, 'bin', 'repair-canvas-truncated-scenes.js');
const GATE_CONSTRAINTS_PATH = join(REPO_ROOT, 'lib', 'gate-constraints.js');
const INVARIANT_BUS_PATH = join(REPO_ROOT, 'lib', 'invariant-bus.js');

/**
 * Slice a top-level phase handler object out of the phaseHandlers export.
 * Phase handlers appear in two forms:
 *   `<name>: {`           (bare identifier — e.g. `composition: {`)
 *   `'<name>': {`         (quoted string — e.g. `'delivery': {`)
 * Returns the source text spanning from the opener line through the matching
 * close brace at column 2 (`  },`), computed via brace-depth tracking so
 * nested objects/braces inside the handler body do not prematurely close the
 * slice. Used to scope assertions to a single handler so other-phase matches
 * and comments do not produce false positives (T-30-04 mitigation).
 *
 * Scoped to the `phaseHandlers` export region — the earlier HERMES_DEFAULTS
 * object also has same-named keys (e.g. 'motion-preview', 'consistency-guard')
 * but those are config-only (no `after:`/`before:`), so we search only inside
 * phaseHandlers to avoid false matches against the config object.
 */
function sliceHandlerBody(source, handlerName) {
  // Locate the phaseHandlers export — handlers live inside this object only.
  const handlersStartMatch = source.match(/^export const phaseHandlers\s*=\s*\{/m);
  if (!handlersStartMatch) {
    throw new Error("could not locate `export const phaseHandlers = {` in source");
  }
  const searchFrom = handlersStartMatch.index;
  const tail = source.slice(searchFrom);
  const openRe = new RegExp(`^(?<indent>\\s+)(?:'${handlerName}'|${handlerName}):\\s*\\{`, 'm');
  const openMatch = tail.match(openRe);
  if (!openMatch) {
    throw new Error(`handler '${handlerName}' not found in phaseHandlers`);
  }
  const source_openMatch = openMatch;
  // Walk forward from the opening `{` tracking brace depth.
  const startBraceIdx = openMatch.index + openMatch[0].lastIndexOf('{');
  let depth = 0;
  let inString = false;
  let stringChar = '';
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = startBraceIdx; i < tail.length; i++) {
    const ch = tail[i];
    const next = tail[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') { inBlockComment = false; i++; }
      continue;
    }
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === stringChar) inString = false;
      continue;
    }
    if (ch === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { inString = true; stringChar = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        // Include trailing comma + newline so closer context is preserved.
        let end = i + 1;
        if (tail[end] === ',') end++;
        return tail.slice(openMatch.index, end);
      }
    }
  }
  throw new Error(`unterminated handler '${handlerName}' — no matching close brace`);
}

describe('Phase 30 P02 — v4.0 audit acceptance (9 findings)', async () => {
  const phasesSource = await readFile(PHASES_INDEX_PATH, 'utf8');
  const pipelineSource = await readFile(PIPELINE_PATH, 'utf8');
  const canvasSyncSource = await readFile(CANVAS_SYNC_PATH, 'utf8');
  const repairCanvasSource = await readFile(REPAIR_CANVAS_PATH, 'utf8');

  test('F1: composition handler writes master.mp4', () => {
    // Audit finding: composition phase declared outputFiles master.mp4 but had
    // no handler — phase silently succeeded with no file produced.
    // Closure: Phase 29 P01 added a composition handler that writes master.mp4.
    const body = sliceHandlerBody(phasesSource, 'composition');
    assert.ok(
      /master\.mp4/.test(body),
      'composition handler must reference master.mp4 (its declared output)',
    );
    assert.ok(
      body.includes("join(pipeline.workdir, 'master.mp4')"),
      "composition handler must build the master.mp4 path via join(pipeline.workdir, 'master.mp4')",
    );
  });

  test('F2: delivery handler checks master.mp4 (not final.mp4)', () => {
    // Audit finding: delivery handler looked for final.mp4 while composition
    // produced master.mp4 — filename mismatch caused delivery to always fail.
    // Closure: Phase 29 P02 aligned delivery to check master.mp4.
    const body = sliceHandlerBody(phasesSource, 'delivery');
    assert.ok(
      /master\.mp4/.test(body),
      'delivery handler must check master.mp4 (the composition output)',
    );
    // Regression-prevention signal: no string-literal PATH REFERENCE to
    // final.mp4 inside the delivery body. Documentation comments mentioning
    // final.mp4 (e.g. "不再验证 final.mp4") are permitted — they document the
    // fix, they do not perform file lookups. A path reference is `'final.mp4'`
    // or `"final.mp4"` as a literal that would flow into join/existsSync/readFile.
    const finalMp4PathRefCount =
      (body.match(/['"]final\.mp4['"]/g) || []).length;
    assert.strictEqual(
      finalMp4PathRefCount,
      0,
      `delivery handler must NOT use 'final.mp4' as a path literal (found ${finalMp4PathRefCount} occurrence(s)) — filename was aligned to master.mp4 in Phase 29 P02. Comment mentions are allowed.`,
    );
  });

  test('F3: motion-preview submitTask uses camelCase taskType (not snake_case task_type)', () => {
    // Audit finding: motion-preview called submitTask({ task_type: 'blender_render' })
    // but submitTask destructures { taskType } — snake_case produced undefined
    // and the render request silently lost its task type. Also read task.task_id
    // while the return shape is { taskId }.
    // Closure: Phase 27 P01 fixed both — submitTask uses taskType, return reads taskId.
    const body = sliceHandlerBody(phasesSource, 'motion-preview');
    // Positive signal: the gold-team submitTask call inside motion-preview uses taskType.
    const submitCallMatch = body.match(/gtClient\.submitTask\(\{[\s\S]*?\}\)/);
    assert.ok(submitCallMatch, 'motion-preview must contain a gtClient.submitTask call');
    assert.ok(
      /taskType:\s*'blender_render'/.test(submitCallMatch[0]),
      "motion-preview submitTask must use taskType: 'blender_render' (camelCase)",
    );
    // Negative signal: no snake_case task_type on the submitTask destructure target.
    assert.ok(
      !/task_type:\s*'blender_render'/.test(submitCallMatch[0]),
      'motion-preview submitTask must NOT use snake_case task_type (field-case fix reverted)',
    );
    // Return-shape fix: task.taskId (not task.task_id).
    assert.ok(
      /task\.taskId/.test(body),
      'motion-preview must read task.taskId from submitTask return (not task.task_id)',
    );
  });

  test('F4: _loadCharactersForGeneration reads pain-report.json (V6 main path)', () => {
    // Audit finding: V6 pain-discovery phase writes pain-report.json, but
    // _loadCharactersForGeneration still expected requirement.json — so V6
    // always fell through to the pipeline.config.characters fallback.
    // Closure: Phase 26 P01 made pain-report.json the Tier 1 main reader.
    const fnMatch = phasesSource.match(
      /async function _loadCharactersForGeneration\(pipeline\)\s*\{[\s\S]*?^}/m,
    );
    assert.ok(fnMatch, '_loadCharactersForGeneration must be defined');
    const fnBody = fnMatch[0];
    assert.ok(
      /pain-report\.json/.test(fnBody),
      '_loadCharactersForGeneration must read pain-report.json (V6 main path)',
    );
    // requirement.json may appear as a legacy-fallback tier, but it must be
    // explicitly marked legacy (warn) — not the primary reader.
    assert.ok(
      /legacy/.test(fnBody) || !/requirement\.json/.test(fnBody),
      'requirement.json, if present, must be explicitly tagged as legacy fallback',
    );
  });

  test('F5: spatio-temporal-script stageOrder < scene-generation < scene-selection', () => {
    // Audit finding: scene-generation (stageOrder 8) read bus.read('spatio-temporal-script'),
    // but spatio-temporal-script ran at stageOrder 10 — bus.read always returned null
    // and scenes fell back to a single default.
    // Closure: Phase 26 P02 reordered PHASES — sts(8) < scene-gen(9) < scene-select(10).
    function stageOrderOf(phaseId) {
      // Find the PHASES entry for the given id and capture its stageOrder number.
      const re = new RegExp(
        `{ id: '${phaseId}'[^}]*?stageOrder:\\s*(\\d+)`,
      );
      const m = pipelineSource.match(re);
      assert.ok(m, `phase '${phaseId}' must be declared in lib/pipeline.js PHASES`);
      return Number(m[1]);
    }
    const sts = stageOrderOf('spatio-temporal-script');
    const sceneGen = stageOrderOf('scene-generation');
    const sceneSel = stageOrderOf('scene-selection');
    assert.ok(
      sts < sceneGen,
      `spatio-temporal-script (stageOrder ${sts}) must precede scene-generation (${sceneGen})`,
    );
    assert.ok(
      sceneGen < sceneSel,
      `scene-generation (stageOrder ${sceneGen}) must precede scene-selection (${sceneSel})`,
    );
  });

  test('F6: consistency-guard throws on audit fail + dead code files deleted', () => {
    // Audit finding: consistency-guard warned but never threw — audit failures
    // were silently swallowed. lib/gate-constraints.js + lib/invariant-bus.js
    // were imported nowhere (dead code, misleading surface).
    // Closure: Phase 29 P03 made consistency-guard throw + write a marker file,
    // and deleted both dead files.
    const body = sliceHandlerBody(phasesSource, 'consistency-guard');
    assert.ok(
      /\bthrow\b/.test(body),
      'consistency-guard handler must throw on audit failure (no silent warn-and-continue)',
    );
    assert.ok(
      /_consistencyBlocked:\s*true/.test(body),
      'consistency-guard must write _consistencyBlocked: true marker',
    );
    assert.strictEqual(
      existsSync(GATE_CONSTRAINTS_PATH),
      false,
      'lib/gate-constraints.js (dead code) must be deleted',
    );
    assert.strictEqual(
      existsSync(INVARIANT_BUS_PATH),
      false,
      'lib/invariant-bus.js (dead code) must be deleted',
    );
  });

  test('F7: _warnJimengDeprecate emitted at the 3 known jimeng call sites', () => {
    // Audit finding: jimeng-client.js was marked @deprecated but still
    // instantiated at 3 production call sites (soul-visual, character-gen,
    // scene-gen) with no operator-visible signal.
    // Closure: Phase 27 P02 added module-level dedup _warnJimengDeprecate
    // invoked at all 3 sites.
    // Definition present.
    assert.ok(
      /function _warnJimengDeprecate\(\)/.test(phasesSource),
      '_warnJimengDeprecate must be defined (module-level dedup warn)',
    );
    // Call sites: count invocations (the function definition itself does not
    // call itself, so total occurrences >= 1 definition + 3 calls = 4).
    const callCount = (phasesSource.match(/_warnJimengDeprecate\(\)/g) || []).length;
    assert.ok(
      callCount >= 4,
      `_warnJimengDeprecate must be invoked at 3 call sites (got ${callCount - 1} calls + 1 definition = ${callCount} total; expected >= 4)`,
    );
  });

  test('F8: canvas-content-sync saveGraph uses HTTP API (no direct sqlite3 UPDATE writes)', () => {
    // Audit finding: canvas-content-sync.js wrote the canvas graph via
    // execSync('sqlite3 ... UPDATE'), racing the kais-aigc-platform HTTP API
    // writing the same cell — last writer won and truncated data.
    // Closure: Phase 28 P01 migrated saveGraph to the HTTP saveCanvas API.
    // (loadGraph still uses sqlite3 CLI for reads — intentionally not migrated
    // per D-PIPE-INTEGRITY-01; reads do not race.)
    // Slice the saveGraph function body — its signature is the only async fn
    // named saveGraph in this file.
    const fnMatch = canvasSyncSource.match(
      /async function saveGraph\(projectId, episodesId, graph\)\s*\{[\s\S]*?^}/m,
    );
    assert.ok(fnMatch, 'saveGraph must be defined in canvas-content-sync.js');
    const body = fnMatch[0];
    // Positive signal: uses the HTTP API (client.saveCanvas).
    assert.ok(
      /client\.saveCanvas\b/.test(body),
      'saveGraph must write via CanvasClient.saveCanvas (HTTP API)',
    );
    // Negative signal: no execSync with sqlite3 UPDATE inside saveGraph body.
    const directWritePattern = /execSync\([\s\S]*?sqlite3[\s\S]*?UPDATE/i;
    assert.ok(
      !directWritePattern.test(body),
      'saveGraph must NOT use execSync + sqlite3 UPDATE (race-prone direct DB write)',
    );
  });

  test('F9: repair-canvas CLI has assertPositiveInt validation (SQL injection guard)', () => {
    // Audit finding: bin/repair-canvas-truncated-scenes.js interpolated raw
    // --projectId / --episodesId values into sqlite3 SQL strings — execFileSync
    // bypasses the shell but sqlite3 CLI accepts `;`-separated multi-statements.
    // Closure: Phase 28 P02 added assertPositiveInt with two-layer validation
    // (/^\d+$/ regex + Number.isInteger defense-in-depth).
    // Validator exists.
    assert.ok(
      /function assertPositiveInt\(/.test(repairCanvasSource),
      'assertPositiveInt validator must be defined',
    );
    const fnMatch = repairCanvasSource.match(
      /function assertPositiveInt\(raw, label\)\s*\{[\s\S]*?^}/m,
    );
    assert.ok(fnMatch, 'assertPositiveInt function body must be extractable');
    const body = fnMatch[0];
    // Two-layer guard (per Phase 28 P02 SUMMARY). Use substring search to
    // match the literal source text without regex-meta escaping headaches.
    assert.ok(
      body.includes('/^\\d+$/'),
      "assertPositiveInt must include /^\\d+$/ regex (primary injection block)",
    );
    assert.ok(
      /Number\.isInteger/.test(body),
      'assertPositiveInt must include Number.isInteger defense-in-depth',
    );
    // Validator actually invoked on both CLI args (projectId + episodesId).
    assert.ok(
      /assertPositiveInt\(opts\.projectId,\s*'projectId'\)/.test(repairCanvasSource),
      'assertPositiveInt must be invoked on opts.projectId',
    );
    assert.ok(
      /assertPositiveInt\(opts\.episodesId,\s*'episodesId'\)/.test(repairCanvasSource),
      'assertPositiveInt must be invoked on opts.episodesId',
    );
  });
});
