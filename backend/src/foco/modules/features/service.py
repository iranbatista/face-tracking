from sqlalchemy import select
from sqlalchemy.orm import Session

from foco.modules.features.models import FeatureFlag
from foco.modules.features.registry import FEATURES


def _overrides(session: Session) -> dict[str, bool]:
    return {f.key: f.enabled for f in session.scalars(select(FeatureFlag))}


def is_enabled(session: Session, key: str) -> bool:
    spec = FEATURES[key]  # KeyError de propósito: flag inexistente é bug
    row = session.get(FeatureFlag, key)
    return spec["default"] if row is None else row.enabled


def all_flags(session: Session) -> dict[str, bool]:
    over = _overrides(session)
    return {k: over.get(k, f["default"]) for k, f in FEATURES.items()}


def describe(session: Session) -> list[dict]:
    flags = all_flags(session)
    return [
        {"key": k, "label": f["label"], "description": f["description"], "enabled": flags[k]}
        for k, f in FEATURES.items()
    ]


def set_enabled(session: Session, key: str, enabled: bool) -> None:
    if key not in FEATURES:
        raise KeyError(key)
    session.merge(FeatureFlag(key=key, enabled=enabled))
    session.commit()
