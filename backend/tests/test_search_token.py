import numpy as np
from factories import unit

from foco.core import signing
from foco.modules.search import token

KEY = "k" * 40
NOW = 1_800_000_000


def test_ida_e_volta():
    v = unit(3) * 0.6 + unit(7) * 0.8  # norma 1
    back = token.read(token.issue(v, KEY, now=NOW), KEY, now=NOW)
    assert back.dtype == np.float32
    assert abs(float(back @ v) - 1.0) < 1e-3  # float16: erro na 4ª casa


def test_tamanho():
    assert len(token.issue(unit(0), KEY, now=NOW)) < 1500


def test_expira_em_uma_hora():
    t = token.issue(unit(0), KEY, now=NOW)
    assert token.read(t, KEY, now=NOW + token.TTL - 1) is not None
    assert token.read(t, KEY, now=NOW + token.TTL) is None


def test_adulterado_ou_de_outra_finalidade():
    assert token.read("lixo", KEY, now=NOW) is None
    other = signing.sign(b"\0" * 1024, purpose="admin", key=KEY, ttl=60, now=NOW)
    assert token.read(other, KEY, now=NOW) is None


def test_payload_de_tamanho_errado():
    short = signing.sign(b"\0" * 10, purpose=token.PURPOSE, key=KEY, ttl=60, now=NOW)
    assert token.read(short, KEY, now=NOW) is None
