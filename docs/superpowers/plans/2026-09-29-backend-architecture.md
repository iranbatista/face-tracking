# Arquitetura do backend: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o backend de arquivos soltos (`api.py`, `store.py`...) por um pacote `foco` em módulos por domínio, com Postgres + pgvector + Alembic e um worker Procrastinate separado, mantendo o frontend atual (`static/`) funcionando.

**Architecture:** O código novo nasce em `backend/` ao lado do antigo, que continua rodando até a Task 23 (corte). Cada módulo (`events`, `photos`, `search`, `features`, `admin`) tem `router` (só HTTP) → `service` (regra de negócio, recebe a `Session`) → `models` (SQLAlchemy 2). A indexação sai da thread do processo e vira tarefa do Procrastinate, e a busca por selfie passa a devolver um token assinado em vez de guardar o embedding na memória.

**Tech Stack:** Python 3.11, FastAPI 0.142, SQLAlchemy 2.1 (síncrono) + psycopg 3.3, Alembic 1.20, pgvector 0.5 (Postgres 17), Procrastinate 3.10, pydantic-settings 2.15, uv, ruff, pytest.

**Spec:** `docs/superpowers/specs/2026-09-29-backend-architecture-design.md`

---

## Ajustes em relação à spec (decididos ao planejar)

- `Storage.read(key) -> bytes` no lugar de `open() -> BinaryIO` (ninguém precisa de stream), e `delete_dir(prefix)` para remover a pasta do evento.
- As chaves de arquivo (`original_key`, `thumb_key`, `medium_key`) ficam em `photos/keys.py`. O código do worker fica em `photos/indexing.py`, e `photos/tasks.py` só tem as cascas do Procrastinate. `photos/covers.py` guarda a escolha da capa e o ponto de foco. Tudo isso evita import circular: `events → photos.tasks/covers`, `photos.service → photos.tasks → photos.indexing`, e ninguém volta.
- Services levantam erros de `core/errors.py` (`NotFound`, `Invalid`, `Gone`, `Unauthorized`, `Unprocessable`), e um handler converte em `{"detail": "..."}` com o status certo. Os services não conhecem HTTP.
- Na VPS, os arquivos vão para `./data/files` e o Postgres para `./data/postgres`, para a API não montar os arquivos internos do banco.
- `uvicorn --factory foco.main:create_app`: sem `app` global, e os testes montam o app com as próprias `Settings`.
- `GET /api/events` deixa de devolver `cover_ids` e `cover_photo_id`, que o frontend não usa, e continua devolvendo `cover`.
- `created_at` sai em ISO 8601 com fuso, e o `fmtDate` do `app.js` é ajustado (Task 20).

## Mapa de arquivos

```
backend/
  pyproject.toml, uv.lock, alembic.ini
  migrations/
    env.py, script.py.mako
    versions/0001_initial.py            # extensão vector + 4 tabelas
    versions/0002_procrastinate.py      # schema da fila
  src/foco/
    __init__.py
    main.py                  # create_app(): handlers, routers, /api/health, static
    models.py                # importa todos os modelos (Alembic e testes)
    worker.py                # procrastinate.App
    core/
      __init__.py
      config.py              # Settings, get_settings
      db.py                  # Base, Timestamps, get_engine, get_sessionmaker, get_session, get_session_factory
      errors.py              # AppError e subclasses, install_handlers
      signing.py             # sign/verify com HMAC e validade
      storage.py             # Storage, LocalStorage, get_storage
    vision/
      __init__.py
      images.py              # load_image, make_thumbnail
      detector.py            # Detector, InsightFaceDetector, get_detector
    modules/
      __init__.py
      events/   __init__.py models.py schemas.py service.py router.py
      photos/   __init__.py models.py schemas.py keys.py covers.py indexing.py tasks.py service.py router.py
      search/   __init__.py token.py service.py router.py
      features/ __init__.py models.py registry.py service.py router.py
      admin/    __init__.py auth.py router.py
  tests/
    conftest.py, fakes.py, factories.py
    test_config.py test_db.py test_migrations.py test_signing.py test_storage.py
    test_vision.py test_indexing.py test_features.py test_admin_auth.py test_api_admin.py
    test_health.py test_covers.py test_events.py test_photos_upload.py test_photos_files.py
    test_progress.py test_search_token.py test_search.py
Makefile, docker-compose.yml, docker-compose.dev.yml, Dockerfile, .env.example, .dockerignore
.github/workflows/ci.yml
static/app.js                  # Task 20: query_token + fmtDate
```

Removidos na Task 23: `api.py`, `store.py`, `detector.py`, `features.py`, `admin_auth.py`, `requirements.txt`, `requirements-dev.txt`, `pytest.ini`, `tests/` da raiz.

Convenção dos commits: `ref(backend): ...` (Sentry), terminando com
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Antes de cada commit a partir da Task 1:** `make fmt && make lint`. O CI
(Task 22) roda `ruff format --check`, e o código dos blocos abaixo pode não
estar exatamente no formato do ruff.

---

### Task 0: Pré-requisitos do ambiente (ação do usuário)

Sem isso nenhum teste roda: o WSL não tem `uv`, e o `docker` não está integrado.

- [ ] **Step 1: Ligar o Docker no WSL**

No Docker Desktop (Windows): Settings → Resources → WSL Integration → ligar a distro atual → Apply & Restart.

Run: `docker version --format '{{.Server.Version}}' && docker compose version`
Expected: imprime a versão do servidor e do compose, sem "could not be found".

- [ ] **Step 2: Instalar o uv**

Run: `curl -LsSf https://astral.sh/uv/install.sh | sh && source ~/.local/bin/env && uv --version`
Expected: `uv 0.x.y`

- [ ] **Step 3: Conferir o Python 3.11**

Run: `uv python find 3.11`
Expected: `/usr/bin/python3.11`

---

### Task 1: Esqueleto do pacote, config e ferramentas

**Files:**
- Create: `backend/pyproject.toml`, `backend/src/foco/__init__.py`, `backend/src/foco/core/__init__.py`, `backend/src/foco/core/config.py`, `backend/tests/test_config.py`, `Makefile`
- Modify: `docker-compose.dev.yml` (reescrito), `.gitignore`

- [ ] **Step 1: Criar `backend/pyproject.toml`**

```toml
[project]
name = "foco"
version = "0.1.0"
description = "Foco: busca de fotos de evento por reconhecimento facial"
requires-python = "==3.11.*"
dependencies = [
    "fastapi==0.142.0",
    "uvicorn[standard]==0.54.0",
    "python-multipart==0.0.32",
    "pydantic-settings==2.15.0",
    "sqlalchemy==2.1.1",
    "psycopg[binary,pool]==3.3.6",
    "alembic==1.20.0",
    "pgvector==0.5.0",
    "procrastinate==3.10.0",
    "numpy==2.4.6",
    "pillow==12.3.0",
    "onnxruntime==1.30.0",
    "insightface==2.0",
    "opencv-python-headless==5.0.0.93",
]

[dependency-groups]
dev = [
    "pytest==9.1.1",
    "httpx==0.28.1",
    "ruff==0.16.9",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/foco"]

[tool.ruff]
line-length = 110
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP"]

[tool.ruff.lint.isort]
known-first-party = ["foco"]

[tool.pytest.ini_options]
testpaths = ["tests"]
markers = ["slow: usa o modelo InsightFace real (~280 MB)"]
addopts = "-m 'not slow'"
```

- [ ] **Step 2: Criar os `__init__.py` do pacote**

`backend/src/foco/__init__.py`:

```python
"""Foco: o fotógrafo sobe as fotos do evento, o participante acha as suas por selfie."""
```

`backend/src/foco/core/__init__.py`: arquivo vazio.

- [ ] **Step 3: Escrever o teste da config**

`backend/tests/test_config.py`:

```python
import pytest
from pydantic import ValidationError

from foco.core.config import Settings

URL = "postgresql+psycopg://u:p@h:5432/d"


def test_le_do_ambiente(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", URL)
    monkeypatch.setenv("SECRET_KEY", "s" * 32)
    monkeypatch.setenv("ADMIN_PASSWORD", "x")
    s = Settings(_env_file=None)
    assert s.database_url == URL
    assert s.admin_password == "x"


def test_pg_conninfo_sem_driver_do_sqlalchemy(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", URL)
    monkeypatch.setenv("SECRET_KEY", "s" * 32)
    assert Settings(_env_file=None).pg_conninfo == "postgresql://u:p@h:5432/d"


def test_admin_password_vazia_por_padrao(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", URL)
    monkeypatch.setenv("SECRET_KEY", "s" * 32)
    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)
    assert Settings(_env_file=None).admin_password == ""


def test_secret_key_curta_recusada(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", URL)
    monkeypatch.setenv("SECRET_KEY", "curta")
    with pytest.raises(ValidationError):
        Settings(_env_file=None)
```

- [ ] **Step 4: Instalar e ver o teste falhar**

Run: `cd backend && uv sync && uv run pytest tests/test_config.py -q`
Expected: FAIL com `ModuleNotFoundError: No module named 'foco.core.config'`

- [ ] **Step 5: Implementar `backend/src/foco/core/config.py`**

```python
"""
config.py — toda a configuração do app, lida do ambiente (e do .env).

Nenhum outro arquivo lê os.environ: quem precisa de um valor recebe as
Settings (Depends(get_settings) nas rotas, get_settings() no worker).
"""

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/src/foco/core/config.py -> raiz do repositório (em dev).
# No Docker, DATA_DIR e STATIC_DIR vêm do ambiente.
REPO_ROOT = Path(__file__).resolve().parents[4]


class Settings(BaseSettings):
    # ../.env = raiz do repo (quando o processo roda de backend/). O .env de
    # backend/, se existir, sobrescreve. Variáveis de ambiente vencem os dois.
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    database_url: str                                # postgresql+psycopg://...
    secret_key: str = Field(min_length=32)           # token da selfie e cookie do admin
    data_dir: Path = REPO_ROOT / "data"              # raiz do LocalStorage
    static_dir: Path = REPO_ROOT / "static"          # frontend
    admin_password: str = ""                         # vazia = backoffice desligado
    insightface_root: str = "~/.insightface"         # onde fica o buffalo_l

    @property
    def pg_conninfo(self) -> str:
        """A mesma URL sem o driver do SQLAlchemy, para o psycopg puro (Procrastinate)."""
        return self.database_url.replace("postgresql+psycopg://", "postgresql://", 1)


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 6: Rodar o teste**

Run: `cd backend && uv run pytest tests/test_config.py -q`
Expected: `4 passed`

- [ ] **Step 7: Reescrever `docker-compose.dev.yml` (só o Postgres de dev)**

```yaml
# Postgres de desenvolvimento. A API e o worker rodam no host (make api,
# make worker), com reload e debugger.
#
#   make db        (= docker compose -f docker-compose.dev.yml up -d db)
#
# Nome .dev.yml (e não docker-compose.override.yml) de propósito: o override é
# carregado automaticamente pelo `docker compose up` e, copiado para a VPS,
# publicaria a porta do banco.
services:
  db:
    image: pgvector/pgvector:pg17
    container_name: face-tracking-db-dev
    environment:
      POSTGRES_USER: foco
      POSTGRES_PASSWORD: foco
      POSTGRES_DB: foco
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - pgdev:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U foco -d foco"]
      interval: 2s
      timeout: 3s
      retries: 15

volumes:
  pgdev:
```

- [ ] **Step 8: Criar o `Makefile` na raiz**

```makefile
# Atalhos de desenvolvimento. Tudo do backend roda dentro de backend/.
B := cd backend &&

.PHONY: db migrate migration api worker test lint fmt

db:        ## Postgres de dev em 127.0.0.1:5432
	docker compose -f docker-compose.dev.yml up -d --wait db

migrate:   ## aplica as migrações pendentes
	$(B) uv run alembic upgrade head

migration: ## nova migração autogerada: make migration m="adiciona coluna x"
	$(B) uv run alembic revision --autogenerate -m "$(m)"

api:       ## API com reload em http://127.0.0.1:8000
	$(B) uv run uvicorn --factory foco.main:create_app --reload --reload-dir src

worker:    ## worker de indexação (Procrastinate)
	$(B) uv run procrastinate --app=foco.worker.app worker --concurrency=1

test:
	$(B) uv run pytest -q

lint:
	$(B) uv run ruff check . && uv run ruff format --check .

fmt:
	$(B) uv run ruff check --fix . && uv run ruff format .
```

- [ ] **Step 9: Acrescentar ao `.gitignore`**

Adicionar ao final:

```
# ferramentas do backend
.pytest_cache/
.ruff_cache/
```

(`backend/.venv/` e `__pycache__/` já são cobertos pelos padrões `.venv/` e `__pycache__/`.)

- [ ] **Step 10: Commit**

```bash
git add backend/pyproject.toml backend/uv.lock backend/src backend/tests Makefile docker-compose.dev.yml .gitignore
git commit -m "ref(backend): Add foco package skeleton with settings

Start the new backend under backend/ next to the current one, with uv,
ruff, pytest and a dev compose that only runs Postgres.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Banco, sessão, Alembic e base dos testes

**Files:**
- Create: `backend/src/foco/core/db.py`, `backend/src/foco/models.py`, `backend/alembic.ini`, `backend/migrations/env.py`, `backend/migrations/script.py.mako`, `backend/migrations/versions/.gitkeep`, `backend/tests/conftest.py`, `backend/tests/test_db.py`

- [ ] **Step 1: Subir o Postgres de dev**

Run: `make db`
Expected: `Container face-tracking-db-dev Healthy`

- [ ] **Step 2: Escrever `backend/tests/conftest.py` (base)**

```python
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
```

- [ ] **Step 3: Escrever `backend/tests/test_db.py`**

```python
from sqlalchemy import text


def test_sessao_conecta(session):
    assert session.execute(text("SELECT 1")).scalar() == 1


def test_commit_do_teste_nao_vaza_parte1(session):
    session.execute(text("CREATE TABLE tmp_isolamento (x int)"))
    session.commit()  # só libera o SAVEPOINT


def test_commit_do_teste_nao_vaza_parte2(session):
    assert session.execute(text("SELECT to_regclass('tmp_isolamento')")).scalar() is None
```

- [ ] **Step 4: Ver o teste falhar**

Run: `cd backend && uv run pytest tests/test_db.py -q`
Expected: ERROR no fixture `engine`, porque `alembic.ini` não existe (`CommandError` / "No 'script_location' key found").

- [ ] **Step 5: Implementar `backend/src/foco/core/db.py`**

```python
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
    pass


class Timestamps:
    """created_at/updated_at em timestamptz. updated_at muda a cada UPDATE feito pelo ORM."""

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
```

- [ ] **Step 6: Criar `backend/src/foco/models.py`**

```python
"""Importa todos os modelos para registrá-los no Base.metadata (Alembic e testes).

Módulo novo com tabelas = uma linha nova aqui.
"""
```

- [ ] **Step 7: Criar `backend/alembic.ini`**

```ini
[alembic]
script_location = %(here)s/migrations
file_template = %%(rev)s_%%(slug)s
```

- [ ] **Step 8: Criar `backend/migrations/env.py`**

```python
"""Alembic: a URL vem das Settings (DATABASE_URL), não do alembic.ini."""

from alembic import context
from sqlalchemy import create_engine

import foco.models  # noqa: F401  registra todos os modelos
from foco.core.config import get_settings
from foco.core.db import Base


def include_name(name, type_, parent_names):
    # As tabelas do Procrastinate vêm do schema dele (0002), não dos nossos
    # modelos: sem isto o autogenerate proporia apagá-las.
    return not (type_ == "table" and name and name.startswith("procrastinate_"))


def run_migrations_online() -> None:
    engine = create_engine(get_settings().database_url)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=Base.metadata, include_name=include_name)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


run_migrations_online()
```

- [ ] **Step 9: Criar `backend/migrations/script.py.mako`**

```mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
"""

import sqlalchemy as sa
from alembic import op
${imports if imports else ""}

revision = ${repr(up_revision)}
down_revision = ${repr(down_revision)}
branch_labels = ${repr(branch_labels)}
depends_on = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
```

E um `backend/migrations/versions/.gitkeep` vazio.

- [ ] **Step 10: Rodar os testes**

Run: `cd backend && uv run pytest tests/test_db.py -q`
Expected: `3 passed`

- [ ] **Step 11: Commit**

```bash
git add backend/src/foco/core/db.py backend/src/foco/models.py backend/alembic.ini backend/migrations backend/tests/conftest.py backend/tests/test_db.py
git commit -m "ref(backend): Add database session, Alembic and test harness

Tests run against a real Postgres, recreated per session and isolated per
test with a rolled back outer transaction.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Modelos e migração inicial

**Files:**
- Create: `backend/src/foco/modules/__init__.py`, `backend/src/foco/modules/{events,photos,features}/__init__.py`, `backend/src/foco/modules/events/models.py`, `backend/src/foco/modules/photos/models.py`, `backend/src/foco/modules/features/models.py`, `backend/migrations/versions/0001_initial.py`, `backend/tests/test_migrations.py`, `backend/tests/factories.py`
- Modify: `backend/src/foco/models.py`

- [ ] **Step 1: Escrever `backend/tests/factories.py`**

```python
"""Atalhos para criar dados de teste direto pelo ORM (sem passar pela API)."""

import uuid

import numpy as np

from foco.modules.events.models import Event
from foco.modules.photos.models import EMBEDDING_DIM, Face, Photo


def unit(i: int) -> np.ndarray:
    """Vetor de norma 1 no eixo i. unit(a)·unit(b) = 1 se a == b, senão 0."""
    v = np.zeros(EMBEDDING_DIM, dtype=np.float32)
    v[i] = 1.0
    return v


def make_event(session, name: str = "Teste", **kw) -> Event:
    ev = Event(name=name, **kw)
    session.add(ev)
    session.flush()
    return ev


def make_photo(session, event: Event, *, faces=(), status: str = "done", sha: str | None = None,
               width: int = 100, height: int = 100) -> Photo:
    """faces: [((x1, y1, x2, y2), embedding, det_score), ...]"""
    sha = sha or uuid.uuid4().hex * 2
    p = Photo(event_id=event.id, sha256=sha, filename=f"{sha[:8]}.jpg",
              storage_key=f"photos/{event.id}/{sha}.jpg", width=width, height=height,
              status=status, n_faces=len(faces))
    session.add(p)
    session.flush()
    for (x1, y1, x2, y2), emb, score in faces:
        session.add(Face(photo_id=p.id, event_id=event.id, x1=x1, y1=y1, x2=x2, y2=y2,
                         det_score=score, embedding=emb))
    session.flush()
    return p
```

- [ ] **Step 2: Escrever `backend/tests/test_migrations.py`**

```python
from alembic import command
from sqlalchemy import delete, func, select, text

from factories import make_event, make_photo, unit
from foco.modules.events.models import Event
from foco.modules.photos.models import Face, Photo


