"""
main.py — monta o app FastAPI.

Rodar:  uvicorn --factory foco.main:create_app      (make api, em dev)
"""

import asyncio
import logging
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
from foco.modules.events.router import router as events_router
from foco.modules.features.router import router as features_router
from foco.modules.photos.router import router as photos_router
from foco.modules.search.router import router as search_router
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
    try:
        # Carrega o modelo agora para a primeira selfie não pagar ~2 s.
        await asyncio.to_thread(get_detector().load)
        # Logger do uvicorn: a config padrão dele não mostra os loggers do app (root em WARNING).
        logging.getLogger("uvicorn.error").info("modelo buffalo_l carregado")
        yield
    finally:
        # Fecha o pool da fila mesmo se o startup falhar.
        worker_app.close()


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
    # Frontend: montado por último para não "engolir" as rotas /api.
    app.mount("/", StaticFiles(directory=settings.static_dir, html=True), name="static")
    return app
