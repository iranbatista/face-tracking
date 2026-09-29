"""
db.py — conexão com o Postgres.

SQLAlchemy síncrono: as rotas síncronas do FastAPI já rodam em threadpool e
o InsightFace é síncrono, então async só complicaria. Cada request abre uma
Session (get_session) e o service decide quando fazer commit.
"""

import datetime as dt
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager
from functools import lru_cache

from sqlalchemy import DateTime, Engine, create_engine, func
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from foco.core.config import get_settings


class Base(DeclarativeBase):
    # Carrega valores gerados pelo servidor (updated_at após UPDATE, defaults após
    # INSERT) via RETURNING, para o objeto seguir usável depois de a sessão fechar.
    __mapper_args__ = {"eager_defaults": True}


class Timestamps:
    """
    created_at/updated_at em timestamptz. updated_at muda a cada UPDATE emitido
    pelo SQLAlchemy (ORM ou update() do Core).
    """

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


@lru_cache
def get_engine() -> Engine:
    # pool_pre_ping: conexão derrubada pelo Postgres (restart) é trocada sem erro
    return create_engine(get_settings().database_url, pool_pre_ping=True)


@lru_cache
def get_sessionmaker() -> sessionmaker[Session]:
    return sessionmaker(get_engine(), expire_on_commit=False)


def get_session() -> Iterator[Session]:
    """Dependência FastAPI: uma Session por request, fechada no fim (rollback do que não foi commitado)."""
    with get_sessionmaker()() as session:
        yield session


SessionFactory = Callable[[], AbstractContextManager[Session]]


def get_session_factory() -> SessionFactory:
    """Para quem precisa de várias sessões curtas no mesmo request (ex.: o SSE de progresso)."""
    return get_sessionmaker()
