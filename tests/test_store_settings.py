import store


def test_setting_ausente_e_none():
    assert store.get_setting("nao.existe") is None


def test_set_e_get():
    store.set_setting("feature.x", "1")
    assert store.get_setting("feature.x") == "1"


def test_set_sobrescreve():
    store.set_setting("feature.x", "1")
    store.set_setting("feature.x", "0")
    assert store.get_setting("feature.x") == "0"
