# Backoffice de funcionalidades: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Painel `#backoffice`, protegido por senha de admin, que liga e desliga funcionalidades globais. A primeira é a Calibração, que quando desligada some da UI e deixa de expor `debug_top`/tempos em `/api/search`.

**Architecture:** O registro de flags fica no código (`features.py`), os overrides na tabela `settings` do SQLite existente, e a sessão admin num cookie HMAC assinado com chave derivada de `ADMIN_PASSWORD` (`admin_auth.py`, só stdlib). O frontend (SPA sem build) lê `/api/features` no boot, esconde a aba e bloqueia a rota, e ganha a vista `#backoffice`.

**Tech Stack:** FastAPI 0.141, SQLite, JS puro, CSS puro, pytest 9 + httpx (TestClient) para testes.

**Spec:** `docs/superpowers/specs/2026-09-29-backoffice-feature-flags-design.md`

**Branch:** `feat/backoffice-feature-flags` (já criada, com a spec commitada).

---

## Mapa de arquivos

| arquivo | ação | responsabilidade |
|---|---|---|
| `requirements-dev.txt` | criar | deps de teste (pytest, httpx) |
| `pytest.ini` | criar | `pythonpath = .`, `testpaths = tests` |
| `tests/conftest.py` | criar | `FACES_DATA_DIR` temporário antes de importar `store`; limpa `settings` a cada teste |
| `tests/test_store_settings.py` | criar | get/set de settings |
| `tests/test_features.py` | criar | registro de flags |
| `tests/test_admin_auth.py` | criar | assinatura e verificação do token |
| `tests/test_api_admin.py` | criar | endpoints `/api/features`, `/api/admin/*` e bloqueio no `/api/search` |
| `store.py` | modificar | tabela `settings` + `get_setting`/`set_setting` |
| `features.py` | criar | `FEATURES`, `is_enabled`, `all_flags`, `describe`, `set_enabled` |
| `admin_auth.py` | criar | `password`, `check_password`, `sign`, `verify`, constantes do cookie |
| `api.py` | modificar | endpoints novos + bloqueio em `/api/search` |
| `Dockerfile` | modificar | copiar `features.py` e `admin_auth.py` (o `COPY` lista os arquivos um a um) |
| `docker-compose.yml`, `docker-compose.dev.yml` | modificar | `ADMIN_PASSWORD` do `.env` |
| `.gitignore` | modificar | `.env` |
| `README.md` | modificar | seção Backoffice + arquivos novos |
| `static/app.js` | modificar | `state.features`, guarda de rota, `syncNav`, vista backoffice, `api()` aceita 204 |
| `static/index.html` | modificar | link da Calibração começa `hidden`; `<section id="view-backoffice">` |
| `static/style.css` | modificar | `input[type=password]`, estilo do backoffice e do switch |

Rodar os testes: `.venv/bin/python -m pytest -q` (na raiz do repo).

---

### Task 1: Infra de testes + settings no SQLite

**Files:**
- Create: `requirements-dev.txt`, `pytest.ini`, `tests/conftest.py`, `tests/test_store_settings.py`
- Modify: `store.py` (SCHEMA, fim do arquivo)

- [ ] **Step 1: Criar infra de teste**

`requirements-dev.txt`:
```
# Só para desenvolvimento (não entra na imagem Docker).
-r requirements.txt
pytest==9.1.1
httpx==0.28.1
```

`pytest.ini`:
```ini
[pytest]
pythonpath = .
testpaths = tests
```

`tests/conftest.py`:
```python
"""Testes rodam contra um data/ temporário, nunca contra as fotos reais.

FACES_DATA_DIR precisa estar definido ANTES de importar store: o caminho do
banco é calculado no import.
"""

import os
import tempfile

os.environ["FACES_DATA_DIR"] = tempfile.mkdtemp(prefix="foco-test-")

import pytest  # noqa: E402

import store  # noqa: E402

store.init_db()


@pytest.fixture(autouse=True)
def clean_settings():
    """Cada teste começa com todas as flags no padrão."""
    with store.db() as c:
        c.execute("DELETE FROM settings")
    yield
```

Instalar:
```bash
.venv/bin/pip install -r requirements-dev.txt
```

- [ ] **Step 2: Escrever o teste que falha**

