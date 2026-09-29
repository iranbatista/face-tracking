import datetime as dt

from sqlalchemy import Date, cast, func, select
from sqlalchemy import delete as sa_delete
from sqlalchemy.orm import Session

from foco.core.errors import Invalid, NotFound
from foco.modules.events.models import Event
from foco.modules.events.schemas import CoverPhoto, EventIn, EventSummary
from foco.modules.photos import covers, tasks
from foco.modules.photos.models import PENDING, Photo


def get_or_404(session: Session, event_id: int) -> Event:
    ev = session.get(Event, event_id)
    if ev is None:
        raise NotFound("evento não encontrado")
    return ev


def _clean(body: EventIn) -> tuple[str, dt.date | None, str | None]:
    name = body.name.strip()
    if not name:
        raise Invalid("Dê um nome ao evento.")
    raw_date = (body.event_date or "").strip()
    date = None
    if raw_date:
        try:
            date = dt.date.fromisoformat(raw_date)
        except ValueError:
            raise Invalid("Data inválida.") from None
    location = (body.location or "").strip() or None
    return name[:120], date, location and location[:120]


def create_event(session: Session, body: EventIn) -> Event:
    name, date, location = _clean(body)
    ev = Event(name=name, event_date=date, location=location)
    session.add(ev)
    session.commit()
    return ev


def update_event(session: Session, event_id: int, body: EventIn) -> Event:
    ev = get_or_404(session, event_id)
    ev.name, ev.event_date, ev.location = _clean(body)
    session.commit()
    return ev


def list_events(session: Session) -> list[EventSummary]:
    counts = (
        select(
            Photo.event_id,
            func.count().label("n_photos"),
            func.count().filter(Photo.status == "done").label("n_done"),
            func.count().filter(Photo.status.in_(PENDING)).label("n_pending"),
            func.coalesce(func.sum(Photo.n_faces), 0).label("n_faces"),
        )
        .group_by(Photo.event_id)
        .subquery()
    )
    rows = session.execute(
        select(Event, counts.c.n_photos, counts.c.n_done, counts.c.n_pending, counts.c.n_faces)
        .outerjoin(counts, counts.c.event_id == Event.id)
        .order_by(func.coalesce(Event.event_date, cast(Event.created_at, Date)).desc(), Event.id.desc())
    ).all()
    done = session.execute(
        select(Photo.id, Photo.event_id, Photo.width, Photo.height)
        .where(Photo.status == "done")
        .order_by(Photo.id)
    ).all()
    by_event: dict[int, list] = {}
    for p in done:
        by_event.setdefault(p.event_id, []).append(p)
    cover_ids = {ev.id: covers.pick_cover(by_event.get(ev.id, [])) for ev, *_ in rows}
    focus = covers.focus_points(session, [pid for ids in cover_ids.values() for pid in ids])
    return [
        EventSummary(
            id=ev.id,
            name=ev.name,
            event_date=ev.event_date,
            location=ev.location,
            created_at=ev.created_at,
            n_photos=n_photos or 0,
            n_done=n_done or 0,
            n_pending=n_pending or 0,
            n_faces=n_faces or 0,
            cover=[CoverPhoto(id=pid, **focus[pid]) for pid in cover_ids[ev.id]],
        )
        for ev, n_photos, n_done, n_pending, n_faces in rows
    ]


def delete_event(session: Session, event_id: int) -> dict:
    """Apaga o evento com TODAS as fotos e rostos (CASCADE). Não tem volta.

    Os arquivos saem depois, numa tarefa do worker. Fotos ainda na fila são
    ignoradas quando chegar a vez delas (index_photo não acha mais a linha).
    """
    get_or_404(session, event_id)
    files = session.execute(select(Photo.storage_key, Photo.sha256).where(Photo.event_id == event_id)).all()
    session.execute(sa_delete(Event).where(Event.id == event_id))
    session.commit()
    if files:
        tasks.delete_event_files.defer(
            event_id=event_id,
            keys=[f.storage_key for f in files],
            shas=sorted({f.sha256 for f in files}),
        )
    return {"deleted": event_id, "photos": len(files)}
