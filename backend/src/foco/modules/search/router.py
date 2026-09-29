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
    event_id: int = Form(..., le=2**63 - 1),
    threshold: float = Form(0.40),
    selfie: UploadFile | None = File(None),
    query_token: str | None = Form(None),
    session: Session = Depends(get_session),
    detector: Detector = Depends(get_detector),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Busca as fotos de um evento que contêm o rosto da selfie (ou do query_token)."""
    return service.search(
        session,
        detector,
        settings.secret_key,
        event_id=event_id,
        threshold=threshold,
        selfie=selfie.file.read() if selfie is not None else None,
        query_token=query_token,
        calibration=features.is_enabled(session, "calibration"),
    )
