import pytest

from foco.modules.features import service
from foco.modules.features.models import FeatureFlag


def test_calibracao_desligada_por_padrao(session):
    assert service.is_enabled(session, "calibration") is False


def test_override_liga_e_desliga(session):
    service.set_enabled(session, "calibration", True)
    assert service.is_enabled(session, "calibration") is True
    service.set_enabled(session, "calibration", False)
    assert service.is_enabled(session, "calibration") is False
    assert session.get(FeatureFlag, "calibration").enabled is False


def test_all_flags(session):
    assert service.all_flags(session) == {"calibration": False}
    service.set_enabled(session, "calibration", True)
    assert service.all_flags(session) == {"calibration": True}


def test_describe(session):
    [cal] = service.describe(session)
    assert cal["key"] == "calibration"
    assert cal["label"] == "Calibração"
    assert cal["enabled"] is False
    assert cal["description"]


def test_chave_desconhecida(session):
    with pytest.raises(KeyError):
        service.is_enabled(session, "nao-existe")
    with pytest.raises(KeyError):
        service.set_enabled(session, "nao-existe", True)


def test_linha_orfa_e_ignorada(session):
    session.add(FeatureFlag(key="removida", enabled=True))
    session.flush()
    assert service.all_flags(session) == {"calibration": False}
