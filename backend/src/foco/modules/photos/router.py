from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from foco.core.db import get_session
from foco.core.storage import Storage, get_storage
from foco.modules.events import service as events
from foco.modules.photos import service
from foco.modules.photos.keys import thumb_key
from foco.modules.photos.schemas import SheetPhoto

router = APIRouter(prefix="/api", tags=["photos"])

CACHE = {"Cache-Control": "max-age=86400"}


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


@router.get("/photos/{photo_id}/thumb")
def photo_thumb(
    photo_id: int, session: Session = Depends(get_session), storage: Storage = Depends(get_storage)
) -> FileResponse:
    p = service.get_or_404(session, photo_id)
    return FileResponse(storage.path(thumb_key(p.sha256)), media_type="image/jpeg", headers=CACHE)


@router.get("/photos/{photo_id}/medium")
def photo_medium(
    photo_id: int, session: Session = Depends(get_session), storage: Storage = Depends(get_storage)
) -> FileResponse:
    p = service.get_or_404(session, photo_id)
    key = service.ensure_medium(storage, p)
    media_type = None if key == p.storage_key else "image/jpeg"
    return FileResponse(storage.path(key), media_type=media_type, headers=CACHE)


@router.get("/photos/{photo_id}/full")
def photo_full(
    photo_id: int,
    download: bool = False,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
) -> FileResponse:
    p = service.get_or_404(session, photo_id)
    return FileResponse(storage.path(p.storage_key), filename=p.filename if download else None)


@router.get("/zip")
def download_zip(
    ids: str, session: Session = Depends(get_session), storage: Storage = Depends(get_storage)
) -> Response:
    photo_ids = [int(x) for x in ids.split(",") if x.strip().isdigit()]
    return Response(
        service.zip_photos(session, storage, photo_ids),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="minhas-fotos.zip"'},
    )


@router.get("/stats")
def stats(event_id: int | None = None, session: Session = Depends(get_session)) -> dict:
    return service.stats(session, event_id)
