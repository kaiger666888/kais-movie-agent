# E2E Runbook — Real-service Pipeline Execution

> **Audience:** Operators running the kais-movie-agent pipeline against real GPU
> infrastructure (gold-team / Hermes / Jimeng). For CI-safe degraded-mode
> validation see `test/e2e/pipeline-degraded-e2e.test.mjs`.

This runbook describes how to configure the pipeline for a real end-to-end
short-drama generation run, how to launch it, how to verify outputs, and how
to diagnose common failure modes.

---

## 0. Shipping master.mp4 — Two Paths (v4.0)

> Added 2026-06-24 (Phase 30 P03 / SC#4). Single source of truth for producing
> the final shippable `master.mp4`. The pipeline writes `master.mp4` (Phase 18
> composition) plus a sibling `web-preview.mp4` (854px H.264 transcode,
> best-effort). The delivery phase (Phase 19) checks `master.mp4` — **not**
> `final.mp4` — and stamps `_composition.delivered_mastermp4` into
> `quality-report.json`.

Both paths use the **same entrypoint**:

```bash
node bin/pipeline.js run --workdir ./projects/<project> --episode <EP_ID>
```

The pipeline drives all 20 stages in order (see §3.1 stage table) and writes
`master.mp4` + `web-preview.mp4` into the workdir root at the composition
stage, then `quality-report.json` at delivery.

| Path | Mode | CI-verifiable? | Use when |
|------|------|----------------|----------|
| **A. Degraded** | All external services fail-fast → placeholder outputs | Yes (automated test) | Smoke test, regression, no-GPU environments |
| **B. Real GPU** | External services reachable → real H.264 mp4 | No (operator-deferred) | Actual drama production |

### Path A: Degraded Mode (CI-verifiable)

Degraded mode is **config-driven, not env-driven** — there is no `DEGRADED=1`
flag on the CLI. Set the degraded config on the `Pipeline` constructor (the
same pattern as `test/e2e/pipeline-degraded-e2e.test.mjs` and
`test/e2e/degraded-shipping.test.mjs`):

```js
new Pipeline({
  degradedMode: true,
  qualityGate: { bypass: true },
  goldTeam:     { baseUrl: 'http://127.0.0.1:0' },
  hermes:       { baseUrl: 'http://127.0.0.1:0' },
  jimeng:       { baseUrl: 'http://127.0.0.1:0' },
  reviewPlatform: { baseUrl: 'http://127.0.0.1:0' },
  // ...all external endpoints pointed at a closed port → ECONNREFUSED → fallback
});
```

What "degraded" means: every external-service-dependent handler (Blender/GT
`gtClient.submitTask`, jimeng/dreamina, canvas platform HTTP API) catches its
connection error and returns a placeholder/passthrough result tagged with
`_stub: true` or a `_reason` field. The composition handler writes a 0-byte
`master.mp4` placeholder when `ffmpeg` has no real input shots to composite
(PIPE-COMPOSE-01 degrade path). The pipeline still completes all 20 stages and
delivery still stamps `_composition.delivered_mastermp4: true`.

Expected output: `master.mp4` exists at the workdir root (0-byte placeholder),
`web-preview.mp4` may or may not exist (best-effort), `quality-report.json`
carries `_composition.delivered_mastermp4: true`.

**Automated test:**

```bash
node --test test/e2e/degraded-shipping.test.mjs
```

This is the SC#1 acceptance gate — runs all 20 stages in ~10s and asserts
`master.mp4` is produced plus the delivery marker is set.

### Path B: Real GPU Mode (Operator)

> **OPERATOR-DEFERRED for full v4.0 CI validation.** The degraded path is the
> only one exercised by automated tests in Phase 30. Real-GPU validation is
> performed per-episode by the operator. This is consistent with the v4.0
> roadmap (STATE.md Deferred Items: "真实 GPU E2E 验证" → v4.1+).

Command (no degraded config — external services must be reachable):

```bash
node bin/pipeline.js run --workdir ./projects/<project> --episode <EP_ID>
```

**Prerequisites:**

- **GT client reachable** — `gtClient.submitTask` for Blender render succeeds.
  Phase 27 P01 fixed the field-case bug (`taskType` / `taskId` camelCase, not
  snake_case). Verify `GOLD_TEAM_URL` points at a live gold-team instance.
- **dreamina CLI installed OR jimeng-client reachable** — Phase 27 P02 marked
  `jimeng-client` as **fallback-only** with a one-shot deprecation warning
  (`_warnJimengDeprecate`) emitted at the 3 production call sites
  (soul-visual, character-generation, scene-generation). The preferred path is
  the dreamina CLI; jimeng remains as a degrade-tolerant fallback.
- **External API keys configured** — grep `lib/` for `process.env.` to
  enumerate. Required for real run:
  - `GOLD_TEAM_URL` (GPU render)
  - `JIMENG_API_KEY` / `JIMENG_BASE_URL` / `JIMENG_SESSION_ID` (if using jimeng fallback)
  - `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `ZHIPU_API_KEY` / `DEEPSEEK_API_KEY`
    (LLM judge for quality scoring — composition gate enforces ≥65 by default)
  - `HERMES_URL` / `HERMES_MCP_URL` / `HERMES_MCP_API_KEY` (optional — parameter decision/audit)
  - `REVIEW_CALLBACK_SECRET` (optional — remote review gates)
  - `CANVAS_API_BASE_URL` (optional — infinite-canvas sync; Phase 28 P01
    migrated `saveGraph` to HTTP API, no direct sqlite3 writes)
- **`ffmpeg` on PATH** — used by `CompositionEngine.compose()` for the
  `web-preview.mp4` transcode (Phase 29 P01). Without it, `master.mp4` may
  still be produced but `web-preview.mp4` degrades silently.

**Expected output:** real H.264 mp4 at `<workdir>/master.mp4` + sibling
`web-preview.mp4`. When composition fails but the pipeline completes, degraded
placeholders are still written (PIPE-COMPOSE-01 degrade path) — see §5.6.

**Operator checklist before declaring an episode shipped:**

- [ ] `quality-report.json` shows `_composition.delivered_mastermp4: true`
- [ ] `master.mp4` file size > 0 (real video, not 0-byte placeholder)
- [ ] `consistency-guard` did not throw — absence of `consistency-blocked.json`
      in the workdir (Phase 29 P03: guard now throws on audit fail and writes
      `consistency-blocked.json` with `_consistencyBlocked: true` before
      throwing; episode is marked failed in `.pipeline-state.json`)
- [ ] No `_consistencyBlocked: true` marker in `quality-report.json`
- [ ] No `_stub: true` / `_reason` fields in critical artifacts
      (`consistency-pass.json`, `quality-report.json`, `master.mp4`)

### Ship-Readiness Gate (before tagging a release)

Before tagging a v4.0 release, all three gates must pass:

```bash
# 1. Full unit/integration regression baseline (≥ 461; currently 508)
npm test

# 2. SC#2 — 9 audit findings closed at HEAD (one test() per finding)
node --test test/audit-v4-acceptance.test.mjs

# 3. SC#1 — degraded E2E produces master.mp4
node --test test/e2e/degraded-shipping.test.mjs
```

**If any of the 9 audit tests (F1-F9) fail: the v4.0 ship is BLOCKED. Do not
tag.** Each F-test pinpoints the exact regression (see audit matrix below).

### Reference: 2026-06-23 Audit Matrix (9 findings)

Mirror of `.planning/phases/30-end-to-end-shipping-verification/30-CONTEXT.md`.
Original rationale: see MEMORY entry `project_pipeline-audit_2026-06-23.md`.

| # | Audit finding | Closed by Phase | Verification command |
|---|---------------|-----------------|----------------------|
| F1 | composition phase 无 handler | 29 P01 (PIPE-COMPOSE-01) | `node --test test/audit-v4-acceptance.test.mjs` (F1) |
| F2 | `final.mp4` vs `master.mp4` 文件名错位 | 29 P02 (PIPE-COMPOSE-02) | `node --test test/audit-v4-acceptance.test.mjs` (F2) |
| F3 | motion-preview Blender 字段大小写错 (`task_type`) | 27 P01 (PIPE-RENDER-01) | `node --test test/audit-v4-acceptance.test.mjs` (F3) |
| F4 | V6 不再写 `requirement.json` | 26 P01 (PIPE-DATA-01) | `node --test test/audit-v4-acceptance.test.mjs` (F4) |
| F5 | scene ↔ spatio-temporal-script 时序倒置 | 26 P02 (PIPE-DATA-02) | `node --test test/audit-v4-acceptance.test.mjs` (F5) |
| F6 | consistency-guard 非阻塞 + 死代码 | 29 P03 (PIPE-GUARD-01) | `node --test test/audit-v4-acceptance.test.mjs` (F6) |
| F7 | jimeng-client deprecated 仍被调用 | 27 P02 (PIPE-RENDER-02) | `node --test test/audit-v4-acceptance.test.mjs` (F7) |
| F8 | canvasGraph 双写竞态 | 28 P01 (PIPE-INTEGRITY-01) | `node --test test/audit-v4-acceptance.test.mjs` (F8) |
| F9 | repair-canvas SQL 注入面 | 28 P02 (PIPE-INTEGRITY-02) | `node --test test/audit-v4-acceptance.test.mjs` (F9) |

---

## 1. Prerequisites

### 1.1 External services

| Service       | Purpose                              | Required?        | Default URL                   |
| ------------- | ------------------------------------ | ---------------- | ----------------------------- |
| **gold-team** | GPU image/video/audio generation     | **Yes** (real)   | `http://192.168.71.140:8900`  |
| **Hermes**    | Parameter decision / audit           | Optional         | `http://localhost:8080`       |
| **Jimeng**    | Seedance 2.0 omni_reference 终版视频 | **Yes** (real)   | (via API key)                 |
| **Review platform** | Remote review gates            | Optional         | `http://192.168.71.140:8090`  |
| **Canvas**    | Auto-sync to infinite canvas         | Optional         | `http://localhost:10588`|
| **Telegram**  | Pipeline notifications               | Optional         | (env vars)                    |

Optional services fall back to degraded paths when unreachable — the pipeline
will still complete, but with `_stub: true` markers in the output JSON.

### 1.2 Local dependencies

- Node.js ≥ 20 (uses native `node:test`, `fetch`, `AbortSignal.timeout`)
- `git` CLI (GitStageManager checkpoints every phase)
- `ffmpeg` on PATH (used by `CompositionEngine.compose()`)

### 1.3 Environment variables

```bash
# Gold-team (required for real run)
export GOLD_TEAM_URL=http://192.168.71.140:8900

# Jimeng / Seedance (required for cloud-production phase)
export JIMENG_API_KEY=<your-api-key>

# Hermes (optional — enables parameter decision + audit)
export HERMES_URL=http://localhost:8080

# Review platform (optional — enables remote review gates)
# When unset, reviews fall back to fail-open AUTO routing.
# export REVIEW_CALLBACK_SECRET=<shared-secret>

# Canvas (optional — enables auto-sync to infinite canvas)
# export CANVAS_PROJECT_ID=<project-id>
# export CANVAS_EPISODES_ID=1

# Telegram (optional — pipeline status notifications)
# export TELEGRAM_BOT_TOKEN=<bot-token>
# export TELEGRAM_CHAT_ID=<chat-id>

# LLM (used by quality scoring / audience analysis / many handlers)
# export DEEPSEEK_API_KEY=<your-key>   # or equivalent provider key
```

---

## 2. Preparing a Requirement File

Each project lives under `projects/<project-name>/`. Create the directory and
place a `requirement.json` inside (or rely on the CLI to template it):

```bash
mkdir -p projects/my-first-drama
cat > projects/my-first-drama/requirement.json <<'JSON'
{
  "title": "城市奇幻喜剧",
  "genre": "喜剧",
  "theme": "都市奇幻",
  "characters": [
    { "name": "小李", "description": "25岁上班族，意外获得超能力" }
  ],
  "episode_count": 1,
  "duration_sec_per_episode": 60,
  "audio_preference": {
    "voice_style": "natural",
    "bgm_strategy": "dual",
    "sfx_mode": "prompt-driven",
    "reverb_profile": "auto"
  },
  "output_format": { "ratio": "9:16", "resolution": "2k" }
}
JSON
```

For multi-episode projects, set `episode_count` ≥ 2 — each episode runs as a
separate pipeline invocation with a distinct `--episode` id.

---

## 3. Running the Pipeline

### 3.1 Full run (fresh project)

```bash
node bin/pipeline.js run \
  --workdir ./projects/my-first-drama \
  --episode EP01
```

The CLI loads `requirement.json` from `--workdir` and drives all 20 phases in
order:

| Stage Order | Phase ID              | Name                |
| ----------- | --------------------- | ------------------- |
| 0           | pain-discovery        | 痛点调查            |
| 1           | topic-selection       | 主题选择 (review)   |
| 2           | outline-generation    | 大纲生成            |
| 3           | outline-selection     | 大纲选择 (review)   |
| 4           | script-generation     | 剧本生成            |
| 5           | script-selection      | 剧本选择 (review)   |
| 6           | character-generation  | 主角生成            |
| 7           | character-selection   | 主角选择 (review)   |
| 8           | scene-generation      | 场景生成            |
| 9           | scene-selection       | 场景选择 (review)   |
| 10          | spatio-temporal-script| 时空剧本 (review)   |
| 11          | script-lock           | 剧本锁定 (review)   |
| 12          | seed-skeleton         | 种子骨架 (review)   |
| 13          | motion-preview        | 运镜预览 (review)   |
| 14          | ai-preview            | AI预览 (review)     |
| 15          | consistency-guard     | 一致性守护          |
| 16          | cloud-production      | 云端终版视频(review)|
| 17          | final-audio           | 本地BGM与声音闭环   |
| 18          | composition           | 剪辑合成            |
| 19          | delivery              | 质检与交付          |

Review-gated phases (marked `(review)`) submit to the review platform and
return an `awaiting_review` status. If the platform is unreachable, they
auto-route to `AUTO` and the pipeline continues.

### 3.2 Resume from a failed/interrupted phase

```bash
# Auto-detect first incomplete phase
node bin/pipeline.js resume --workdir ./projects/my-first-drama --episode EP01

# Resume from a specific phase
node bin/pipeline.js resume --workdir ./projects/my-first-drama \
  --episode EP01 --phase cloud-production
```

### 3.3 Inspect status

```bash
node bin/pipeline.js status --workdir ./projects/my-first-drama
```

---

## 4. Verifying Outputs

After a successful run, the workdir contains the full artifact tree:

```
projects/my-first-drama/
├── .pipeline-state.json          # state machine (phases + timestamps)
├── .review/                      # review gate HTML pages
├── .git/                         # phase-by-phase checkpoint history
├── pain-report.json              # Phase 0
├── selected-topic.json           # Phase 1
├── outline-candidates.json
├── selected-outline.json
├── script-candidates.json
├── selected-script.json
├── character-candidates.json
├── soul-pack.json
├── scene-candidates.json
├── geometry-bed.json
├── sts-script.json
├── script-locked.json
├── seed-skeleton-pack.json
├── shot_seed_frames/             # generated seed frames
├── temp_dialogue/                # temp voice lines
├── bgm_segments/                 # BGM segments
├── ambience_base/
├── camera-plan.json
├── motion-preview.mp4
├── rough-mix.mp3
├── preview-pack/
├── seedance-input-pack.json
├── audio_plan.json
├── consistency-pass.json         # Phase 15 — critical quality artifact
├── final-shots/
│   ├── video/                    # final Seedance renders
│   └── audio-stems/              # final BGM/dialogue/sfx
├── master.mp4                    # Phase 18 final composite
├── web-preview.mp4
├── quality-report.json           # Phase 19 — critical quality artifact
├── cost-report.json              # Phase 19 — cost aggregation
└── quality_radar.svg             # quality radar visualization
```

### 4.1 Critical sanity checks

```bash
# State file: all 20 phases should be in a done status
jq '.phases | to_entries | map({phase: .key, status: .value.status})' \
  projects/my-first-drama/.pipeline-state.json

# Quality report: overall score should exceed the configured gate (default 65)
jq '.summary.score' projects/my-first-drama/quality-report.json

# Cost report: total GPU seconds should be non-zero for a real run
jq '.total_gpu_sec, .by_phase' projects/my-first-drama/cost-report.json

# Consistency: retry_shots should ideally be empty (all shots pass audit)
jq '.passed, .retry_shots | length' projects/my-first-drama/consistency-pass.json
```

### 4.2 Detecting degraded stubs

Any artifact with `_stub: true` or a `_reason` field means that phase ran in
degraded mode. This is normal when an external service was unreachable. To
identify all degraded outputs:

```bash
grep -l '"_stub": true' projects/my-first-drama/*.json
grep -l '"_reason"' projects/my-first-drama/*.json
```

For a fully real run, neither query should return any hits in the critical
artifacts (`consistency-pass.json`, `cost-report.json`, `quality-report.json`,
`master.mp4`).

### 4.3 Git checkpoint history

Each phase automatically creates a git commit tagged `[stage] <phase>`:

```bash
git -C projects/my-first-drama log --oneline
```

To roll back a specific phase:

```bash
git -C projects/my-first-drama log --oneline
git -C projects/my-first-drama checkout <commit-hash> -- .
```

---

## 5. Troubleshooting

### 5.1 Pipeline hard-fails at `composition` with `质量门控未通过 (0/65)`

Cause: `assessQuality` returned a zero score, usually because the LLM judge
could not be reached (expired token, 401).

Fix:
1. Check `DEEPSEEK_API_KEY` / equivalent LLM env var.
2. If running in a known-degraded environment, add `"degradedMode": true`
   and `"qualityGate": { "bypass": true }` to the requirement.json. This is
   what the E2E test does. Production runs should keep the gate enabled.

### 5.2 All review gates return `awaiting_review` forever

Cause: review platform unreachable, and the fail-open AUTO routing records
the status as `awaiting_review` instead of `approved`. The pipeline continues
either way — this is informational, not a failure.

Fix: configure `reviewPlatform.baseUrl` to a reachable review platform
instance, or ignore the status if you don't need remote review approval.

### 5.3 Pipeline aborts with `Cannot read properties of undefined (reading 'summary')`

Cause: a phase handler returned `undefined` and the runPhase wrapper tried to
read `result.summary`.

Fix: this should not occur after Phase 17 — `runPhase` defensively normalizes
undefined results to `{ summary: {}, metrics: {} }`. If you see this error,
check that you are on a release that includes the Phase 17 fix.

### 5.4 Idempotent re-run wipes state

Cause: pre-Phase-17 bug where `run()`/`resume()` overwrote the per-phase
state with the stale snapshot captured at the top of the method.

Fix: fixed in Phase 17. Ensure your release includes the re-load-before-final-
save patch in `lib/pipeline.js`.

### 5.5 Cloud-production phase skips (`stubbed: true`, `reason: ...`)

Cause: either `goldTeam.baseUrl` is unreachable or no shots were found in
`spatio-temporal-script`.

Fix:
1. Verify `GOLD_TEAM_URL` is set and the gold-team service responds to ping.
2. Check that `sts-script.json` contains non-empty `shots[]`.

### 5.6 FFmpeg composition silently skips

Symptom: `master.mp4` is missing but `quality-report.json` exists.

Cause: `CompositionEngine` caught an FFmpeg error and degraded gracefully.

Fix: check the pipeline log for `[composition] FFmpeg合成降级: <reason>`.
Usually this is missing input files (no `final-shots/video/*.mp4`) — fix
upstream phases first.

---

## 6. CI vs Real-Service E2E

| Aspect                | CI (degraded)                              | Real service                   |
| --------------------- | ------------------------------------------ | ------------------------------ |
| Test location         | `test/e2e/pipeline-degraded-e2e.test.mjs`  | Manual `bin/pipeline.js run`   |
| External services     | 127.0.0.1:0 (all fail-fast)               | Real infra on LAN              |
| Expected duration     | <5s                                        | 30min–several hours (GPU-bound)|
| Quality gate          | bypassed (`degradedMode: true`)            | Enforced (≥65)                 |
| Output artifacts      | Stubbed (`_stub: true` / `_reason`)        | Real video/audio               |
| Review gates          | AUTO (fail-open)                           | Real human/LLM review          |
| Use case              | Regression / smoke test                    | Actual drama production        |

The CI test is designed to catch structural regressions (handler signature
drift, state corruption, missing output files). It cannot validate aesthetic
quality or GPU correctness — that is the operator's responsibility on real
runs.