`tests/test_store_settings.py`:
```python
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
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `.venv/bin/python -m pytest tests/test_store_settings.py -q`
Expected: ERROR no fixture, `sqlite3.OperationalError: no such table: settings`

- [ ] **Step 4: Implementar**

Em `store.py`, dentro de `SCHEMA`, logo depois da linha `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER);`:
```sql
CREATE TABLE IF NOT EXISTS settings (  -- overrides do backoffice (ver features.py)
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

No fim de `store.py`:
```python


# ----------------------------------------------------------- settings -----

def get_setting(key: str) -> str | None:
    with db() as c:
        row = c.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else None


def set_setting(key: str, value: str):
    with db() as c:
        c.execute("INSERT INTO settings (key, value) VALUES (?, ?)"
                  " ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))
```

- [ ] **Step 5: Rodar e ver passar**

Run: `.venv/bin/python -m pytest tests/test_store_settings.py -q`
Expected: `3 passed`

- [ ] **Step 6: Commit**

```bash
git add requirements-dev.txt pytest.ini tests/conftest.py tests/test_store_settings.py store.py
git commit -m "feat(store): Add settings table for backoffice overrides" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Registro de funcionalidades (`features.py`)

**Files:**
- Create: `features.py`, `tests/test_features.py`

- [ ] **Step 1: Escrever o teste que falha**

`tests/test_features.py`:
```python
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `.venv/bin/python -m pytest tests/test_features.py -q`
Expected: ERROR `ModuleNotFoundError: No module named 'features'`

- [ ] **Step 3: Implementar**

`features.py`:
```python
"""
features.py — funcionalidades que o backoffice liga e desliga.

O código define QUAIS flags existem e o padrão de cada uma; o banco
(tabela settings, chave "feature.<nome>") guarda só o que o admin mudou.
Flag nova = uma entrada em FEATURES, sem migração.

As flags são globais: valem para todos os eventos e todos os visitantes,
inclusive o próprio admin.
"""

import store

FEATURES = {
    "calibration": {
        "label": "Calibração",
        "description": "Top 30 rostos mais parecidos + tempos de cada etapa, para ajustar o corte. "
                       "Mostra rostos de outras pessoas abaixo do corte: deixe desligada em produção.",
        "default": False,
    },
}


def is_enabled(key: str) -> bool:
    spec = FEATURES[key]  # KeyError de propósito: flag inexistente é bug
    value = store.get_setting(f"feature.{key}")
    return spec["default"] if value is None else value == "1"


def all_flags() -> dict[str, bool]:
    return {k: is_enabled(k) for k in FEATURES}


def describe() -> list[dict]:
    return [
        {"key": k, "label": f["label"], "description": f["description"], "enabled": is_enabled(k)}
        for k, f in FEATURES.items()
    ]


def set_enabled(key: str, enabled: bool):
    if key not in FEATURES:
        raise KeyError(key)
    store.set_setting(f"feature.{key}", "1" if enabled else "0")
```

- [ ] **Step 4: Rodar e ver passar**

Run: `.venv/bin/python -m pytest tests/test_features.py -q`
Expected: `5 passed`

- [ ] **Step 5: Commit**

```bash
git add features.py tests/test_features.py
git commit -m "feat(backoffice): Add feature flag registry" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Sessão admin (`admin_auth.py`)

**Files:**
- Create: `admin_auth.py`, `tests/test_admin_auth.py`

- [ ] **Step 1: Escrever o teste que falha**

`tests/test_admin_auth.py`:
```python
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
    for bad in [None, "", "abc", "123", ".abc", "12a.ff", "²³.ff"]:
        assert not admin_auth.verify(bad, PW, now=NOW), bad


def test_sem_senha_nada_vale():
    tok = admin_auth.sign(NOW + 60, "")
    assert not admin_auth.verify(tok, "", now=NOW)


def test_check_password():
    assert admin_auth.check_password(PW, PW)
    assert not admin_auth.check_password("errada", PW)
    assert not admin_auth.check_password("", "")      # backoffice sem senha nunca loga
    assert admin_auth.check_password("ção", "ção")    # não-ASCII funciona


def test_password_vem_do_ambiente(monkeypatch):
    monkeypatch.setenv("ADMIN_PASSWORD", "x")
    assert admin_auth.password() == "x"
    monkeypatch.delenv("ADMIN_PASSWORD")
    assert admin_auth.password() == ""
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `.venv/bin/python -m pytest tests/test_admin_auth.py -q`
Expected: ERROR `ModuleNotFoundError: No module named 'admin_auth'`

- [ ] **Step 3: Implementar**

`admin_auth.py`:
```python
"""
admin_auth.py — sessão do backoffice: uma senha só, um cookie assinado.

Sem banco de sessões e sem dependência nova. O cookie é
"<expira_unix>.<hmac>", e o HMAC (SHA-256) usa uma chave derivada de
ADMIN_PASSWORD. Consequências:
  - ninguém forja ou estende um cookie sem saber a senha;
  - trocar a senha (e reiniciar o container) derruba todas as sessões.

ADMIN_PASSWORD vazia = backoffice desligado (a API responde 404).
"""

import hashlib
import hmac
import os
import time

COOKIE = "foco_admin"
TTL = 12 * 3600      # validade da sessão, em segundos
FAIL_DELAY = 1.0     # espera após senha errada: freia força bruta (testes zeram)


def password() -> str:
    """Lida a cada chamada (não no import) para os testes poderem trocá-la."""
    return os.environ.get("ADMIN_PASSWORD", "")


def check_password(given: str, pw: str) -> bool:
    # compare_digest: tempo constante, não revela quantos caracteres acertou
    return bool(pw) and hmac.compare_digest(given.encode(), pw.encode())


def _key(pw: str) -> bytes:
    return hashlib.sha256(b"foco-admin:" + pw.encode()).digest()


def sign(expires: int, pw: str) -> str:
    mac = hmac.new(_key(pw), str(expires).encode(), hashlib.sha256).hexdigest()
    return f"{expires}.{mac}"


def verify(token: str | None, pw: str, now: float | None = None) -> bool:
    if not token or not pw:
        return False
    exp, sep, _ = token.partition(".")
    if not sep or not (exp.isascii() and exp.isdigit()):
        return False
    if not hmac.compare_digest(token, sign(int(exp), pw)):
        return False
    return int(exp) > (time.time() if now is None else now)
```

- [ ] **Step 4: Rodar e ver passar**

Run: `.venv/bin/python -m pytest tests/test_admin_auth.py -q`
Expected: `8 passed`

- [ ] **Step 5: Commit**

```bash
git add admin_auth.py tests/test_admin_auth.py
git commit -m "feat(backoffice): Add signed-cookie admin session helpers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Endpoints `/api/features` e `/api/admin/*`

**Files:**
- Modify: `api.py` (imports; nova seção antes de `# Frontend: montado por último`)
- Create: `tests/test_api_admin.py`

- [ ] **Step 1: Escrever o teste que falha**

`tests/test_api_admin.py`:
```python
import pytest
from fastapi.testclient import TestClient

import admin_auth
import api
import features

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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `.venv/bin/python -m pytest tests/test_api_admin.py -q`
Expected: FAIL. `/api/features` devolve 404 ou o HTML do StaticFiles, então as asserções quebram.

- [ ] **Step 3: Implementar**

Em `api.py`, trocar os imports do FastAPI e dos módulos locais:
```python
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import admin_auth
import detector
import features
import store
```

Em `api.py`, logo **antes** da linha `# Frontend: montado por último para não "engolir" as rotas /api.`, inserir:
```python
# --------------------------------------------------------- backoffice -----
#
# Flags globais (features.py) e a sessão do admin (admin_auth.py). Sem
# ADMIN_PASSWORD o backoffice não existe: /api/admin/* responde 404 e as
# flags ficam no padrão.


@app.get("/api/features")
def get_features():
    """Público: o frontend decide o que mostrar (a API bloqueia por conta própria)."""
    return features.all_flags()


def require_admin(request: Request):
    pw = admin_auth.password()
    if not pw:
        raise HTTPException(404, "Backoffice desativado.")
    if not admin_auth.verify(request.cookies.get(admin_auth.COOKIE), pw):
        raise HTTPException(401, "Entre no backoffice.")


def _is_https(request: Request) -> bool:
    # Atrás do Caddy o uvicorn recebe HTTP; o esquema original vem no header.
    return request.headers.get("x-forwarded-proto", request.url.scheme) == "https"


class LoginIn(BaseModel):
    password: str


@app.post("/api/admin/login", status_code=204)
async def admin_login(body: LoginIn, request: Request, response: Response):
    pw = admin_auth.password()
    if not pw:
        raise HTTPException(404, "Backoffice desativado.")
    if not admin_auth.check_password(body.password, pw):
        await asyncio.sleep(admin_auth.FAIL_DELAY)
        raise HTTPException(401, "Senha incorreta.")
    token = admin_auth.sign(int(time.time()) + admin_auth.TTL, pw)
    response.set_cookie(admin_auth.COOKIE, token, max_age=admin_auth.TTL, path="/",
                        httponly=True, samesite="strict", secure=_is_https(request))


@app.post("/api/admin/logout", status_code=204)
def admin_logout(response: Response):
    response.delete_cookie(admin_auth.COOKIE, path="/", httponly=True, samesite="strict")


@app.get("/api/admin/session")
def admin_session(request: Request):
    pw = admin_auth.password()
    return {"enabled": bool(pw),
            "logged_in": admin_auth.verify(request.cookies.get(admin_auth.COOKIE), pw)}


@app.get("/api/admin/features", dependencies=[Depends(require_admin)])
def admin_features():
    return features.describe()


class FeatureIn(BaseModel):
    enabled: bool


@app.put("/api/admin/features/{key}", dependencies=[Depends(require_admin)])
def admin_set_feature(key: str, body: FeatureIn):
    try:
        features.set_enabled(key, body.enabled)
    except KeyError:
        raise HTTPException(404, "Funcionalidade desconhecida.")
    return next(f for f in features.describe() if f["key"] == key)


```

- [ ] **Step 4: Rodar e ver passar**

Run: `.venv/bin/python -m pytest -q`
Expected: todos passam (`25 passed`)

- [ ] **Step 5: Commit**

```bash
git add api.py tests/test_api_admin.py
git commit -m "feat(backoffice): Add admin login and feature toggle endpoints" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Bloquear dados de calibração em `/api/search`

**Files:**
- Modify: `api.py` (fim de `search()`, a partir de `t0 = time.perf_counter()` antes de `hits = ...` até o `return`)
- Modify: `tests/test_api_admin.py` (acrescentar no fim)

- [ ] **Step 1: Escrever o teste que falha**

No fim de `tests/test_api_admin.py`:
```python
import uuid  # noqa: E402

import numpy as np  # noqa: E402

import store  # noqa: E402


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


def test_search_sem_calibracao_nao_expoe_top30(client):
    eid, qid = _seed_face()
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `.venv/bin/python -m pytest tests/test_api_admin.py -q -k search`
Expected: `test_search_sem_calibracao_nao_expoe_top30` FAIL (`debug_top` presente); o outro passa.

- [ ] **Step 3: Implementar**

Em `api.py`, função `search()`, trocar o bloco que começa em
```python
    t0 = time.perf_counter()
    hits = store.search_threshold(event_id, emb, threshold)  # tudo acima do corte
    top = store.search(event_id, emb, DEBUG_TOP_K)           # top-30, com ou sem corte
```
por
```python
    # Calibração desligada no backoffice: nada de top 30 (rostos de OUTRAS
    # pessoas abaixo do corte) nem tempos. Nem calcula.
    calibration = features.is_enabled("calibration")

    t0 = time.perf_counter()
    hits = store.search_threshold(event_id, emb, threshold)  # tudo acima do corte
    top = store.search(event_id, emb, DEBUG_TOP_K) if calibration else []  # top-30, com ou sem corte
```
e trocar o `return {...}` final da função por:
```python
    out = {
        "query_id": query_id,
        "threshold": threshold,
        "selfie": q["info"],
        "total_photos": total_photos,
        "indexed_faces": store.index_size(event_id),
        "matches": matches,
    }
    if calibration:
        out["timings_ms"] = {k: round(v, 1) for k, v in timings.items()}
        out["timings_from_cache"] = from_cache
        out["debug_top"] = [{**_face_out(fid, s, meta), "above": s > threshold} for fid, s in top]
    return out
```

- [ ] **Step 4: Rodar e ver passar**

Run: `.venv/bin/python -m pytest -q`
Expected: `27 passed`

- [ ] **Step 5: Commit**

```bash
git add api.py tests/test_api_admin.py
git commit -m "feat(search): Hide calibration data when feature is off" -m "Without the calibration flag, /api/search no longer returns debug_top (faces of other people below the cut) or stage timings, and skips the top-30 query." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Deploy e docs

**Files:**
- Modify: `Dockerfile`, `docker-compose.yml`, `docker-compose.dev.yml`, `.gitignore`, `README.md`

- [ ] **Step 1: Dockerfile**

Trocar
```dockerfile
COPY detector.py store.py api.py ./
```
por
```dockerfile
COPY detector.py store.py features.py admin_auth.py api.py ./
```

- [ ] **Step 2: Compose**

Em `docker-compose.yml`, depois do bloco `volumes:` do serviço (antes de `networks:` do serviço):
```yaml
    environment:
      # Senha do backoffice (/#backoffice). Vem do arquivo .env ao lado deste
      # compose, que não vai para o git. Vazia = backoffice desligado.
      ADMIN_PASSWORD: ${ADMIN_PASSWORD:-}
```
Em `docker-compose.dev.yml`, depois do bloco `volumes:`, o mesmo bloco `environment:`.

- [ ] **Step 3: `.gitignore`**

Depois do bloco `# ambiente local`, acrescentar:
```
# senha do backoffice (ADMIN_PASSWORD) na VPS
.env
```

- [ ] **Step 4: README**

Na tabela `## Arquivos`, depois da linha de `store.py`:
```markdown
| `features.py` | funcionalidades que o backoffice liga e desliga (padrões no código, overrides no SQLite) |
| `admin_auth.py` | sessão do backoffice: senha única (`ADMIN_PASSWORD`) e cookie assinado |
```

Antes de `## Desempenho medido (CPU, WSL2)`, inserir:
````markdown
## Backoffice

Em `/#backoffice` o admin liga e desliga funcionalidades para todos os
visitantes, sem novo deploy. Hoje só tem a **Calibração**, que vem
**desligada**: com ela desligada a aba some e `/api/search` não devolve o top 30
nem os tempos (o top 30 mostra rostos de outras pessoas abaixo do corte).

O backoffice só existe se `ADMIN_PASSWORD` estiver definida:

```bash
ADMIN_PASSWORD='uma-senha-longa' uvicorn api:app --reload     # local
```

Na VPS, crie um `.env` ao lado do `docker-compose.yml` (fica fora do git):

```bash
echo "ADMIN_PASSWORD=$(openssl rand -base64 24)" > .env && cat .env
docker compose up -d
```

A sessão dura 12 h. Trocar a senha e reiniciar derruba todas as sessões.

Testes (sem modelo, com banco temporário):

```bash
pip install -r requirements-dev.txt
python -m pytest -q
```
````

- [ ] **Step 5: Conferir que o compose continua válido**

Run: `ADMIN_PASSWORD=x docker compose -f docker-compose.yml config | grep -A1 environment`
Expected: `environment:` e `ADMIN_PASSWORD: x`. Se `docker` não estiver disponível no WSL, pular e registrar isso.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile docker-compose.yml docker-compose.dev.yml .gitignore README.md
git commit -m "build(backoffice): Ship new modules and ADMIN_PASSWORD config" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Frontend, flags no boot e guarda da Calibração

**Files:**
- Modify: `static/app.js` (cabeçalho, `state`, `api()`, rotas, `route()`, `runSearch()`, `renderDebug()`, `init()`)
- Modify: `static/index.html:101` (link da Calibração)

- [ ] **Step 1: Link começa escondido**

Em `static/index.html`, trocar
```html
      <a href="#calibracao" data-nav="lab">Calibração</a>
```
por
```html
      <a href="#calibracao" data-nav="lab" hidden>Calibração</a>
```
(assim ele não pisca antes de `/api/features` responder)

- [ ] **Step 2: Cabeçalho, state e `api()`**

No comentário do topo de `static/app.js`, depois da linha do `#calibracao`:
```js
//   #backoffice  admin: liga e desliga funcionalidades (ex.: a Calibração)
```

Em `state`, depois de `result: null, ...`:
```js
  features: {},       // flags do backoffice (/api/features); vazio = tudo desligado
```

Em `api()`, trocar `  return res.json();` por:
```js
  return res.status === 204 ? null : res.json();
```

- [ ] **Step 3: Rotas**

Trocar o bloco de comentário e constantes de rotas por:
```js
// Endereço = estado (o botão voltar do navegador funciona). Rotas:
//   #galeria           índice público de galerias
//   #galeria?e=3       galeria do evento 3, o link que o fotógrafo compartilha
//   #estudio           lista de eventos do fotógrafo
//   #estudio?e=3       gerenciar o evento 3
//   #calibracao?e=3    calibração com o evento 3 (só com a flag ligada)
//   #backoffice        funcionalidades (sem link na nav)

const ROUTES = { galeria: "gallery", estudio: "studio", calibracao: "lab", backoffice: "admin" };
const HASH_OF = { gallery: "galeria", studio: "estudio", lab: "calibracao", admin: "backoffice" };
const SECTIONS = {
  "gallery-index": "view-index", "gallery-event": "view-gallery",
  "studio-index": "view-studio-index", "studio-event": "view-studio", lab: "view-lab", admin: "view-backoffice",
};

const feature = (key) => state.features[key] === true;
async function loadFeatures() {
  try { state.features = await api("/api/features"); } catch { state.features = {}; }
}
/** Links da nav que dependem de flag. */
function syncNav() {
  $('.nav a[data-nav="lab"]').hidden = !feature("calibration");
}
```

- [ ] **Step 4: `route()` e `renderView()`**

Trocar o começo de `route()`:
```js
function route() {
  const { area, eventId } = parseHash();
  let id = eventId;
```
por:
```js
function route() {
  const { area, eventId } = parseHash();
  // Calibração desligada no backoffice: a rota não existe. replaceState para o
  // voltar do navegador não cair de novo aqui.
  if (area === "lab" && !feature("calibration")) {
    history.replaceState(null, "", hrefFor("gallery"));
    return route();
  }
  let id = eventId;
```

Trocar
```js
  const view = area === "lab" ? "lab" : `${area}-${id ? "event" : "index"}`;
```
por
```js
  const view = area === "lab" || area === "admin" ? area : `${area}-${id ? "event" : "index"}`;
```

Logo depois de `document.body.dataset.view = view;`, acrescentar:
```js
  syncNav();
```

Em `renderView()`, acrescentar como última linha antes do `}`:
```js
  if (state.view === "admin") renderBackoffice();
```
(`renderBackoffice` é criada na Task 8. Até lá, abrir `#backoffice` dá erro no console, o que é esperado.)

- [ ] **Step 5: `runSearch()` se ajusta sozinho quando a flag cai**

Em `runSearch()`, logo depois de `    state.result = r;`:
```js
    // Desligaram a Calibração com a página aberta: a resposta veio sem o top 30.
    if (!r.debug_top && feature("calibration")) {
      state.features = { ...state.features, calibration: false };
      syncNav();
      if (state.view === "lab") return route();
    }
```

- [ ] **Step 6: `renderDebug()` tolera resposta sem top 30**

Em `renderDebug()`, trocar a primeira linha
```js
  const r = state.result;
```
por
```js
  // Busca feita com a Calibração desligada vem sem top 30: conta como "sem busca".
  const r = state.result?.debug_top ? state.result : null;
```

- [ ] **Step 7: Boot**

Em `init()`, trocar
```js
  state.events = await api("/api/events");
  route();
```
por
```js
  const [events] = await Promise.all([api("/api/events"), loadFeatures()]);
  state.events = events;
  route();
```

- [ ] **Step 8: Checagem de sintaxe**

Run: `node --check static/app.js && echo ok`
Expected: `ok`

- [ ] **Step 9: Commit**

```bash
git add static/app.js static/index.html
git commit -m "feat(ui): Gate Calibração tab and route behind feature flag" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Frontend, vista `#backoffice`

**Files:**
- Modify: `static/index.html` (nova section depois da section `view-lab`, antes de `</main>`)
- Modify: `static/style.css` (seletor de `input[type="text"]`; nova seção antes de `/* ---...--- mobile ---- */`)
- Modify: `static/app.js` (nova seção antes de `// -------...------- início ---`)

- [ ] **Step 1: HTML**

Em `static/index.html`, logo antes de `  </main>`:
```html

    <!-- ======================= BACKOFFICE (sem link na nav) ======================= -->
    <section id="view-backoffice" class="view" hidden aria-labelledby="a-title">
      <header class="lab-head">
        <h1 id="a-title" class="display">Backoffice</h1>
        <p class="lab-lede">Ligue e desligue funcionalidades do Foco para todos os visitantes. Vale na hora, sem novo deploy.</p>
      </header>

      <p id="admin-off" class="admin-note" hidden>Backoffice desativado: defina <code>ADMIN_PASSWORD</code> no servidor e reinicie.</p>

      <form id="admin-login" class="admin-login" hidden novalidate>
        <label class="field">
          <span>Senha de admin</span>
          <input id="admin-password" type="password" autocomplete="current-password" required>
        </label>
        <button class="btn primary" type="submit" id="admin-submit">Entrar</button>
        <p class="msg err" id="admin-error" role="alert"></p>
      </form>

      <div id="admin-panel" hidden>
        <ul id="flag-list" class="flag-list"></ul>
        <button class="text-btn" type="button" id="admin-logout"><svg class="ico"><use href="#i-close"/></svg>Sair</button>
      </div>
    </section>
```

- [ ] **Step 2: CSS**

Em `static/style.css`, trocar
```css
input[type="text"] {
```
por
```css
input[type="text"], input[type="password"] {
```

Antes da linha `/* ---------------------------------------------------------------- mobile ---- */`:
```css
/* ---------------------------------------------------- backoffice ---- */
/* O cabeçalho reaproveita .lab-head. Uma funcionalidade por linha, com os
   mesmos filetes das listas do Estúdio. */
.admin-note { margin-top: 2rem; color: var(--chumbo); max-width: 52ch; }
.admin-note code { font-size: var(--t-sm); background: var(--passe); padding: .1rem .35rem; border-radius: 4px; }
.admin-login { display: grid; gap: 1rem; max-width: 360px; margin-top: 2rem; }
.admin-login .btn { justify-self: start; }
.admin-login .msg { margin-top: 0; }
.flag-list { list-style: none; margin: 2rem 0 1.25rem; padding: 0; border-top: 1px solid var(--linha); max-width: 760px; }
.flag {
  display: flex; align-items: center; justify-content: space-between; gap: 1.5rem;
  padding: 1.1rem .25rem; border-bottom: 1px solid var(--linha);
}
.flag-name { font-weight: 500; font-size: var(--t-md); cursor: pointer; }
.flag .quiet { margin-top: .2rem; }

/* switch: o verde de foco marca o estado ativo */
.switch {
  -webkit-appearance: none; appearance: none; flex: none; position: relative; margin: 0;
  width: 44px; height: 26px; border-radius: 13px; background: var(--linha); cursor: pointer;
  transition: background-color .15s;
}
.switch::after {
  content: ""; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%;
  background: var(--papel); box-shadow: 0 1px 2px rgba(35, 38, 43, .25); transition: transform .15s;
}
.switch:checked { background: var(--viridian); }
.switch:checked::after { transform: translateX(18px); }
.switch:disabled { opacity: .5; cursor: wait; }

```

- [ ] **Step 3: JS**

Em `static/app.js`, antes de `// ---------------------------------------------------------------- início ---`:
```js
// ---------------------------------------------------------- backoffice ---

/** Um dos três estados da tela: "off" (sem ADMIN_PASSWORD) | "login" | "panel". */
function showAdmin(mode) {
  $("#admin-off").hidden = mode !== "off";
  $("#admin-login").hidden = mode !== "login";
  $("#admin-panel").hidden = mode !== "panel";
}

async function renderBackoffice() {
  let s = { enabled: false, logged_in: false };
  try { s = await api("/api/admin/session"); } catch { /* servidor fora: trata como desligado */ }
  if (state.view !== "admin") return;  // saiu da tela enquanto esperava
  if (!s.enabled) return showAdmin("off");
  if (!s.logged_in) { showAdmin("login"); $("#admin-password").focus(); return; }
  try {
    renderFlags(await api("/api/admin/features"));
    showAdmin("panel");
  } catch (err) {
    showAdmin("login");
    $("#admin-error").textContent = err.status === 401 ? "" : err.message;
  }
}

function renderFlags(list) {
  $("#flag-list").replaceChildren(...list.map((f) => {
    const id = `flag-${f.key}`;
    const sw = el("input", { type: "checkbox", role: "switch", class: "switch", id, "aria-describedby": `${id}-desc` });
    sw.checked = f.enabled;
    const err = el("p", { class: "msg err", role: "alert" });
    sw.addEventListener("change", () => toggleFlag(f, sw, err));
    return el("li", { class: "flag" },
      el("div", {},
        el("label", { for: id, class: "flag-name" }, f.label),
        el("p", { class: "quiet", id: `${id}-desc` }, f.description),
        err),
      sw);
  }));
}

/** Liga/desliga na hora; se a API recusar, o switch volta. */
async function toggleFlag(f, sw, err) {
  const enabled = sw.checked;
  sw.disabled = true;
  err.textContent = "";
  try {
    await api(`/api/admin/features/${f.key}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }),
    });
    state.features = { ...state.features, [f.key]: enabled };
    syncNav();
    toast(`${f.label}: ${enabled ? "ligada" : "desligada"}`);
  } catch (e) {
    sw.checked = !enabled;
    if (e.status === 401) {
      showAdmin("login");
      $("#admin-error").textContent = "Sessão expirada. Entre de novo.";
    } else err.textContent = e.message;
  } finally {
    sw.disabled = false;
  }
}

