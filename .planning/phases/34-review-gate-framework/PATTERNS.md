# Phase 34 Patterns: HIL Gate State Machine + YAML Config + Runner Hooks

**Source:** Reference against Phase 32 PATTERNS (HTTP client + degrade), Phase 33 PATTERNS (atomic write + dataclass records), Node.js `lib/pipeline.js` review trigger logic, and hermes-agent plugin convention (`plugins/spotify/` standalone multi-tool pattern).

This document shows the executor the exact Python patterns to mirror so they don't re-explore the codebase.

## Reference Modules Consulted

| Module | Path | Why Consulted | Pattern Extracted |
|--------|------|---------------|-------------------|
| Phase 32 review_platform | `plugins/kais_aigc/review_platform.py` | JWT bearer + HMAC verify_callback (5-min window) | Reuse for webhook-mode callback verification |
| Phase 33 asset_bus | `plugins/pipeline_state/asset_bus.py` | Atomic write, envelope wrap, ASSET_SCHEMA dict | Pattern for gates.yaml loader + outcome write-back via `bus.write("review-outcomes", ...)` |
| Phase 33 store | `plugins/pipeline_state/store.py` | PipelineState dataclass + atomic write + DONE_STATUSES | Pattern for episode-failed state write (PIPE-GUARD-01) |
| Phase 33 tools.py | `plugins/pipeline_state/tools.py` | Factory helpers + handler dispatch + JSONL routing | Pattern for 34-04 tools.py rewrite |
| Phase 31 tools.py stubs | `plugins/review_gates/tools.py` | Current 4 stubs + schema shape | Schemas UNCHANGED; only handler bodies swap |
| hermes-agent plugin loader | `tools/registry.py` (`tool_result`, `tool_error`) | Uniform JSON serialization | Handler return shape |
| Node.js review trigger | `lib/pipeline.js:295-379, 472-483` | Remote review submission + awaiting_review state + onProgress event | Behavior reference for gate.submit() side effects |

## Adopted Pattern: Gate State Machine (pure stdlib)

### `gate.py` Anatomy

