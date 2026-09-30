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
    if not (u.database or "").endswith("_test"):
        raise RuntimeError(
            f"Recusando apagar o banco {u.database!r}: o nome do banco de testes deve terminar em '_test'."
        )
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


@pytest.fixture
def jobs():
    """Fila em memória: defer() grava aqui em vez do Postgres. Nenhum worker roda."""
    from procrastinate.testing import InMemoryConnector

    from foco.worker import app as worker_app

    connector = InMemoryConnector()
    with worker_app.replace_connector(connector):
        yield connector


def deferred(jobs, task_name: str) -> list[dict]:
    """Argumentos dos jobs enfileirados para uma tarefa."""
    return [j["args"] for j in jobs.jobs.values() if j["task_name"] == task_name]


@pytest.fixture
def static_dir(tmp_path):
    d = tmp_path / "static"
    d.mkdir()
    (d / "index.html").write_text("<!doctype html><html><body>foco</body></html>")
    return d


@pytest.fixture
def settings(tmp_path, static_dir):
    from foco.core.config import Settings

    return Settings(
        database_url=TEST_DATABASE_URL,
        secret_key=SECRET,
        data_dir=tmp_path / "data",
        static_dir=static_dir,
        admin_password="",
        _env_file=None,
    )


@pytest.fixture
def storage(settings):
    from foco.core.storage import LocalStorage

    return LocalStorage(settings.data_dir)


@pytest.fixture
def detector():
    from fakes import FakeDetector

    return FakeDetector()


@pytest.fixture
def make_client(session, settings, storage, detector, jobs):
    """make_client(admin_password="x") -> TestClient com as dependências de teste."""
    from contextlib import nullcontext

    from fastapi.testclient import TestClient

    from foco.core.config import get_settings
    from foco.core.db import get_session, get_session_factory
    from foco.core.storage import get_storage
    from foco.main import create_app
    from foco.vision.detector import get_detector

    def make(**overrides):
        s = settings.model_copy(update=overrides)
        app = create_app(s)
        app.dependency_overrides.update(
            {
                get_session: lambda: session,
                get_session_factory: lambda: lambda: nullcontext(session),
                get_settings: lambda: s,
                get_storage: lambda: storage,
                get_detector: lambda: detector,
            }
        )
        # sem "with": o lifespan (carregar o modelo, abrir o Procrastinate) não roda
        return TestClient(app)

    return make


@pytest.fixture
def client(make_client):
    return make_client()
