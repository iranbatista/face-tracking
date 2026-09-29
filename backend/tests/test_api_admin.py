import pytest

from foco.modules.admin import auth
from foco.modules.features import service as features

PW = "senha-de-teste"


@pytest.fixture
def admin(make_client, monkeypatch):
    monkeypatch.setattr(auth, "FAIL_DELAY", 0)
    return make_client(admin_password=PW)


def login(c, pw=PW):
    return c.post("/api/admin/login", json={"password": pw})


def test_features_publico(admin):
    assert admin.get("/api/features").json() == {"calibration": False}


def test_admin_sem_cookie_401(admin):
    assert admin.get("/api/admin/features").status_code == 401
    assert admin.put("/api/admin/features/calibration", json={"enabled": True}).status_code == 401


def test_login_errado_401(admin):
    r = login(admin, "errada")
    assert r.status_code == 401
    assert auth.COOKIE not in r.cookies


def test_login_e_toggle(admin, session):
    r = login(admin)
    assert r.status_code == 204
    assert auth.COOKIE in r.cookies
    assert "httponly" in r.headers["set-cookie"].lower()
    assert "samesite=strict" in r.headers["set-cookie"].lower()

    assert admin.get("/api/admin/session").json() == {"enabled": True, "logged_in": True}
    [cal] = admin.get("/api/admin/features").json()
    assert cal["key"] == "calibration" and cal["enabled"] is False

    r = admin.put("/api/admin/features/calibration", json={"enabled": True})
    assert r.status_code == 200
    assert r.json()["enabled"] is True
    assert admin.get("/api/features").json() == {"calibration": True}
    assert features.is_enabled(session, "calibration")


def test_flag_desconhecida_404(admin):
    login(admin)
    assert admin.put("/api/admin/features/nao-existe", json={"enabled": True}).status_code == 404


def test_corpo_invalido_422(admin):
    login(admin)
    assert admin.put("/api/admin/features/calibration", json={}).status_code == 422
    assert admin.put("/api/admin/features/calibration", json={"enabled": "yes"}).status_code == 422
    assert admin.put("/api/admin/features/calibration", json={"enabled": 1}).status_code == 422


def test_logout(admin):
    login(admin)
    assert admin.post("/api/admin/logout").status_code == 204
    assert admin.get("/api/admin/session").json() == {"enabled": True, "logged_in": False}
    assert admin.get("/api/admin/features").status_code == 401


def test_cookie_forjado_401(admin):
    admin.cookies.set(auth.COOKIE, "9999999999.deadbeef")
    assert admin.get("/api/admin/features").status_code == 401


def test_sem_admin_password_backoffice_desligado(client):
    assert client.get("/api/admin/session").json() == {"enabled": False, "logged_in": False}
    assert login(client, "").status_code == 404
    assert client.get("/api/admin/features").status_code == 404
    assert client.get("/api/features").json() == {"calibration": False}


def test_cookie_secure_atras_de_https(admin):
    assert "secure" not in login(admin).headers["set-cookie"].lower()
    r = admin.post("/api/admin/login", json={"password": PW}, headers={"x-forwarded-proto": "https"})
    assert "secure" in r.headers["set-cookie"].lower()


def test_csrf_corpo_nao_json_422(admin, session):
    # Um <form> de outro site só consegue enviar text/plain (sem preflight):
    # exigir JSON de verdade bloqueia isso, junto com SameSite=Strict.
    body = f'{{"password":"{PW}"}}'.encode()
    r = admin.post("/api/admin/login", content=body, headers={"content-type": "text/plain"})
    assert r.status_code == 422
    assert auth.COOKIE not in r.cookies

    login(admin)
    r = admin.put(
        "/api/admin/features/calibration", content=b'{"enabled":true}', headers={"content-type": "text/plain"}
    )
    assert r.status_code == 422
    assert features.is_enabled(session, "calibration") is False