$("#admin-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#admin-submit");
  btn.disabled = true;
  $("#admin-error").textContent = "";
  try {
    await api("/api/admin/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: $("#admin-password").value }),
    });
    $("#admin-password").value = "";
    await renderBackoffice();
  } catch (err) {
    $("#admin-error").textContent = err.message;  // "Senha incorreta." vem da API
  } finally {
    btn.disabled = false;
  }
});

$("#admin-logout").addEventListener("click", async () => {
  try { await api("/api/admin/logout", { method: "POST" }); } catch { /* segue para o login mesmo assim */ }
  renderBackoffice();
});

```

- [ ] **Step 4: Checagem de sintaxe**

Run: `node --check static/app.js && echo ok`
Expected: `ok`

- [ ] **Step 5: Commit**

```bash
git add static/index.html static/style.css static/app.js
git commit -m "feat(ui): Add backoffice view with login and feature switches" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Verificação ponta a ponta

**Files:** nenhum no repo. Scripts e dados ficam no scratchpad da sessão.

- [ ] **Step 1: Suíte completa**

Run: `.venv/bin/python -m pytest -q`
Expected: `27 passed`

- [ ] **Step 2: Subir servidor isolado**

```bash
export SCRATCH=/tmp/claude-1000/-home-iranbatista-www-study-face-tracking/03c2525a-9f82-4acb-b03b-be827b1dd5aa/scratchpad
FACES_DATA_DIR=$SCRATCH/data ADMIN_PASSWORD=teste123 .venv/bin/uvicorn api:app --port 8011
```
(em background; esperar o log `modelo buffalo_l carregado`)

