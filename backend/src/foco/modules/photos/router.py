import asyncio
import json
from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse
from sqlalchemy.orm import Session

from foco.core.db import SessionFactory, get_session, get_session_factory
from foco.core.errors import NotFound
from foco.core.params import MAX_BIGINT, BigId
from foco.core.storage import Storage, get_storage
from foco.modules.events import service as events
from foco.modules.photos import service
from foco.modules.photos.keys import thumb_key
from foco.modules.photos.schemas import SheetPhoto, StatsOut, UploadResult

router = APIRouter(prefix="/api", tags=["photos"])

CACHE = {"Cache-Control": "max-age=86400"}


def parse_ids(ids: str) -> list[int]:
    """ "1,2,3" -> [1, 2, 3]. Ignora o que não é inteiro positivo de bigint."""
    out = []
    for x in ids.split(","):
        x = x.strip()
        if x.isascii() and x.isdecimal() and len(x) <= 19 and 0 < int(x) < 2**63:
            out.append(int(x))
    return out


def existing(storage: Storage, key: str):
    if not storage.exists(key):
        raise NotFound("arquivo não encontrado")
    return storage.path(key)


@router.post("/events/{event_id}/photos", response_model_exclude_unset=True)
def upload_photos(
    event_id: BigId,
    files: list[UploadFile] = File(...),
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
) -> list[UploadResult]:
    events.get_or_404(session, event_id)
    saved = [service.add_photo(session, storage, event_id, f.filename, f.file.read()) for f in files]
    return [UploadResult(**r) for r in saved]


@router.get("/events/{event_id}/photos")
def list_photos(
    event_id: BigId,
    limit: Annotated[int, Query(ge=1, le=2000)] = 500,
    session: Session = Depends(get_session),
) -> list[SheetPhoto]:
    events.get_or_404(session, event_id)
    return service.list_photos(session, event_id, limit)


@router.get("/photos/{photo_id}/thumb", response_class=FileResponse)
def photo_thumb(
    photo_id: BigId, session: Session = Depends(get_session), storage: Storage = Depends(get_storage)
) -> FileResponse:
    p = service.get_or_404(session, photo_id)
    return FileResponse(existing(storage, thumb_key(p.sha256)), media_type="image/jpeg", headers=CACHE)


@router.get("/photos/{photo_id}/medium", response_class=FileResponse)
def photo_medium(
    photo_id: BigId, session: Session = Depends(get_session), storage: Storage = Depends(get_storage)
) -> FileResponse:
    p = service.get_or_404(session, photo_id)
    key = service.ensure_medium(storage, p)
    media_type = None if key == p.storage_key else "image/jpeg"
    return FileResponse(existing(storage, key), media_type=media_type, headers=CACHE)


@router.get("/photos/{photo_id}/full", response_class=FileResponse)
def photo_full(
    photo_id: BigId,
    download: bool = False,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
) -> FileResponse:
    p = service.get_or_404(session, photo_id)
    return FileResponse(existing(storage, p.storage_key), filename=p.filename if download else None)


@router.get("/zip", response_class=Response)
def download_zip(
    ids: str, session: Session = Depends(get_session), storage: Storage = Depends(get_storage)
) -> Response:
    photo_ids = parse_ids(ids)
    return Response(
        service.zip_photos(session, storage, photo_ids),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="minhas-fotos.zip"'},
    )


@router.get("/stats")
def stats(
    event_id: Annotated[int | None, Query(ge=1, le=MAX_BIGINT)] = None,
    session: Session = Depends(get_session),
) -> StatsOut:
    return StatsOut(**service.stats(session, event_id))


@router.get("/events/{event_id}/progress", response_class=StreamingResponse)
async def progress(
    event_id: BigId, ids: str = "", factory: SessionFactory = Depends(get_session_factory)
) -> StreamingResponse:
    """Server-Sent Events: empurra o status das fotos até todas terminarem.

    SSE é só uma resposta HTTP que nunca fecha, onde o servidor escreve
    linhas "data: ...\\n\\n". O navegador lê com `new EventSource(url)`.
    O status vive no Postgres (o worker é outro processo), então cada volta
    abre uma sessão curta e lê o banco.
    """
    with factory() as s:
        events.get_or_404(s, event_id)
    wanted = parse_ids(ids)

    def snapshot() -> dict:
        with factory() as s:
            return service.progress_snapshot(s, event_id, wanted)

    async def stream():
        last = None
        while True:
            snap = await asyncio.to_thread(snapshot)  # consulta síncrona fora do event loop
            payload = json.dumps(snap)
            if payload != last:  # só envia quando algo mudou
                yield f"data: {payload}\n\n"
                last = payload
            if snap["done"]:
                return
            await asyncio.sleep(0.4)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
