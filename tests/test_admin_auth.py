import admin_auth

PW = "segredo-forte"
NOW = 1_800_000_000


def test_token_valido():
    tok = admin_auth.sign(NOW + 60, PW)
    assert admin_auth.verify(tok, PW, now=NOW)


def test_token_expirado():
    tok = admin_auth.sign(NOW - 1, PW)
    assert not admin_auth.verify(tok, PW, now=NOW)


def test_assinatura_adulterada():
    tok = admin_auth.sign(NOW + 60, PW)
    exp, mac = tok.split(".")
    forged = f"{int(exp) + 3600}.{mac}"           # tenta estender a validade
    assert not admin_auth.verify(forged, PW, now=NOW)
    flipped = f"{exp}.{'0' if mac[0] != '0' else '1'}{mac[1:]}"
    assert not admin_auth.verify(flipped, PW, now=NOW)


def test_senha_trocada_invalida_sessoes():
    tok = admin_auth.sign(NOW + 60, PW)
    assert not admin_auth.verify(tok, "outra-senha", now=NOW)


def test_formatos_invalidos():
    for bad in [None, "", "abc", "123", ".abc", "12a.ff", "²³.ff", "123.ção", "1" * 5000 + ".ff"]:
        assert not admin_auth.verify(bad, PW, now=NOW), bad


def test_zero_a_esquerda_invalida():
    tok = admin_auth.sign(NOW + 60, PW)
    assert not admin_auth.verify("0" + tok, PW, now=NOW)


def test_sem_senha_nada_vale():
    tok = admin_auth.sign(NOW + 60, "")
    assert not admin_auth.verify(tok, "", now=NOW)


def test_check_password():
    assert admin_auth.check_password(PW, PW)
    assert not admin_auth.check_password("errada", PW)
    assert not admin_auth.check_password("", "")      # backoffice sem senha nunca loga
    assert not admin_auth.check_password("\udc80", PW)  # surrogate solto não estoura
    assert admin_auth.check_password("ção", "ção")    # não-ASCII funciona


def test_password_vem_do_ambiente(monkeypatch):
    monkeypatch.setenv("ADMIN_PASSWORD", "x")
    assert admin_auth.password() == "x"
    monkeypatch.delenv("ADMIN_PASSWORD")
    assert admin_auth.password() == ""
