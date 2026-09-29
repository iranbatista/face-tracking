"""Testes rodam contra um Postgres de verdade (pgvector não existe no SQLite).

O banco foco_test é recriado do zero uma vez por sessão, com as migrações.
Cada teste roda dentro de uma transação desfeita no fim: o commit() dos
services só libera um SAVEPOINT, nada fica gravado entre testes.
"""

import os

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://foco:foco@127.0.0.1:5432/foco_test"
)
SECRET = "chave-de-teste-" + "x" * 32
# Antes de importar foco: get_settings() lê o ambiente uma vez só (lru_cache),
# e o worker (Procrastinate) monta o conector no import.
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ["SECRET_KEY"] = SECRET
os.environ["ADMIN_PASSWORD"] = ""

from pathlib import Path  # noqa: E402

import psycopg  # noqa: E402
import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

BACKEND = Path(__file__).resolve().parents[1]


def _recreate_database(url: str) -> None:
    u = make_url(url)
    admin = u.set(drivername="postgresql", database="postgres").render_as_string(hide_password=False)
    with psycopg.connect(admin, autocommit=True) as c:
        c.execute(f'DROP DATABASE IF EXISTS "{u.database}" WITH (FORCE)')
        c.execute(f'CREATE DATABASE "{u.database}"')


@pytest.fixture(scope="session")
def alembic_cfg() -> Config:
    return Config(str(BACKEND / "alembic.ini"))


@pytest.fixture(scope="session")
def engine(alembic_cfg):
    _recreate_database(TEST_DATABASE_URL)
    command.upgrade(alembic_cfg, "head")
    eng = create_engine(TEST_DATABASE_URL)
    yield eng
    eng.dispose()


@pytest.fixture
def session(engine):
    conn = engine.connect()
    trans = conn.begin()
    s = Session(bind=conn, join_transaction_mode="create_savepoint", expire_on_commit=False)
    yield s
    s.close()
    trans.rollback()
    conn.close()
