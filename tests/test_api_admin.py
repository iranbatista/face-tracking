import uuid

import numpy as np
import pytest
from fastapi.testclient import TestClient

import admin_auth
import api
import features
import store

PW = "senha-de-teste"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ADMIN_PASSWORD", PW)
    monkeypatch.setattr(admin_auth, "FAIL_DELAY", 0)
    # sem "with": o lifespan (carregar o modelo) não roda nos testes
    return TestClient(api.app)


def login(client, pw=PW):
    return client.post("/api/admin/login", json={"password": pw})


def test_features_publico(client):
    assert client.get("/api/features").json() == {"calibration": False}


def test_admin_sem_cookie_401(client):
    assert client.get("/api/admin/features").status_code == 401
    assert client.put("/api/admin/features/calibration", json={"enabled": True}).status_code == 401


def test_login_errado_401(client):
    r = login(client, "errada")
    assert r.status_code == 401
    assert admin_auth.COOKIE not in r.cookies


def test_login_e_toggle(client):
    r = login(client)
    assert r.status_code == 204
    assert admin_auth.COOKIE in r.cookies
    assert "httponly" in r.headers["set-cookie"].lower()
    assert "samesite=strict" in r.headers["set-cookie"].lower()

    assert client.get("/api/admin/session").json() == {"enabled": True, "logged_in": True}
    [cal] = client.get("/api/admin/features").json()
    assert cal["key"] == "calibration" and cal["enabled"] is False

    r = client.put("/api/admin/features/calibration", json={"enabled": True})
    assert r.status_code == 200
    assert r.json()["enabled"] is True
    assert client.get("/api/features").json() == {"calibration": True}
    assert features.is_enabled("calibration")


def test_flag_desconhecida_404(client):
    login(client)
    assert client.put("/api/admin/features/nao-existe", json={"enabled": True}).status_code == 404


def test_corpo_invalido_422(client):
    login(client)
    assert client.put("/api/admin/features/calibration", json={}).status_code == 422
    assert client.put("/api/admin/features/calibration", json={"enabled": "yes"}).status_code == 422
    assert client.put("/api/admin/features/calibration", json={"enabled": 1}).status_code == 422


def test_logout(client):
    login(client)
    assert client.post("/api/admin/logout").status_code == 204
    assert client.get("/api/admin/session").json() == {"enabled": True, "logged_in": False}
    assert client.get("/api/admin/features").status_code == 401


def test_cookie_forjado_401(client):
    client.cookies.set(admin_auth.COOKIE, "9999999999.deadbeef")
    assert client.get("/api/admin/features").status_code == 401


def test_sem_admin_password_backoffice_desligado(client, monkeypatch):
    monkeypatch.delenv("ADMIN_PASSWORD")
    assert client.get("/api/admin/session").json() == {"enabled": False, "logged_in": False}
    assert login(client, "").status_code == 404
    assert client.get("/api/admin/features").status_code == 404
    assert client.get("/api/features").json() == {"calibration": False}


def test_cookie_secure_atras_de_https(client):
    r = login(client)
    assert "secure" not in r.headers["set-cookie"].lower()
    r = client.post("/api/admin/login", json={"password": PW},
                    headers={"x-forwarded-proto": "https"})
    assert "secure" in r.headers["set-cookie"].lower()


def test_csrf_corpo_nao_json_422(client):
    # Um <form> de outro site só consegue enviar text/plain (sem preflight):
    # exigir JSON de verdade bloqueia isso, junto com SameSite=Strict.
    body = ('{"password":"%s"}' % PW).encode()
    r = client.post("/api/admin/login", content=body, headers={"content-type": "text/plain"})
    assert r.status_code == 422
    assert admin_auth.COOKIE not in r.cookies

    login(client)
    r = client.put("/api/admin/features/calibration", content=b'{"enabled":true}',
                   headers={"content-type": "text/plain"})
    assert r.status_code == 422
    assert features.is_enabled("calibration") is False


def test_token_expirado_401(client):
    client.cookies.set(admin_auth.COOKIE, admin_auth.sign(1, PW))
    assert client.get("/api/admin/features").status_code == 401


def _seed_face():
    """Evento com 1 foto e 1 rosto, e uma selfie já "processada" no cache.

    Usa o mesmo vetor para as duas: score 1.0, cai acima de qualquer corte.
    Nada de modelo nem imagem real.
    """
    with store.db() as c:
        eid = store.next_event_id(c)
        c.execute("INSERT INTO events (id, name) VALUES (?, ?)", (eid, "Teste"))
        pid = c.execute(
            "INSERT INTO photos (event_id, sha256, filename, path, thumb_path, width, height, status)"
            " VALUES (?,?,?,?,?,?,?, 'queued')",
            (eid, uuid.uuid4().hex, "a.jpg", "/nao/existe.jpg", "/nao/existe_t.jpg", 100, 100),
        ).lastrowid
    vec = np.zeros(store.DIM, dtype=np.float32)
    vec[0] = 1.0
    store.save_faces(pid, eid, [{"bbox": [10, 10, 50, 50], "det_score": 0.9, "embedding": vec}], 5.0)
    qid = uuid.uuid4().hex
    api._queries[qid] = {"embedding": vec, "info": {"bbox": [0, 0, 1, 1]}, "timings": {"detection": 1.0}}
    return eid, qid


def _search(client, eid, qid):
    r = client.post("/api/search", data={"event_id": eid, "threshold": 0.4, "query_id": qid})
    assert r.status_code == 200, r.text
    return r.json()


def test_search_sem_calibracao_nao_expoe_top30(client, monkeypatch):
    eid, qid = _seed_face()

    def boom(*a, **k):
        raise AssertionError("top 30 não deveria rodar com a calibração desligada")

    monkeypatch.setattr(store, "search", boom)
    r = _search(client, eid, qid)
    assert len(r["matches"]) == 1                     # a Galeria segue funcionando
    for k in ("debug_top", "timings_ms", "timings_from_cache"):
        assert k not in r


def test_search_com_calibracao_expoe_top30(client):
    eid, qid = _seed_face()
    features.set_enabled("calibration", True)
    r = _search(client, eid, qid)
    assert len(r["matches"]) == 1
    assert len(r["debug_top"]) == 1 and r["debug_top"][0]["above"] is True
    assert "search" in r["timings_ms"]
    assert r["timings_from_cache"] is True


def test_search_limita_threshold_ao_intervalo_dos_sliders(client):
    eid, qid = _seed_face()
    # Segundo rosto (outra pessoa): vetor ortogonal à selfie, score 0.
    with store.db() as c:
        pid = c.execute(
            "INSERT INTO photos (event_id, sha256, filename, path, thumb_path, width, height, status)"
            " VALUES (?,?,?,?,?,?,?, 'queued')",
            (eid, uuid.uuid4().hex, "b.jpg", "/nao/existe2.jpg", "/nao/existe2_t.jpg", 100, 100),
        ).lastrowid
    outro = np.zeros(store.DIM, dtype=np.float32)
    outro[1] = 1.0
    store.save_faces(pid, eid, [{"bbox": [10, 10, 50, 50], "det_score": 0.9, "embedding": outro}], 5.0)

    r = client.post("/api/search", data={"event_id": eid, "threshold": -1, "query_id": qid})
    assert r.status_code == 200, r.text
    r = r.json()
    assert len(r["matches"]) == 1                     # o desconhecido (score 0) não volta
    assert r["threshold"] == 0.15

    r = client.post("/api/search", data={"event_id": eid, "threshold": 5, "query_id": qid})
    assert r.json()["threshold"] == 0.80
