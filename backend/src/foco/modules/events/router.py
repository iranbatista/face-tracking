from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi import Path as PathParam
from sqlalchemy.orm import Session

from foco.core.db import get_session
from foco.modules.events import service
from foco.modules.events.schemas import EventIn, EventOut, EventSummary

router = APIRouter(prefix="/api/events", tags=["events"])


BigId = Annotated[int, PathParam(le=2**63 - 1)]


@router.post("")
def create_event(body: EventIn, session: Session = Depends(get_session)) -> EventOut:
    return service.create_event(session, body)


@router.get("")
def list_events(session: Session = Depends(get_session)) -> list[EventSummary]:
    return service.list_events(session)


@router.patch("/{event_id}")
def update_event(event_id: BigId, body: EventIn, session: Session = Depends(get_session)) -> EventOut:
    return service.update_event(session, event_id, body)


@router.delete("/{event_id}")
def delete_event(event_id: BigId, session: Session = Depends(get_session)) -> dict:
    return service.delete_event(session, event_id)