```python
"""gate.py — HIL Gate lifecycle state machine (Phase 34-01, SC#1).

Pure stdlib (threading/dataclasses/enum/time/pathlib/json/logging).
HTTP-calling adapters (webhook verify, polling query) live in runner_hooks.py
and reuse plugins.kais_aigc.review_platform.

3 modes (CF-01): blocking (Event.wait) / webhook (non-blocking, resume via
callback) / polling (active query loop).
"""
from __future__ import annotations

import enum
import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)


class GateMode(str, enum.Enum):
    BLOCKING = "blocking"
    WEBHOOK = "webhook"
    POLLING = "polling"


class GateStatus(str, enum.Enum):
    PENDING = "pending"          # submitted, waiting
    APPROVED = "approved"
    REJECTED = "rejected"
    CONTESTED = "contested"
    TIMED_OUT = "timed_out"
    FAILED = "failed"            # max_retries exceeded (PIPE-GUARD-01)


class GateError(Exception):
    """Transient gate error (network, state mismatch)."""


class GateMaxRetriesExceeded(Exception):
    """Terminal: gate exhausted retry_policy.max_retries.

    Preserves v4.0 PIPE-GUARD-01 CONSISTENCY_BLOCKED semantics — the episode
    is marked failed and the runner must stop. NOT silent swallow.
    """

    def __init__(self, gate_id: str, attempts: int, max_retries: int):
        super().__init__(
            f"CONSISTENCY_BLOCKED: gate '{gate_id}' exhausted retries "
            f"({attempts} > {max_retries})"
        )
        self.gate_id = gate_id
        self.attempts = attempts
        self.max_retries = max_retries


@dataclass(frozen=True)
class GateConfig:
    """Static gate definition (loaded from gates.yaml)."""
    gate_id: str
    phase: str                           # V8.6 phase after which this gate fires
    asset_bus_slots_to_lock: tuple[str, ...]
    reviewer_role: str
    timeout_sec: int = 3600
    callback_url: Optional[str] = None
    max_retries: int = 2
    backoff_sec: int = 300
    default_mode: GateMode = GateMode.BLOCKING


@dataclass
class Gate:
    """Runtime gate instance — carries mutable state across submit/wait/resolve."""
    config: GateConfig
    episode_id: str
    mode: GateMode
    attempt: int = 0
    status: GateStatus = GateStatus.PENDING
    review_id: Optional[str] = None
    submitted_at: Optional[str] = None
    resolved_at: Optional[str] = None
    decision: Optional[str] = None       # "approve" | "reject" | "contest"
    suggested_action: Optional[str] = None
    _event: threading.Event = field(default_factory=threading.Event, repr=False)

    def submit(self, payload: dict, *, review_client: Any = None) -> dict:
        """Submit gate for review. Increments attempt. Returns submission record."""
        self.attempt += 1
        self.submitted_at = datetime.now(timezone.utc).isoformat()
        self.status = GateStatus.PENDING
        self._event.clear()
        # Caller (runner_hooks.pause_for_review) handles the actual review_platform
        # call + PipelineState.awaiting_review write. gate.submit just tracks state.
        if self.attempt > self.config.max_retries:
            self.status = GateStatus.FAILED
            raise GateMaxRetriesExceeded(
                self.config.gate_id, self.attempt, self.config.max_retries
            )
        return {
            "gate_id": self.config.gate_id,
            "episode_id": self.episode_id,
            "attempt": self.attempt,
            "submitted_at": self.submitted_at,
            "status": self.status.value,
        }

    def wait(self, timeout_sec: Optional[int] = None) -> dict:
        """Block/poll/return depending on mode (CF-01)."""
        effective_timeout = timeout_sec or self.config.timeout_sec
        if self.mode == GateMode.BLOCKING:
            # threading.Event.wait returns True if set, False on timeout
            resolved = self._event.wait(timeout=effective_timeout)
            if not resolved:
                self.status = GateStatus.TIMED_OUT
            return self._outcome_record()
        elif self.mode == GateMode.WEBHOOK:
            # Non-blocking — return immediately. Caller persists state and exits.
            # Resume happens via Gate.resume_from_callback() in a later process.
            return {"status": "awaiting_callback", "review_id": self.review_id}
        elif self.mode == GateMode.POLLING:
            # Active pull loop — caller (runner_hooks) supplies query_fn.
            raise GateError(
                "POLLING mode wait requires runner_hooks.poll_until_terminal(); "
                "use Gate.poll_step() in a loop instead."
            )

    def resolve(self, decision: str, suggested_action: Optional[str] = None) -> dict:
        """Resolve the gate. Sets Event for blocking mode; writes outcome record."""
        if decision not in {"approve", "reject", "contest"}:
            raise GateError(f"Invalid decision: {decision}")
        self.decision = decision
        self.suggested_action = suggested_action
        self.resolved_at = datetime.now(timezone.utc).isoformat()
        self.status = {
            "approve": GateStatus.APPROVED,
            "reject": GateStatus.REJECTED,
            "contest": GateStatus.CONTESTED,
        }[decision]
        self._event.set()  # wake blocking-mode waiters
        return self._outcome_record()

    def _outcome_record(self) -> dict:
        return {
            "gate_id": self.config.gate_id,
            "episode_id": self.episode_id,
            "decision": self.decision,
            "suggested_action": self.suggested_action,
            "reviewer_role": self.config.reviewer_role,
            "resolved_at": self.resolved_at,
            "attempt": self.attempt,
            "status": self.status.value,
        }
```

**Key points:**
- Pure stdlib. `threading.Event` for blocking mode (D-34-05).
- `GateMaxRetriesExceeded` raised from `submit()` when `attempt > max_retries` — propagates to caller.
- `resolve()` writes the outcome record but does NOT touch asset bus — the runner_hooks adapter or tools.py handler does the bus write (separation of concerns: state machine vs persistence).

### `gates.yaml` Format

```yaml
# 8 V8.6 review gates. Loaded once at __init__.py import (D-34-02).
version: 1
gates:
  - gate_id: topic-gate
    phase: p01_hook_topic
    asset_bus_slots_to_lock: ["hook-topic"]
    reviewer_role: creative_source
    timeout_sec: 3600
    callback_url: null
    default_mode: blocking
    retry_policy:
      max_retries: 2
      backoff_sec: 300
  # ... 7 more (see CF-02 table)
```

### `runner_hooks.py` Anatomy

