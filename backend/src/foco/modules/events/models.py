import datetime as dt

from sqlalchemy import BigInteger, Date, Identity, Text
from sqlalchemy.orm import Mapped, mapped_column

from foco.core.db import Base, Timestamps


class Event(Timestamps, Base):
    __tablename__ = "events"

    # IDENTITY nunca reusa o id de um evento excluído: um link antigo de
    # galeria (#galeria?e=4) não pode passar a abrir o evento de outra pessoa.
    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    event_date: Mapped[dt.date | None] = mapped_column(Date)  # quando o evento aconteceu
    location: Mapped[str | None] = mapped_column(Text)  # cidade / lugar, livre
