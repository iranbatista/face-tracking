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
        thumb = make_thumbnail(img)  # na hora: o Estúdio mostra a miniatura enquanto indexa
    except Exception:
        return {"filename": filename, "status": "error", "error": "arquivo não é uma imagem válida"}
    key = original_key(event_id, sha, filename)
    storage.save(key, data)  # original intacto, para download
    storage.save(thumb_key(sha), thumb)
    p = Photo(
        event_id=event_id,
        sha256=sha,
        filename=filename or "foto",
        storage_key=key,
        width=img.width,
        height=img.height,
        status="queued",
    )
    session.add(p)
    session.commit()
    tasks.defer_index(p.id)
    return {**photo_json(p), "duplicate": False}


def list_photos(session: Session, event_id: int, limit: int = 500) -> list[SheetPhoto]:
    """Fotos do evento, mais recentes primeiro (folha de contato do Estúdio)."""
    photos = list(
        session.scalars(
            select(Photo).where(Photo.event_id == event_id).order_by(Photo.id.desc()).limit(min(limit, 2000))
        )
    )
    focus = covers.focus_points(session, [p.id for p in photos])
    return [SheetPhoto(**photo_json(p), **focus[p.id]) for p in photos]


def get_or_404(session: Session, photo_id: int) -> Photo:
    p = session.get(Photo, photo_id)
    if p is None:
        raise NotFound("foto não encontrada")
    return p
