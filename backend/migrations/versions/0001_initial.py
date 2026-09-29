"""extensão vector + events, photos, faces, feature_flags

Revision ID: 0001
Revises:
"""

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table(
        "events",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("event_date", sa.Date(), nullable=True),
        sa.Column("location", sa.Text(), nullable=True),
        *_timestamps(),
    )
    op.create_table(
        "photos",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), primary_key=True),
        sa.Column(
            "event_id", sa.BigInteger(), sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("sha256", sa.Text(), nullable=False),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("n_faces", sa.Integer(), server_default="0", nullable=False),
        sa.Column("proc_ms", sa.REAL(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        *_timestamps(),
        sa.UniqueConstraint("event_id", "sha256", name="uq_photos_event_sha256"),
        sa.CheckConstraint("status IN ('queued','processing','done','error')", name="ck_photos_status"),
    )
    op.create_index("ix_photos_event_status", "photos", ["event_id", "status"])
    op.create_table(
        "faces",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), primary_key=True),
        sa.Column(
            "photo_id", sa.BigInteger(), sa.ForeignKey("photos.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("event_id", sa.BigInteger(), nullable=False),
        sa.Column("x1", sa.REAL(), nullable=False),
        sa.Column("y1", sa.REAL(), nullable=False),
        sa.Column("x2", sa.REAL(), nullable=False),
        sa.Column("y2", sa.REAL(), nullable=False),
        sa.Column("det_score", sa.REAL(), nullable=True),
        sa.Column("embedding", Vector(512), nullable=False),
    )
    # Sem HNSW/IVF de propósito: o btree restringe ao evento e a comparação é
    # exata (como o IndexFlatIP do FAISS). Índice aproximado + filtro perde rostos.
    op.create_index("ix_faces_photo_id", "faces", ["photo_id"])
    op.create_index("ix_faces_event_id", "faces", ["event_id"])
    op.create_table(
        "feature_flags",
        sa.Column("key", sa.Text(), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("feature_flags")
    op.drop_table("faces")
    op.drop_table("photos")
    op.drop_table("events")
