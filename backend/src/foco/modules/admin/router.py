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
from foco.modules.admin.schemas import AdminSession, FeatureInfo
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
async def login(
    body: LoginIn, request: Request, response: Response, settings: Settings = Depends(get_settings)
) -> None:
    if not settings.admin_password:
        raise NotFound("Backoffice desativado.")
    if not auth.check_password(body.password, settings.admin_password):
        await asyncio.sleep(auth.FAIL_DELAY)
        raise Unauthorized("Senha incorreta.")
    response.set_cookie(
        auth.COOKIE,
        auth.issue(settings),
        max_age=auth.TTL,
        path="/",
        httponly=True,
        samesite="strict",
        secure=_is_https(request),
    )


@router.post("/logout", status_code=204)
def logout(response: Response) -> None:
    response.delete_cookie(auth.COOKIE, path="/", httponly=True, samesite="strict")


@router.get("/session")
def session_state(request: Request, settings: Settings = Depends(get_settings)) -> AdminSession:
    return AdminSession(
        enabled=bool(settings.admin_password),
        logged_in=auth.verify(request.cookies.get(auth.COOKIE), settings),
    )


@router.get("/features", dependencies=[Depends(require_admin)])
def list_features(session: Session = Depends(get_session)) -> list[FeatureInfo]:
    return [FeatureInfo(**f) for f in features.describe(session)]


@router.put("/features/{key}", dependencies=[Depends(require_admin)])
def set_feature(key: str, body: FeatureIn, session: Session = Depends(get_session)) -> FeatureInfo:
    try:
        features.set_enabled(session, key, body.enabled)
    except KeyError:
        raise NotFound("Funcionalidade desconhecida.") from None
    return FeatureInfo(**next(f for f in features.describe(session) if f["key"] == key))
