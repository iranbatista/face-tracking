from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from foco.core.db import get_session
from foco.modules.features import service

router = APIRouter(prefix="/api", tags=["features"])


@router.get("/features")
def get_features(session: Session = Depends(get_session)) -> dict[str, bool]:
    """Público: o frontend decide o que mostrar (a API bloqueia por conta própria)."""
    return service.all_flags(session)
