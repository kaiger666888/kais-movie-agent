---
phase: quick-260702-wzc
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - lib/prompt-injector.js
  - lib/phases/index.js
  - lib/iteration-engine.js
  - lib/quality-gate.js
  - lib/hooks/quality-assessment.js
  - test/prompt-injector-overrides.test.mjs
  - test/quality-gate-overrides.test.mjs
  - /data/workspace/kais-aigc-platform/src/routes/canvas/execute.ts
autonomous: true
requirements:
  - BREAKPOINT-1
  - BREAKPOINT-2
  - BREAKPOINT-3
  - BREAKPOINT-4
  - BREAKPOINT-5
cross_repo: true
repos:
  kais-movie-agent: [breakpoint-1, breakpoint-2, breakpoint-4, breakpoint-5]
  kais-aigc-platform: [breakpoint-3]
---

<objective>
Close the 5-breakpoint gap in the pipeline evolution loop so that
`反馈→诊断→进化→重生成` actually fires end-to-end. Today the
IterationEngine + PipelineReflector write `prompt-overrides.json` and
`pipeline.appliedReflections.overrides`, but 5 consumers ignore that
data, so evolution is silent.

Purpose: Make operator-approved prompt/threshold overrides actually
change downstream LLM calls; make `/api/canvas/execute` accept
IterationEngine's payload without 400/500.

Output: 4 patched libs in kais-movie-agent, 1 patched route +
router registration in kais-aigc-platform, 2 new unit tests.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@/tmp/gsd-task-pipeline-breakthrough.md

# Real code state (verified 2026-07-02 — spec line numbers shifted, this is source of truth)

## lib/prompt-injector.js (read in full)
- `class PromptInjector { constructor(assetBus) { this._bus = assetBus; } }` — line 24-27
- `inject()` returns `parts.join(', ')` at line 110; last pushes before return are audioEvent/reverbHint/mode SFX
- `injectVideoPrompt()` returns `parts.join('. ')` at line 186; last pushes are consistency + audio
- NO override plumbing exists today

## lib/phases/index.js — verified line numbers
- `new PromptInjector(bus)` at lines **1185** and **1310** (NOT 1185/1310 in spec — spec was right, confirm)
- 8 hardcoded system prompts at lines: **1744, 1847, 1968, 2068, 2189, 2299, 2535, 2869**
- Helper zone after `_hermesAudit` ends near line 260 (`// ─── Phase Handlers ───` divider)
- Line 577 already builds `pipeline.appliedReflections = { applied, overrides }` — overrides ARE in scope inside phase handlers via the `pipeline` param

## lib/iteration-engine.js
- `_buildPrompt(action)` at line 481-487 — empty `base`, only prepends promptDelta
- `_callEngine(nodeId, prompt, branchId)` at line 465 already POSTs `/api/canvas/execute` with `{ nodeId, prompt, branchId, projectId }` — the contract the execute endpoint MUST accept
- Constructor has `this.apiBase`, `this.projectId`, `this.episodesId`

## lib/quality-gate.js
- `constructor(options = {})` at line 144 — NO `options.overrides` today
- `_loadConfig()` at line 167 (NOT `_ensureGateConfig` — spec name was wrong)
- `get threshold()` at line 160 returns `this._gateConfig?.threshold || { total: 65, critical: 40, warning: 75 }` — pure YAML, no override merge
- Single callsite: `lib/hooks/quality-assessment.js:17` → `new QualityGate({ workdir, config })`

## kais-aigc-platform/src/routes/canvas/execute.ts — ALREADY EXISTS
- File exists, registered as `route4` in `src/router.ts:7` and mounted at `router.ts:134`
- Current schema: `{ projectId: z.number(), episodesId: z.number(), nodeId: z.string(), nodeType: z.string() }`
- IterationEngine sends `{ nodeId, prompt, branchId, projectId }` — NO episodesId, NO nodeType, HAS prompt + branchId
- **Gap = schema mismatch → 400 validation error, not 404**
- Fix: widen schema (episodesId + nodeType optional, prompt + branchId optional), keep existing simulateExecution path for canvas-UI callers

## Test conventions
- Runner: `node --test 'test/**/*.test.mjs'`
- Tests live in `test/` (flat), e.g. `test/iteration-engine.test.mjs`, `test/pipeline-reflector.test.mjs`
- Use plain `node:test` + `node:assert`
</context>

