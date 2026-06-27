---
phase: 40-rapid-preview-tier
reviewed: 2026-06-27T00:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - /data/workspace/hermes-agent/plugins/kais_aigc/preview_engine.py
  - /data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p10b_rapid_preview.py
  - /data/workspace/hermes-agent/plugins/pipeline_state/asset_bus.py
  - /data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/__init__.py
findings:
  critical: 2
  warning: 5
  info: 4
  total: 11
status: fixes_applied
fixed_at: 2026-06-27T07:00:00Z
fixed_findings: [CR-01, CR-02, WR-01, WR-02, WR-03, WR-04, WR-05]
skipped_findings: []
fix_iteration: 1
---

# Phase 40: Code Review Report

**Reviewed:** 2026-06-27
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Phase 40 (Rapid Preview Tier) ships the PreviewEngine strategy + p10b orchestration + 2 new AssetBus slots. The two engines, the cycling variant matrix, the degrade envelope, and the PHASE_REGISTRY insertion are well-structured and follow the V5.0 conventions. Security posture on FFmpeg (list-form argv, no shell=True — T-40-06 mitigation) and HTTP degrade-first contract (D-09) is correct.

However, the production code paths contain **two Critical defects** that the integration test suite does NOT catch, because the test suite substitutes a JSONL-aware `_StubBus` that masks the production runner's broken dispatch:

1. **CR-01 — Production runner cannot write `rapid-preview-clips`.** The runner's injected `_asset_bus_write` unconditionally calls `bus.write(slot, entry, envelope=True)`, but `AssetBus.write()` explicitly raises `AssetBusError` for JSONL-format slots (asset_bus.py:469-472). On the very first successful variant, p10b will raise from inside the runner, hit the outer `try/except Exception` in `p10b.run()`, and silently downgrade to `preview_skipped=True`. Every episode will end up skipped regardless of engine health.

2. **CR-02 — `httpx.Client` resource leak.** `select_engine()` constructs a fresh `LTXVideoEngine` (which constructs an `httpx.Client`) on every `p10b.run()` call, but the engine is never closed. The class provides `close()`/`__exit__`/`__enter__` but `_run_body` holds the engine in a local variable and never enters the context manager. Long-running daemons (gateway / cron) will leak a connection pool per episode.

