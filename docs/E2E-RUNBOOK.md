# E2E Runbook — Real-service Pipeline Execution

> **Audience:** Operators running the kais-movie-agent pipeline against real GPU
> infrastructure (gold-team / Hermes / Jimeng). For CI-safe degraded-mode
> validation see `test/e2e/pipeline-degraded-e2e.test.mjs`.

This runbook describes how to configure the pipeline for a real end-to-end
short-drama generation run, how to launch it, how to verify outputs, and how
to diagnose common failure modes.

---

## 1. Prerequisites

### 1.1 External services

| Service       | Purpose                              | Required?        | Default URL                   |
| ------------- | ------------------------------------ | ---------------- | ----------------------------- |
| **gold-team** | GPU image/video/audio generation     | **Yes** (real)   | `http://192.168.71.140:8900`  |
| **Hermes**    | Parameter decision / audit           | Optional         | `http://localhost:8080`       |
| **Jimeng**    | Seedance 2.0 omni_reference 终版视频 | **Yes** (real)   | (via API key)                 |
| **Review platform** | Remote review gates            | Optional         | `http://192.168.71.140:8090`  |
| **Canvas**    | Auto-sync to infinite canvas         | Optional         | `http://192.168.71.176:10588`|
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
