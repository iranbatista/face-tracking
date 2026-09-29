"""
indexing.py — o trabalho pesado do worker. Recebe Session/Storage/Detector
prontos (as tarefas em tasks.py montam), então os testes chamam direto.
"""

import datetime as dt
import time

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from foco.core.storage import Storage
from foco.modules.photos.keys import medium_key, thumb_key
from foco.modules.photos.models import PENDING, Face, Photo
from foco.vision.detector import Detector
from foco.vision.images import load_image


def _fail(session: Session, photo: Photo, exc: Exception) -> None:
    photo.status, photo.error = "error", str(exc) or type(exc).__name__
    try:
        session.commit()
    except StaleDataError:  # a foto foi excluída enquanto isso
        session.rollback()


def index_photo(
    session: Session, storage: Storage, detector: Detector, photo_id: int, *, final_attempt: bool = True
) -> None:
    """Indexa uma foto: detectar rostos -> embeddings -> tabela faces.

    Idempotente: apaga os rostos anteriores da foto antes de inserir, então
    rodar de novo (retry, requeue_stuck) não duplica nada.
    final_attempt=False: uma falha do detector sobe a exceção, para o
    Procrastinate tentar de novo. Na última tentativa, a foto vira "error".
    """
    photo = session.get(Photo, photo_id)
    if photo is None:  # evento excluído enquanto a foto esperava na fila
        return
    photo.status, photo.error = "processing", None
    session.commit()

    t0 = time.perf_counter()
    try:
        img = load_image(storage.read(photo.storage_key))
    except OSError as e:  # arquivo sumiu ou está corrompido: tentar de novo não resolve
        _fail(session, photo, e)
        return
    try:
        faces, _ = detector.analyze(img)
    except Exception as e:
        if not final_attempt:
            raise
        _fail(session, photo, e)
        return

    try:
        session.execute(delete(Face).where(Face.photo_id == photo_id))
        session.add_all(
            [
                Face(
                    photo_id=photo_id,
                    event_id=photo.event_id,
                    x1=f["bbox"][0],
                    y1=f["bbox"][1],
                    x2=f["bbox"][2],
                    y2=f["bbox"][3],
                    det_score=f["det_score"],
                    embedding=f["embedding"],
                )
                for f in faces
            ]
        )
        photo.status, photo.n_faces = "done", len(faces)
        photo.proc_ms = (time.perf_counter() - t0) * 1000
        session.commit()
    except (IntegrityError, StaleDataError):
        # O evento foi excluído no meio da indexação (CASCADE levou a foto):
        # desfaz tudo, senão sobrariam rostos órfãos.
        session.rollback()


STUCK_AFTER = dt.timedelta(minutes=10)


def stuck_photo_ids(session: Session, now: dt.datetime | None = None) -> list[int]:
    """Fotos pendentes paradas há mais de 10 min: o defer falhou depois do
    commit, ou o worker morreu no meio da foto."""
    cutoff = (now or dt.datetime.now(dt.UTC)) - STUCK_AFTER
    return list(
        session.scalars(
            select(Photo.id).where(Photo.status.in_(PENDING), Photo.updated_at < cutoff).order_by(Photo.id)
        )
    )


def delete_event_files(
    session: Session, storage: Storage, event_id: int, keys: list[str], shas: list[str]
) -> None:
    """Apaga os arquivos de um evento já excluído do banco.

    Miniatura e versão média são nomeadas pelo hash: só saem se nenhuma outra
    foto (de outro evento) usa o mesmo conteúdo.
    """
    for key in keys:
        storage.delete(key)
    still_used = set(session.scalars(select(Photo.sha256).where(Photo.sha256.in_(shas))))
    for sha in set(shas) - still_used:
        storage.delete(thumb_key(sha))
        storage.delete(medium_key(sha))
    storage.delete_dir(f"photos/{event_id}")
