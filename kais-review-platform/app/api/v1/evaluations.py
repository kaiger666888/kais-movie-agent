"""Evaluation API endpoints.

POST /api/v1/evaluations        — Record an evaluation
GET  /api/v1/evaluations        — List evaluations with filters
GET  /api/v1/evaluations/stats  — Aggregated statistics
POST /api/v1/evaluations/export — Export in Hermes-consumable format
GET  /api/v1/evaluations/hermes/{phase} — Hermes phase-specific export
"""

import uuid
from datetime import datetime
from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.evaluation import Evaluation
from app.models.schemas import ApiResponse

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/api/v1/evaluations", tags=["evaluations"])


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------


class EvaluationCreateRequest(BaseModel):
    """Request body for creating an evaluation record."""
    review_id: int | None = None
    phase: str = Field(min_length=1, max_length=100)
    task_type: str = Field(min_length=1, max_length=100)
    gpu_time_sec: float | None = None
    peak_vram_gb: float | None = None
    success: bool = True
    retry_count: int = Field(default=0, ge=0)
    ai_quality_score: float | None = Field(default=None, ge=0, le=100)
    human_cinematic: int | None = Field(default=None, ge=1, le=5)
    human_motion: int | None = Field(default=None, ge=1, le=5)
    human_consistency: int | None = Field(default=None, ge=1, le=5)
    hermes_decision_id: str | None = None
    hermes_confidence: float | None = Field(default=None, ge=0, le=1)
    parameters_used: dict | None = None


class EvaluationResponse(BaseModel):
    id: str
    review_id: int | None = None
    phase: str
    task_type: str
    gpu_time_sec: float | None = None
    peak_vram_gb: float | None = None
    success: bool
    retry_count: int
    ai_quality_score: float | None = None
    human_cinematic: int | None = None
    human_motion: int | None = None
    human_consistency: int | None = None
    hermes_decision_id: str | None = None
    hermes_confidence: float | None = None
    parameters_used: dict | None = None
    timestamp: datetime
    created_at: datetime

    model_config = {"from_attributes": True}


class EvaluationStatsResponse(BaseModel):
    total_evaluations: int
    success_rate: float
    avg_gpu_time_sec: float | None = None
    avg_peak_vram_gb: float | None = None
    avg_ai_quality_score: float | None = None
    avg_human_cinematic: float | None = None
    avg_human_motion: float | None = None
    avg_human_consistency: float | None = None
    phase_breakdown: dict[str, int] = {}


class HermesExportRequest(BaseModel):
    """Request body for Hermes export."""
    phase: str | None = None
    task_type: str | None = None
    limit: int = Field(default=100, ge=1, le=1000)


class HermesPhaseExport(BaseModel):
    """Hermes-consumable format for a specific pipeline phase."""
    phase: str
    total_evaluations: int
    avg_scores: dict[str, float | None]
    best_params: dict[str, Any] | None
    recommendations: list[str]


# ---------------------------------------------------------------------------
# POST / — Record evaluation
# ---------------------------------------------------------------------------