<tasks>

<task type="auto">
  <name>Task 1 (Breakpoint 1): PromptInjector reads overrides — kais-movie-agent</name>
  <files>lib/prompt-injector.js, lib/phases/index.js, test/prompt-injector-overrides.test.mjs</files>
  <action>
In `lib/prompt-injector.js`:

1. Change constructor signature to `constructor(assetBus, overrides = null)` and store `this._overrides = overrides`.

2. In `inject()` BEFORE the final `return parts.join(', ');` (line 110), insert an override-application block. Iterate `Object.entries(this._overrides || {})`, skip keys `thresholds` and `parameterChanges`, and for each array-valued entry push `entry.change` onto `parts` (filter falsy). This appends operator-approved prompt-modification text AFTER all existing injected parts (art-bible, scene, camera, rawPrompt, audio) — order matters: overrides are evolution instructions applied last so they carry maximum weight.

3. In `injectVideoPrompt()` BEFORE the final `return parts.join('. ');` (line 186), insert the same override block. Use `.join('. ')` consistency: push raw `entry.change` (the surrounding join handles separators).

4. Backwards compatibility: when `this._overrides` is null/empty, behavior MUST be byte-identical to today (verify via existing tests + new test's "no overrides" case).

In `lib/phases/index.js`:

5. Line 1185: change `new PromptInjector(bus)` → `new PromptInjector(bus, pipeline.appliedReflections?.overrides || null)`.

6. Line 1310: same change.

7. Verify `pipeline` is in scope at both sites — both are inside `after: async (pipeline, phase, phaseConfig) => { ... }` handlers, confirmed at lines 1169 and 1295. `pipeline.appliedReflections` is set at line 577 unconditionally before these handlers fire.

Create `test/prompt-injector-overrides.test.mjs`:

8. Three cases using `node:test`:
   (a) `inject()` with no overrides → output identical to pre-patch (no `[进化指令]`, no override text).
   (b) `inject()` with overrides `{ 'topic-selector': [{ change: 'PREFER_SUSPENSE' }], thresholds: { total: { change: 70 } } }` → returned string CONTAINS 'PREFER_SUSPENSE' and does NOT contain anything from `thresholds`.
   (c) `injectVideoPrompt()` with same overrides → returned string CONTAINS 'PREFER_SUSPENSE'.
   Mock AssetBus with `{ read: async () => null }` so parts only contain rawPrompt + overrides (deterministic).
  </action>
  <verify>
    <automated>cd /data/workspace/kais-movie-agent && node --test test/prompt-injector-overrides.test.mjs</automated>
  </verify>
  <done>
    - PromptInjector accepts optional overrides, appends override text last in inject() and injectVideoPrompt()
    - Both phases/index.js callsites pass pipeline.appliedReflections.overrides
    - 3 tests pass; no existing test regresses (scoped node --test run)
    - Commit message: `fix(quick-260702-wzc): breakpoint 1 — PromptInjector applies prompt overrides`
  </done>
</task>

<task type="auto">
  <name>Task 2 (Breakpoint 2): 8 hardcoded system prompts accept overrides — kais-movie-agent</name>
  <files>lib/phases/index.js</files>
  <action>
In `lib/phases/index.js`:

1. Add a file-level helper `_applySystemOverride(baseSystem, overrideKey, overrides)` just BEFORE the `// ─── Phase Handlers ───` divider (around line 260, immediately after `_hermesAudit`). Body per spec:
   - If `!overrides || !overrides[overrideKey]` return `baseSystem`.
   - Coerce entries to array; if empty, return `baseSystem`.
   - Map `entries.map(e => e.change).filter(Boolean)`; if empty, return `baseSystem`.
   - Return `baseSystem + '\n\n[进化指令] ' + additions.join('; ')`.

2. At each of the 8 hardcoded system prompt sites, wrap with override lookup. Pattern (apply at every site):
   - Read overrides once per handler if not already in scope: `const _overrides = pipeline.appliedReflections?.overrides || null;` (place near top of the handler function body, before the LLM call — not inside the callLLM line to avoid repeating).
   - Replace `{ system: '<literal>' }` with `{ system: _applySystemOverride('<literal>', '<overrideKey>', _overrides) }`.

   Sites + overrideKey mapping (use these EXACT keys — they match IterationEngine's `pipelineAdjustment.target` values):
   | Line | Literal system prompt | overrideKey |
   |------|-----------------------|-------------|
   | 1744 | `你是短视频选题专家` | `topic-selector` |
   | 1847 | `你是剧本大纲专家,擅长多集短剧结构` | `outline-writer` |
   | 1968 | `你是剧本大纲评审专家` | `outline-auditor` |
   | 2068 | `你是短剧剧本编剧专家,擅长快节奏高密度叙事` | `screenplay-writer` |
   | 2189 | `你是剧本评审专家` | `script-auditor` |
   | 2299 | `你是角色定妆照质量审查专家。...` | `character-quality-checker` |
   | 2535 | `你是角色设计评审专家` | `character-selector` |
   | 2869 | `你是场景设计评审专家` | `scene-selector` |

3. For line 2299 the system prompt is multi-line (continues with `0.85+ 优秀...`). Pass the FULL existing literal as the `baseSystem` argument; only the `[进化指令] ...` suffix is appended.

4. Verify `pipeline` is in scope at each of the 8 sites. They all live inside `after: async (pipeline, phase, phaseConfig) =>` handlers in the `phaseHandlers` map; if any site is inside a nested closure without `pipeline` access, hoist the `_overrides` const to the handler-body level so the closure captures it.

5. Backwards compat: when `pipeline.appliedReflections?.overrides` is null/undefined (no reflection applied), `_applySystemOverride` returns `baseSystem` byte-identical → no behavior change.

No new test file (this task is internal wiring; the override helper is exercised indirectly by task 1's test pattern and the existing phase tests). Add a 1-case smoke test as part of the commit verifying `_applySystemOverride` is exported OR add a `node --test` inline check via a new `test/system-override-helper.test.mjs` with 3 cases:
   (a) null overrides → returns base unchanged
   (b) `{ 'topic-selector': [{ change: 'X' }] }` → returns `base + '\n\n[进化指令] X'`
   (c) `{ thresholds: {...} }` only → returns base unchanged (thresholds key never matches overrideKey)
   To make the helper testable, export it from `lib/phases/index.js` as `export function _applySystemOverride(...)` (named export; does not disturb existing default/CommonJS consumers).
  </action>
  <files_test>test/system-override-helper.test.mjs</files_test>
  <verify>
    <automated>cd /data/workspace/kais-movie-agent && node --test test/system-override-helper.test.mjs && node --test test/phases/ 2>/dev/null || node --test 'test/**/*.test.mjs'</automated>
  </verify>
  <done>
    - Helper `_applySystemOverride` defined and exported near line 260
    - All 8 hardcoded callLLM sites wrapped (verified by grep: each line still contains the original literal AND `_applySystemOverride`)
    - 3 helper tests pass; no regression in existing phase tests
    - Commit message: `fix(quick-260702-wzc): breakpoint 2 — 8 system prompts accept overrides via _applySystemOverride`
  </done>
</task>

<task type="auto">
  <name>Task 3 (Breakpoint 3): /api/canvas/execute accepts IterationEngine payload — kais-aigc-platform</name>
  <files>/data/workspace/kais-aigc-platform/src/routes/canvas/execute.ts</files>
  <action>
**File already exists.** Spec's "create new endpoint" is wrong — verified at `/data/workspace/kais-aigc-platform/src/routes/canvas/execute.ts`. Real problem: schema mismatch causes 400 when IterationEngine._callEngine POSTs `{ nodeId, prompt, branchId, projectId }` (no episodesId, no nodeType).

In `src/routes/canvas/execute.ts`:

1. Widen the zod schema. Current:
   ```
   projectId: z.number(),
   episodesId: z.number(),
   nodeId: z.string(),
   nodeType: z.string(),
   ```
   Change to accept BOTH the canvas-UI caller (passes episodesId+nodeType) AND IterationEngine (passes prompt+branchId, projectId may be number OR string):
   - `projectId: z.union([z.number(), z.string()])` — IterationEngine sends `this.projectId` which may be either
   - `episodesId: z.number().optional()` — IterationEngine omits this
   - `nodeType: z.string().optional()` — IterationEngine omits; default to `'script'` when absent (cheapest non-crashing dispatch per spec's "minimal implementation" directive)
   - `nodeId: z.string().min(1)` — unchanged, required by both callers
   - `prompt: z.string().optional()` — new, IterationEngine sends this
   - `branchId: z.string().optional()` — new, IterationEngine sends this

2. In the handler body, destructure the new fields. When `nodeType` is absent, set `const effectiveType = nodeType || 'script';` and use it in the `supportedTypes.includes` check. When canvas-UI calls with `episodesId` + `nodeType`, existing `simulateExecution(projectId, nodeId, episodesId)` path is preserved byte-identical.

3. For IterationEngine callers (no `episodesId`), guard the simulateExecution call: `const epId = episodesId ?? 0;` then call `simulateExecution(projectId, nodeId, epId)` — simulateExecution is a stub that tolerates `0`. Alternatively, return the spec's `status: 'queued'` response shape directly without simulateExecution when `!episodesId`. Prefer the latter for explicit contract:
   ```
   if (!episodesId) {
     return res.status(200).send(success({ status: 'queued', nodeId, branchId: branchId || null, message: `Regeneration queued for node ${nodeId}` }));
   }
   // ... existing canvas-UI path unchanged ...
   ```

4. Do NOT touch `src/router.ts` — the route is already registered (`route4` at line 7, mounted at line 134). Spec's "register in router.ts" step is unnecessary and would require renumbering, which the constraints forbid.

5. Do NOT delete or rename the existing `simulateExecution` import; canvas-UI flow still needs it.

NO test file required for this task (TypeScript route with side-effectful WS broadcast — covered by manual smoke in task 5). Verify by inspecting the patched schema accepts IterationEngine's exact payload shape via a local `tsx` eval or a 1-line zod-compile check.
  </action>
  <verify>
    <automated>cd /data/workspace/kais-aigc-platform && npx tsc --noEmit src/routes/canvas/execute.ts 2>&1 | head -20 && node -e "const { z } = require('zod'); const s = z.object({ projectId: z.union([z.number(), z.string()]), episodesId: z.number().optional(), nodeId: z.string().min(1), nodeType: z.string().optional(), prompt: z.string().optional(), branchId: z.string().optional() }); console.log('iteration-payload:', JSON.stringify(s.parse({ nodeId: 'n1', prompt: 'p', branchId: 'b1', projectId: 42 }))); console.log('canvas-ui-payload:', JSON.stringify(s.parse({ projectId: 1, episodesId: 2, nodeId: 'n1', nodeType: 'video' })));"</automated>
  </verify>
  <done>
    - execute.ts schema accepts IterationEngine payload `{ nodeId, prompt, branchId, projectId }` AND canvas-UI payload `{ projectId, episodesId, nodeId, nodeType }`
    - TypeScript compiles clean
    - Router.ts untouched (no renumbering)
    - **WIP SAFETY**: commit using `git add src/routes/canvas/execute.ts` ONLY — never `git add -A` or `git add .` in kais-aigc-platform (lots of WIP). Run `git status --short` before commit to confirm only this file is staged.
    - Commit message: `fix(canvas): execute route accepts iteration-engine payload (prompt/branchId, optional episodesId/nodeType)`
  </done>
</task>

<task type="auto">
  <name>Task 4 (Breakpoint 4): _buildPrompt fetches original node context — kais-movie-agent</name>
  <files>lib/iteration-engine.js, test/iteration-engine.test.mjs</files>
  <action>
In `lib/iteration-engine.js`, replace `_buildPrompt(action)` (lines 481-487) with a version that fetches the original node from the canvas API before composing the prompt.

New body (per spec, adapted to verified canvas endpoint):
- Try `fetch(\`${this.apiBase}/api/canvas/v2/nodes?projectId=${this.projectId}&nodeId=${action.nodeId}\`)`.
- If response is ok, parse body; extract `node = body?.data ?? body` (canvas API returns `{ data: ... }` envelope; fall back to raw body).
- Set `base = node?.description || node?.content || node?.prompt || ''`.
- On any error (network, non-2xx, JSON parse) → `base = ''` (graceful degrade — iteration still works, just without original-node context).
- After base resolution, compose with promptDelta:
  - If `action.promptDelta`: return `base ? \`${base}\n\n[迭代增补] ${action.promptDelta}\` : \`[迭代增补] ${action.promptDelta}\``.
  - Else: return `base`.

Notes:
- Make the method `async _buildPrompt(action)` — it already is (line 481). The fetch is awaited.
- Do NOT change the `_callEngine` contract (still called as `this._callEngine(action.nodeId, prompt, branchId)` at line 402).
- Do NOT touch any other method in iteration-engine.js (constraint #5).

In `test/iteration-engine.test.mjs` (existing file — EXTEND, don't replace):
- Add 2 new tests using a mock fetch. Node 18+ has global `fetch`; mock via `global.fetch = jest.fn()`-equivalent in node:test style: stash `global.fetch`, replace with a stub, restore in afterEach.
- Test (a): mock fetch returning `{ data: { description: 'ORIGINAL_DESC' } }`; call `_buildPrompt({ nodeId: 'n1', promptDelta: 'DELTA' })`; assert result CONTAINS 'ORIGINAL_DESC' AND '[迭代增补] DELTA'.
- Test (b): mock fetch throwing; call `_buildPrompt({ nodeId: 'n1', promptDelta: 'DELTA' })`; assert result EQUALS `[迭代增补] DELTA` (graceful degrade, no crash, no base).
- Construct IterationEngine with `new IterationEngine(tmpDir, { apiBase: 'http://test', projectId: 42, llmCaller: async () => '{}' })`.
  </action>
  <verify>
    <automated>cd /data/workspace/kais-movie-agent && node --test test/iteration-engine.test.mjs</automated>
  </verify>
  <done>
    - _buildPrompt fetches original node via canvas API, uses description/content/prompt as base
    - Graceful degrade on fetch failure (empty base, promptDelta still applied)
    - 2 new tests pass; all 21 existing iteration-engine tests still pass
    - Commit message: `fix(quick-260702-wzc): breakpoint 4 — _buildPrompt fetches original node context from canvas API`
  </done>
</task>

<task type="auto">
  <name>Task 5 (Breakpoint 5): QualityGate threshold getter honors overrides — kais-movie-agent</name>
  <files>lib/quality-gate.js, lib/hooks/quality-assessment.js, test/quality-gate-overrides.test.mjs</files>
  <action>
In `lib/quality-gate.js`:

1. Extend `constructor(options = {})` (line 144): add `this._overrides = options.overrides || null;` near the existing `this.config = options.config || {};` line.

2. Replace `get threshold()` (line 160) with an override-aware version:
   - Compute `const base = this._gateConfig?.threshold || { total: 65, critical: 40, warning: 75 };` (unchanged).
   - Clone it: `const merged = { ...base };`.
   - If `this._overrides?.thresholds`, iterate `Object.entries(this._overrides.thresholds)`. For each `[key, val]`, if `val?.change != null` AND `typeof val.change === 'number'`, set `merged[key] = val.change`. (Spec's `val?.change` shape — IterationEngine stores threshold overrides as `{ change: <number>, appliedAt, source }` per `_applyPipelineAdjustment` at iteration-engine.js line 628-633.)
   - Return `merged`.

3. Do NOT touch `_loadConfig`, `_getThresholds`, `_parseYaml`, or any scoring method. The override applies ONLY to the public `threshold` getter (which is what external callers use for gate decisions). `_getThresholds()` stays YAML-only because it's called inside `evaluate()` which already accepts a `blueprint` parameter for threshold override — adding override application there would double-apply. The `decide()` method at line 467 receives `thresholds` as a parameter from `evaluate()`, so the public getter override covers programmatic introspection use cases (IterationEngine's quality-gate-aware flows).

4. In `lib/hooks/quality-assessment.js:17`, change `new QualityGate({ workdir: pipeline.workdir, config: pipeline.config })` to also pass `overrides: pipeline.appliedReflections?.overrides || null`. Verify `pipeline.appliedReflections` is populated by the time this hook fires (line 577 sets it before phase handlers run; quality-assessment hook is a `after`/post-phase hook, so it fires AFTER — safe).

Create `test/quality-gate-overrides.test.mjs` with 3 cases using `node:test`:
   (a) Construct `new QualityGate({ workdir: tmpDir })` (no overrides) → `gate.threshold.total === 65` (or whatever gate-config.yaml in lib/ dictates — verify by reading gate-config.yaml first; if absent, defaults to 65). Test the ABSOLUTE default by pointing `configPath` at a non-existent file → threshold falls back to `{ total: 65, critical: 40, warning: 75 }`.
   (b) Construct with `overrides: { thresholds: { total: { change: 70 }, warning: { change: 80 } } }` AND a non-existent `configPath` → `gate.threshold.total === 70 AND gate.threshold.warning === 80 AND gate.threshold.critical === 40` (unmodified key preserved from default).
   (c) Construct with `overrides: { thresholds: { total: { change: 'not-a-number' } } }` → `gate.threshold.total === 65` (non-number change ignored, no crash).
  </action>
  <verify>
    <automated>cd /data/workspace/kais-movie-agent && node --test test/quality-gate-overrides.test.mjs</automated>
  </verify>
  <done>
    - QualityGate constructor accepts optional `options.overrides`
    - `threshold` getter merges numeric overrides from `overrides.thresholds[*].change`
    - Non-numeric / missing overrides ignored without crash
    - quality-assessment.js callsite passes `pipeline.appliedReflections.overrides`
    - 3 tests pass
    - Commit message: `fix(quick-260702-wzc): breakpoint 5 — QualityGate.threshold honors prompt-overrides thresholds`
  </done>
</task>

</tasks>

<verification>
**Per-task automated:** each task has its own `<verify><automated>` command above — all run in <10s.

**Cross-repo integration smoke (manual, after all 5 tasks committed):**
1. In kais-movie-agent, write a test overrides file:
   ```
   mkdir -p .pipeline-assets && echo '{"topic-selector":[{"change":"PREFER_SUSPENSE","appliedAt":"2026-07-02"}],"thresholds":{"total":{"change":70}}}' > .pipeline-assets/prompt-overrides.json
   ```
2. Restart kais-aigc-platform backend (`cd /data/workspace/kais-aigc-platform && npm run dev` or equivalent tsx watch).
3. `curl -X POST http://localhost:10588/api/canvas/execute -H 'Content-Type: application/json' -d '{"nodeId":"test-node","prompt":"reload","projectId":1}'` → expect HTTP 200 with `{ status: 'queued' }` body (NOT 400).
4. Confirm all existing kais-movie-agent endpoints still respond (no regression): run the full `node --test 'test/**/*.test.mjs' 'test/**/*.test.js'` sweep.

**Backwards compatibility gates (mandatory):**
- PromptInjector with `null` overrides → byte-identical output to pre-patch (covered by task 1 test a).
- QualityGate with `null` overrides → threshold getter returns YAML/default value (covered by task 5 test a).
- `_applySystemOverride(base, key, null)` → returns `base` (covered by task 2 test a).
- execute.ts with canvas-UI payload (projectId+episodesId+nodeId+nodeType) → existing simulateExecution path unchanged.
</verification>

<success_criteria>
All 5 breakpoints closed, each backed by an automated test (where unit-testable):

1. PromptInjector.inject() and injectVideoPrompt() append override text when overrides present; pass-through when null.
2. All 8 hardcoded system prompts in phases/index.js route through `_applySystemOverride`; helper exported and unit-tested.
3. `/api/canvas/execute` accepts IterationEngine's `{ nodeId, prompt, branchId, projectId }` payload with HTTP 200.
4. IterationEngine._buildPrompt() fetches original node description/content from canvas API, composes with promptDelta, degrades gracefully on fetch failure.
5. QualityGate.threshold getter merges numeric overrides from `overrides.thresholds[*].change`; quality-assessment.js passes `pipeline.appliedReflections.overrides`.

Commits: 5 atomic commits (one per task). kais-movie-agent gets 4 commits (breakpoints 1, 2, 4, 5). kais-aigc-platform gets 1 commit (breakpoint 3) using `git add <specific file>` only.
</success_criteria>

<output>
Create `.planning/quick/260702-wzc-fix-5-pipeline-evolution-breakpoints-acr/260702-wzc-SUMMARY.md` when done. Include:
- Per-breakpoint: file(s) touched, commit hash, test count delta
- Cross-repo commit log (both repos)
- Manual smoke results (HTTP 200 from /api/canvas/execute)
- Any deviations from this plan (e.g., spec line-number drift discoveries)
</output>
