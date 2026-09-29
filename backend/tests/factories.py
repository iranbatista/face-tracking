"""Atalhos para criar dados de teste direto pelo ORM (sem passar pela API)."""

import uuid

import numpy as np

from foco.modules.events.models import Event
from foco.modules.photos.models import EMBEDDING_DIM, Face, Photo


def unit(i: int) -> np.ndarray:
    """Vetor de norma 1 no eixo i. unit(a)·unit(b) = 1 se a == b, senão 0."""
    v = np.zeros(EMBEDDING_DIM, dtype=np.float32)
    v[i] = 1.0
    return v


def make_event(session, name: str = "Teste", **kw) -> Event:
    ev = Event(name=name, **kw)
    session.add(ev)
    session.flush()
    return ev


def make_photo(
    session,
    event: Event,
    *,
    faces=(),
    status: str = "done",
    sha: str | None = None,
    width: int = 100,
    height: int = 100,
) -> Photo:
    """faces: [((x1, y1, x2, y2), embedding, det_score), ...]"""
    sha = sha or uuid.uuid4().hex * 2
    p = Photo(
        event_id=event.id,
        sha256=sha,
        filename=f"{sha[:8]}.jpg",
        storage_key=f"photos/{event.id}/{sha}.jpg",
        width=width,
        height=height,
        status=status,
        n_faces=len(faces),
    )
    session.add(p)
    session.flush()
    for (x1, y1, x2, y2), emb, score in faces:
        session.add(
            Face(photo_id=p.id, event_id=event.id, x1=x1, y1=y1, x2=x2, y2=y2, det_score=score, embedding=emb)
        )
    session.flush()
    return p