@router.post(
    "/",
    status_code=status.HTTP_201_CREATED,
    response_model=ApiResponse[EvaluationResponse],
)
async def create_evaluation(
    request: EvaluationCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Record a new evaluation data point."""
    eval_id = str(uuid.uuid4())

    evaluation = Evaluation(
        id=eval_id,
        review_id=request.review_id,
        phase=request.phase,
        task_type=request.task_type,
        gpu_time_sec=request.gpu_time_sec,
        peak_vram_gb=request.peak_vram_gb,
        success=request.success,
        retry_count=request.retry_count,
        ai_quality_score=request.ai_quality_score,
        human_cinematic=request.human_cinematic,
        human_motion=request.human_motion,
        human_consistency=request.human_consistency,
        hermes_decision_id=request.hermes_decision_id,
        hermes_confidence=request.hermes_confidence,
        parameters_used=request.parameters_used,
    )

    db.add(evaluation)
    await db.commit()
    await db.refresh(evaluation)

    logger.info(
        "evaluation_created",
        eval_id=eval_id,
        phase=request.phase,
        task_type=request.task_type,
        success=request.success,
    )

    return ApiResponse(
        data=EvaluationResponse.model_validate(evaluation).model_dump(),
        meta={"request_id": uuid.uuid4().hex[:12]},
    )


# ---------------------------------------------------------------------------
# GET / — List evaluations
# ---------------------------------------------------------------------------


@router.get(
    "/",
    response_model=ApiResponse[list[EvaluationResponse]],
)
async def list_evaluations(
    phase: str | None = Query(None),
    task_type: str | None = Query(None),
    review_id: int | None = Query(None),
    success: bool | None = Query(None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """Query evaluations with optional filters."""
    stmt = select(Evaluation)

    if phase:
        stmt = stmt.where(Evaluation.phase == phase)
    if task_type:
        stmt = stmt.where(Evaluation.task_type == task_type)
    if review_id is not None:
        stmt = stmt.where(Evaluation.review_id == review_id)
    if success is not None:
        stmt = stmt.where(Evaluation.success == success)

    stmt = stmt.order_by(Evaluation.timestamp.desc()).limit(limit).offset(offset)

    result = await db.execute(stmt)
    evaluations = result.scalars().all()

    return ApiResponse(
        data=[EvaluationResponse.model_validate(e).model_dump() for e in evaluations],
        meta={"request_id": uuid.uuid4().hex[:12], "count": len(evaluations)},
    )


# ---------------------------------------------------------------------------
# GET /stats — Aggregated statistics
# ---------------------------------------------------------------------------


@router.get(
    "/stats",
    response_model=ApiResponse[EvaluationStatsResponse],
)
async def get_evaluation_stats(
    phase: str | None = Query(None),
    task_type: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Get aggregated evaluation statistics."""
    # Base filter
    conditions = []
    if phase:
        conditions.append(Evaluation.phase == phase)
    if task_type:
        conditions.append(Evaluation.task_type == task_type)

    from sqlalchemy import and_, case, cast, Float as SAFloat

    base_where = and_(*conditions) if conditions else True

    # Aggregate query
    stmt = select(
        func.count(Evaluation.id).label("total"),
        func.avg(cast(case((Evaluation.success == True, 1), else_=0), SAFloat)).label("success_rate"),
        func.avg(Evaluation.gpu_time_sec).label("avg_gpu"),
        func.avg(Evaluation.peak_vram_gb).label("avg_vram"),
        func.avg(Evaluation.ai_quality_score).label("avg_ai_score"),
        func.avg(Evaluation.human_cinematic).label("avg_cinematic"),
        func.avg(Evaluation.human_motion).label("avg_motion"),
        func.avg(Evaluation.human_consistency).label("avg_consistency"),
    ).select_from(Evaluation).where(base_where)

    result = await db.execute(stmt)
    row = result.one()

    # Phase breakdown
    phase_stmt = (
        select(Evaluation.phase, func.count(Evaluation.id).label("cnt"))
        .where(base_where)
        .group_by(Evaluation.phase)
    )
    phase_result = await db.execute(phase_stmt)
    phase_breakdown = {r[0]: r[1] for r in phase_result.all()}

    stats = EvaluationStatsResponse(
        total_evaluations=row.total or 0,
        success_rate=round(row.success_rate or 0, 4),
        avg_gpu_time_sec=round(row.avg_gpu, 2) if row.avg_gpu else None,
        avg_peak_vram_gb=round(row.avg_vram, 2) if row.avg_vram else None,
        avg_ai_quality_score=round(row.avg_ai_score, 2) if row.avg_ai_score else None,
        avg_human_cinematic=round(row.avg_cinematic, 2) if row.avg_cinematic else None,
        avg_human_motion=round(row.avg_motion, 2) if row.avg_motion else None,
        avg_human_consistency=round(row.avg_consistency, 2) if row.avg_consistency else None,
        phase_breakdown=phase_breakdown,
    )

    return ApiResponse(
        data=stats.model_dump(),
        meta={"request_id": uuid.uuid4().hex[:12]},
    )


# ---------------------------------------------------------------------------
# POST /export — Export evaluations in Hermes format
# ---------------------------------------------------------------------------


@router.post(
    "/export",
    response_model=ApiResponse[dict],
)
async def export_evaluations(
    request: HermesExportRequest,
    db: AsyncSession = Depends(get_db),
):
    """Export evaluation data in Hermes-consumable format."""
    stmt = select(Evaluation)

    if request.phase:
        stmt = stmt.where(Evaluation.phase == request.phase)
    if request.task_type:
        stmt = stmt.where(Evaluation.task_type == request.task_type)

    stmt = stmt.order_by(Evaluation.timestamp.desc()).limit(request.limit)
    result = await db.execute(stmt)
    evaluations = result.scalars().all()

    export_data = [
        {
            "id": e.id,
            "phase": e.phase,
            "task_type": e.task_type,
            "gpu_time_sec": e.gpu_time_sec,
            "peak_vram_gb": e.peak_vram_gb,
            "success": e.success,
            "retry_count": e.retry_count,
            "ai_quality_score": e.ai_quality_score,
            "human_scores": {
                "cinematic": e.human_cinematic,
                "motion": e.human_motion,
                "consistency": e.human_consistency,
            },
            "hermes_decision_id": e.hermes_decision_id,
            "hermes_confidence": e.hermes_confidence,
            "parameters_used": e.parameters_used,
            "timestamp": e.timestamp.isoformat() if e.timestamp else None,
        }
        for e in evaluations
    ]

    return ApiResponse(
        data={
            "evaluations": export_data,
            "count": len(export_data),
            "exported_at": datetime.utcnow().isoformat(),
        },
        meta={"request_id": uuid.uuid4().hex[:12]},
    )


# ---------------------------------------------------------------------------
# GET /hermes/{phase} — Hermes phase-specific export
# ---------------------------------------------------------------------------


@router.get(
    "/hermes/{phase}",
    response_model=ApiResponse[HermesPhaseExport],
)
async def get_hermes_phase_export(
    phase: str,
    limit: int = Query(default=100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
):
    """Get Hermes-consumable data for a specific pipeline phase.

    Returns aggregated scores, best parameters, and recommendations
    derived from evaluation history.
    """
    stmt = select(Evaluation).where(Evaluation.phase == phase)
    stmt = stmt.order_by(Evaluation.timestamp.desc()).limit(limit)
    result = await db.execute(stmt)
    evaluations = result.scalars().all()

    if not evaluations:
        return ApiResponse(
            data=HermesPhaseExport(
                phase=phase,
                total_evaluations=0,
                avg_scores={"cinematic": None, "motion": None, "consistency": None, "ai_quality": None},
                best_params=None,
                recommendations=[f"No evaluation data available for phase '{phase}'"],
            ).model_dump(),
            meta={"request_id": uuid.uuid4().hex[:12]},
        )

    # Compute averages
    n = len(evaluations)
    avg_cinematic = sum(e.human_cinematic for e in evaluations if e.human_cinematic) / max(1, sum(1 for e in evaluations if e.human_cinematic))
    avg_motion = sum(e.human_motion for e in evaluations if e.human_motion) / max(1, sum(1 for e in evaluations if e.human_motion))
    avg_consistency = sum(e.human_consistency for e in evaluations if e.human_consistency) / max(1, sum(1 for e in evaluations if e.human_consistency))
    avg_ai = sum(e.ai_quality_score for e in evaluations if e.ai_quality_score) / max(1, sum(1 for e in evaluations if e.ai_quality_score))

    avg_scores = {
        "cinematic": round(avg_cinematic, 2) if any(e.human_cinematic for e in evaluations) else None,
        "motion": round(avg_motion, 2) if any(e.human_motion for e in evaluations) else None,
        "consistency": round(avg_consistency, 2) if any(e.human_consistency for e in evaluations) else None,
        "ai_quality": round(avg_ai, 2) if any(e.ai_quality_score for e in evaluations) else None,
    }

    # Find best parameters (highest combined human score among successful evaluations)
    best_eval = None
    best_score = -1
    for e in evaluations:
        if not e.success or not e.parameters_used:
            continue
        score = (e.human_cinematic or 0) + (e.human_motion or 0) + (e.human_consistency or 0)
        if score > best_score:
            best_score = score
            best_eval = e

    best_params = best_eval.parameters_used if best_eval else None

    # Generate recommendations
    recommendations: list[str] = []
    success_rate = sum(1 for e in evaluations if e.success) / n
    if success_rate < 0.8:
        recommendations.append(
            f"Success rate is {success_rate:.0%} — investigate failure patterns"
        )

    if avg_scores["cinematic"] is not None and avg_scores["cinematic"] < 3:
        recommendations.append("Cinematic quality below threshold — consider adjusting visual parameters")
    if avg_scores["motion"] is not None and avg_scores["motion"] < 3:
        recommendations.append("Motion quality below threshold — review motion model settings")
    if avg_scores["consistency"] is not None and avg_scores["consistency"] < 3:
        recommendations.append("Consistency below threshold — check reference image quality")

    avg_retry = sum(e.retry_count for e in evaluations) / n
    if avg_retry > 1:
        recommendations.append(f"Average retry count is {avg_retry:.1f} — optimize parameters to reduce retries")

    if not recommendations:
        recommendations.append("All metrics within acceptable range")

    return ApiResponse(
        data=HermesPhaseExport(
            phase=phase,
            total_evaluations=n,
            avg_scores=avg_scores,
            best_params=best_params,
            recommendations=recommendations,
        ).model_dump(),
        meta={"request_id": uuid.uuid4().hex[:12]},
    )
