from conftest import SECRET, TEST_DATABASE_URL

from foco.core.config import Settings
from foco.modules.admin import auth

NOW = 1_800_000_000


def cfg(pw="segredo-forte", secret=SECRET):
    return Settings(database_url=TEST_DATABASE_URL, secret_key=secret, admin_password=pw, _env_file=None)


def test_cookie_valido():
    assert auth.verify(auth.issue(cfg(), now=NOW), cfg(), now=NOW)


def test_cookie_expirado():
    assert auth.verify(auth.issue(cfg(), now=NOW), cfg(), now=NOW + auth.TTL - 1)
    assert not auth.verify(auth.issue(cfg(), now=NOW), cfg(), now=NOW + auth.TTL)


def test_senha_trocada_derruba_sessoes():
    assert not auth.verify(auth.issue(cfg(), now=NOW), cfg(pw="outra-senha"), now=NOW)


def test_secret_key_trocada_derruba_sessoes():
    assert not auth.verify(auth.issue(cfg(), now=NOW), cfg(secret="y" * 40), now=NOW)


def test_sem_senha_nada_vale():
    assert not auth.verify(auth.issue(cfg(pw=""), now=NOW), cfg(pw=""), now=NOW)


def test_lixo_nao_vale():
    for bad in [None, "", "abc", "9999999999.deadbeef"]:
        assert not auth.verify(bad, cfg(), now=NOW)


def test_check_password():
    pw = "segredo-forte"
    assert auth.check_password(pw, pw)
    assert not auth.check_password("errada", pw)
    assert not auth.check_password("", "")  # backoffice sem senha nunca loga
    assert not auth.check_password("\udc80", pw)  # surrogate solto não estoura
    assert auth.check_password("ção", "ção")  # não-ASCII funciona
