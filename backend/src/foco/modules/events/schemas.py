import datetime as dt

from pydantic import BaseModel, ConfigDict


class EventIn(BaseModel):
    name: str
    event_date: str | None = None  # AAAA-MM-DD, vem de <input type="date">
    location: str | None = None


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    event_date: dt.date | None
    location: str | None


class CoverPhoto(BaseModel):
    id: int
    fx: float
    fy: float


class EventSummary(EventOut):
    created_at: dt.datetime
    n_photos: int
    n_done: int
    n_pending: int
    n_faces: int
    cover: list[CoverPhoto]  # mosaico da página pública, com ponto de foco


class DeleteOut(BaseModel):
    deleted: int
    photos: int