```python
"""runner_hooks.py — Phase 35 runner ↔ Phase 34 gate framework adapter.

Three entry points the Phase 35 runner calls:
  * pause_for_review(gate_id, episode_id, payload)  — submit + write awaiting_review state
  * resume_from_callback(body, sig, ts)             — HMAC verify + resolve + write outcome
  * poll_until_terminal(gate_id, timeout_sec)       — polling-mode wait loop
"""
from __future__ import annotations

from plugins.kais_aigc.review_platform import ReviewPlatformClient
from plugins.pipeline_state.asset_bus import AssetBus
from plugins.pipeline_state.store import PipelineStateStore
from plugins.review_gates.gate import Gate, GateMaxRetriesExceeded, GateStatus

# Module-level factories (mirror Phase 33-04 _state_store() / _asset_bus() pattern)
def _review_client() -> ReviewPlatformClient: ...
def _asset_bus(workdir: str | None = None) -> AssetBus: ...
def _state_store(workdir: str | None = None) -> PipelineStateStore: ...


def pause_for_review(gate_id: str, episode_id: str, payload: dict) -> dict:
    """Submit gate to review-platform + write awaiting_review to PipelineState.

    Raises GateMaxRetriesExceeded on retry exhaustion → caller (Phase 35 runner)
    catches and marks episode failed (preserves PIPE-GUARD-01).
    """
    gate = _build_gate(gate_id, episode_id)
    submission = gate.submit(payload)
    # Submit to review-platform (mocked in tests via transport injection)
    result = _review_client().submit_review(
        type=gate_id,
        content_ref=f"{episode_id}/{gate.config.phase}",
        callback_url=gate.config.callback_url,
    )
    if result.get("degraded"):
        # Auto-approve on degrade (mirrors review_platform DEGRADED_AUTO disposition)
        gate.resolve("approve")
    else:
        gate.review_id = result.get("review_id")
    _write_awaiting_review_state(episode_id, gate.config.phase, gate.review_id)
    return {**submission, "review_id": gate.review_id, "status": gate.status.value}


def resume_from_callback(body: str, signature: str, timestamp: int) -> dict:
    """Verify HMAC callback → resolve matching pending gate → write outcome."""
    if not _review_client().verify_callback(body, signature, timestamp):
        raise PermissionError("Invalid HMAC callback signature")
    callback_data = json.loads(body)
    gate_id = callback_data["gate_id"]
    decision = callback_data["decision"]
    suggested_action = callback_data.get("suggested_action")
    gate = _load_pending_gate(gate_id)
    outcome = gate.resolve(decision, suggested_action)
    _write_review_outcome(gate, outcome)
    if decision == "reject" and suggested_action:
        _mark_rollback(episode_id, suggested_action)  # runner jumps to target phase
    return outcome


def _write_review_outcome(gate: Gate, outcome: dict) -> None:
    """Append to asset bus review-outcomes slot (CF-04 schema)."""
    bus = _asset_bus()
    current = bus.read("review-outcomes") or {"outcomes": [], "version": 1}
    current["outcomes"].append(outcome)
    bus.write("review-outcomes", current, envelope=True)


def mark_episode_failed(episode_id: str, gate_id: str, exc: GateMaxRetriesExceeded) -> None:
    """PIPE-GUARD-01: write failed status + CONSISTENCY_BLOCKED error to state."""
    store = _state_store()
    state = store.load()
    phase = GATE_REGISTRY[gate_id].config.phase
    state.phases[phase] = {
        "status": "failed",
        "failed_at": datetime.now(timezone.utc).isoformat(),
        "error": str(exc),  # "CONSISTENCY_BLOCKED: gate 'X' exhausted retries (n > m)"
    }
    store.save(state)
```

## Test Pattern: MockTransport + tmp_path

Mirror Phase 32's `httpx.MockTransport(handler)` pattern for review-client tests:

```python
def test_resume_from_callback_reject_triggers_rollback(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    # Inject mock review client (verify_callback → True)
    fake_client = MagicMock()
    fake_client.verify_callback.return_value = True
    monkeypatch.setattr(runner_hooks, "_review_client", lambda: fake_client)
    # ... exercise resume_from_callback, assert review-outcomes written + rollback marker
```

## Differences from Phase 33

- Phase 33 = pure data structures, no network. Phase 34 = state machine (pure) + HTTP adapters (via Phase 32 client reuse).
- Phase 33 added 0 third-party deps. Phase 34 adds `pyyaml` (already transitive; no pyproject.toml change per D-34-03).
- Phase 33 tests = pure unit (no mocks). Phase 34 tests = unit (gate.py) + integration with mocked review client (runner_hooks.py).

## Anti-Patterns to Avoid

- DO NOT call `review_platform` HTTP from `gate.py` directly — keep gate.py pure stdlib (D-34-01).
- DO NOT silently swallow `GateMaxRetriesExceeded` — that's the v4.0 bug PIPE-GUARD-01 fixed.
- DO NOT hot-reload `gates.yaml` (D-34-02) — restart required.
- DO NOT add `async def` (D-34-05) — sync like Phase 33.
- DO NOT change tool schemas in tools.py — Phase 31 contract is locked; only swap handler bodies (Plan 34-04).
