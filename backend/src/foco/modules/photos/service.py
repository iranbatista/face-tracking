"""
service.py — o lado da API das fotos: upload, listagens, arquivos, stats.
A indexação (lado do worker) fica em indexing.py.
"""

import hashlib
import io
import zipfile

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from foco.core.errors import Invalid, NotFound
from foco.core.storage import Storage
from foco.modules.events.models import Event
from foco.modules.photos import covers, tasks
from foco.modules.photos.keys import medium_key, original_key, thumb_key
from foco.modules.photos.models import PENDING, Photo
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
        "photos": r.photos,
        "done": r.done,
        "pending": r.pending,
        "errors": r.errors,
        "faces": r.faces,
        "avg_ms_per_photo": round(r.avg_ms, 1) if r.avg_ms else None,
    }