- [ ] **Step 3: Smoke com curl**

```bash
B=http://127.0.0.1:8011; J=$SCRATCH/cj.txt; rm -f $J
curl -s $B/api/features                                                   # {"calibration":false}
curl -s -o /dev/null -w '%{http_code}\n' $B/api/admin/features            # 401
curl -s -o /dev/null -w '%{http_code}\n' -H 'content-type: application/json' -d '{"password":"x"}' $B/api/admin/login        # 401 (~1s)
curl -s -c $J -o /dev/null -w '%{http_code}\n' -H 'content-type: application/json' -d '{"password":"teste123"}' $B/api/admin/login  # 204
curl -s -b $J -X PUT -H 'content-type: application/json' -d '{"enabled":true}' $B/api/admin/features/calibration   # enabled: true
curl -s $B/api/features                                                   # {"calibration":true}
```
Depois: criar um evento, subir 2 fotos com rosto (as de testes anteriores, se houver) e rodar `/api/search` com uma selfie, uma vez com a flag ligada (tem `debug_top`) e outra desligada (sem `debug_top`):
```bash
EID=$(curl -s -H 'content-type: application/json' -d '{"name":"Smoke"}' $B/api/events | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
curl -s -F files=@<foto1.jpg> -F files=@<foto2.jpg> $B/api/events/$EID/photos
curl -s -F event_id=$EID -F selfie=@<selfie.jpg> $B/api/search | python3 -c 'import sys,json;print(sorted(json.load(sys.stdin)))'
curl -s -b $J -X PUT -H 'content-type: application/json' -d '{"enabled":false}' $B/api/admin/features/calibration
curl -s -F event_id=$EID -F selfie=@<selfie.jpg> $B/api/search | python3 -c 'import sys,json;print(sorted(json.load(sys.stdin)))'
```
Expected: a primeira lista de chaves inclui `debug_top` e `timings_ms`; a segunda não. As fotos vêm de onde houver imagens com rosto na máquina: procurar com `find ~ -iname '*.jpg' -size +50k 2>/dev/null | head`, ou usar as do `data/` local. Se não houver nenhuma, registrar que essa parte ficou coberta só pelo pytest.

