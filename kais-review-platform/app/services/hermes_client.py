"""Hermes Worker Agent audit client.

Reports evaluation outcomes to hermes-worker-agent /audit endpoint
to close the feedback loop: decision → execution → evaluation.
"""

import os

import httpx
import structlog

logger = structlog.get_logger(__name__)

HERMES_WORKER_URL = os.environ.get("HERMES_WORKER_URL", "http://host.docker.internal:3100")


async def report_audit(
    phase: str,
    decision_id: str | None = None,
    outcome: str = "completed",
    metrics: dict | None = None,
    parameters_used: dict | None = None,
) -> dict | None:
    """POST /audit to hermes-worker-agent. Fire-and-forget with logging."""
    if not HERMES_WORKER_URL:
        return None

    payload: dict = {
        "phase": phase,
        "decision_id": decision_id,
        "outcome": outcome,
        "metrics": metrics or {},
    }
    if parameters_used:
        payload["parameters_used"] = parameters_used

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(f"{HERMES_WORKER_URL}/audit", json=payload)
            resp.raise_for_status()
            data = resp.json()
            logger.info(
                "hermes_audit_reported",
                phase=phase,
                decision_id=decision_id,
                outcome=outcome,
                status_code=resp.status_code,
            )
            return data
    except Exception:
        logger.warning(
            "hermes_audit_failed",
            phase=phase,
            decision_id=decision_id,
            exc_info=True,
        )
        return None