The integration tests pass only because:
- `test_p10b_full_dag_integration.py` uses a custom `_StubBus` with JSONL-aware dispatch (40-04-SUMMARY.md "Auto-fixed Issues" #1 admits this), masking CR-01.
- Tests inject mock transports / monkeypatch the engine and never assert connection-pool closure, masking CR-02.

Additional findings: 5 warnings (concurrency hazards, error swallowing, ambiguous data flow) and 4 info items (dead parameters, missing log fields, naming).

## Critical Issues

### CR-01: Production runner raises `AssetBusError` on `rapid-preview-clips` JSONL writes — every episode silently downgrades to `preview_skipped`

**File:** `/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p10b_rapid_preview.py:376` (trigger) + `/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/runner.py:288-289` (root cause) + `/data/workspace/hermes-agent/plugins/pipeline_state/asset_bus.py:469-472` (guard)

**Issue:** p10b calls `asset_bus_write("rapid-preview-clips", record)` for each successful variant (p10b line 376). The runner injects `_asset_bus_write` as:
```python
def _asset_bus_write(slot: str, entry: dict) -> None:
    bus.write(slot, entry, envelope=True)
```
But `AssetBus.write()` explicitly rejects JSONL slots (asset_bus.py:469-472):
```python
if schema.get("format") == "jsonl":
    raise AssetBusError(
        f"Slot {slot} is JSONL — use append_line() instead of write()"
    )
```
Since `rapid-preview-clips` is registered as `format: "jsonl"` (asset_bus.py:296-304), the very first successful variant record raises `AssetBusError`. That exception propagates up through `_run_body` → caught by the broad `except Exception` in `run()` (p10b:263) → logs `preview_skipped: episode=... error=AssetBusError: Slot rapid-preview-clips is JSONL...` → writes `preview_skipped: True` to `episode-meta` → returns a clean degrade envelope. The episode always reports "all variants degraded" **regardless of actual engine health**.

The V5.0 reference (p11) avoids this because its outputs (`video-clips`, `lip-sync-reports`) are JSON-format slots. p10b is the first phase to write a JSONL slot through the runner's injected write callable, and the runner was never updated to dispatch on slot format.

**Why tests miss it:** `test_p10b_full_dag_integration.py` substitutes a custom `_StubBus` whose `write` method detects JSONL via `ASSET_SCHEMA[slot]["format"]` and appends to a list (40-04-SUMMARY.md "Deviations from Plan" → "Auto-fixed Issues" #1 explicitly admits this). That stub mirrors what the production runner *should* do but doesn't. The plan-level deviation write-up documents the stub fix as "local test double — no production code changed" — which is exactly the problem.

**Fix:** Either (preferred) make the runner's injected write callable format-aware, mirroring the test stub:
```python
# runner.py — replace _asset_bus_write
def _asset_bus_write(slot: str, entry: dict) -> None:
    schema = ASSET_SCHEMA.get(slot, {})
    if schema.get("format") == "jsonl":
        bus.append_line(slot, entry)
    else:
        bus.write(slot, entry, envelope=True)
```
OR change p10b to bypass the runner-injected callable for the JSONL slot and call `bus.append_line` directly. The former is consistent with how the V5.0 test stub already behaves and avoids forcing every future JSONL-writing phase to reinvent dispatch.

A regression test that uses the **real** `AssetBus` against a tmp `workdir` (not a `_StubBus`) through the **real** runner's `_asset_bus_write` closure would have caught this. Add one.

### CR-02: `LTXVideoEngine` constructed by `select_engine()` is never closed — `httpx.Client` connection pool leak per episode

**File:** `/data/workspace/hermes-agent/plugins/kais_aigc/preview_engine.py:285` (construction) + `/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p10b_rapid_preview.py:310` (unclosed hold)

**Issue:** `LTXVideoEngine.__init__` unconditionally constructs `self._client = httpx.Client(timeout=..., transport=...)` (preview_engine.py:285). The class correctly defines `close()`, `__enter__`, `__exit__` (preview_engine.py:375-383) — but `_run_body` calls `engine = select_engine()` (p10b:310) and never closes it:
```python
engine = select_engine()
# ... fan-out uses engine.generate() N×3 times ...
return {...}  # engine falls out of scope WITHOUT close()
```
When the engine is `LTXVideoEngine`, this leaks the `httpx.Client`'s underlying connection pool and thread pool. In the gateway daemon or cron scheduler (long-running processes that drive many episodes), this accumulates one leaked client per episode. Eventually hits file-descriptor limits or exhausts the httpx connection pool, manifesting as `httpx.ConnectError` on unrelated traffic — which will then be (correctly) degraded by `_request`, masking the root cause.

For `SlideshowEngine` this is harmless (no resources). For `LTXVideoEngine` it is a real leak.

**Fix:** Use the context-manager protocol that already exists:
```python
# p10b._run_body — wrap engine lifecycle
engine = select_engine()
if hasattr(engine, "__enter__"):
    with engine:
        return _fan_out(engine, ...)
else:
    return _fan_out(engine, ...)
```
Or simpler: make `PreviewEngine` an abstract context manager so both subclasses support `with`, then unconditionally `with select_engine() as engine:` in `_run_body`. `SlideshowEngine`'s `__enter__`/`__exit__` can be no-ops.

## Warnings

### WR-01: `httpx.Client` shared across ThreadPoolExecutor workers — concurrent `.post()` on a sync client is not guaranteed thread-safe

**File:** `/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p10b_rapid_preview.py:348-361`

**Issue:** The fan-out submits one future per (shot, variant) — up to `len(shot_list) × 3` tasks across `parallel_shots=4` worker threads. All workers share the same `engine` instance (p10b:310), and therefore the same `self._client` (`httpx.Client`). The sync `httpx.Client` uses a `httpcore` sync connection pool whose thread-safety for *concurrent* `request()` calls from multiple threads is not part of its public contract; serialized access happens to work but is not documented. Under real network latency, interleaved `.post()` calls can corrupt connection state or trip `httpcore`'s "connection already in use" assertion.

The same hazard does not apply to `SlideshowEngine` (each `subprocess.run` spawns its own process).

**Fix:** Either (a) document the assumption and serialize via a `threading.Lock` around `engine.generate` when engine is `LTXVideoEngine`; (b) construct one `LTXVideoEngine` per worker thread (e.g., via `threading.local` or `ThreadPoolExecutor(initializer=...)`); or (c) switch to `httpx.AsyncClient` + `asyncio.gather`. Option (b) matches the per-shot fan-out pattern most cleanly.

### WR-02: Episode-level `episode-meta` write is racy with concurrent p10b invocations on the same `workdir`

**File:** `/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p10b_rapid_preview.py:389-393`

**Issue:** `episode-meta` is a JSON-format slot, which `AssetBus.write` atomically replaces via `_atomic_write_text` (temp file + `os.replace`). However, if two concurrent p10b runs (e.g., cron + manual invocation) target the same `workdir`, the second `episode-meta` write clobbers the first via `os.replace` — there is no read-merge-write. The CONTEXT explicitly delegates episode-level coordination to the operator (D-09 / Out of Scope), but the current code leaves no trace that a previous `preview_skipped=True` was overwritten. This is the same hazard as the V5.0 atomic-write contract for any JSON slot, but `episode-meta` is the one slot where losing the flag silently defeats the "no silent swallow" red line.

**Fix:** Either (a) key the file by `episode_id` (e.g., `episode-meta-{episode_id}.json`) so concurrent episodes don't collide; (b) read-merge-write under a file lock; or (c) document this as an accepted limitation in the docstring and add a `previous_skip_reason` field when overwriting.

### WR-03: Outer `try/except Exception` in `run()` swallows programming errors — masks bugs like CR-01

**File:** `/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p10b_rapid_preview.py:258-285`

**Issue:** The broad `except Exception as exc:` is documented as "defensive — plan 02's select_engine should not raise in practice" (p10b:264-265). But it also catches `AssetBusError`, `KeyError`, `TypeError`, `AttributeError`, and any other programming bug *inside* `_run_body` — including CR-01. The result is a clean degrade envelope that, to monitoring, looks identical to a genuine engine-degraded episode. The `error: str(exc)` field in the returned envelope is the only breadcrumb, and it's only visible to callers that introspect `outputs.error` (the runner's checkpoint stores `result` so it is recoverable post-hoc, but no WARN distinguishes "engine degraded" from "phase code crashed").

CLAUDE.md (project conventions → Error Handling) explicitly permits `except Exception:` for best-effort fallbacks **only when the exception is logged**. The current code logs at WARNING but the message format `preview_skipped: episode=%s error=%s: %s — falling back to p11 direct Seedance` is the same message used for the *legitimate* episode-level full-degrade path (p10b:385-388). Operators cannot distinguish the two cases.

**Fix:** Log programming errors at `ERROR` level with `logger.exception(...)` (includes traceback), and reserve the `preview_skipped` WARN message for the legitimate full-degrade path. Consider narrowing the catch to `(AssetBusError, PreviewEngineError, OSError)` for the degrade path and letting truly unexpected exceptions propagate to the runner's retry loop (which the docstring claims to be the design — p10b:251-252 — but the broad catch contradicts).

### WR-04: `total_variants` is computed *before* the shot loop but the actual fan-out may produce fewer futures if `_build_variants` raises — full-degrade check can mis-fire

**File:** `/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p10b_rapid_preview.py:313, 383`

**Issue:** `total_variants = len(shot_list) * VARIANTS_PER_SHOT` is computed up front (p10b:313). The subsequent per-shot loop calls `_build_variants` → `_derive_new_value` → arithmetic on `baseline_value`. If `baseline_value` is malformed (e.g., `hook_position_sec` is a string from upstream p06/p01), `_derive_new_value` raises `TypeError` inside `ThreadPoolExecutor.submit` → `fut.result()` re-raises → caught by the outer `except Exception` → episode marked `preview_skipped`. That part is fine. But if the same upstream bug causes only *some* shots' baselines to be malformed and the rest succeed, the `total_variants` counter still reflects the *planned* count, while `degraded_count` only counts engine-degraded results (not exceptions). The `degraded_count == total_variants` check (p10b:383) is therefore comparing apples to oranges.

**Fix:** Track `expected_variants` separately from `attempted_variants` and emit a distinct `variants_skipped` counter when `_build_variants` or `engine.generate` raises (rather than degrades). The full-degrade check should compare against `attempted_variants`, not `total_variants`.

### WR-05: `keyframe_image_path` and `voice_clip_path` are read from untrusted upstream slots with no path-traversal validation

**File:** `/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p10b_rapid_preview.py:326-328, 411-420`

**Issue:** `_resolve_keyframe` returns `shot.get("keyframe")` verbatim from the `e-konte-sheets` slot, and `voice_clip_path = shot.get("clip_path")` from `voice-clips`. These strings flow directly into FFmpeg's `-i` argv (preview_engine.py:201-211) and into the success record's `clip_path` field. Since `e-konte-sheets` is produced by p09 (an LLM-driven phase per CONTEXT D-35-04 pure-orchestration contract — *upstream* of p10b), and LLM output is not trusted input, a malicious or buggy p09 output like `../../etc/passwd` would be passed as an FFmpeg input file. FFmpeg would fail to decode it (degrade path), but the path itself would be persisted in the JSONL record, and an operator reading the record might `cat` it.

List-form argv (T-40-06) correctly prevents shell injection, but does NOT prevent path traversal — the LLM-controlled path is still a filesystem read by FFmpeg.

**Fix:** Add a `_validate_path_under_root(path, root)` helper that resolves the path via `Path(path).resolve()` and asserts it's under an allow-listed directory (e.g., the workdir or a designated `previews/` subdir). Reject paths that escape. Apply to `keyframe_image_path`, `voice_clip_path`, and `output_path` before invoking FFmpeg.

## Info

### IN-01: `delegate_task` parameter is dead — accepted only for signature compatibility

**File:** `/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p10b_rapid_preview.py:218, 233-235`

**Issue:** The docstring is honest about this ("ACCEPTED for signature compatibility ... but NOT CALLED"), and it's correct per D-35-02 uniform phase dispatch. But the parameter has no `_ = delegate_task` assertion or unit-level guard. If a future change accidentally calls `delegate_task(...)`, it would silently invoke the production delegate (which talks to an LLM) — breaking the "pure orchestration, no LLM" contract from CONTEXT D-35-04.

**Fix:** Optional: add `assert delegate_task is not None or True  # accepted, not called` or simply `del delegate_task` at the top of `_run_body` to make the unused-ness load-bearing. Or document this finding as accepted.

### IN-02: `_derive_new_value` for `hook_position_sec` blindly adds 2 to an untrusted numeric — `TypeError` if baseline is `None`

**File:** `/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p10b_rapid_preview.py:112-114`

**Issue:** When `baseline_structure.get("hook_position_sec")` returns `None` (the param is absent from the upstream structure{}), `baseline_value + 2` raises `TypeError: unsupported operand type(s) for +: 'NoneType' and 'int'`. Same hazard for `turning_points_sec` when `baseline_value` is `None` and the `isinstance(baseline_value, list)` check passes through to the `[t + 2 for t in baseline_value]` line (which would raise on `None`-iteration — actually it wouldn't, because `None` is not a list; the check returns `baseline_value` unchanged). For `hook_position_sec` specifically, there's no `None` guard.

The default baseline (p10b:441-446) sets `hook_position_sec: 3`, so tests using the default pass. But the operator-override path (p10b:438-439) lets the upstream shot carry its own baseline, where the field could be missing.

**Fix:** Add `if baseline_value is None: return 0` (or `return 2`) at the top of `_derive_new_value` for the numeric branches.

### IN-03: Log message at p10b:269-271 uses `%s: %s` formatting for exception — correct, but the same line omits the canonical `preview_skipped` token that monitoring depends on

**File:** `/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p10b_rapid_preview.py:269-271`

**Issue:** Wait — re-reading: the message DOES start with `preview_skipped:` (good). However, the message format `episode=%s error=%s: %s` puts the exception type and message in `%s: %s` form, which can be confused with the `episode_id` field if the exception message contains `episode=`. Minor — but worth noting that 40-04-CONTEXT requires `preview_skipped` as the canonical grep token, and this line preserves it. No action needed; logging for completeness.

**Fix:** None required. (Reclassified from WARNING to INFO after re-reading.)

### IN-04: `PreviewEngine._record_time` is `@staticmethod` but reads no class state — could be a module function

**File:** `/data/workspace/hermes-agent/plugins/kais_aigc/preview_engine.py:97-100`

**Issue:** Minor design smell: `_record_time` doesn't depend on `self` or `cls`. As a `@staticmethod` it's effectively a module function embedded in the ABC. This is fine if future engines might override it, but currently both subclasses use the inherited version.

**Fix:** Optional — leave as-is for future override flexibility, or move to module-level `_record_wall_time_ms(start)`. No behavior change.

---

_Reviewed: 2026-06-27_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
