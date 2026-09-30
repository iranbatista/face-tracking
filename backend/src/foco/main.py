"""
main.py — monta o app FastAPI.

Rodar:  uvicorn --factory foco.main:create_app      (make api, em dev)
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, Depends, FastAPI
from fastapi.openapi.utils import get_openapi
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from foco.core.config import Settings, get_settings
from foco.core.db import get_session
from foco.core.errors import AppError, NotFound, install_handlers
from foco.modules.admin.router import router as admin_router
from foco.modules.events.router import router as events_router
from foco.modules.features.router import router as features_router
from foco.modules.photos.router import router as photos_router
from foco.modules.photos.schemas import ProgressOut
from foco.modules.search.router import router as search_router
from foco.vision.detector import get_detector
from foco.worker import app as worker_app

health_router = APIRouter()


class Health(BaseModel):
    ok: bool


class Unavailable(AppError):
    status_code = 503


@health_router.get("/api/health")
def health(session: Session = Depends(get_session)) -> Health:
    try:
        session.execute(text("SELECT 1"))
    except SQLAlchemyError:
        raise Unavailable("banco indisponível") from None
    return Health(ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # O upload enfileira com defer() síncrono: precisa do Procrastinate aberto.
    worker_app.open()
    try:
        # Carrega o modelo agora para a primeira selfie não pagar ~2 s.
        await asyncio.to_thread(get_detector().load)
        # Logger do uvicorn: a config padrão dele não mostra os loggers do app (root em WARNING).
        logging.getLogger("uvicorn.error").info("modelo buffalo_l carregado")
        yield
    finally:
        # Fecha o pool da fila mesmo se o startup falhar.
        worker_app.close()


class ImmutableStaticFiles(StaticFiles):
    """Arquivos com hash no nome (o Vite gera assets/app-3f9a.js): podem ficar
    em cache para sempre, porque um build novo gera outro nome."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


def mount_spa(app: FastAPI, static_dir: Path) -> None:
    """Frontend como SPA: o roteamento é do navegador (/galeria/4, /estudio...),
    então qualquer caminho que não seja da API nem um arquivo devolve o index.html.

    Sem a pasta (ex.: CI do backend, antes do build do front) só a API existe.
    """
    root = static_dir.resolve()
    index = root / "index.html"
    if not index.is_file():
        logging.getLogger("uvicorn.error").warning("frontend não encontrado em %s", root)
        return
    if (root / "assets").is_dir():
        app.mount("/assets", ImmutableStaticFiles(directory=root / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        if path == "api" or path.startswith("api/"):
            raise NotFound("rota não encontrada")
        candidate = (root / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(root):
            return FileResponse(candidate)
        # o index muda a cada build: o navegador sempre revalida
        return FileResponse(index, headers={"Cache-Control": "no-cache"})


def _openapi_with_extras(app: FastAPI):
    def build():
        if app.openapi_schema:
            return app.openapi_schema
        spec = get_openapi(title=app.title, version=app.version, routes=app.routes)
        # Payload do SSE de progresso: o front importa o tipo daqui.
        schemas = spec.setdefault("components", {}).setdefault("schemas", {})
        extra = ProgressOut.model_json_schema(ref_template="#/components/schemas/{model}")
        # $defs (PhotoOut) sobe para components.schemas, onde as rotas já o referenciam.
        for name, definition in extra.pop("$defs", {}).items():
            schemas.setdefault(name, definition)
        schemas["ProgressOut"] = extra
        app.openapi_schema = spec
        return spec

    return build


def create_app(settings: Settings | None = None) -> FastAPI:
    explicit = settings is not None
    settings = settings or get_settings()
    app = FastAPI(title="Foco", lifespan=lifespan)
    if explicit:
        # As rotas usam Depends(get_settings): sem isso veriam as Settings do
        # ambiente, e não as que foram passadas aqui. Só elas e o mount estático
        # usam as Settings explícitas; o engine, o conector do worker e o detector
        # ainda leem get_settings() do ambiente.
        app.dependency_overrides[get_settings] = lambda: settings
    install_handlers(app)
    for router in (health_router, events_router, photos_router, search_router, features_router, admin_router):
        app.include_router(router)
    app.openapi = _openapi_with_extras(app)
    # Frontend: por último, para o catch-all não "engolir" as rotas /api.
    mount_spa(app, settings.static_dir)
    return app