Reiniciar sem `ADMIN_PASSWORD` e conferir `curl -s -o /dev/null -w '%{http_code}\n' $B/api/admin/features` → `404`.

- [ ] **Step 4: Playwright (desktop 1440 e mobile 393)**

Usar o skill `playwright-skill` (script em `$SCRATCH/pw-backoffice.js`, rodado com `cd ~/.claude/skills/playwright-skill && node run.js $SCRATCH/pw-backoffice.js`; se faltar `playwright`, rodar `npm install` no diretório do skill primeiro). Servidor da Step 2 rodando, calibração desligada.

Para cada viewport, verificar:
1. `/#galeria`: `.nav a[data-nav=lab]` está oculto.
2. `/#calibracao` → a URL vira `#galeria` e `#view-index` aparece.
3. `/#backoffice`: o formulário de login aparece. Senha errada → `#admin-error` mostra "Senha incorreta.". Senha `teste123` → `#flag-list` com 1 item, switch desmarcado.
4. Clicar no switch → toast "Calibração: ligada", o link Calibração aparece na nav sem reload, e `/#calibracao` abre `#view-lab`.
5. Voltar ao backoffice, desligar → o link some.
6. "Sair" → o login volta.
7. Screenshot do painel em cada viewport, conferindo que não há scroll horizontal (`document.documentElement.scrollWidth <= innerWidth`).

Deixar a calibração desligada no fim.

- [ ] **Step 5: Parar servidor e limpar**

Parar o uvicorn da Step 2. Os dados de teste ficam no scratchpad; `data/` do repo não é tocado.

- [ ] **Step 6: Revisão**

Rodar o skill `code-review` (ou `superpowers:requesting-code-review`) sobre o diff do branch contra `main`, corrigir o que for real, rodar `pytest` de novo e commitar as correções.
