import datetime as dt

from sqlalchemy import Boolean, DateTime, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from foco.core.db import Base


class FeatureFlag(Base):
    """Override do backoffice. O padrão de cada flag fica no código (registry.py):
    a linha só existe quando o admin muda alguma coisa."""

    __tablename__ = "feature_flags"

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
