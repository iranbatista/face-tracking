import numpy as np
from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    REAL,
    BigInteger,
    CheckConstraint,
    ForeignKey,
    Identity,
    Index,
    Integer,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from foco.core.db import Base, Timestamps

EMBEDDING_DIM = 512  # tamanho do embedding do ArcFace (w600k_r50)
PENDING = ("queued", "processing")


class Photo(Timestamps, Base):
    __tablename__ = "photos"
    __table_args__ = (
        UniqueConstraint("event_id", "sha256", name="uq_photos_event_sha256"),  # mesma foto não entra 2x
        CheckConstraint("status IN ('queued','processing','done','error')", name="ck_photos_status"),
        Index("ix_photos_event_status", "event_id", "status"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    event_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("events.id", ondelete="CASCADE"))
    sha256: Mapped[str] = mapped_column(Text)  # hash do CONTEÚDO (dedupe)
    filename: Mapped[str] = mapped_column(Text)  # nome original enviado
    storage_key: Mapped[str] = mapped_column(Text)  # original no Storage (ver keys.py)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(Text)  # queued | processing | done | error
    n_faces: Mapped[int] = mapped_column(Integer, server_default="0", default=0)
    proc_ms: Mapped[float | None] = mapped_column(REAL)  # tempo gasto indexando
    error: Mapped[str | None] = mapped_column(Text)


class Face(Base):
    __tablename__ = "faces"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    photo_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("photos.id", ondelete="CASCADE"), index=True)
    event_id: Mapped[int] = mapped_column(BigInteger, index=True)  # desnormalizado: filtro da busca
    x1: Mapped[float] = mapped_column(REAL)  # bbox em px da foto ORIGINAL
    y1: Mapped[float] = mapped_column(REAL)
    x2: Mapped[float] = mapped_column(REAL)
    y2: Mapped[float] = mapped_column(REAL)
    det_score: Mapped[float | None] = mapped_column(REAL)
    embedding: Mapped[np.ndarray] = mapped_column(Vector(EMBEDDING_DIM))  # norma 1
