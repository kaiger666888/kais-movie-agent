"""Evaluation data model for quality score collection.

Stores evaluation records from GPU tasks and human reviews,
providing structured data for Hermes experience learning.
"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.schema import Base


class Evaluation(Base):
    __tablename__ = "evaluations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    review_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    phase: Mapped[str] = mapped_column(String(100), nullable=False)
    task_type: Mapped[str] = mapped_column(String(100), nullable=False)

    # GPU metrics
    gpu_time_sec: Mapped[float | None] = mapped_column(Float, nullable=True)
    peak_vram_gb: Mapped[float | None] = mapped_column(Float, nullable=True)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Quality scores
    ai_quality_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    human_cinematic: Mapped[int | None] = mapped_column(Integer, nullable=True)
    human_motion: Mapped[int | None] = mapped_column(Integer, nullable=True)
    human_consistency: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Hermes correlation
    hermes_decision_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    hermes_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Parameters snapshot (JSON)
    parameters_used: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Timestamps
    timestamp: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index("ix_evaluations_phase_timestamp", "phase", "timestamp"),
        Index("ix_evaluations_task_type", "task_type"),
        Index("ix_evaluations_review_id", "review_id"),
    )
