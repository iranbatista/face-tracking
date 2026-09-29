from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session

from foco.core.db import get_session
from foco.core.storage import Storage, get_storage
from foco.modules.events import service as events
from foco.modules.photos import service
from foco.modules.photos.schemas import SheetPhoto

router = APIRouter(prefix="/api", tags=["photos"])


@router.post("/events/{event_id}/photos")
def upload_photos(
    event_id: int,
    files: list[UploadFile] = File(...),
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
) -> list[dict]:
    events.get_or_404(session, event_id)
    return [service.add_photo(session, storage, event_id, f.filename, f.file.read()) for f in files]


@router.get("/events/{event_id}/photos")
def list_photos(event_id: int, limit: int = 500, session: Session = Depends(get_session)) -> list[SheetPhoto]:
    events.get_or_404(session, event_id)
    return service.list_photos(session, event_id, limit)
