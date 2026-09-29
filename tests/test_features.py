import pytest

import features


def test_calibracao_desligada_por_padrao():
    assert features.is_enabled("calibration") is False


def test_override_liga_e_desliga():
    features.set_enabled("calibration", True)
    assert features.is_enabled("calibration") is True
    features.set_enabled("calibration", False)
    assert features.is_enabled("calibration") is False


def test_all_flags():
    assert features.all_flags() == {"calibration": False}
    features.set_enabled("calibration", True)
    assert features.all_flags() == {"calibration": True}


def test_describe():
    [cal] = features.describe()
    assert cal["key"] == "calibration"
    assert cal["label"] == "Calibração"
    assert cal["enabled"] is False
    assert cal["description"]


def test_chave_desconhecida():
    with pytest.raises(KeyError):
        features.is_enabled("nao-existe")
    with pytest.raises(KeyError):
        features.set_enabled("nao-existe", True)
