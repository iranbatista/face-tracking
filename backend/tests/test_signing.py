from foco.core import signing

KEY = "k" * 40
NOW = 1_800_000_000


def tok(payload=b"abc", purpose="p", key=KEY, ttl=60, now=NOW):
    return signing.sign(payload, purpose=purpose, key=key, ttl=ttl, now=now)


def test_valido_devolve_payload():
    assert signing.verify(tok(), purpose="p", key=KEY, now=NOW) == b"abc"


def test_payload_vazio():
    assert signing.verify(tok(b""), purpose="p", key=KEY, now=NOW) == b""


def test_expirado():
    assert signing.verify(tok(ttl=60), purpose="p", key=KEY, now=NOW + 60) is None


def test_outra_finalidade_nao_vale():
    assert signing.verify(tok(purpose="search"), purpose="admin", key=KEY, now=NOW) is None


def test_outra_chave_nao_vale():
    assert signing.verify(tok(), purpose="p", key="z" * 40, now=NOW) is None


def test_corpo_adulterado():
    body, mac = tok().split(".")
    other_body = tok(b"abd").split(".")[0]  # mesmo prazo, payload diferente
    assert signing.verify(f"{other_body}.{mac}", purpose="p", key=KEY, now=NOW) is None


def test_formatos_invalidos():
    for bad in [None, "", "abc", "a.b.c", ".", "ção.ção", "!!!.???", "A" * 5000 + ".B"]:
        assert signing.verify(bad, purpose="p", key=KEY, now=NOW) is None, bad


def test_token_nao_canonico_recusado():
    good = tok()
    assert signing.verify(good, purpose="p", key=KEY, now=NOW) == b"abc"
    body, mac = good.split(".")
    for bad in [f"{body}==.{mac}", f"{body}!.{mac}", f"{body}.{mac}=", f"{body}.{mac}!"]:
        assert signing.verify(bad, purpose="p", key=KEY, now=NOW) is None, bad
    # "-"/"_" trocados por "+"/"/" (o mac de 32 bytes costuma ter algum)
    for i in range(200):
        t = tok(payload=bytes([i]) * 5)
        if "-" in t or "_" in t:
            swapped = t.replace("-", "+").replace("_", "/")
            assert signing.verify(swapped, purpose="p", key=KEY, now=NOW) is None
            return
    raise AssertionError("nenhum token com - ou _")