def test_extensao_e_tabelas(session):
    tables = set(session.scalars(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")))
    assert {"events", "photos", "faces", "feature_flags"} <= tables
    assert session.scalar(text("SELECT 1 FROM pg_extension WHERE extname = 'vector'")) == 1


def test_modelos_batem_com_as_migracoes(engine, alembic_cfg):
    # Levanta AutogenerateDiffsDetected se um modelo mudou sem migração.
    command.check(alembic_cfg)


def test_id_de_evento_nunca_e_reusado(session):
    a = make_event(session, "A")
    session.execute(delete(Event).where(Event.id == a.id))
    b = make_event(session, "B")
    assert b.id > a.id


def test_excluir_evento_apaga_fotos_e_rostos(session):
    ev = make_event(session)
    make_photo(session, ev, faces=[((0, 0, 10, 10), unit(0), 0.9)])
    session.execute(delete(Event).where(Event.id == ev.id))
    assert session.scalar(select(func.count()).select_from(Photo)) == 0
    assert session.scalar(select(func.count()).select_from(Face)) == 0
```

- [ ] **Step 3: Ver falhar**

Run: `cd backend && uv run pytest tests/test_migrations.py -q`
Expected: FAIL com `ModuleNotFoundError: No module named 'foco.modules'`

- [ ] **Step 4: Criar os pacotes**

Arquivos vazios: `backend/src/foco/modules/__init__.py`, `backend/src/foco/modules/events/__init__.py`, `backend/src/foco/modules/photos/__init__.py`, `backend/src/foco/modules/features/__init__.py`.

- [ ] **Step 5: `backend/src/foco/modules/events/models.py`**

```python
import datetime as dt

from sqlalchemy import BigInteger, Date, Identity, Text
from sqlalchemy.orm import Mapped, mapped_column

from foco.core.db import Base, Timestamps


class Event(Timestamps, Base):
    __tablename__ = "events"

    # IDENTITY nunca reusa o id de um evento excluído: um link antigo de
    # galeria (#galeria?e=4) não pode passar a abrir o evento de outra pessoa.
    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    event_date: Mapped[dt.date | None] = mapped_column(Date)    # quando o evento aconteceu
    location: Mapped[str | None] = mapped_column(Text)          # cidade / lugar, livre
```

- [ ] **Step 6: `backend/src/foco/modules/photos/models.py`**

```python
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

EMBEDDING_DIM = 512   # tamanho do embedding do ArcFace (w600k_r50)
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
    sha256: Mapped[str] = mapped_column(Text)              # hash do CONTEÚDO (dedupe)
    filename: Mapped[str] = mapped_column(Text)            # nome original enviado
    storage_key: Mapped[str] = mapped_column(Text)         # original no Storage (ver keys.py)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(Text)              # queued | processing | done | error
    n_faces: Mapped[int] = mapped_column(Integer, server_default="0", default=0)
    proc_ms: Mapped[float | None] = mapped_column(REAL)    # tempo gasto indexando
    error: Mapped[str | None] = mapped_column(Text)


class Face(Base):
    __tablename__ = "faces"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    photo_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("photos.id", ondelete="CASCADE"), index=True
    )
    event_id: Mapped[int] = mapped_column(BigInteger, index=True)   # desnormalizado: filtro da busca
    x1: Mapped[float] = mapped_column(REAL)                          # bbox em px da foto ORIGINAL
    y1: Mapped[float] = mapped_column(REAL)
    x2: Mapped[float] = mapped_column(REAL)
    y2: Mapped[float] = mapped_column(REAL)
    det_score: Mapped[float | None] = mapped_column(REAL)
    embedding: Mapped[np.ndarray] = mapped_column(Vector(EMBEDDING_DIM))   # norma 1
```

- [ ] **Step 7: `backend/src/foco/modules/features/models.py`**

```python
import datetime as dt

from sqlalchemy import Boolean, DateTime, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from foco.core.db import Base


class FeatureFlag(Base):
    """Override do backoffice. O padrão de cada flag fica no código (registry.py):
    a linha só existe quando o admin muda alguma coisa."""

    __tablename__ = "feature_flags"

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
```

- [ ] **Step 8: Registrar em `backend/src/foco/models.py`**

Acrescentar abaixo da docstring:

```python
from foco.modules.events.models import Event  # noqa: F401
from foco.modules.features.models import FeatureFlag  # noqa: F401
from foco.modules.photos.models import Face, Photo  # noqa: F401
```

- [ ] **Step 9: `backend/migrations/versions/0001_initial.py`**

```python
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
        sa.Column("event_id", sa.BigInteger(), sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False),
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
        sa.Column("photo_id", sa.BigInteger(), sa.ForeignKey("photos.id", ondelete="CASCADE"), nullable=False),
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
```

- [ ] **Step 10: Rodar os testes**

Run: `cd backend && uv run pytest tests/test_migrations.py tests/test_db.py -q`
Expected: `7 passed`. Se o `test_modelos_batem_com_as_migracoes` acusar diferença, a mensagem diz qual coluna/índice: corrija o modelo ou a migração até os dois baterem. Não desligue o teste.

- [ ] **Step 11: Commit**

```bash
git add backend/src/foco/modules backend/src/foco/models.py backend/migrations/versions/0001_initial.py backend/tests/factories.py backend/tests/test_migrations.py
git commit -m "ref(backend): Add models and initial migration with pgvector

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Erros de negócio e tokens assinados

**Files:**
- Create: `backend/src/foco/core/errors.py`, `backend/src/foco/core/signing.py`, `backend/tests/test_signing.py`

- [ ] **Step 1: Escrever `backend/tests/test_signing.py`**

```python
from foco.core import signing

KEY = "k" * 40
NOW = 1_800_000_000


def tok(payload=b"abc", purpose="p", key=KEY, ttl=60, now=NOW):
    return signing.sign(payload, purpose=purpose, key=key, ttl=ttl, now=now)


def test_valido_devolve_payload():
    assert signing.verify(tok(), purpose="p", key=KEY, now=NOW) == b"abc"


def test_payload_vazio():
    assert signing.verify(tok(b""), purpose="p", key=KEY, now=NOW) == b""


def test_expirado():
    assert signing.verify(tok(ttl=60), purpose="p", key=KEY, now=NOW + 60) is None


def test_outra_finalidade_nao_vale():
    assert signing.verify(tok(purpose="search"), purpose="admin", key=KEY, now=NOW) is None


def test_outra_chave_nao_vale():
    assert signing.verify(tok(), purpose="p", key="z" * 40, now=NOW) is None


def test_corpo_adulterado():
    body, mac = tok().split(".")
    other_body = tok(b"abd").split(".")[0]      # mesmo prazo, payload diferente
    assert signing.verify(f"{other_body}.{mac}", purpose="p", key=KEY, now=NOW) is None


def test_formatos_invalidos():
    for bad in [None, "", "abc", "a.b.c", ".", "ção.ção", "!!!.???", "A" * 5000 + ".B"]:
        assert signing.verify(bad, purpose="p", key=KEY, now=NOW) is None, bad
```

- [ ] **Step 2: Ver falhar**

Run: `cd backend && uv run pytest tests/test_signing.py -q`
Expected: FAIL com `ImportError: cannot import name 'signing'`

- [ ] **Step 3: Implementar `backend/src/foco/core/signing.py`**

```python
"""
signing.py — tokens assinados (HMAC-SHA256) com prazo de validade, sem estado.

Formato: base64url(expira_unix 8 bytes || payload) + "." + base64url(hmac)

`purpose` entra no HMAC: um token emitido para uma finalidade (ex.: busca por
selfie) não vale em outra (ex.: sessão do admin), mesmo com a mesma chave.
"""

import base64
import hashlib
import hmac
import time

MAX_TOKEN_LEN = 4096   # o token da selfie tem ~1,4 KB


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _mac(key: str, purpose: str, body: bytes) -> bytes:
    return hmac.new(key.encode(), purpose.encode() + b"\0" + body, hashlib.sha256).digest()


def sign(payload: bytes, *, purpose: str, key: str, ttl: int, now: float | None = None) -> str:
    expires = int(time.time() if now is None else now) + ttl
    body = expires.to_bytes(8, "big") + payload
    return f"{_b64(body)}.{_b64(_mac(key, purpose, body))}"


def verify(token: str | None, *, purpose: str, key: str, now: float | None = None) -> bytes | None:
    """Payload se o token é autêntico e está no prazo. Qualquer outra coisa: None."""
    if not token or len(token) > MAX_TOKEN_LEN or token.count(".") != 1:
        return None
    body_b64, mac_b64 = token.split(".")
    try:
        body, mac = _unb64(body_b64), _unb64(mac_b64)
    except ValueError:   # base64 inválido ou caractere não-ASCII
        return None
    # compare_digest: tempo constante, não revela quantos bytes acertou
    if len(body) < 8 or not hmac.compare_digest(mac, _mac(key, purpose, body)):
        return None
    if int.from_bytes(body[:8], "big") <= (time.time() if now is None else now):
        return None
    return body[8:]
```

- [ ] **Step 4: Implementar `backend/src/foco/core/errors.py`**

```python
"""
errors.py — erros de negócio. Services levantam estes; o handler vira HTTP.

O corpo é {"detail": "..."}, o mesmo formato do HTTPException do FastAPI,
que o frontend já lê.
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class AppError(Exception):
    status_code = 400

    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


class Invalid(AppError):
    status_code = 400


class Unauthorized(AppError):
    status_code = 401


class NotFound(AppError):
    status_code = 404


class Gone(AppError):
    status_code = 410


class Unprocessable(AppError):
    status_code = 422


def install_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
```

- [ ] **Step 5: Rodar os testes**

Run: `cd backend && uv run pytest tests/test_signing.py -q`
Expected: `7 passed`

- [ ] **Step 6: Commit**

```bash
git add backend/src/foco/core/errors.py backend/src/foco/core/signing.py backend/tests/test_signing.py
git commit -m "ref(backend): Add signed tokens and domain errors

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Storage local

**Files:**
- Create: `backend/src/foco/core/storage.py`, `backend/tests/test_storage.py`

- [ ] **Step 1: Escrever `backend/tests/test_storage.py`**

```python
import pytest

from foco.core.storage import LocalStorage


@pytest.fixture
def st(tmp_path):
    return LocalStorage(tmp_path)


def test_salva_e_le(st):
    st.save("photos/1/a.jpg", b"123")
    assert st.exists("photos/1/a.jpg")
    assert st.read("photos/1/a.jpg") == b"123"


def test_sobrescreve_sem_deixar_tmp(st, tmp_path):
    st.save("thumbs/x.jpg", b"1")
    st.save("thumbs/x.jpg", b"2")
    assert st.read("thumbs/x.jpg") == b"2"
    assert [p.name for p in (tmp_path / "thumbs").iterdir()] == ["x.jpg"]


def test_apagar_inexistente_nao_falha(st):
    st.delete("nao/existe.jpg")
    assert not st.exists("nao/existe.jpg")


def test_delete_dir(st):
    st.save("photos/7/a.jpg", b"1")
    st.delete_dir("photos/7")
    assert not st.exists("photos/7/a.jpg")
    st.delete_dir("photos/7")   # de novo: não falha


def test_chave_fora_da_raiz_recusada(st):
    with pytest.raises(ValueError):
        st.path("../fora.txt")
    with pytest.raises(ValueError):
        st.save("/etc/passwd", b"x")
```

- [ ] **Step 2: Ver falhar**

Run: `cd backend && uv run pytest tests/test_storage.py -q`
Expected: FAIL com `ModuleNotFoundError: No module named 'foco.core.storage'`

- [ ] **Step 3: Implementar `backend/src/foco/core/storage.py`**

```python
"""
storage.py — onde ficam os arquivos (originais, miniaturas, versões médias).

O banco guarda só CHAVES relativas ("photos/4/<sha>.jpg"), nunca caminhos
absolutos: trocar o LocalStorage por um S3 um dia não exige migrar dados.
"""

import shutil
import uuid
from pathlib import Path
from typing import Protocol

from fastapi import Depends

from foco.core.config import Settings, get_settings


class Storage(Protocol):
    def save(self, key: str, data: bytes) -> None: ...
    def read(self, key: str) -> bytes: ...
    def exists(self, key: str) -> bool: ...
    def delete(self, key: str) -> None: ...
    def delete_dir(self, prefix: str) -> None: ...
    def path(self, key: str) -> Path: ...   # para FileResponse (só faz sentido no disco local)


class LocalStorage:
    def __init__(self, root: Path):
        self.root = Path(root).resolve()

    def path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if not p.is_relative_to(self.root):
            raise ValueError(f"chave fora do storage: {key!r}")
        return p

    def save(self, key: str, data: bytes) -> None:
        p = self.path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        # troca atômica: dois pedidos ao mesmo tempo nunca deixam arquivo pela metade
        tmp = p.with_name(f"{p.name}.{uuid.uuid4().hex}.tmp")
        tmp.write_bytes(data)
        tmp.replace(p)

    def read(self, key: str) -> bytes:
        return self.path(key).read_bytes()

    def exists(self, key: str) -> bool:
        return self.path(key).exists()

    def delete(self, key: str) -> None:
        self.path(key).unlink(missing_ok=True)

    def delete_dir(self, prefix: str) -> None:
        shutil.rmtree(self.path(prefix), ignore_errors=True)


def get_storage(settings: Settings = Depends(get_settings)) -> Storage:
    return LocalStorage(settings.data_dir)
```

- [ ] **Step 4: Rodar os testes**

Run: `cd backend && uv run pytest tests/test_storage.py -q`
Expected: `5 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/src/foco/core/storage.py backend/tests/test_storage.py
git commit -m "ref(backend): Add local file storage keyed by relative paths

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Visão (imagens + detector) e detector falso dos testes

**Files:**
- Create: `backend/src/foco/vision/__init__.py`, `backend/src/foco/vision/images.py`, `backend/src/foco/vision/detector.py`, `backend/tests/fakes.py`, `backend/tests/test_vision.py`

- [ ] **Step 1: Escrever `backend/tests/fakes.py`**

```python
"""Detector falso: nada de modelo de 280 MB nos testes.

A "identidade" vem da cor do pixel (0, 0) de uma PNG (sem perda, a cor não muda):
  vermelho r > 0 -> um rosto com embedding unit(r)
  verde    g > 0 -> um segundo rosto, menor, com embedding unit(g)
  azul     b == 255 -> analyze() levanta RuntimeError
"""

import io

from PIL import Image

from factories import unit


def png(r: int = 0, g: int = 0, b: int = 0, size=(64, 48)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (r, g, b)).save(buf, "PNG")
    return buf.getvalue()


class FakeDetector:
    def __init__(self):
        self.calls = 0
        self.on_analyze = None   # callback opcional, roda no meio da análise

    def load(self) -> None:
        pass

    def analyze(self, img):
        self.calls += 1
        if self.on_analyze:
            self.on_analyze()
        r, g, b = img.getpixel((0, 0))
        if b == 255:
            raise RuntimeError("falha simulada")
        faces = []
        if r:
            faces.append({"bbox": [10.0, 10.0, 40.0, 40.0], "det_score": 0.9, "embedding": unit(r)})
        if g:
            faces.append({"bbox": [2.0, 2.0, 8.0, 8.0], "det_score": 0.8, "embedding": unit(g)})
        return faces, {"resize": 0.1, "detection": 1.0, "embedding": 2.0}
```

- [ ] **Step 2: Escrever `backend/tests/test_vision.py`**

```python
import io

import pytest
from PIL import Image

from fakes import png
from foco.vision.images import load_image, make_thumbnail


def test_load_image_converte_para_rgb():
    buf = io.BytesIO()
    Image.new("L", (10, 10), 128).save(buf, "PNG")
    assert load_image(buf.getvalue()).mode == "RGB"


def test_load_image_bytes_invalidos():
    with pytest.raises(OSError):
        load_image(b"isto nao e imagem")


def test_make_thumbnail_limita_lado_maior():
    img = load_image(png(size=(1000, 500)))
    thumb = Image.open(io.BytesIO(make_thumbnail(img)))
    assert thumb.format == "JPEG"
    assert max(thumb.size) == 400


@pytest.mark.slow
def test_modelo_real_sem_rosto():
    from foco.vision.detector import InsightFaceDetector

    faces, timings = InsightFaceDetector("~/.insightface").analyze(load_image(png(size=(320, 240))))
    assert faces == []
    assert {"resize", "detection", "embedding"} <= timings.keys()
```

- [ ] **Step 3: Ver falhar**

Run: `cd backend && uv run pytest tests/test_vision.py -q`
Expected: FAIL com `ModuleNotFoundError: No module named 'foco.vision'`

- [ ] **Step 4: Criar `backend/src/foco/vision/__init__.py`**

```python
"""Tudo que "olha para a imagem". Sem estado, sem banco: imagem entra, rostos saem.

Se um dia a indexação precisar de GPU, este pacote vira um serviço HTTP de
embeddings e só detector.py muda.
"""
```

- [ ] **Step 5: Criar `backend/src/foco/vision/images.py`**

Mover `load_image` e `make_thumbnail` do `detector.py` da raiz (linhas 83-106), sem mudar a lógica:

```python
"""Carregar e reduzir imagens (Pillow). Não depende do modelo."""

import io

from PIL import Image, ImageOps

THUMB_SIDE = 400


def load_image(data: bytes) -> Image.Image:
    """Abre bytes como imagem RGB, aplicando a rotação EXIF.

    Celulares salvam a foto "deitada" e só marcam no EXIF que ela deve ser
    girada. O navegador respeita essa marca ao exibir; se nós não
    respeitarmos, as bounding boxes ficariam em coordenadas giradas e o
    retângulo apareceria no lugar errado na galeria.
    """
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img)
    return img.convert("RGB")


def make_thumbnail(img: Image.Image, side: int = THUMB_SIDE, quality: int = 82) -> bytes:
    """JPEG reduzido: miniatura (400px) para a galeria carregar rápido, ou
    tamanho médio (1600px) para capa e visualizador, sem baixar o original."""
    t = img.copy()
    t.thumbnail((side, side), Image.LANCZOS)
    buf = io.BytesIO()
    t.save(buf, "JPEG", quality=quality)
    return buf.getvalue()
```

- [ ] **Step 6: Criar `backend/src/foco/vision/detector.py`**

Copiar a docstring do topo do `detector.py` da raiz (linhas 1-31, pipeline SCRFD → alinhamento → ArcFace → L2) e as constantes (`MAX_SIDE`, `DET_SIZE`, `DET_THRESH`, `MIN_FACE_PX`, com os comentários). O resto vira uma classe:

```python
# (docstring do pipeline copiada do detector.py antigo, linhas 1-31)

import threading
import time
from functools import lru_cache
from typing import Protocol

import numpy as np
from PIL import Image

from foco.core.config import get_settings

# (MAX_SIDE, DET_SIZE, DET_THRESH, MIN_FACE_PX com os comentários do detector.py antigo)
MAX_SIDE = 1280
DET_SIZE = (640, 640)
DET_THRESH = 0.5
MIN_FACE_PX = 32


class Detector(Protocol):
    def load(self) -> None: ...

    def analyze(self, img: Image.Image) -> tuple[list[dict], dict[str, float]]:
        """(faces, timings_ms). Cada face: {"bbox": [x1,y1,x2,y2] em px da ORIGINAL,
        "det_score": float, "embedding": np.ndarray float32 (512,), norma 1}."""
        ...


def _resize_for_detection(img: Image.Image):
    """Reduz para MAX_SIDE e devolve (array BGR, fator de escala).

    scale = tamanho_original / tamanho_reduzido. Multiplicar uma bbox
    detectada na imagem reduzida por `scale` a leva de volta para as
    coordenadas da foto original.
    """
    w, h = img.size
    scale = max(w, h) / MAX_SIDE if max(w, h) > MAX_SIDE else 1.0
    if scale > 1.0:
        img = img.resize((round(w / scale), round(h / scale)), Image.LANCZOS)
    # InsightFace/OpenCV esperam BGR (ordem de canais invertida em relação ao RGB)
    bgr = np.asarray(img)[:, :, ::-1].copy()
    return bgr, scale


class InsightFaceDetector:
    """buffalo_l carregado uma vez por processo (demora ~2 s e ocupa ~300 MB)."""

    def __init__(self, root: str):
        self._root = root
        self._app = None
        # Duas selfies ao mesmo tempo na API: o onnxruntime aguenta, mas o
        # código Python do InsightFace em volta mantém caches internos. O
        # lock deixa tudo previsível (custo: uma espera de <1 s).
        self._lock = threading.Lock()

    def load(self) -> None:
        with self._lock:
            self._model()

    def _model(self):
        if self._app is None:
            from insightface.app import FaceAnalysis

            # Só detecção + reconhecimento: o buffalo_l também traz idade/gênero/
            # landmarks 3D, que só gastariam CPU.
            self._app = FaceAnalysis(
                name="buffalo_l",
                root=self._root,
                allowed_modules=["detection", "recognition"],
                providers=["CPUExecutionProvider"],
            )
            self._app.prepare(ctx_id=-1, det_thresh=DET_THRESH, det_size=DET_SIZE)   # -1 = CPU
        return self._app

    def analyze(self, img: Image.Image) -> tuple[list[dict], dict[str, float]]:
        with self._lock:
            return self._analyze(img)

    def _analyze(self, img: Image.Image):
        from insightface.app.common import Face

        app = self._model()
        timings = {}

        t0 = time.perf_counter()
        bgr, scale = _resize_for_detection(img)
        timings["resize"] = (time.perf_counter() - t0) * 1000

        # Etapa 1: detecção (bboxes + 5 landmarks por rosto)
        t0 = time.perf_counter()
        bboxes, kpss = app.det_model.detect(bgr, max_num=0, metric="default")
        timings["detection"] = (time.perf_counter() - t0) * 1000

        # Etapas 2-4: alinhamento + embedding + normalização, rosto a rosto
        t0 = time.perf_counter()
        rec = app.models["recognition"]
        faces = []
        for i in range(bboxes.shape[0]):
            x1, y1, x2, y2, score = bboxes[i]
            if min(x2 - x1, y2 - y1) < MIN_FACE_PX:
                continue
            face = Face(bbox=bboxes[i, :4], kps=kpss[i], det_score=score)
            emb = rec.get(bgr, face)          # alinha pelos landmarks e roda o ArcFace
            emb = emb / np.linalg.norm(emb)   # normalização L2 -> cosseno = produto interno
            faces.append({
                "bbox": [float(v * scale) for v in (x1, y1, x2, y2)],   # coordenadas da original
                "det_score": float(score),
                "embedding": emb.astype(np.float32),
            })
        timings["embedding"] = (time.perf_counter() - t0) * 1000
        return faces, timings


@lru_cache
def get_detector() -> Detector:
    """Um detector por processo (API e worker têm cada um o seu)."""
    return InsightFaceDetector(get_settings().insightface_root)
```

- [ ] **Step 7: Rodar os testes**

Run: `cd backend && uv run pytest tests/test_vision.py -q`
Expected: `3 passed, 1 deselected`

Run (opcional, carrega o modelo real): `cd backend && uv run pytest tests/test_vision.py -m slow -q`
Expected: `1 passed`

- [ ] **Step 8: Commit**

```bash
git add backend/src/foco/vision backend/tests/fakes.py backend/tests/test_vision.py
git commit -m "ref(backend): Move face detection into foco.vision

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: App do Procrastinate e schema da fila

**Files:**
- Create: `backend/src/foco/worker.py`, `backend/migrations/versions/0002_procrastinate.py`
- Modify: `backend/tests/test_migrations.py`, `backend/tests/conftest.py`

- [ ] **Step 1: Acrescentar o teste em `backend/tests/test_migrations.py`**

```python
def test_schema_do_procrastinate(session):
    assert session.scalar(text("SELECT to_regclass('procrastinate_jobs')")) is not None
```

- [ ] **Step 2: Ver falhar**

Run: `cd backend && uv run pytest tests/test_migrations.py::test_schema_do_procrastinate -q`
Expected: FAIL (`assert None is not None`)

- [ ] **Step 3: Criar `backend/src/foco/worker.py`**

```python
"""
worker.py — fila de tarefas em background (Procrastinate, sobre o próprio Postgres).

Rodar:  procrastinate --app=foco.worker.app worker --concurrency=1

Por que um processo separado?
  Indexar uma foto em CPU leva ~0.3-4 s. O upload só SALVA o arquivo e
  enfileira; o worker consome a fila, uma foto por vez, e o navegador
  acompanha pelo SSE de progresso (que lê o status no banco). A fila fica no
  Postgres: reiniciar qualquer processo não perde nada.

concurrency=1: indexar é CPU pura e o onnxruntime já usa várias threads.
"""

import procrastinate

from foco.core.config import get_settings

app = procrastinate.App(
    connector=procrastinate.PsycopgConnector(conninfo=get_settings().pg_conninfo),
    import_paths=["foco.modules.photos.tasks"],
)
```

- [ ] **Step 4: Criar `backend/migrations/versions/0002_procrastinate.py`**

```python
"""schema do Procrastinate (fila de tarefas)

Aplica o SQL que a própria lib fornece. Ao atualizar a versão do
Procrastinate, crie uma revisão nova aplicando os arquivos de
procrastinate/sql/migrations/ entre a versão antiga e a nova.

Revision ID: 0002
Revises: 0001
"""

from alembic import op
from procrastinate.schema import SchemaManager

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # psycopg puro (driver_connection): o script tem várias instruções e funções
    # plpgsql; pelo SQLAlchemy ele passaria pelo parser de parâmetros.
    op.get_bind().connection.driver_connection.execute(SchemaManager.get_schema())


def downgrade() -> None:
    raise NotImplementedError("remover o schema do Procrastinate apaga a fila: faça à mão se precisar")
```

- [ ] **Step 5: Acrescentar a fixture `jobs` em `backend/tests/conftest.py`**

No fim do arquivo:

```python
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
```

- [ ] **Step 6: Rodar os testes**

Run: `cd backend && uv run pytest tests/test_migrations.py -q`
Expected: `5 passed`

- [ ] **Step 7: Commit**

```bash
git add backend/src/foco/worker.py backend/migrations/versions/0002_procrastinate.py backend/tests/test_migrations.py backend/tests/conftest.py
git commit -m "ref(backend): Add Procrastinate app and queue schema

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Indexação de fotos (index_photo)

**Files:**
- Create: `backend/src/foco/modules/photos/keys.py`, `backend/src/foco/modules/photos/indexing.py`, `backend/src/foco/modules/photos/tasks.py`, `backend/tests/test_indexing.py`

- [ ] **Step 1: Escrever `backend/tests/test_indexing.py`**

```python
import pytest
from sqlalchemy import delete, func, select

from conftest import deferred
from factories import make_event, make_photo
from fakes import FakeDetector, png
from foco.core.storage import LocalStorage
from foco.modules.events.models import Event
from foco.modules.photos import indexing, tasks
from foco.modules.photos.models import Face, Photo


@pytest.fixture
def storage(tmp_path):
    return LocalStorage(tmp_path)


@pytest.fixture
def det():
    return FakeDetector()


def queued_photo(session, storage, data):
    ev = make_event(session)
    p = make_photo(session, ev, status="queued")
    storage.save(p.storage_key, data)
    session.commit()
    return p


def n_faces(session, photo_id):
    return session.scalar(select(func.count()).select_from(Face).where(Face.photo_id == photo_id))


def test_indexa(session, storage, det):
    p = queued_photo(session, storage, png(r=3, g=5))
    indexing.index_photo(session, storage, det, p.id)
    session.refresh(p)
    assert (p.status, p.n_faces, p.error) == ("done", 2, None)
    assert p.proc_ms is not None
    assert n_faces(session, p.id) == 2


def test_rodar_duas_vezes_nao_duplica(session, storage, det):
    p = queued_photo(session, storage, png(r=3))
    indexing.index_photo(session, storage, det, p.id)
    indexing.index_photo(session, storage, det, p.id)
    assert n_faces(session, p.id) == 1


def test_foto_sem_rosto(session, storage, det):
    p = queued_photo(session, storage, png())
    indexing.index_photo(session, storage, det, p.id)
    session.refresh(p)
    assert (p.status, p.n_faces) == ("done", 0)


def test_foto_inexistente_nao_falha(session, storage, det):
    indexing.index_photo(session, storage, det, 999_999)
    assert det.calls == 0


def test_arquivo_corrompido_vira_erro_sem_retry(session, storage, det):
    p = queued_photo(session, storage, b"nao e imagem")
    indexing.index_photo(session, storage, det, p.id, final_attempt=False)
    session.refresh(p)
    assert p.status == "error" and p.error


def test_falha_do_detector_tenta_de_novo(session, storage, det):
    p = queued_photo(session, storage, png(b=255))
    with pytest.raises(RuntimeError):
        indexing.index_photo(session, storage, det, p.id, final_attempt=False)
    session.refresh(p)
    assert p.status == "processing"


def test_falha_na_ultima_tentativa_vira_erro(session, storage, det):
    p = queued_photo(session, storage, png(b=255))
    indexing.index_photo(session, storage, det, p.id, final_attempt=True)
    session.refresh(p)
    assert (p.status, p.error) == ("error", "falha simulada")


def test_evento_excluido_no_meio(session, storage, det):
    p = queued_photo(session, storage, png(r=3))

    def excluir_evento():
        session.execute(delete(Event).where(Event.id == p.event_id))
        session.commit()

    det.on_analyze = excluir_evento
    indexing.index_photo(session, storage, det, p.id)   # não levanta
    assert session.get(Photo, p.id) is None
    assert n_faces(session, p.id) == 0


def test_defer_index_nao_duplica_na_fila(jobs):
    tasks.defer_index(5)
    tasks.defer_index(5)
    assert deferred(jobs, "index_photo") == [{"photo_id": 5}]
```

- [ ] **Step 2: Ver falhar**

Run: `cd backend && uv run pytest tests/test_indexing.py -q`
Expected: FAIL com `ImportError: cannot import name 'indexing'`

- [ ] **Step 3: Criar `backend/src/foco/modules/photos/keys.py`**

```python
"""Chaves dos arquivos no Storage. Miniatura e versão média são nomeadas pelo
hash do conteúdo: a mesma foto em dois eventos compartilha os arquivos."""

from pathlib import Path

EXTS = (".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff")


def original_key(event_id: int, sha256: str, filename: str | None) -> str:
    ext = Path(filename or "").suffix.lower()
    return f"photos/{event_id}/{sha256}{ext if ext in EXTS else '.jpg'}"


def thumb_key(sha256: str) -> str:
    return f"thumbs/{sha256}.jpg"


def medium_key(sha256: str) -> str:
    return f"medium/{sha256}.jpg"
```

- [ ] **Step 4: Criar `backend/src/foco/modules/photos/indexing.py`**

```python
"""
indexing.py — o trabalho pesado do worker. Recebe Session/Storage/Detector
prontos (as tarefas em tasks.py montam), então os testes chamam direto.
"""

import time

from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from foco.core.storage import Storage
from foco.modules.photos.models import Face, Photo
from foco.vision.detector import Detector
from foco.vision.images import load_image


def _fail(session: Session, photo: Photo, exc: Exception) -> None:
    photo.status, photo.error = "error", str(exc) or type(exc).__name__
    try:
        session.commit()
    except StaleDataError:   # a foto foi excluída enquanto isso
        session.rollback()


def index_photo(session: Session, storage: Storage, detector: Detector, photo_id: int,
                *, final_attempt: bool = True) -> None:
    """Indexa uma foto: detectar rostos -> embeddings -> tabela faces.

    Idempotente: apaga os rostos anteriores da foto antes de inserir, então
    rodar de novo (retry, requeue_stuck) não duplica nada.
    final_attempt=False: uma falha do detector sobe a exceção, para o
    Procrastinate tentar de novo. Na última tentativa, a foto vira "error".
    """
    photo = session.get(Photo, photo_id)
    if photo is None:   # evento excluído enquanto a foto esperava na fila
        return
    photo.status, photo.error = "processing", None
    session.commit()

    t0 = time.perf_counter()
    try:
        img = load_image(storage.read(photo.storage_key))
    except OSError as e:   # arquivo sumiu ou está corrompido: tentar de novo não resolve
        _fail(session, photo, e)
        return
    try:
        faces, _ = detector.analyze(img)
    except Exception as e:
        if not final_attempt:
            raise
        _fail(session, photo, e)
        return

    try:
        session.execute(delete(Face).where(Face.photo_id == photo_id))
        session.add_all([
            Face(photo_id=photo_id, event_id=photo.event_id, x1=f["bbox"][0], y1=f["bbox"][1],
                 x2=f["bbox"][2], y2=f["bbox"][3], det_score=f["det_score"], embedding=f["embedding"])
            for f in faces
        ])
        photo.status, photo.n_faces = "done", len(faces)
        photo.proc_ms = (time.perf_counter() - t0) * 1000
        session.commit()
    except (IntegrityError, StaleDataError):
        # O evento foi excluído no meio da indexação (CASCADE levou a foto):
        # desfaz tudo, senão sobrariam rostos órfãos.
        session.rollback()
```

- [ ] **Step 5: Criar `backend/src/foco/modules/photos/tasks.py`**

```python
"""
tasks.py — tarefas do worker. Só casca: montam Session/Storage/Detector e
chamam indexing.py, onde está a lógica (e os testes).
"""

from procrastinate import JobContext, RetryStrategy
from procrastinate.exceptions import AlreadyEnqueued

from foco.core.config import get_settings
from foco.core.db import get_sessionmaker
from foco.core.storage import LocalStorage
from foco.modules.photos import indexing
from foco.vision.detector import get_detector
from foco.worker import app

MAX_ATTEMPTS = 3


def _storage() -> LocalStorage:
    return LocalStorage(get_settings().data_dir)


@app.task(name="index_photo", pass_context=True,
          retry=RetryStrategy(max_attempts=MAX_ATTEMPTS, exponential_wait=5))
def index_photo(context: JobContext, photo_id: int) -> None:
    with get_sessionmaker()() as session:
        indexing.index_photo(session, _storage(), get_detector(), photo_id,
                             final_attempt=context.job.attempts >= MAX_ATTEMPTS)


def defer_index(photo_id: int) -> None:
    """Enfileira a indexação. Se a foto já está esperando na fila, fica como está."""
    try:
        index_photo.configure(queueing_lock=f"photo:{photo_id}").defer(photo_id=photo_id)
    except AlreadyEnqueued:
        pass
```

- [ ] **Step 6: Rodar os testes**

Run: `cd backend && uv run pytest tests/test_indexing.py -q`
Expected: `9 passed`

- [ ] **Step 7: Commit**

```bash
git add backend/src/foco/modules/photos/keys.py backend/src/foco/modules/photos/indexing.py backend/src/foco/modules/photos/tasks.py backend/tests/test_indexing.py
git commit -m "ref(backend): Index photos in a Procrastinate task

Indexing is idempotent and retries detector failures, so a restart or a
retry never duplicates faces.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Rede de segurança da fila e limpeza de arquivos

**Files:**
- Modify: `backend/src/foco/modules/photos/indexing.py`, `backend/src/foco/modules/photos/tasks.py`, `backend/tests/test_indexing.py`

- [ ] **Step 1: Acrescentar os testes em `backend/tests/test_indexing.py`**

No topo, junto dos outros imports:

```python
import datetime as dt

from foco.modules.photos.keys import medium_key, thumb_key
```

No fim do arquivo:

```python
def test_stuck_photo_ids(session):
    ev = make_event(session)
    q = make_photo(session, ev, status="queued")
    pr = make_photo(session, ev, status="processing")
    make_photo(session, ev, status="done")
    make_photo(session, ev, status="error")
    session.commit()
    now = dt.datetime.now(dt.UTC)
    assert indexing.stuck_photo_ids(session, now=now) == []            # recém-criadas
    later = now + dt.timedelta(minutes=11)
    assert indexing.stuck_photo_ids(session, now=later) == [q.id, pr.id]


def test_delete_event_files_preserva_miniatura_compartilhada(session, storage):
    a, b = make_event(session, "A"), make_event(session, "B")
    sha_shared, sha_only_a = "a" * 64, "b" * 64
    pa1 = make_photo(session, a, sha=sha_shared)
    pa2 = make_photo(session, a, sha=sha_only_a)
    make_photo(session, b, sha=sha_shared)          # mesma foto no evento B
    for p in (pa1, pa2):
        storage.save(p.storage_key, b"orig")
    for sha in (sha_shared, sha_only_a):
        storage.save(thumb_key(sha), b"t")
        storage.save(medium_key(sha), b"m")
    keys = [pa1.storage_key, pa2.storage_key]
    session.execute(delete(Event).where(Event.id == a.id))
    session.commit()

    indexing.delete_event_files(session, storage, a.id, keys, [sha_shared, sha_only_a])

    assert not storage.exists(pa1.storage_key) and not storage.exists(pa2.storage_key)
    assert storage.exists(thumb_key(sha_shared)) and storage.exists(medium_key(sha_shared))
    assert not storage.exists(thumb_key(sha_only_a)) and not storage.exists(medium_key(sha_only_a))
    assert not storage.path(f"photos/{a.id}").exists()
```

- [ ] **Step 2: Ver falhar**

Run: `cd backend && uv run pytest tests/test_indexing.py -q`
Expected: FAIL com `AttributeError: module 'foco.modules.photos.indexing' has no attribute 'stuck_photo_ids'`

- [ ] **Step 3: Acrescentar em `backend/src/foco/modules/photos/indexing.py`**

Imports no topo (junto dos existentes):

```python
import datetime as dt

from sqlalchemy import delete, select

from foco.modules.photos.keys import medium_key, thumb_key
from foco.modules.photos.models import PENDING, Face, Photo
```

(`delete` e `Face, Photo` já estavam importados: una as linhas.) No fim do arquivo:

```python
STUCK_AFTER = dt.timedelta(minutes=10)


def stuck_photo_ids(session: Session, now: dt.datetime | None = None) -> list[int]:
    """Fotos pendentes paradas há mais de 10 min: o defer falhou depois do
    commit, ou o worker morreu no meio da foto."""
    cutoff = (now or dt.datetime.now(dt.UTC)) - STUCK_AFTER
    return list(session.scalars(
        select(Photo.id).where(Photo.status.in_(PENDING), Photo.updated_at < cutoff).order_by(Photo.id)
    ))


def delete_event_files(session: Session, storage: Storage, event_id: int,
                       keys: list[str], shas: list[str]) -> None:
    """Apaga os arquivos de um evento já excluído do banco.

    Miniatura e versão média são nomeadas pelo hash: só saem se nenhuma outra
    foto (de outro evento) usa o mesmo conteúdo.
    """
    for key in keys:
        storage.delete(key)
    still_used = set(session.scalars(select(Photo.sha256).where(Photo.sha256.in_(shas))))
    for sha in set(shas) - still_used:
        storage.delete(thumb_key(sha))
        storage.delete(medium_key(sha))
    storage.delete_dir(f"photos/{event_id}")
```

- [ ] **Step 4: Acrescentar as tarefas em `backend/src/foco/modules/photos/tasks.py`**

No fim do arquivo:

```python
@app.task(name="delete_event_files")
def delete_event_files(event_id: int, keys: list[str], shas: list[str]) -> None:
    with get_sessionmaker()() as session:
        indexing.delete_event_files(session, _storage(), event_id, keys, shas)


@app.periodic(cron="*/5 * * * *")
@app.task(name="requeue_stuck", queueing_lock="requeue_stuck")
def requeue_stuck(timestamp: int) -> None:
    """Rede de segurança: foto pendente há mais de 10 min volta para a fila."""
    with get_sessionmaker()() as session:
        ids = indexing.stuck_photo_ids(session)
    for photo_id in ids:
        defer_index(photo_id)
```

- [ ] **Step 5: Rodar os testes**

Run: `cd backend && uv run pytest tests/test_indexing.py -q`
Expected: `11 passed`

- [ ] **Step 6: Commit**

```bash
git add backend/src/foco/modules/photos/indexing.py backend/src/foco/modules/photos/tasks.py backend/tests/test_indexing.py
git commit -m "ref(backend): Requeue stuck photos and clean up event files in tasks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Módulo features

**Files:**
- Create: `backend/src/foco/modules/features/registry.py`, `backend/src/foco/modules/features/service.py`, `backend/src/foco/modules/features/router.py`, `backend/tests/test_features.py`

- [ ] **Step 1: Escrever `backend/tests/test_features.py`** (porta do `tests/test_features.py` da raiz)

```python
import pytest

from foco.modules.features import service
from foco.modules.features.models import FeatureFlag


def test_calibracao_desligada_por_padrao(session):
    assert service.is_enabled(session, "calibration") is False


def test_override_liga_e_desliga(session):
    service.set_enabled(session, "calibration", True)
    assert service.is_enabled(session, "calibration") is True
    service.set_enabled(session, "calibration", False)
    assert service.is_enabled(session, "calibration") is False
    assert session.get(FeatureFlag, "calibration").enabled is False


def test_all_flags(session):
    assert service.all_flags(session) == {"calibration": False}
    service.set_enabled(session, "calibration", True)
    assert service.all_flags(session) == {"calibration": True}


def test_describe(session):
    [cal] = service.describe(session)
    assert cal["key"] == "calibration"
    assert cal["label"] == "Calibração"
    assert cal["enabled"] is False
    assert cal["description"]


def test_chave_desconhecida(session):
    with pytest.raises(KeyError):
        service.is_enabled(session, "nao-existe")
    with pytest.raises(KeyError):
        service.set_enabled(session, "nao-existe", True)


def test_linha_orfa_e_ignorada(session):
    session.add(FeatureFlag(key="removida", enabled=True))
    session.flush()
    assert service.all_flags(session) == {"calibration": False}
```

- [ ] **Step 2: Ver falhar**

Run: `cd backend && uv run pytest tests/test_features.py -q`
Expected: FAIL com `ImportError: cannot import name 'service'`

- [ ] **Step 3: Criar `backend/src/foco/modules/features/registry.py`**

```python
"""
registry.py — QUAIS flags existem e o padrão de cada uma.

O banco (tabela feature_flags) guarda só o que o admin mudou. Flag nova = uma
entrada aqui, sem migração. As flags são globais: valem para todos os
eventos e todos os visitantes, inclusive o próprio admin.
"""

FEATURES = {
    "calibration": {
        "label": "Calibração",
        "description": "Top 30 rostos mais parecidos + tempos de cada etapa, para ajustar o corte. "
                       "Mostra rostos de outras pessoas abaixo do corte: deixe desligada em produção.",
        "default": False,
    },
}
```

- [ ] **Step 4: Criar `backend/src/foco/modules/features/service.py`**

```python
from sqlalchemy import select
from sqlalchemy.orm import Session

from foco.modules.features.models import FeatureFlag
from foco.modules.features.registry import FEATURES


def _overrides(session: Session) -> dict[str, bool]:
    return {f.key: f.enabled for f in session.scalars(select(FeatureFlag))}


def is_enabled(session: Session, key: str) -> bool:
    spec = FEATURES[key]   # KeyError de propósito: flag inexistente é bug
    row = session.get(FeatureFlag, key)
    return spec["default"] if row is None else row.enabled


def all_flags(session: Session) -> dict[str, bool]:
    over = _overrides(session)
    return {k: over.get(k, f["default"]) for k, f in FEATURES.items()}


def describe(session: Session) -> list[dict]:
    flags = all_flags(session)
    return [
        {"key": k, "label": f["label"], "description": f["description"], "enabled": flags[k]}
        for k, f in FEATURES.items()
    ]


def set_enabled(session: Session, key: str, enabled: bool) -> None:
    if key not in FEATURES:
        raise KeyError(key)
    session.merge(FeatureFlag(key=key, enabled=enabled))
    session.commit()
```

- [ ] **Step 5: Criar `backend/src/foco/modules/features/router.py`**

```python
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from foco.core.db import get_session
from foco.modules.features import service

router = APIRouter(prefix="/api", tags=["features"])


@router.get("/features")
def get_features(session: Session = Depends(get_session)) -> dict[str, bool]:
    """Público: o frontend decide o que mostrar (a API bloqueia por conta própria)."""
    return service.all_flags(session)
```

- [ ] **Step 6: Rodar os testes**

Run: `cd backend && uv run pytest tests/test_features.py -q`
Expected: `6 passed`

- [ ] **Step 7: Commit**

```bash
git add backend/src/foco/modules/features backend/tests/test_features.py
git commit -m "ref(backend): Move feature flags to a typed table

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Sessão do admin

**Files:**
- Create: `backend/src/foco/modules/admin/__init__.py`, `backend/src/foco/modules/admin/auth.py`, `backend/tests/test_admin_auth.py`

- [ ] **Step 1: Escrever `backend/tests/test_admin_auth.py`**

```python
from conftest import SECRET, TEST_DATABASE_URL
from foco.core.config import Settings
from foco.modules.admin import auth

NOW = 1_800_000_000


def cfg(pw="segredo-forte", secret=SECRET):
    return Settings(database_url=TEST_DATABASE_URL, secret_key=secret, admin_password=pw, _env_file=None)


def test_cookie_valido():
    assert auth.verify(auth.issue(cfg(), now=NOW), cfg(), now=NOW)


def test_cookie_expirado():
    assert not auth.verify(auth.issue(cfg(), now=NOW), cfg(), now=NOW + auth.TTL)


def test_senha_trocada_derruba_sessoes():
    assert not auth.verify(auth.issue(cfg(), now=NOW), cfg(pw="outra-senha"), now=NOW)


def test_secret_key_trocada_derruba_sessoes():
    assert not auth.verify(auth.issue(cfg(), now=NOW), cfg(secret="y" * 40), now=NOW)


def test_sem_senha_nada_vale():
    assert not auth.verify(auth.issue(cfg(pw=""), now=NOW), cfg(pw=""), now=NOW)


def test_lixo_nao_vale():
    for bad in [None, "", "abc", "9999999999.deadbeef"]:
        assert not auth.verify(bad, cfg(), now=NOW)


def test_check_password():
    pw = "segredo-forte"
    assert auth.check_password(pw, pw)
    assert not auth.check_password("errada", pw)
    assert not auth.check_password("", "")        # backoffice sem senha nunca loga
    assert not auth.check_password("\udc80", pw)  # surrogate solto não estoura
    assert auth.check_password("ção", "ção")      # não-ASCII funciona
```

- [ ] **Step 2: Ver falhar**

Run: `cd backend && uv run pytest tests/test_admin_auth.py -q`
Expected: FAIL com `ModuleNotFoundError: No module named 'foco.modules.admin'`

- [ ] **Step 3: Criar `backend/src/foco/modules/admin/__init__.py`** (vazio) e **`backend/src/foco/modules/admin/auth.py`**

```python
"""
auth.py — sessão do backoffice: uma senha só (ADMIN_PASSWORD), um cookie assinado.

O cookie é um token de core/signing.py sem payload. A finalidade assinada
inclui o hash da senha, e a chave é a SECRET_KEY. Consequências:
  - ninguém forja ou estende um cookie sem a SECRET_KEY;
  - trocar a senha OU a SECRET_KEY (e reiniciar) derruba todas as sessões;
  - um cookie roubado não serve para testar senhas offline (precisaria da SECRET_KEY).

ADMIN_PASSWORD vazia = backoffice desligado (a API responde 404).
"""

import hashlib
import hmac

from foco.core import signing
from foco.core.config import Settings

COOKIE = "foco_admin"
TTL = 12 * 3600      # validade da sessão, em segundos
FAIL_DELAY = 1.0     # espera após senha errada: freia força bruta (testes zeram)


def _b(s: str) -> bytes:
    # surrogatepass: surrogates soltos (JSON, ambiente) não estouram o encode
    return s.encode("utf-8", "surrogatepass")


def _purpose(pw: str) -> str:
    return "admin:" + hashlib.sha256(_b(pw)).hexdigest()


def check_password(given: str, pw: str) -> bool:
    # compare_digest: tempo constante, não revela quantos caracteres acertou
    return bool(pw) and hmac.compare_digest(_b(given), _b(pw))


def issue(settings: Settings, now: float | None = None) -> str:
    return signing.sign(b"", purpose=_purpose(settings.admin_password),
                        key=settings.secret_key, ttl=TTL, now=now)


def verify(token: str | None, settings: Settings, now: float | None = None) -> bool:
    if not settings.admin_password:
        return False
    payload = signing.verify(token, purpose=_purpose(settings.admin_password),
                             key=settings.secret_key, now=now)
    return payload is not None
```

- [ ] **Step 4: Rodar os testes**

Run: `cd backend && uv run pytest tests/test_admin_auth.py -q`
Expected: `7 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/src/foco/modules/admin backend/tests/test_admin_auth.py
git commit -m "ref(backend): Sign admin cookie with SECRET_KEY and password hash

Rotating either secret now drops all sessions, and a stolen cookie can no
longer be used to brute force the password offline.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: App FastAPI, health e rotas do admin

**Files:**
- Create: `backend/src/foco/modules/admin/router.py`, `backend/src/foco/main.py`, `backend/tests/test_health.py`, `backend/tests/test_api_admin.py`
- Modify: `backend/tests/conftest.py`

- [ ] **Step 1: Acrescentar as fixtures do app em `backend/tests/conftest.py`**

No fim do arquivo:

```python
STATIC_DIR = BACKEND.parent / "static"


@pytest.fixture
def settings(tmp_path):
    from foco.core.config import Settings

    return Settings(database_url=TEST_DATABASE_URL, secret_key=SECRET, data_dir=tmp_path / "data",
                    static_dir=STATIC_DIR, admin_password="", _env_file=None)


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
        app.dependency_overrides.update({
            get_session: lambda: session,
            get_session_factory: lambda: (lambda: nullcontext(session)),
            get_settings: lambda: s,
            get_storage: lambda: storage,
            get_detector: lambda: detector,
        })
        # sem "with": o lifespan (carregar o modelo, abrir o Procrastinate) não roda
        return TestClient(app)

    return make


@pytest.fixture
def client(make_client):
    return make_client()
```

- [ ] **Step 2: Escrever `backend/tests/test_health.py`**

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from foco.core.db import get_session


def test_health_ok(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_health_sem_banco_503(client):
    dead = Session(bind=create_engine("postgresql+psycopg://x:x@127.0.0.1:1/x"))
    client.app.dependency_overrides[get_session] = lambda: dead
    assert client.get("/api/health").status_code == 503


def test_frontend_servido(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "<html" in r.text.lower()
```

- [ ] **Step 3: Escrever `backend/tests/test_api_admin.py`** (porta do `tests/test_api_admin.py` da raiz, sem a parte da busca, que vai para a Task 19)

```python
import pytest

from foco.modules.admin import auth
from foco.modules.features import service as features

PW = "senha-de-teste"


@pytest.fixture
def admin(make_client, monkeypatch):
    monkeypatch.setattr(auth, "FAIL_DELAY", 0)
    return make_client(admin_password=PW)


def login(c, pw=PW):
    return c.post("/api/admin/login", json={"password": pw})


def test_features_publico(admin):
    assert admin.get("/api/features").json() == {"calibration": False}


def test_admin_sem_cookie_401(admin):
    assert admin.get("/api/admin/features").status_code == 401
    assert admin.put("/api/admin/features/calibration", json={"enabled": True}).status_code == 401


def test_login_errado_401(admin):
    r = login(admin, "errada")
    assert r.status_code == 401
    assert auth.COOKIE not in r.cookies


def test_login_e_toggle(admin, session):
    r = login(admin)
    assert r.status_code == 204
    assert auth.COOKIE in r.cookies
    assert "httponly" in r.headers["set-cookie"].lower()
    assert "samesite=strict" in r.headers["set-cookie"].lower()

    assert admin.get("/api/admin/session").json() == {"enabled": True, "logged_in": True}
    [cal] = admin.get("/api/admin/features").json()
    assert cal["key"] == "calibration" and cal["enabled"] is False

    r = admin.put("/api/admin/features/calibration", json={"enabled": True})
    assert r.status_code == 200
    assert r.json()["enabled"] is True
    assert admin.get("/api/features").json() == {"calibration": True}
    assert features.is_enabled(session, "calibration")


def test_flag_desconhecida_404(admin):
    login(admin)
    assert admin.put("/api/admin/features/nao-existe", json={"enabled": True}).status_code == 404


def test_corpo_invalido_422(admin):
    login(admin)
    assert admin.put("/api/admin/features/calibration", json={}).status_code == 422
    assert admin.put("/api/admin/features/calibration", json={"enabled": "yes"}).status_code == 422
    assert admin.put("/api/admin/features/calibration", json={"enabled": 1}).status_code == 422


def test_logout(admin):
    login(admin)
    assert admin.post("/api/admin/logout").status_code == 204
    assert admin.get("/api/admin/session").json() == {"enabled": True, "logged_in": False}
    assert admin.get("/api/admin/features").status_code == 401


def test_cookie_forjado_401(admin):
    admin.cookies.set(auth.COOKIE, "9999999999.deadbeef")
    assert admin.get("/api/admin/features").status_code == 401


def test_sem_admin_password_backoffice_desligado(client):
    assert client.get("/api/admin/session").json() == {"enabled": False, "logged_in": False}
    assert login(client, "").status_code == 404
    assert client.get("/api/admin/features").status_code == 404
    assert client.get("/api/features").json() == {"calibration": False}


def test_cookie_secure_atras_de_https(admin):
    assert "secure" not in login(admin).headers["set-cookie"].lower()
    r = admin.post("/api/admin/login", json={"password": PW}, headers={"x-forwarded-proto": "https"})
    assert "secure" in r.headers["set-cookie"].lower()


def test_csrf_corpo_nao_json_422(admin, session):
    # Um <form> de outro site só consegue enviar text/plain (sem preflight):
    # exigir JSON de verdade bloqueia isso, junto com SameSite=Strict.
    body = ('{"password":"%s"}' % PW).encode()
    r = admin.post("/api/admin/login", content=body, headers={"content-type": "text/plain"})
    assert r.status_code == 422
    assert auth.COOKIE not in r.cookies

    login(admin)
    r = admin.put("/api/admin/features/calibration", content=b'{"enabled":true}',
                  headers={"content-type": "text/plain"})
    assert r.status_code == 422
    assert features.is_enabled(session, "calibration") is False
```

- [ ] **Step 4: Ver falhar**

Run: `cd backend && uv run pytest tests/test_health.py tests/test_api_admin.py -q`
Expected: FAIL com `ModuleNotFoundError: No module named 'foco.main'`

- [ ] **Step 5: Criar `backend/src/foco/modules/admin/router.py`**

```python
"""
Backoffice. Sem ADMIN_PASSWORD o backoffice não existe: /api/admin/* responde
404 e as flags ficam no padrão.
"""

import asyncio

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, StrictBool
from sqlalchemy.orm import Session

from foco.core.config import Settings, get_settings
from foco.core.db import get_session
from foco.core.errors import NotFound, Unauthorized
from foco.modules.admin import auth
from foco.modules.features import service as features

router = APIRouter(prefix="/api/admin", tags=["admin"])


def require_admin(request: Request, settings: Settings = Depends(get_settings)) -> None:
    if not settings.admin_password:
        raise NotFound("Backoffice desativado.")
    if not auth.verify(request.cookies.get(auth.COOKIE), settings):
        raise Unauthorized("Entre no backoffice.")


def _is_https(request: Request) -> bool:
    # Atrás do Caddy o uvicorn recebe HTTP; o esquema original vem no header.
    return request.headers.get("x-forwarded-proto", request.url.scheme) == "https"


class LoginIn(BaseModel):
    password: str


class FeatureIn(BaseModel):
    enabled: StrictBool


@router.post("/login", status_code=204)
async def login(body: LoginIn, request: Request, response: Response,
                settings: Settings = Depends(get_settings)) -> None:
    if not settings.admin_password:
        raise NotFound("Backoffice desativado.")
    if not auth.check_password(body.password, settings.admin_password):
        await asyncio.sleep(auth.FAIL_DELAY)
        raise Unauthorized("Senha incorreta.")
    response.set_cookie(auth.COOKIE, auth.issue(settings), max_age=auth.TTL, path="/",
                        httponly=True, samesite="strict", secure=_is_https(request))


@router.post("/logout", status_code=204)
def logout(response: Response) -> None:
    response.delete_cookie(auth.COOKIE, path="/", httponly=True, samesite="strict")


@router.get("/session")
def session_state(request: Request, settings: Settings = Depends(get_settings)) -> dict:
    return {"enabled": bool(settings.admin_password),
            "logged_in": auth.verify(request.cookies.get(auth.COOKIE), settings)}


@router.get("/features", dependencies=[Depends(require_admin)])
def list_features(session: Session = Depends(get_session)) -> list[dict]:
    return features.describe(session)


@router.put("/features/{key}", dependencies=[Depends(require_admin)])
def set_feature(key: str, body: FeatureIn, session: Session = Depends(get_session)) -> dict:
    try:
        features.set_enabled(session, key, body.enabled)
    except KeyError:
        raise NotFound("Funcionalidade desconhecida.") from None
    return next(f for f in features.describe(session) if f["key"] == key)
```

- [ ] **Step 6: Criar `backend/src/foco/main.py`**

```python
"""
main.py — monta o app FastAPI.

Rodar:  uvicorn --factory foco.main:create_app      (make api, em dev)
"""

import asyncio
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, FastAPI
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from foco.core.config import Settings, get_settings
from foco.core.db import get_session
from foco.core.errors import AppError, install_handlers
from foco.modules.admin.router import router as admin_router
from foco.modules.features.router import router as features_router
from foco.vision.detector import get_detector
from foco.worker import app as worker_app

health_router = APIRouter()


class Unavailable(AppError):
    status_code = 503


@health_router.get("/api/health")
def health(session: Session = Depends(get_session)) -> dict:
    try:
        session.execute(text("SELECT 1"))
    except SQLAlchemyError:
        raise Unavailable("banco indisponível") from None
    return {"ok": True}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # O upload enfileira com defer() síncrono: precisa do Procrastinate aberto.
    worker_app.open()
    # Carrega o modelo agora para a primeira selfie não pagar ~2 s.
    await asyncio.to_thread(get_detector().load)
    print("[startup] modelo buffalo_l carregado")
    yield
    worker_app.close()


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="Foco", lifespan=lifespan)
    install_handlers(app)
    for router in (health_router, features_router, admin_router):
        app.include_router(router)
    # Frontend: montado por último para não "engolir" as rotas /api.
    app.mount("/", StaticFiles(directory=settings.static_dir, html=True), name="static")
    return app
```

- [ ] **Step 7: Rodar os testes**

Run: `cd backend && uv run pytest tests/test_health.py tests/test_api_admin.py -q`
Expected: `14 passed`

- [ ] **Step 8: Commit**

```bash
git add backend/src/foco/main.py backend/src/foco/modules/admin/router.py backend/tests/conftest.py backend/tests/test_health.py backend/tests/test_api_admin.py
git commit -m "ref(backend): Add app factory, health check and admin routes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Capa e ponto de foco

**Files:**
- Create: `backend/src/foco/modules/photos/covers.py`, `backend/tests/test_covers.py`

- [ ] **Step 1: Escrever `backend/tests/test_covers.py`**

```python
from types import SimpleNamespace as P

from factories import make_event, make_photo, unit
from foco.modules.photos.covers import DEFAULT_FOCUS, focus_points, pick_cover


def test_capa_com_poucas_fotos_poe_horizontal_primeiro():
    photos = [P(id=1, width=600, height=800), P(id=2, width=800, height=600)]
    assert pick_cover(photos) == [2, 1]


def test_capa_espalha_pelo_evento():
    photos = [P(id=i, width=800, height=600) for i in range(1, 11)]
    assert pick_cover(photos) == [1, 3, 5, 8, 10]   # round() arredonda 4.5 para 4


def test_foco_sem_rosto_usa_padrao(session):
    ev = make_event(session)
    p = make_photo(session, ev)
    assert focus_points(session, [p.id]) == {p.id: DEFAULT_FOCUS}


def test_foco_no_centro_do_rosto(session):
    ev = make_event(session)
    p = make_photo(session, ev, width=1000, height=1000,
                   faces=[((100, 200, 300, 400), unit(0), 0.9)])
    assert focus_points(session, [p.id])[p.id] == {"fx": 0.2, "fy": 0.3}


def test_foco_ignora_rosto_pequeno_em_outra_altura(session):
    # Rosto principal em cima; um rosto bem menor lá embaixo não puxa o foco.
    ev = make_event(session)
    p = make_photo(session, ev, width=1000, height=1000, faces=[
        ((400, 100, 600, 300), unit(0), 0.9),
        ((100, 800, 150, 850), unit(1), 0.9),
    ])
    assert focus_points(session, [p.id])[p.id] == {"fx": 0.5, "fy": 0.2}


def test_foco_lista_vazia(session):
    assert focus_points(session, []) == {}
```

- [ ] **Step 2: Ver falhar**

Run: `cd backend && uv run pytest tests/test_covers.py -q`
Expected: FAIL com `ModuleNotFoundError: No module named 'foco.modules.photos.covers'`

- [ ] **Step 3: Criar `backend/src/foco/modules/photos/covers.py`**

Porta de `_pick_cover` e da PRIMEIRA versão de `_focus_points` do `api.py` (linhas 193-242, a que usa `det_score`). O código morto das linhas 243-264 não vem junto.

```python
"""Capa do evento e ponto de foco das miniaturas (para object-position no front)."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from foco.modules.photos.models import Face, Photo

# Foto sem rosto detectado: mira no terço de cima, onde costumam estar as pessoas.
DEFAULT_FOCUS = {"fx": 0.5, "fy": 0.33}


def pick_cover(photos: list, n: int = 5) -> list[int]:
    """Fotos da capa em mosaico: até `n`, espalhadas do início ao fim do
    evento (fotos seguidas costumam ser quase iguais). A primeira vai no quadro
    grande, então preferimos uma horizontal para ela.

    `photos`: objetos com .id, .width, .height, em ordem de envio."""
    if len(photos) <= n:
        picks = list(photos)
    else:
        step = (len(photos) - 1) / (n - 1)
        picks = [photos[round(i * step)] for i in range(n)]
    wide = next((p for p in picks if (p.width or 0) >= (p.height or 0)), None)
    if wide:
        picks.remove(wide)
        picks.insert(0, wide)
    return [p.id for p in picks]


def focus_points(session: Session, photo_ids: list[int]) -> dict[int, dict]:
    """Ponto de foco de cada foto, em fração da largura/altura (0..1).

    1. Escolhe o rosto principal pela pontuação área x confiança do detector.
       Rosto cortado pela borda da foto vale só 30%: é um pedaço de alguém
       que estava fora do quadro, não o assunto da foto.
    2. Junta os rostos de pontuação parecida (>= 60%) que estão NA MESMA
       ALTURA do principal: a fileira de uma foto de grupo.
    3. O foco é o centro desses rostos, com peso pela área.

    Tirar a média de TODOS os rostos falhava: com duas pessoas em alturas
    diferentes, o centro caía entre elas, onde não há ninguém.
    """
    out = {pid: dict(DEFAULT_FOCUS) for pid in photo_ids}
    if not photo_ids:
        return out
    rows = session.execute(
        select(Face.photo_id, Face.x1, Face.y1, Face.x2, Face.y2, Face.det_score, Photo.width, Photo.height)
        .join(Photo, Photo.id == Face.photo_id)
        .where(Face.photo_id.in_(photo_ids))
    ).all()
    by_photo: dict[int, list] = {}
    for r in rows:
        by_photo.setdefault(r.photo_id, []).append(r)
    for pid, fs in by_photo.items():
        W, H = fs[0].width, fs[0].height
        if not (W and H):
            continue
        faces = []
        for r in fs:
            w, h = max(r.x2 - r.x1, 1), max(r.y2 - r.y1, 1)
            cut = r.x1 < -2 or r.y1 < -2 or r.x2 > W + 2 or r.y2 > H + 2
            score = w * h * (r.det_score or 1) * (0.3 if cut else 1)
            faces.append({"score": score, "area": w * h, "h": h,
                          "cx": (r.x1 + r.x2) / 2, "cy": (r.y1 + r.y2) / 2})
        best = max(faces, key=lambda f: f["score"])
        row = [f for f in faces
               if f["score"] >= 0.6 * best["score"] and abs(f["cy"] - best["cy"]) <= 1.2 * best["h"]]
        total = sum(f["area"] for f in row)
        fx = sum(f["area"] * f["cx"] for f in row) / total / W
        fy = sum(f["area"] * f["cy"] for f in row) / total / H
        out[pid] = {"fx": round(min(max(fx, 0), 1), 3), "fy": round(min(max(fy, 0), 1), 3)}
    return out
```

- [ ] **Step 4: Rodar os testes**

Run: `cd backend && uv run pytest tests/test_covers.py -q`
Expected: `6 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/src/foco/modules/photos/covers.py backend/tests/test_covers.py
git commit -m "ref(backend): Move cover and focus point logic to photos.covers

Drop the dead second copy of _focus_points that sat after its return.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Módulo events

**Files:**
- Create: `backend/src/foco/modules/events/schemas.py`, `backend/src/foco/modules/events/service.py`, `backend/src/foco/modules/events/router.py`, `backend/tests/test_events.py`
- Modify: `backend/src/foco/main.py`

- [ ] **Step 1: Escrever `backend/tests/test_events.py`**

```python
from unittest.mock import ANY

from sqlalchemy import func, select

from conftest import deferred
from factories import make_event, make_photo, unit
from foco.modules.photos.models import Photo


def test_cria(client):
    r = client.post("/api/events", json={"name": "  Corrida  ", "event_date": "2026-09-01", "location": " SP "})
    assert r.status_code == 200
    assert r.json() == {"id": ANY, "name": "Corrida", "event_date": "2026-09-01", "location": "SP"}


def test_nome_vazio_400(client):
    r = client.post("/api/events", json={"name": "   "})
    assert r.status_code == 400
    assert r.json() == {"detail": "Dê um nome ao evento."}


def test_data_invalida_400(client):
    r = client.post("/api/events", json={"name": "X", "event_date": "31/12/2026"})
    assert r.status_code == 400
    assert r.json() == {"detail": "Data inválida."}


def test_campos_opcionais_vazios_viram_null(client):
    r = client.post("/api/events", json={"name": "X", "event_date": "", "location": "  "})
    assert r.json()["event_date"] is None and r.json()["location"] is None


def test_edita(client):
    eid = client.post("/api/events", json={"name": "A"}).json()["id"]
    r = client.patch(f"/api/events/{eid}", json={"name": "B", "location": "Rio"})
    assert r.json() == {"id": eid, "name": "B", "event_date": None, "location": "Rio"}


def test_edita_inexistente_404(client):
    assert client.patch("/api/events/999999", json={"name": "B"}).status_code == 404


def test_lista_mais_recente_primeiro(client):
    client.post("/api/events", json={"name": "Velho", "event_date": "2020-01-01"})
    client.post("/api/events", json={"name": "Novo", "event_date": "2026-01-01"})
    assert [e["name"] for e in client.get("/api/events").json()] == ["Novo", "Velho"]


def test_lista_com_contagens_e_capa(client, session):
    ev = make_event(session, "Festa")
    p = make_photo(session, ev, width=1000, height=1000, faces=[((100, 200, 300, 400), unit(0), 0.9)])
    make_photo(session, ev, status="queued")
    session.commit()
    [e] = client.get("/api/events").json()
    assert (e["n_photos"], e["n_done"], e["n_pending"], e["n_faces"]) == (2, 1, 1, 1)
    assert e["cover"] == [{"id": p.id, "fx": 0.2, "fy": 0.3}]
    assert e["created_at"]


def test_exclui_evento_e_agenda_arquivos(client, session, jobs):
    ev = make_event(session)
    p = make_photo(session, ev)
    session.commit()
    r = client.delete(f"/api/events/{ev.id}")
    assert r.json() == {"deleted": ev.id, "photos": 1}
    assert session.scalar(select(func.count()).select_from(Photo)) == 0
    assert deferred(jobs, "delete_event_files") == [
        {"event_id": ev.id, "keys": [p.storage_key], "shas": [p.sha256]}
    ]


def test_exclui_inexistente_404(client):
    assert client.delete("/api/events/999999").status_code == 404
```

- [ ] **Step 2: Ver falhar**

Run: `cd backend && uv run pytest tests/test_events.py -q`
Expected: FAIL (404 em `POST /api/events`, porque a rota não existe ainda)

- [ ] **Step 3: Criar `backend/src/foco/modules/events/schemas.py`**

```python
import datetime as dt

from pydantic import BaseModel, ConfigDict


class EventIn(BaseModel):
    name: str
    event_date: str | None = None   # AAAA-MM-DD, vem de <input type="date">
    location: str | None = None


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    event_date: dt.date | None
    location: str | None


class CoverPhoto(BaseModel):
    id: int
    fx: float
    fy: float


class EventSummary(EventOut):
    created_at: dt.datetime
    n_photos: int
    n_done: int
    n_pending: int
    n_faces: int
    cover: list[CoverPhoto]   # mosaico da página pública, com ponto de foco
```

- [ ] **Step 4: Criar `backend/src/foco/modules/events/service.py`**

```python
import datetime as dt

from sqlalchemy import Date, cast, func, select
from sqlalchemy import delete as sa_delete
from sqlalchemy.orm import Session

from foco.core.errors import Invalid, NotFound
from foco.modules.events.models import Event
from foco.modules.events.schemas import CoverPhoto, EventIn, EventSummary
from foco.modules.photos import covers, tasks
from foco.modules.photos.models import PENDING, Photo


def get_or_404(session: Session, event_id: int) -> Event:
    ev = session.get(Event, event_id)
    if ev is None:
        raise NotFound("evento não encontrado")
    return ev


def _clean(body: EventIn) -> tuple[str, dt.date | None, str | None]:
    name = body.name.strip()
    if not name:
        raise Invalid("Dê um nome ao evento.")
    raw_date = (body.event_date or "").strip()
    date = None
    if raw_date:
        try:
            date = dt.date.fromisoformat(raw_date)
        except ValueError:
            raise Invalid("Data inválida.") from None
    location = (body.location or "").strip() or None
    return name[:120], date, location and location[:120]


def create_event(session: Session, body: EventIn) -> Event:
    name, date, location = _clean(body)
    ev = Event(name=name, event_date=date, location=location)
    session.add(ev)
    session.commit()
    return ev


def update_event(session: Session, event_id: int, body: EventIn) -> Event:
    ev = get_or_404(session, event_id)
    ev.name, ev.event_date, ev.location = _clean(body)
    session.commit()
    return ev


def list_events(session: Session) -> list[EventSummary]:
    counts = (
        select(
            Photo.event_id,
            func.count().label("n_photos"),
            func.count().filter(Photo.status == "done").label("n_done"),
            func.count().filter(Photo.status.in_(PENDING)).label("n_pending"),
            func.coalesce(func.sum(Photo.n_faces), 0).label("n_faces"),
        )
        .group_by(Photo.event_id)
        .subquery()
    )
    rows = session.execute(
        select(Event, counts.c.n_photos, counts.c.n_done, counts.c.n_pending, counts.c.n_faces)
        .outerjoin(counts, counts.c.event_id == Event.id)
        .order_by(func.coalesce(Event.event_date, cast(Event.created_at, Date)).desc(), Event.id.desc())
    ).all()
    done = session.execute(
        select(Photo.id, Photo.event_id, Photo.width, Photo.height)
        .where(Photo.status == "done")
        .order_by(Photo.id)
    ).all()
    by_event: dict[int, list] = {}
    for p in done:
        by_event.setdefault(p.event_id, []).append(p)
    cover_ids = {ev.id: covers.pick_cover(by_event.get(ev.id, [])) for ev, *_ in rows}
    focus = covers.focus_points(session, [pid for ids in cover_ids.values() for pid in ids])
    return [
        EventSummary(
            id=ev.id, name=ev.name, event_date=ev.event_date, location=ev.location,
            created_at=ev.created_at, n_photos=n_photos or 0, n_done=n_done or 0,
            n_pending=n_pending or 0, n_faces=n_faces or 0,
            cover=[CoverPhoto(id=pid, **focus[pid]) for pid in cover_ids[ev.id]],
        )
        for ev, n_photos, n_done, n_pending, n_faces in rows
    ]


def delete_event(session: Session, event_id: int) -> dict:
    """Apaga o evento com TODAS as fotos e rostos (CASCADE). Não tem volta.

    Os arquivos saem depois, numa tarefa do worker. Fotos ainda na fila são
    ignoradas quando chegar a vez delas (index_photo não acha mais a linha).
    """
    get_or_404(session, event_id)
    files = session.execute(
        select(Photo.storage_key, Photo.sha256).where(Photo.event_id == event_id)
    ).all()
    session.execute(sa_delete(Event).where(Event.id == event_id))
    session.commit()
    if files:
        tasks.delete_event_files.defer(
            event_id=event_id,
            keys=[f.storage_key for f in files],
            shas=sorted({f.sha256 for f in files}),
        )
    return {"deleted": event_id, "photos": len(files)}
```

- [ ] **Step 5: Criar `backend/src/foco/modules/events/router.py`**

```python
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from foco.core.db import get_session
from foco.modules.events import service
from foco.modules.events.schemas import EventIn, EventOut, EventSummary

router = APIRouter(prefix="/api/events", tags=["events"])


@router.post("")
def create_event(body: EventIn, session: Session = Depends(get_session)) -> EventOut:
    return service.create_event(session, body)


@router.get("")
def list_events(session: Session = Depends(get_session)) -> list[EventSummary]:
    return service.list_events(session)


@router.patch("/{event_id}")
def update_event(event_id: int, body: EventIn, session: Session = Depends(get_session)) -> EventOut:
    return service.update_event(session, event_id, body)


@router.delete("/{event_id}")
def delete_event(event_id: int, session: Session = Depends(get_session)) -> dict:
    return service.delete_event(session, event_id)
```

- [ ] **Step 6: Incluir o router em `backend/src/foco/main.py`**

Import:

```python
from foco.modules.events.router import router as events_router
```

E trocar a tupla dos routers:

```python
    for router in (health_router, events_router, features_router, admin_router):
```

- [ ] **Step 7: Rodar os testes**

Run: `cd backend && uv run pytest tests/test_events.py -q`
Expected: `10 passed`

- [ ] **Step 8: Commit**

```bash
git add backend/src/foco/modules/events backend/src/foco/main.py backend/tests/test_events.py
git commit -m "ref(backend): Move event routes to the events module

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Upload e folha de contato

**Files:**
- Create: `backend/src/foco/modules/photos/schemas.py`, `backend/src/foco/modules/photos/service.py`, `backend/src/foco/modules/photos/router.py`, `backend/tests/test_photos_upload.py`
- Modify: `backend/src/foco/main.py`

- [ ] **Step 1: Escrever `backend/tests/test_photos_upload.py`**

```python
from conftest import deferred
from fakes import png
from foco.modules.photos.keys import thumb_key


def new_event(client):
    return client.post("/api/events", json={"name": "Evento"}).json()["id"]


def upload(client, eid, data, name="a.png"):
    return client.post(f"/api/events/{eid}/photos", files=[("files", (name, data, "image/png"))])


def test_upload_salva_e_enfileira(client, storage, jobs):
    eid = new_event(client)
    r = upload(client, eid, png(r=1))
    assert r.status_code == 200
    [item] = r.json()
    assert item["status"] == "queued" and item["duplicate"] is False
    assert (item["filename"], item["width"], item["height"]) == ("a.png", 64, 48)
    assert deferred(jobs, "index_photo") == [{"photo_id": item["id"]}]
    [orig] = storage.path(f"photos/{eid}").iterdir()
    assert orig.suffix == ".png"
    assert storage.exists(thumb_key(orig.stem))


def test_mesma_foto_de_novo_e_duplicada(client, jobs):
    eid = new_event(client)
    first = upload(client, eid, png(r=1)).json()[0]
    [again] = upload(client, eid, png(r=1), name="outro-nome.png").json()
    assert again["duplicate"] is True and again["id"] == first["id"]
    assert len(deferred(jobs, "index_photo")) == 1


def test_arquivo_invalido(client, jobs):
    eid = new_event(client)
    [item] = upload(client, eid, b"nao e imagem", name="x.png").json()
    assert item == {"filename": "x.png", "status": "error", "error": "arquivo não é uma imagem válida"}
    assert deferred(jobs, "index_photo") == []


def test_upload_evento_inexistente_404(client):
    assert upload(client, 999_999, png(r=1)).status_code == 404


def test_folha_de_contato(client):
    eid = new_event(client)
    a = upload(client, eid, png(r=1)).json()[0]
    b = upload(client, eid, png(r=2)).json()[0]
    sheet = client.get(f"/api/events/{eid}/photos").json()
    assert [p["id"] for p in sheet] == [b["id"], a["id"]]     # mais recente primeiro
    assert {"fx", "fy", "status", "n_faces"} <= sheet[0].keys()
```

- [ ] **Step 2: Ver falhar**

Run: `cd backend && uv run pytest tests/test_photos_upload.py -q`
Expected: FAIL (404/405 em `POST /api/events/{id}/photos`)

- [ ] **Step 3: Criar `backend/src/foco/modules/photos/schemas.py`**

```python
from pydantic import BaseModel, ConfigDict


class PhotoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    filename: str
    status: str
    n_faces: int
    proc_ms: float | None
    error: str | None
    width: int | None
    height: int | None


class SheetPhoto(PhotoOut):
    fx: float   # ponto de foco (object-position)
    fy: float
```

- [ ] **Step 4: Criar `backend/src/foco/modules/photos/service.py`**

```python
"""
service.py — o lado da API das fotos: upload, listagens, arquivos, stats.
A indexação (lado do worker) fica em indexing.py.
"""

import hashlib

from sqlalchemy import select
from sqlalchemy.orm import Session

from foco.core.errors import NotFound
from foco.core.storage import Storage
from foco.modules.photos import covers, tasks
from foco.modules.photos.keys import original_key, thumb_key
from foco.modules.photos.models import Photo
from foco.modules.photos.schemas import PhotoOut, SheetPhoto
from foco.vision.images import load_image, make_thumbnail


def photo_json(p: Photo) -> dict:
    return PhotoOut.model_validate(p).model_dump()


def add_photo(session: Session, storage: Storage, event_id: int, filename: str | None, data: bytes) -> dict:
    """Salva a foto e agenda a indexação. NÃO indexa aqui (ver tasks.index_photo)."""
    # Hash do CONTEÚDO: a mesma foto enviada de novo (mesmo com outro nome)
    # tem o mesmo hash e não é reprocessada.
    sha = hashlib.sha256(data).hexdigest()
    dup = session.scalar(select(Photo).where(Photo.event_id == event_id, Photo.sha256 == sha))
    if dup:
        return {**photo_json(dup), "duplicate": True}
    try:
        img = load_image(data)
        thumb = make_thumbnail(img)   # na hora: o Estúdio mostra a miniatura enquanto indexa
    except Exception:
        return {"filename": filename, "status": "error", "error": "arquivo não é uma imagem válida"}
    key = original_key(event_id, sha, filename)
    storage.save(key, data)            # original intacto, para download
    storage.save(thumb_key(sha), thumb)
    p = Photo(event_id=event_id, sha256=sha, filename=filename or "foto", storage_key=key,
              width=img.width, height=img.height, status="queued")
    session.add(p)
    session.commit()
    tasks.defer_index(p.id)
    return {**photo_json(p), "duplicate": False}


def list_photos(session: Session, event_id: int, limit: int = 500) -> list[SheetPhoto]:
    """Fotos do evento, mais recentes primeiro (folha de contato do Estúdio)."""
    photos = list(session.scalars(
        select(Photo).where(Photo.event_id == event_id).order_by(Photo.id.desc()).limit(min(limit, 2000))
    ))
    focus = covers.focus_points(session, [p.id for p in photos])
    return [SheetPhoto(**photo_json(p), **focus[p.id]) for p in photos]


def get_or_404(session: Session, photo_id: int) -> Photo:
    p = session.get(Photo, photo_id)
    if p is None:
        raise NotFound("foto não encontrada")
    return p
```

- [ ] **Step 5: Criar `backend/src/foco/modules/photos/router.py`**

```python
from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session

from foco.core.db import get_session
from foco.core.storage import Storage, get_storage
from foco.modules.events import service as events
from foco.modules.photos import service
from foco.modules.photos.schemas import SheetPhoto

router = APIRouter(prefix="/api", tags=["photos"])


@router.post("/events/{event_id}/photos")
def upload_photos(event_id: int, files: list[UploadFile] = File(...),
                  session: Session = Depends(get_session),
                  storage: Storage = Depends(get_storage)) -> list[dict]:
    events.get_or_404(session, event_id)
    return [service.add_photo(session, storage, event_id, f.filename, f.file.read()) for f in files]


@router.get("/events/{event_id}/photos")
def list_photos(event_id: int, limit: int = 500, session: Session = Depends(get_session)) -> list[SheetPhoto]:
    events.get_or_404(session, event_id)
    return service.list_photos(session, event_id, limit)
```

- [ ] **Step 6: Incluir o router em `backend/src/foco/main.py`**

Import:

```python
from foco.modules.photos.router import router as photos_router
```

Tupla:

```python
    for router in (health_router, events_router, photos_router, features_router, admin_router):
```

- [ ] **Step 7: Rodar os testes**

Run: `cd backend && uv run pytest tests/test_photos_upload.py -q`
Expected: `5 passed`

- [ ] **Step 8: Commit**

```bash
git add backend/src/foco/modules/photos/schemas.py backend/src/foco/modules/photos/service.py backend/src/foco/modules/photos/router.py backend/src/foco/main.py backend/tests/test_photos_upload.py
git commit -m "ref(backend): Move photo upload to the photos module

Uploads now enqueue a Procrastinate job instead of a thread-local queue.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Arquivos, zip e estatísticas

**Files:**
- Modify: `backend/src/foco/modules/photos/service.py`, `backend/src/foco/modules/photos/router.py`
- Create: `backend/tests/test_photos_files.py`

- [ ] **Step 1: Escrever `backend/tests/test_photos_files.py`**

```python
import io
import zipfile

from sqlalchemy import update

from fakes import png
from foco.modules.photos.keys import medium_key
from foco.modules.photos.models import Photo


def seed(client, data=None, name="a.png"):
    eid = client.post("/api/events", json={"name": "E"}).json()["id"]
    item = client.post(f"/api/events/{eid}/photos",
                       files=[("files", (name, data or png(r=1), "image/png"))]).json()[0]
    return eid, item


def test_thumb(client):
    _, p = seed(client)
    r = client.get(f"/api/photos/{p['id']}/thumb")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    assert "max-age=86400" in r.headers["cache-control"]


def test_medium_de_foto_pequena_e_a_original(client):
    _, p = seed(client)
    r = client.get(f"/api/photos/{p['id']}/medium")
    assert r.content == png(r=1)


def test_medium_de_foto_grande_e_gerada_uma_vez(client, storage, session):
    _, p = seed(client, png(r=1, size=(2000, 1000)))
    sha = session.get(Photo, p["id"]).sha256
    r = client.get(f"/api/photos/{p['id']}/medium")
    assert r.headers["content-type"] == "image/jpeg"
    assert storage.exists(medium_key(sha))
    mtime = storage.path(medium_key(sha)).stat().st_mtime_ns
    client.get(f"/api/photos/{p['id']}/medium")
    assert storage.path(medium_key(sha)).stat().st_mtime_ns == mtime


def test_full_com_download(client):
    _, p = seed(client, name="minha foto.png")
    r = client.get(f"/api/photos/{p['id']}/full?download=1")
    assert r.content == png(r=1)
    assert "attachment" in r.headers["content-disposition"]


def test_foto_inexistente_404(client):
    for kind in ("thumb", "medium", "full"):
        assert client.get(f"/api/photos/999999/{kind}").status_code == 404


def test_zip(client):
    _, p = seed(client, name="a.png")
    r = client.get(f"/api/zip?ids={p['id']}")
    assert r.headers["content-type"] == "application/zip"
    names = zipfile.ZipFile(io.BytesIO(r.content)).namelist()
    assert names == [f"{p['id']:05d}_a.png"]


def test_zip_sem_ids_400(client):
    assert client.get("/api/zip?ids=abc").status_code == 400


def test_stats(client, session):
    eid, p = seed(client)
    session.execute(update(Photo).where(Photo.id == p["id"]).values(status="done", n_faces=2, proc_ms=100.0))
    session.commit()
    s = client.get(f"/api/stats?event_id={eid}").json()
    assert s == {"events": 1, "photos": 1, "done": 1, "pending": 0, "errors": 0, "faces": 2,
                 "avg_ms_per_photo": 100.0}
```

- [ ] **Step 2: Ver falhar**

Run: `cd backend && uv run pytest tests/test_photos_files.py -q`
Expected: FAIL (404 nas rotas `/api/photos/...`, `/api/zip`, `/api/stats`)

- [ ] **Step 3: Acrescentar em `backend/src/foco/modules/photos/service.py`**

Imports (juntar aos existentes):

```python
import io
import zipfile

from sqlalchemy import func

from foco.core.errors import Invalid
from foco.modules.events.models import Event
from foco.modules.photos.keys import medium_key
from foco.modules.photos.models import PENDING
```

No fim do arquivo:

```python
MEDIUM_SIDE = 1600


def ensure_medium(storage: Storage, p: Photo) -> str:
    """Chave da versão de 1600px: nítida na capa e no visualizador, sem baixar
    o original de 5 MB+. Gerada no primeiro pedido e guardada (nome = hash)."""
    # original já pequena (ex.: foto de celular redimensionada): recomprimir só
    # aumentaria o arquivo, então entrega a própria original
    if max(p.width or 0, p.height or 0) <= MEDIUM_SIDE:
        return p.storage_key
    key = medium_key(p.sha256)
    if not storage.exists(key):
        img = load_image(storage.read(p.storage_key))
        storage.save(key, make_thumbnail(img, MEDIUM_SIDE, 85))
    return key


def zip_photos(session: Session, storage: Storage, photo_ids: list[int]) -> bytes:
    """Zip com as originais. ZIP_STORED (sem compressão) porque JPEG já é
    comprimido: comprimir de novo só gasta CPU sem reduzir tamanho."""
    if not photo_ids:
        raise Invalid("nenhuma foto")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
        for pid in photo_ids:
            p = get_or_404(session, pid)
            z.write(storage.path(p.storage_key), arcname=f"{pid:05d}_{p.filename}")
    return buf.getvalue()


def stats(session: Session, event_id: int | None = None) -> dict:
    q = select(
        func.count().label("photos"),
        func.count().filter(Photo.status == "done").label("done"),
        func.count().filter(Photo.status.in_(PENDING)).label("pending"),
        func.count().filter(Photo.status == "error").label("errors"),
        func.coalesce(func.sum(Photo.n_faces), 0).label("faces"),
        func.avg(Photo.proc_ms).filter(Photo.status == "done").label("avg_ms"),
    )
    if event_id:
        q = q.where(Photo.event_id == event_id)
    r = session.execute(q).one()
    return {
        "events": session.scalar(select(func.count()).select_from(Event)),
        "photos": r.photos, "done": r.done, "pending": r.pending, "errors": r.errors, "faces": r.faces,
        "avg_ms_per_photo": round(r.avg_ms, 1) if r.avg_ms else None,
    }
```

- [ ] **Step 4: Acrescentar em `backend/src/foco/modules/photos/router.py`**

Imports (no topo):

```python
from fastapi.responses import FileResponse, Response

from foco.modules.photos.keys import thumb_key
```

Logo abaixo de `router = APIRouter(...)`:

```python
CACHE = {"Cache-Control": "max-age=86400"}
```

Rotas, no fim:

```python
@router.get("/photos/{photo_id}/thumb")
def photo_thumb(photo_id: int, session: Session = Depends(get_session),
                storage: Storage = Depends(get_storage)) -> FileResponse:
    p = service.get_or_404(session, photo_id)
    return FileResponse(storage.path(thumb_key(p.sha256)), media_type="image/jpeg", headers=CACHE)


@router.get("/photos/{photo_id}/medium")
def photo_medium(photo_id: int, session: Session = Depends(get_session),
                 storage: Storage = Depends(get_storage)) -> FileResponse:
    p = service.get_or_404(session, photo_id)
    key = service.ensure_medium(storage, p)
    media_type = None if key == p.storage_key else "image/jpeg"
    return FileResponse(storage.path(key), media_type=media_type, headers=CACHE)


@router.get("/photos/{photo_id}/full")
def photo_full(photo_id: int, download: bool = False, session: Session = Depends(get_session),
               storage: Storage = Depends(get_storage)) -> FileResponse:
    p = service.get_or_404(session, photo_id)
    return FileResponse(storage.path(p.storage_key), filename=p.filename if download else None)


@router.get("/zip")
def download_zip(ids: str, session: Session = Depends(get_session),
                 storage: Storage = Depends(get_storage)) -> Response:
    photo_ids = [int(x) for x in ids.split(",") if x.strip().isdigit()]
    return Response(service.zip_photos(session, storage, photo_ids), media_type="application/zip",
                    headers={"Content-Disposition": 'attachment; filename="minhas-fotos.zip"'})


@router.get("/stats")
def stats(event_id: int | None = None, session: Session = Depends(get_session)) -> dict:
    return service.stats(session, event_id)
```


- [ ] **Step 5: Rodar os testes**

Run: `cd backend && uv run pytest tests/test_photos_files.py tests/test_photos_upload.py -q`
Expected: `13 passed`

- [ ] **Step 6: Commit**

```bash
git add backend/src/foco/modules/photos/service.py backend/src/foco/modules/photos/router.py backend/tests/test_photos_files.py
git commit -m "ref(backend): Serve photo files, zip and stats from the photos module

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Progresso via SSE

**Files:**
- Modify: `backend/src/foco/modules/photos/service.py`, `backend/src/foco/modules/photos/router.py`
- Create: `backend/tests/test_progress.py`

- [ ] **Step 1: Escrever `backend/tests/test_progress.py`**

```python
import json

from factories import make_event, make_photo
from foco.modules.photos import service


def events_of(text):
    return [json.loads(line[len("data: "):]) for line in text.splitlines() if line.startswith("data: ")]


def test_snapshot_sem_ids_pega_so_pendentes(session):
    ev = make_event(session)
    q = make_photo(session, ev, status="queued")
    make_photo(session, ev, status="done")
    snap = service.progress_snapshot(session, ev.id, [])
    assert [i["id"] for i in snap["items"]] == [q.id]
    assert snap["done"] is False and snap["queue"] == 1


def test_snapshot_com_ids(session):
    ev = make_event(session)
    a = make_photo(session, ev, status="done")
    b = make_photo(session, ev, status="error")
    snap = service.progress_snapshot(session, ev.id, [a.id, b.id])
    assert {i["id"] for i in snap["items"]} == {a.id, b.id}
    assert snap["done"] is True


def test_sse_termina_quando_tudo_acaba(client, session):
    ev = make_event(session)
    p = make_photo(session, ev, status="done")
    session.commit()
    r = client.get(f"/api/events/{ev.id}/progress?ids={p.id}")
    assert r.headers["content-type"].startswith("text/event-stream")
    [msg] = events_of(r.text)
    assert msg["done"] is True and msg["items"][0]["status"] == "done"


def test_sse_evento_inexistente_404(client):
    assert client.get("/api/events/999999/progress").status_code == 404
```

- [ ] **Step 2: Ver falhar**

Run: `cd backend && uv run pytest tests/test_progress.py -q`
Expected: FAIL com `AttributeError: module 'foco.modules.photos.service' has no attribute 'progress_snapshot'`

- [ ] **Step 3: Acrescentar em `backend/src/foco/modules/photos/service.py`**

```python
def progress_snapshot(session: Session, event_id: int, wanted: list[int]) -> dict:
    """Status das fotos pedidas (ou de todas as pendentes do evento, sem ids)."""
    q = select(Photo).where(Photo.event_id == event_id)
    q = q.where(Photo.id.in_(wanted)) if wanted else q.where(Photo.status.in_(PENDING))
    items = [photo_json(p) for p in session.scalars(q.order_by(Photo.id))]
    return {
        "items": items,
        "done": all(i["status"] in ("done", "error") for i in items),
        # fila inteira (todos os eventos): o worker é um só
        "queue": session.scalar(select(func.count()).select_from(Photo).where(Photo.status.in_(PENDING))),
    }
```

- [ ] **Step 4: Acrescentar em `backend/src/foco/modules/photos/router.py`**

Imports:

```python
import asyncio
import json

from fastapi.responses import StreamingResponse

from foco.core.db import SessionFactory, get_session_factory
```

Rota:

```python
@router.get("/events/{event_id}/progress")
async def progress(event_id: int, ids: str = "",
                   factory: SessionFactory = Depends(get_session_factory)) -> StreamingResponse:
    """Server-Sent Events: empurra o status das fotos até todas terminarem.

    SSE é só uma resposta HTTP que nunca fecha, onde o servidor escreve
    linhas "data: ...\\n\\n". O navegador lê com `new EventSource(url)`.
    O status vive no Postgres (o worker é outro processo), então cada volta
    abre uma sessão curta e lê o banco.
    """
    with factory() as s:
        events.get_or_404(s, event_id)
    wanted = [int(x) for x in ids.split(",") if x.strip().isdigit()]

    def snapshot() -> dict:
        with factory() as s:
            return service.progress_snapshot(s, event_id, wanted)

    async def stream():
        last = None
        while True:
            snap = await asyncio.to_thread(snapshot)   # consulta síncrona fora do event loop
            payload = json.dumps(snap)
            if payload != last:   # só envia quando algo mudou
                yield f"data: {payload}\n\n"
                last = payload
            if snap["done"]:
                return
            await asyncio.sleep(0.4)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
```

- [ ] **Step 5: Rodar os testes**

Run: `cd backend && uv run pytest tests/test_progress.py -q`
Expected: `4 passed`

- [ ] **Step 6: Commit**

```bash
git add backend/src/foco/modules/photos/service.py backend/src/foco/modules/photos/router.py backend/tests/test_progress.py
git commit -m "ref(backend): Stream indexing progress from Postgres

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Token da busca

**Files:**
- Create: `backend/src/foco/modules/search/__init__.py`, `backend/src/foco/modules/search/token.py`, `backend/tests/test_search_token.py`

- [ ] **Step 1: Escrever `backend/tests/test_search_token.py`**

```python
import numpy as np

from factories import unit
from foco.core import signing
from foco.modules.search import token

KEY = "k" * 40
NOW = 1_800_000_000


def test_ida_e_volta():
    v = unit(3) * 0.6 + unit(7) * 0.8          # norma 1
    back = token.read(token.issue(v, KEY, now=NOW), KEY, now=NOW)
    assert back.dtype == np.float32
    assert abs(float(back @ v) - 1.0) < 1e-3   # float16: erro na 4ª casa


def test_tamanho():
    assert len(token.issue(unit(0), KEY, now=NOW)) < 1500


def test_expira_em_uma_hora():
    t = token.issue(unit(0), KEY, now=NOW)
    assert token.read(t, KEY, now=NOW + token.TTL - 1) is not None
    assert token.read(t, KEY, now=NOW + token.TTL) is None


def test_adulterado_ou_de_outra_finalidade():
    assert token.read("lixo", KEY, now=NOW) is None
    other = signing.sign(b"\0" * 1024, purpose="admin", key=KEY, ttl=60, now=NOW)
    assert token.read(other, KEY, now=NOW) is None


def test_payload_de_tamanho_errado():
    short = signing.sign(b"\0" * 10, purpose=token.PURPOSE, key=KEY, ttl=60, now=NOW)
    assert token.read(short, KEY, now=NOW) is None
```

- [ ] **Step 2: Ver falhar**

Run: `cd backend && uv run pytest tests/test_search_token.py -q`
Expected: FAIL com `ModuleNotFoundError: No module named 'foco.modules.search'`

- [ ] **Step 3: Criar `backend/src/foco/modules/search/__init__.py`** (vazio) e **`backend/src/foco/modules/search/token.py`**

```python
"""
token.py — o embedding da selfie volta para o navegador, assinado.

Mover o slider refaz a busca SEM rodar a rede de novo (~1 ms em vez de
~300 ms): o navegador devolve o token e o servidor só confere a assinatura.
Nada da selfie fica no servidor entre requests (nem disco, nem banco, nem
memória), e qualquer réplica da API atende.

float16: 1 KB em vez de 2 KB; o score muda só na 4ª casa decimal.
"""

import numpy as np

from foco.core import signing
from foco.modules.photos.models import EMBEDDING_DIM

PURPOSE = "search"
TTL = 3600


def issue(embedding: np.ndarray, key: str, now: float | None = None) -> str:
    return signing.sign(embedding.astype(np.float16).tobytes(), purpose=PURPOSE, key=key, ttl=TTL, now=now)


def read(tok: str | None, key: str, now: float | None = None) -> np.ndarray | None:
    """Embedding float32 de norma 1, ou None se o token é inválido ou expirou."""
    payload = signing.verify(tok, purpose=PURPOSE, key=key, now=now)
    if payload is None or len(payload) != EMBEDDING_DIM * 2:
        return None
    emb = np.frombuffer(payload, dtype=np.float16).astype(np.float32)
    norm = np.linalg.norm(emb)
    return emb / norm if norm else None
```

- [ ] **Step 4: Rodar os testes**

Run: `cd backend && uv run pytest tests/test_search_token.py -q`
Expected: `5 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/src/foco/modules/search backend/tests/test_search_token.py
git commit -m "ref(backend): Carry the selfie embedding in a signed token

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: Busca com pgvector

**Files:**
- Create: `backend/src/foco/modules/search/service.py`, `backend/src/foco/modules/search/router.py`, `backend/tests/test_search.py`
- Modify: `backend/src/foco/main.py`

- [ ] **Step 1: Escrever `backend/tests/test_search.py`**

```python
import numpy as np
import pytest

from conftest import SECRET
from factories import make_event, make_photo, unit
from fakes import png
from foco.modules.features import service as features
from foco.modules.search import service, token

BOX = (10, 10, 50, 50)


@pytest.fixture
def ev(session):
    """Foto 1: a pessoa 1. Foto 2: outra pessoa (unit(2), score 0 com a selfie)."""
    e = make_event(session)
    make_photo(session, e, faces=[(BOX, unit(1), 0.9)])
    make_photo(session, e, faces=[(BOX, unit(2), 0.9)])
    session.commit()
    return e


def search(client, eid, **data):
    files = {"selfie": ("s.png", data.pop("selfie"), "image/png")} if "selfie" in data else None
    return client.post("/api/search", data={"event_id": eid, "threshold": 0.4, **data}, files=files)


def test_selfie_acha_a_foto(client, ev):
    r = search(client, ev.id, selfie=png(r=1))
    assert r.status_code == 200, r.text
    body = r.json()
    assert [m["score"] for m in body["matches"]] == [1.0]
    assert body["selfie"]["n_faces"] == 1 and body["selfie"]["warning"] is None
    assert (body["total_photos"], body["indexed_faces"]) == (2, 2)
    assert body["query_token"]
    for k in ("debug_top", "timings_ms", "timings_from_cache"):
        assert k not in body


def test_token_refaz_a_busca_sem_selfie(client, ev, detector):
    tok = search(client, ev.id, selfie=png(r=1)).json()["query_token"]
    r = search(client, ev.id, query_token=tok)
    assert r.status_code == 200
    assert len(r.json()["matches"]) == 1
    assert "selfie" not in r.json()
    assert detector.calls == 1   # a rede não rodou de novo


def test_varios_rostos_na_selfie_usa_o_maior(client, ev):
    body = search(client, ev.id, selfie=png(r=1, g=2)).json()
    assert body["selfie"]["n_faces"] == 2 and body["selfie"]["warning"]
    assert [m["score"] for m in body["matches"]] == [1.0]   # o maior é a pessoa 1


def test_um_resultado_por_foto(client, session):
    e = make_event(session)
    near = unit(1) + 0.1 * unit(3)
    make_photo(session, e, faces=[(BOX, unit(1), 0.9), (BOX, near / np.linalg.norm(near), 0.9)])
    session.commit()
    matches = search(client, e.id, selfie=png(r=1)).json()["matches"]
    assert len(matches) == 1 and matches[0]["score"] == 1.0


def test_calibracao_ligada(client, ev, session):
    features.set_enabled(session, "calibration", True)
    body = search(client, ev.id, selfie=png(r=1)).json()
    assert [d["above"] for d in body["debug_top"]] == [True, False]
    assert {"decode", "detection", "embedding", "search"} <= body["timings_ms"].keys()
    assert body["timings_from_cache"] is False

    body = search(client, ev.id, query_token=body["query_token"]).json()
    assert body["timings_ms"].keys() == {"search"}
    assert body["timings_from_cache"] is True


def test_calibracao_desligada_nem_calcula_top30(client, ev, monkeypatch):
    calls = []
    original = service._query
    monkeypatch.setattr(service, "_query", lambda *a, **k: calls.append(k) or original(*a, **k))
    search(client, ev.id, selfie=png(r=1))
    assert calls and all("limit" not in k for k in calls)


def test_threshold_limitado_ao_intervalo_dos_sliders(client, ev):
    body = search(client, ev.id, selfie=png(r=1), threshold=-1).json()
    assert body["threshold"] == 0.15 and len(body["matches"]) == 1   # o desconhecido (0) não volta
    assert search(client, ev.id, selfie=png(r=1), threshold=5).json()["threshold"] == 0.80


def test_token_adulterado_410(client, ev):
    r = search(client, ev.id, query_token="lixo.lixo")
    assert r.status_code == 410
    assert r.json() == {"detail": "Busca expirada. Envie a selfie de novo."}


def test_token_expirado_410(client, ev):
    old = token.issue(unit(1), SECRET, now=1)
    assert search(client, ev.id, query_token=old).status_code == 410


def test_sem_selfie_nem_token_400(client, ev):
    assert search(client, ev.id).status_code == 400


def test_selfie_sem_rosto_422(client, ev):
    assert search(client, ev.id, selfie=png()).status_code == 422


def test_selfie_invalida_422(client, ev):
    assert search(client, ev.id, selfie=b"nao e imagem").status_code == 422


def test_evento_inexistente_404(client):
    assert search(client, 999_999, selfie=png(r=1)).status_code == 404
```

- [ ] **Step 2: Ver falhar**

Run: `cd backend && uv run pytest tests/test_search.py -q`
Expected: FAIL (404/405 em `POST /api/search` e `ImportError` de `service`)

- [ ] **Step 3: Criar `backend/src/foco/modules/search/service.py`**

```python
"""
service.py — "quais fotos deste evento têm o rosto desta selfie?"

O THRESHOLD é o corte de similaridade (cosseno) acima do qual dizemos
"é a mesma pessoa". Ele é a única decisão "humana" do sistema:
  - mais alto => menos fotos erradas (falsos positivos), mas perde fotos
    suas com ângulo/luz ruins (falsos negativos);
  - mais baixo => acha mais fotos suas, mas começa a trazer desconhecidos.

Embeddings têm norma 1, então o `<#>` do pgvector (produto interno com sinal
trocado) é -cosseno: "score > corte" vira "embedding <#> q < -corte". A busca
é exata, rosto a rosto dentro do evento (ver a migração 0001).
"""

import time

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from foco.core.errors import Gone, Invalid, Unprocessable
from foco.modules.events import service as events
from foco.modules.photos.models import Face, Photo
from foco.modules.search import token
from foco.vision.detector import Detector
from foco.vision.images import load_image

DEBUG_TOP_K = 30
# Mesmo intervalo dos sliders da UI. Abaixo dele os "matches" trariam
# desconhecidos (threshold negativo = todos os rostos do evento).
THRESHOLD_MIN, THRESHOLD_MAX = 0.15, 0.80


def _ms(t0: float) -> float:
    return (time.perf_counter() - t0) * 1000


def _selfie(detector: Detector, data: bytes) -> tuple[np.ndarray, dict, dict]:
    t0 = time.perf_counter()
    try:
        img = load_image(data)
    except Exception:
        raise Unprocessable("Não consegui abrir esta imagem.") from None
    timings = {"decode": _ms(t0)}
    faces, t = detector.analyze(img)
    timings.update(t)
    if not faces:
        raise Unprocessable("Nenhum rosto encontrado na selfie. Tente com mais luz e o rosto de frente.")
    # Várias pessoas na selfie? Usamos o maior rosto (provavelmente quem segura a câmera).
    faces.sort(key=lambda f: (f["bbox"][2] - f["bbox"][0]) * (f["bbox"][3] - f["bbox"][1]), reverse=True)
    main = faces[0]
    info = {
        "bbox": main["bbox"], "det_score": main["det_score"], "n_faces": len(faces),
        "all_bboxes": [f["bbox"] for f in faces], "width": img.width, "height": img.height,
        "warning": f"{len(faces)} rostos na selfie — usando o maior." if len(faces) > 1 else None,
    }
    return main["embedding"], info, timings


def _query(session: Session, event_id: int, emb: np.ndarray, *,
           threshold: float | None = None, limit: int | None = None) -> list[dict]:
    """Rostos do evento em ordem de semelhança: acima do corte, ou os `limit` primeiros."""
    dist = Face.embedding.max_inner_product(emb)   # = -cosseno
    q = (
        select(Face.id, Face.photo_id, Face.x1, Face.y1, Face.x2, Face.y2, (-dist).label("score"),
               Photo.filename, Photo.width, Photo.height)
        .join(Photo, Photo.id == Face.photo_id)
        .where(Face.event_id == event_id)
    )
    if threshold is not None:
        q = q.where(dist < -threshold)
    q = q.order_by(dist)
    if limit is not None:
        q = q.limit(limit)
    return [
        {"face_id": r.id, "photo_id": r.photo_id, "score": round(float(r.score), 4),
         "bbox": [r.x1, r.y1, r.x2, r.y2], "width": r.width, "height": r.height, "filename": r.filename}
        for r in session.execute(q)
    ]


def search(session: Session, detector: Detector, secret_key: str, *, event_id: int, threshold: float,
           selfie: bytes | None, query_token: str | None, calibration: bool) -> dict:
    threshold = min(max(threshold, THRESHOLD_MIN), THRESHOLD_MAX)
    events.get_or_404(session, event_id)
    out: dict = {}

    if selfie is not None:
        emb, out["selfie"], timings = _selfie(detector, selfie)
        query_token = token.issue(emb, secret_key)
    elif query_token:
        emb = token.read(query_token, secret_key)
        if emb is None:
            raise Gone("Busca expirada. Envie a selfie de novo.")
        timings = {}   # a rede não rodou: o front reaproveita os tempos da 1ª busca
    else:
        raise Invalid("envie 'selfie' ou um 'query_token' válido")

    t0 = time.perf_counter()
    hits = _query(session, event_id, emb, threshold=threshold)
    # Calibração desligada: nada de top 30 (rostos de OUTRAS pessoas abaixo do corte). Nem calcula.
    top = _query(session, event_id, emb, limit=DEBUG_TOP_K) if calibration else []
    timings["search"] = _ms(t0)

    # Uma foto pode ter vários rostos parecidos com a selfie (ex.: gêmeos, ou
    # um reflexo). A galeria quer FOTOS: fica o melhor rosto de cada foto.
    # hits já vem ordenado por score, o 1º de cada foto vence.
    matches, seen = [], set()
    for h in hits:
        if h["photo_id"] not in seen:
            seen.add(h["photo_id"])
            matches.append(h)

    out.update(
        query_token=query_token,
        threshold=threshold,
        total_photos=session.scalar(
            select(func.count()).select_from(Photo).where(Photo.event_id == event_id, Photo.status == "done")
        ),
        indexed_faces=session.scalar(select(func.count()).select_from(Face).where(Face.event_id == event_id)),
        matches=matches,
    )
    if calibration:
        out["timings_ms"] = {k: round(v, 1) for k, v in timings.items()}
        out["timings_from_cache"] = selfie is None
        out["debug_top"] = [{**f, "above": f["score"] > threshold} for f in top]
    return out
```

- [ ] **Step 4: Criar `backend/src/foco/modules/search/router.py`**

```python
from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.orm import Session

from foco.core.config import Settings, get_settings
from foco.core.db import get_session
from foco.modules.features import service as features
from foco.modules.search import service
from foco.vision.detector import Detector, get_detector

router = APIRouter(prefix="/api", tags=["search"])


@router.post("/search")
def search(
    event_id: int = Form(...),
    threshold: float = Form(0.40),
    selfie: UploadFile | None = File(None),
    query_token: str | None = Form(None),
    session: Session = Depends(get_session),
    detector: Detector = Depends(get_detector),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Busca as fotos de um evento que contêm o rosto da selfie (ou do query_token)."""
    return service.search(
        session, detector, settings.secret_key,
        event_id=event_id, threshold=threshold,
        selfie=selfie.file.read() if selfie is not None else None,
        query_token=query_token,
        calibration=features.is_enabled(session, "calibration"),
    )
```

- [ ] **Step 5: Incluir o router em `backend/src/foco/main.py`**

Import:

```python
from foco.modules.search.router import router as search_router
```

Tupla:

```python
    for router in (health_router, events_router, photos_router, search_router, features_router, admin_router):
```

- [ ] **Step 6: Rodar os testes**

Run: `cd backend && uv run pytest tests/test_search.py -q`
Expected: `13 passed`

- [ ] **Step 7: Rodar a suíte inteira e o lint**

Run: `make test && make lint`
Expected: todos passam, sem erro de ruff. Se o `ruff format --check` reclamar, rode `make fmt` e confira o diff.

- [ ] **Step 8: Commit**

```bash
git add backend/src/foco/modules/search backend/src/foco/main.py backend/tests/test_search.py
git commit -m "ref(backend): Search faces with pgvector and a stateless token

Replace the in-memory FAISS indexes and selfie cache: any API replica can
answer, and restarts no longer rebuild anything.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: Ajustes no frontend atual

**Files:**
- Modify: `static/app.js`

- [ ] **Step 1: Trocar o estado da busca (linha 17)**

Trocar:

```js
  queryId: null,      // id da selfie já processada no servidor (cache do embedding)
```

por:

```js
  queryToken: null,   // embedding da selfie assinado pelo servidor: refaz a busca sem reenviar a foto
  selfieInfo: null,   // rosto usado na busca (só vem na resposta com selfie)
  firstTimings: null, // tempos da busca com selfie, reaproveitados na Calibração
```

- [ ] **Step 2: Ajustar `fmtDate` (linhas 69-71)**

Trocar:

```js
function fmtDate(sqlTs) {
  // created_at vem do SQLite em UTC ("2026-09-29 00:49:24")
  const d = new Date(sqlTs.replace(" ", "T") + "Z");
```

por:

```js
function fmtDate(ts) {
  // created_at vem do Postgres em ISO 8601 com fuso ("2026-09-29T00:49:24.123+00:00")
  const d = new Date(ts);
```

- [ ] **Step 3: Ajustar `clearSearch` (linha 711)**

Trocar `  state.queryId = null;` por:

```js
  state.queryToken = null;
  state.selfieInfo = null;
  state.firstTimings = null;
```

- [ ] **Step 4: Ajustar `runSearch` (linhas 746-751)**

Trocar `  else fd.append("query_id", state.queryId);` por:

```js
  else fd.append("query_token", state.queryToken);
```

Trocar `    state.queryId = r.query_id;` por:

```js
    state.queryToken = r.query_token;
    // A busca pelo token não traz a selfie nem os tempos da detecção: reaproveita os da primeira.
    if (r.selfie) {
      state.selfieInfo = r.selfie;
      state.firstTimings = r.timings_ms ?? null;
    } else {
      r.selfie = state.selfieInfo;
      if (r.timings_ms && state.firstTimings) r.timings_ms = { ...state.firstTimings, search: r.timings_ms.search };
    }
```

- [ ] **Step 5: Ajustar o tratamento de erro de `runSearch` (linhas 771-772)**

Trocar:

```js
    // query_id esquecido (servidor reiniciou): reenvia a selfie guardada.
    if (err.status === 400 && !blob && state.selfieBlob) return runSearch({ blob: state.selfieBlob });
```

por:

```js
    // token expirado (410): reenvia a selfie guardada.
    if (err.status === 410 && !blob && state.selfieBlob) return runSearch({ blob: state.selfieBlob });
```

- [ ] **Step 6: Ajustar `researchSoon` (linha 839)**

Trocar `if (state.queryId) runSearch();` por `if (state.queryToken) runSearch();`.

- [ ] **Step 7: Conferir**

Run: `grep -n "queryId\|query_id" static/app.js; node --check static/app.js && echo OK`
Expected: nenhuma linha do grep, depois `OK`.

- [ ] **Step 8: Commit**

```bash
git add static/app.js
git commit -m "ref(ui): Search with the signed query token

Keep the selfie info and first timings on the client, since token searches
no longer return them, and resend the selfie when the token expires.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 21: Docker e compose de produção

**Files:**
- Modify: `Dockerfile` (reescrito), `docker-compose.yml` (reescrito), `.dockerignore`
- Create: `.env.example`

- [ ] **Step 1: Reescrever o `Dockerfile`**

```dockerfile
FROM python:3.11-slim

# libgl1 + libglib2.0-0: o insightface puxa o opencv-python "completo", que
# precisa dessas libs mesmo sem interface gráfica. curl: HEALTHCHECK.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
        curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH" \
    INSIGHTFACE_ROOT=/models \
    DATA_DIR=/data \
    STATIC_DIR=/app/static

WORKDIR /app

# Dependências primeiro (camada em cache enquanto o uv.lock não muda).
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Baixa o buffalo_l (~280MB) no build, para o container não depender da
# internet nem atrasar o primeiro boot baixando o modelo.
RUN python -c "from insightface.app import FaceAnalysis; \
FaceAnalysis(name='buffalo_l', root='/models', allowed_modules=['detection','recognition'], providers=['CPUExecutionProvider'])"

COPY backend/src ./src
COPY backend/alembic.ini ./
COPY backend/migrations ./migrations
RUN uv sync --frozen --no-dev
COPY static ./static

# Sem root. O host precisa dar a pasta de arquivos para o uid 1000 (ver README).
RUN useradd --system --uid 1000 foco && mkdir -p /data && chown foco /data
USER foco

EXPOSE 8000

# start-period cobre a carga do modelo no boot.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -fsS http://localhost:8000/api/health || exit 1

# 0.0.0.0 aqui é DENTRO do container: nenhuma porta é publicada no host, só o
# Caddy alcança o serviço pela rede "web".
CMD ["uvicorn", "--factory", "foco.main:create_app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 2: Reescrever o `docker-compose.yml`**

```yaml
# Produção (VPS). Segredos no .env ao lado deste arquivo (fora do git), veja
# .env.example. Subir/atualizar:  docker compose up -d --build
x-logging: &logging
  # uvicorn loga uma linha por request; sem limite o log cresce para sempre.
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"

x-app: &app
  build: .
  image: face-tracking-app
  restart: unless-stopped
  environment:
    DATABASE_URL: postgresql+psycopg://foco:${POSTGRES_PASSWORD}@db:5432/foco
    SECRET_KEY: ${SECRET_KEY:?defina SECRET_KEY no .env}
    # Vazia = backoffice desligado.
    ADMIN_PASSWORD: ${ADMIN_PASSWORD:-}
  volumes:
    # Fotos originais, miniaturas e versões médias. Bind mount (não volume
    # nomeado) para ficar visível no host: backup com rsync/tar.
    - ./data/files:/data
  logging: *logging

services:
  db:
    image: pgvector/pgvector:pg17
    container_name: face-tracking-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: foco
      POSTGRES_DB: foco
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?defina POSTGRES_PASSWORD no .env}
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U foco -d foco"]
      interval: 5s
      timeout: 3s
      retries: 10
    networks: [backend]
    logging: *logging

  migrate:
    <<: *app
    container_name: face-tracking-migrate
    restart: "no"
    command: ["alembic", "upgrade", "head"]
    depends_on:
      db:
        condition: service_healthy
    networks: [backend]

  api:
    <<: *app
    # Mesmo nome de antes: o Caddyfile continua com reverse_proxy face-tracking:8000.
    container_name: face-tracking
    depends_on:
      migrate:
        condition: service_completed_successfully
    networks: [web, backend]

  worker:
    <<: *app
    container_name: face-tracking-worker
    command: ["procrastinate", "--app=foco.worker.app", "worker", "--concurrency=1"]
    # Sem HTTP: o healthcheck da imagem (curl na API) não se aplica aqui.
    healthcheck:
      disable: true
    depends_on:
      migrate:
        condition: service_completed_successfully
    networks: [backend]

networks:
  web:
    external: true
  backend:
    # Só entre os containers: banco e worker não falam com a internet.
    internal: true
```

- [ ] **Step 3: Criar `.env.example`**

```bash
# Copie para .env (fora do git) e preencha. Gere valores só com letras e
# números (a senha do Postgres entra numa URL):
#   openssl rand -hex 24
POSTGRES_PASSWORD=
# Assina o token da selfie e o cookie do admin. Trocar derruba as sessões do admin.
#   openssl rand -hex 32
SECRET_KEY=
# Senha do backoffice (/#backoffice). Vazia = backoffice desligado.
ADMIN_PASSWORD=

# Só em dev (make api / make worker): banco do docker-compose.dev.yml.
DATABASE_URL=postgresql+psycopg://foco:foco@127.0.0.1:5432/foco
```

(Em produção o compose monta a `DATABASE_URL` a partir de `POSTGRES_PASSWORD` e ignora a linha de dev.)

- [ ] **Step 4: Reescrever o `.dockerignore`**

```
.git/
.github/
.venv/
**/.venv/
**/__pycache__/
**/*.pyc
.pytest_cache/
.ruff_cache/
data/
data-docker/
docs/
backend/tests/
*.md
.env
docker-compose*.yml
Caddyfile.example
Makefile
```

- [ ] **Step 5: Build e subida local do stack de produção**

O `.env` da raiz pode já existir (com `ADMIN_PASSWORD`): estes comandos só
criam o que falta, sem sobrescrever.

```bash
[ -f .env ] || cp .env.example .env
grep -q '^POSTGRES_PASSWORD=.' .env || { sed -i '/^POSTGRES_PASSWORD=/d' .env; echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" >> .env; }
grep -q '^SECRET_KEY=.' .env || { sed -i '/^SECRET_KEY=/d' .env; echo "SECRET_KEY=$(openssl rand -hex 32)" >> .env; }
grep -q '^DATABASE_URL=' .env || echo "DATABASE_URL=postgresql+psycopg://foco:foco@127.0.0.1:5432/foco" >> .env
docker network create web 2>/dev/null || true
mkdir -p data/files && sudo chown 1000:1000 data/files
docker compose up -d --build
```

Run: `docker compose ps && docker compose exec api curl -fsS localhost:8000/api/health`
Expected: `db`, `api` e `worker` com status `Up` (`db` e `api` `healthy`), `migrate` `Exited (0)`, e `{"ok":true}`.

Run: `docker compose logs worker | tail -5`
Expected: linhas do Procrastinate dizendo que o worker começou a escutar a fila (`Starting worker`), sem traceback.

Run: `docker compose down`

- [ ] **Step 6: Commit**

```bash
git add Dockerfile docker-compose.yml .env.example .dockerignore
git commit -m "build: Run api, worker and Postgres as separate services

The api keeps the face-tracking container name, so the VPS Caddyfile does
not change. Migrations run in a one-shot service before api and worker.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 22: CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Criar `.github/workflows/ci.yml`**

```yaml
name: ci

on:
  push:
  pull_request:

jobs:
  backend:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg17
        env:
          POSTGRES_USER: foco
          POSTGRES_PASSWORD: foco
          POSTGRES_DB: foco
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U foco"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v5
      - uses: astral-sh/setup-uv@v6
      - run: uv sync --frozen
      - run: uv run ruff check .
      - run: uv run ruff format --check .
      - run: uv run pytest -q
```

- [ ] **Step 2: Validar a sintaxe localmente**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('OK')"`
Expected: `OK` (se o PyYAML não estiver instalado: `cd backend && uv run --with pyyaml python -c "..."` com o mesmo código).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: Run ruff and pytest against pgvector on every push

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 23: Corte: remover o backend antigo e atualizar o README

**Files:**
- Delete: `api.py`, `store.py`, `detector.py`, `features.py`, `admin_auth.py`, `requirements.txt`, `requirements-dev.txt`, `pytest.ini`, `tests/`
- Modify: `README.md`

- [ ] **Step 1: Conferir que nada mais importa os arquivos antigos**

Run: `grep -rn "import store\|import api\|import detector\|import features\|import admin_auth\|requirements.txt\|pytest.ini" --include=*.py --include=*.yml --include=Dockerfile --include=Makefile . | grep -v "^./tests/\|^./api.py\|^./store.py\|^./detector.py\|^./features.py\|^./admin_auth.py\|/.venv/"`
Expected: nenhuma linha.

- [ ] **Step 2: Remover**

```bash
git rm -r api.py store.py detector.py features.py admin_auth.py requirements.txt requirements-dev.txt pytest.ini tests
```

- [ ] **Step 3: Atualizar o `README.md`**

Manter o título, a introdução e a seção "Desempenho medido". Substituir o resto por:

````markdown
## Arquitetura

| peça | papel |
|---|---|
| `backend/src/foco/` | pacote Python (FastAPI). `modules/` tem um pacote por domínio: `events`, `photos`, `search`, `features`, `admin` |
| `router.py` / `service.py` / `models.py` | HTTP / regra de negócio / tabelas (SQLAlchemy 2), em cada módulo |
| `core/` | config (`Settings`), banco, storage de arquivos, tokens assinados, erros |
| `vision/` | InsightFace: detecção (SCRFD) + embeddings (ArcFace). Sem estado |
| `worker.py` + `photos/tasks.py` | fila de tarefas (Procrastinate, no próprio Postgres): indexar fotos, apagar arquivos |
| Postgres + pgvector | fonte da verdade, inclusive os embeddings (`vector(512)`). A busca é SQL |
| `static/` | interface: `index.html`, `style.css`, `app.js` (sem build, sem CDN) |

Módulo novo (ex.: vendas) = pasta nova em `modules/`, router incluído em `main.py`,
modelos importados em `models.py` e uma migração (`make migration m="..."`).

## Desenvolvimento

Pré-requisitos: Docker (no WSL, ligar a integração do Docker Desktop) e
[uv](https://docs.astral.sh/uv/) (`curl -LsSf https://astral.sh/uv/install.sh | sh`).

```bash
[ -f .env ] || cp .env.example .env   # e preencha SECRET_KEY (openssl rand -hex 32)
make db                      # Postgres de dev em 127.0.0.1:5432
make migrate                 # cria as tabelas
make api                     # http://127.0.0.1:8000, com reload
make worker                  # em outro terminal: indexa as fotos enviadas
```

Na primeira execução o InsightFace baixa o `buffalo_l` (~280 MB) para `~/.insightface/models/`.

1. **Fotógrafo:** crie um evento, arraste as fotos. Cada uma mostra quantos rostos foram achados.
2. **Participante:** envie uma selfie (ou use a webcam), ajuste a semelhança mínima.
3. **Calibração:** os 30 rostos mais parecidos, inclusive os abaixo do corte, e o tempo de cada etapa. Só aparece se estiver ligada no [backoffice](#backoffice) (vem desligada).

Testes (Postgres de verdade, modelo falso): `make test`. Lint: `make lint` (corrigir: `make fmt`).
Teste com o modelo real: `cd backend && uv run pytest -m slow`.

Mudou um modelo? `make migration m="descreva a mudança"`, **revise** o arquivo
gerado em `backend/migrations/versions/` e rode `make migrate`.

## API

```bash
curl -X POST localhost:8000/api/events -H 'content-type: application/json' -d '{"name":"Corrida"}'
curl localhost:8000/api/events
curl -X POST localhost:8000/api/events/1/photos -F files=@a.jpg -F files=@b.jpg
curl -N "localhost:8000/api/events/1/progress?ids=1,2"      # SSE
curl -X POST localhost:8000/api/search -F event_id=1 -F threshold=0.4 -F selfie=@eu.jpg
curl -X POST localhost:8000/api/search -F event_id=1 -F threshold=0.3 -F query_token=<do passo anterior>
curl localhost:8000/api/photos/1/thumb -o t.jpg
curl "localhost:8000/api/photos/1/full?download=1" -O -J
curl "localhost:8000/api/zip?ids=1,2" -o fotos.zip
curl "localhost:8000/api/stats?event_id=1"
curl localhost:8000/api/health
curl localhost:8000/api/features
curl -c cj -H 'content-type: application/json' -d '{"password":"..."}' localhost:8000/api/admin/login
curl -b cj -X PUT -H 'content-type: application/json' -d '{"enabled":true}' localhost:8000/api/admin/features/calibration
```

O `query_token` carrega o embedding da selfie assinado pelo servidor e vale 1 h.
Nada da selfie fica guardado no servidor.

## Backoffice

Em `/#backoffice` o admin liga e desliga funcionalidades para todos os
visitantes, sem novo deploy. Hoje só tem a **Calibração**, que vem
**desligada**: com ela desligada a aba some e `/api/search` não devolve o top 30
nem os tempos (o top 30 mostra rostos de outras pessoas abaixo do corte).
A flag esconde a ferramenta de calibração, não é um controle de privacidade:
quem passa pelo `basic_auth` do Caddy ainda vê todas as fotos do evento na
Galeria e no Estúdio. O corte de semelhança é limitado no servidor ao intervalo
dos sliders (0.15 a 0.80).

O backoffice só existe se `ADMIN_PASSWORD` estiver definida. A sessão dura 12 h.
"Sair" só apaga o cookie deste navegador; para derrubar todas as sessões, troque
`ADMIN_PASSWORD` ou `SECRET_KEY` no `.env` e rode `docker compose up -d`.

## Deploy na VPS (Docker + Caddy)

Quatro serviços no `docker-compose.yml`: `db` (Postgres + pgvector), `migrate`
(aplica as migrações e sai), `api` e `worker`. Só a `api` está na rede externa
`web`, com o mesmo nome de container de antes (`face-tracking`): o bloco do
`Caddyfile.example` não muda.

**Antes:** confira a arquitetura da VPS com `uname -m`. Os arquivos foram pensados
para `x86_64` (linha CX/CPX).

Primeira instalação, ou migração da versão antiga (SQLite). A versão antiga
guardava tudo em `data/`; a nova começa do zero:

```bash
cd ~/face-tracking
git pull
docker compose down                       # para o container antigo
mv data data-antigo                       # apague depois de conferir a nova versão
# segredos: gera valores sem abrir editor (se o .env já existe, só acrescenta)
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" >> .env
echo "SECRET_KEY=$(openssl rand -hex 32)" >> .env
cat .env                                  # confira: ADMIN_PASSWORD, POSTGRES_PASSWORD, SECRET_KEY
mkdir -p data/files && sudo chown 1000:1000 data/files   # a app roda como uid 1000
docker compose up -d --build              # build ~3-5 min (baixa o modelo)
docker compose ps                         # db/api healthy, worker Up, migrate Exited (0)
docker compose exec api curl -fsS localhost:8000/api/health
```

Atualizar: `git pull && docker compose up -d --build`. As migrações novas rodam
sozinhas antes da API subir.

Backup:

```bash
docker compose exec -T db pg_dump -U foco foco | gzip > backup-$(date +%F).sql.gz   # banco
tar czf fotos-$(date +%F).tgz data/files                                          # arquivos
```

Não copie `data/postgres` com o banco rodando: use o `pg_dump`.
````

- [ ] **Step 4: Rodar tudo de novo**

Run: `make test && make lint`
Expected: todos passam.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "ref: Remove the old flat backend

Everything now lives in backend/src/foco. Update the README for uv, the
Makefile, the four-service deploy and Postgres backups.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(`git rm` do Step 2 já deixou as remoções no stage.)

---

### Task 24: Verificação de ponta a ponta com o frontend atual

Garante que o `app.js` segue funcionando com o backend novo e o modelo real.
Precisa de uma foto de evento com pelo menos um rosto e de uma selfie da mesma pessoa.
**Peça os caminhos ao usuário** se não houver fotos de teste à mão.

**Files:** nenhum no repositório (o script fica no scratchpad).

- [ ] **Step 1: Subir o ambiente de dev**

O `.env` precisa de `DATABASE_URL` e `SECRET_KEY` (a Task 21 já garante isso). Confira:
`grep -c '^DATABASE_URL=\|^SECRET_KEY=.' .env` deve dar `2`.

```bash
make db && make migrate
make api        # terminal 1
make worker     # terminal 2
```

Run: `curl -fsS 127.0.0.1:8000/api/health`
Expected: `{"ok":true}`

- [ ] **Step 2: Escrever o smoke em Playwright (use a skill playwright-skill)**

`smoke.mjs` no scratchpad:

```js
// SMOKE_PHOTO=/caminho/evento.jpg SMOKE_SELFIE=/caminho/selfie.jpg node smoke.mjs
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:8000";
const { SMOKE_PHOTO, SMOKE_SELFIE } = process.env;
const api = async (path, opts) => {
  const r = await fetch(BASE + path, opts);
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
};

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// 1. evento
const ev = await api("/api/events", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: `Smoke ${Date.now()}` }),
});

// 2. upload pela UI do Estúdio + indexação pelo worker
await page.goto(`${BASE}/#estudio?e=${ev.id}`);
await page.setInputFiles("#file-input", SMOKE_PHOTO);
let s;
for (let i = 0; i < 90; i++) {
  s = await api(`/api/stats?event_id=${ev.id}`);
  if (s.done + s.errors >= 1) break;
  await new Promise((r) => setTimeout(r, 1000));
}
if (s.done !== 1 || s.faces < 1) throw new Error(`indexação falhou: ${JSON.stringify(s)}`);

// 3. selfie na Galeria
await page.goto(`${BASE}/#galeria?e=${ev.id}`);
await page.setInputFiles("#selfie-input", SMOKE_SELFIE);
await page.locator("#gallery > *").first().waitFor({ timeout: 30000 });

// 4. slider: a nova busca vai pelo query_token, sem reenviar a selfie
const viaToken = page.waitForResponse((r) =>
  r.url().endsWith("/api/search") && r.status() === 200 && (r.request().postData() ?? "").includes("query_token"));
await page.locator("#thr").fill("0.3");
await viaToken;
await page.waitForTimeout(500);
await page.screenshot({ path: "smoke-galeria.png", fullPage: true });

// 5. excluir o evento pela API (a tarefa apaga os arquivos)
await api(`/api/events/${ev.id}`, { method: "DELETE" });

if (errors.length) throw new Error(`erros de JS: ${errors.join(" | ")}`);
console.log(`OK: evento ${ev.id}, ${s.faces} rosto(s), ${await page.locator("#gallery > *").count()} foto(s) na galeria`);
await browser.close();
```

- [ ] **Step 3: Rodar o smoke**

Run: `SMOKE_PHOTO=... SMOKE_SELFIE=... node smoke.mjs`
Expected: `OK: evento N, ...` e o screenshot `smoke-galeria.png` mostrando a foto na galeria. Abra o screenshot e confira.

- [ ] **Step 4: Conferir à mão o que o smoke não cobre**

No navegador, em `http://127.0.0.1:8000`:
- Estúdio: editar e excluir evento pelo diálogo; progresso de upload com várias fotos.
- Backoffice (`ADMIN_PASSWORD` no `.env`, reiniciar `make api`): login, ligar a Calibração.
- Calibração: régua com os 30 rostos, tempos por etapa. Mover o slider e ver os tempos marcados como cache.
- Baixar o zip das fotos encontradas.

- [ ] **Step 5: Critérios de pronto da spec**

Run: `grep -rn "os.environ" backend/src | grep -v "core/config.py"; ls *.py 2>/dev/null; make test && make lint`
Expected: nada no grep, nenhum `.py` na raiz, testes e lint passando.
````

