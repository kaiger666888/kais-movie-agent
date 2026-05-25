"""Add evaluations table for quality score collection.

Revision ID: 004_evaluations
Revises: 003_shot_cards_v6
Create Date: 2026-05-25
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "004_evaluations"
down_revision: Union[str, None] = "003_shot_cards_v6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "evaluations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("review_id", sa.Integer(), nullable=True),
        sa.Column("phase", sa.String(100), nullable=False),
        sa.Column("task_type", sa.String(100), nullable=False),
        # GPU metrics
        sa.Column("gpu_time_sec", sa.Float(), nullable=True),
        sa.Column("peak_vram_gb", sa.Float(), nullable=True),
        sa.Column("success", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        # Quality scores
        sa.Column("ai_quality_score", sa.Float(), nullable=True),
        sa.Column("human_cinematic", sa.Integer(), nullable=True),
        sa.Column("human_motion", sa.Integer(), nullable=True),
        sa.Column("human_consistency", sa.Integer(), nullable=True),
        # Hermes correlation
        sa.Column("hermes_decision_id", sa.String(100), nullable=True),
        sa.Column("hermes_confidence", sa.Float(), nullable=True),
        # Parameters snapshot
        sa.Column("parameters_used", JSONB, nullable=True),
        # Timestamps
        sa.Column("timestamp", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )

    op.create_index("ix_evaluations_phase_timestamp", "evaluations", ["phase", "timestamp"])
    op.create_index("ix_evaluations_task_type", "evaluations", ["task_type"])
    op.create_index("ix_evaluations_review_id", "evaluations", ["review_id"])


def downgrade() -> None:
    op.drop_index("ix_evaluations_review_id", table_name="evaluations")
    op.drop_index("ix_evaluations_task_type", table_name="evaluations")
    op.drop_index("ix_evaluations_phase_timestamp", table_name="evaluations")
    op.drop_table("evaluations")
