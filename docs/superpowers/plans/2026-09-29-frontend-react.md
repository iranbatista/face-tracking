# Frontend em React: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o frontend vanilla (`static/`) por um app React + Vite + TypeScript em `frontend/`, com paridade visual e de comportamento, mais os 4 ajustes da spec, servido pelo FastAPI como SPA.

**Architecture:** O app nasce em `frontend/` ao lado do antigo. Em dev, o Vite (:5173) faz proxy de `/api` para o backend (:8000), que continua servindo o `static/` antigo até a Task 22 (troca). Dados do servidor via TanStack Query com tipos gerados do OpenAPI; navegação via TanStack Router (file-based); estado de sessão da página (busca da selfie, fila de upload) em dois providers no `__root`.

**Tech Stack:** React 19, Vite 8, TypeScript (strict), Tailwind v4, shadcn/ui (Radix), TanStack Router + Query, openapi-typescript + openapi-fetch, Vitest + Testing Library + MSW, Biome, Playwright (local), pnpm.

**Spec:** `docs/superpowers/specs/2026-09-29-frontend-react-design.md`

---

## Como ler este plano

- **Tarefas de lógica e infraestrutura** (backend, scaffold, API, `lib/`, providers, rotas, build, CI) trazem o **código completo**.
- **Tarefas de tela** (Tasks 10–18) portam markup e CSS que já existem. A fonte da verdade visual é o `static/` atual, então essas tarefas trazem: o **contrato** do componente (props, estados, comportamento), o **mapa exato das linhas de origem** em `static/index.html`, `static/app.js` e `static/style.css`, os **testes completos** e a **checagem de paridade** no fim. Reescrever as ~2.400 linhas de UI aqui só duplicaria a fonte.
- **Versões:** as libs foram conferidas no npm em 2026-09-29 (React 19.3, Vite 8.3, TypeScript 7.0, Tailwind 4.3, TanStack Router 1.170 / Query 5.104, openapi-fetch 0.17, MSW 3.0, Vitest 5.0, Biome 2.5, shadcn 4.21, Playwright 1.63). Algumas são mais novas que os exemplos de API deste plano. **Se uma API do plano não existir na versão instalada, veja os tipos/README em `node_modules/<pacote>` e adapte, mantendo o comportamento; relate a diferença.** Não rebaixe versões sem motivo.

## Ajustes em relação à spec (decididos ao planejar)

- **Respostas tipadas no backend (Task 3):** várias rotas devolvem `dict` sem schema (busca, stats, upload, sessão do admin...), o que deixaria os tipos gerados vazios e forçaria tipos escritos à mão, contra a spec. A Task 3 adiciona modelos de resposta pydantic a essas rotas sem mudar o formato do JSON.
- **Visualizador na Calibração:** a régua pode ter dois rostos da mesma foto, então lá o parâmetro é `?rosto=<face_id>`. Na Galeria fica `?foto=<photo_id>`, como na spec.
- **CSS de componente:** utilitários do Tailwind no JSX são o padrão. `src/styles/components.css` (`@layer components`) só para o que utilitário não expressa bem: keyframes, pseudo-elementos (trilho do slider, colchetes de foco), grades por atributo (`data-n` da capa) e regras longas repetidas.
- **Breakpoints:** o CSS atual é desktop-first (`max-width: 820px`). Em vez de inverter tudo, o `app.css` define variantes próprias com as mesmas media queries: `mobile:`, `short:`, `touch:`, `nohover:`.
- **Playwright local:** o Chromium do Playwright não instala no Ubuntu 26.04 deste WSL. Os scripts aceitam `PW_CHROMIUM` (caminho de um `chrome-headless-shell` já em cache, ex.: `find ~/.cache/ms-playwright -name chrome-headless-shell -type f | head -1`).

## Mapa de arquivos

```
backend/
  scripts/export_openapi.py                 # Task 4
  src/foco/main.py                          # Task 2 (SPA)
  src/foco/modules/events/{service,router}.py   # Task 1
  src/foco/modules/*/schemas.py, routers    # Task 3 (respostas tipadas)
  tests/test_spa.py, tests/test_events.py   # Tasks 1-2
frontend/
  package.json, pnpm-lock.yaml, vite.config.ts, tsconfig.json, biome.json, components.json, index.html
  public/favicon.svg
  src/
    main.tsx, routeTree.gen.ts (gerado)
    styles/app.css, styles/components.css, styles/fonts/*
    api/openapi.json, api/schema.d.ts (gerados), api/client.ts, api/queries.ts, api/upload.ts, api/types.ts
    lib/format.ts, lib/text.ts, lib/geometry.ts, lib/storage.ts, lib/utils.ts (cn)
    components/Icon.tsx, components/Illustration.tsx, components/RouteStates.tsx
    components/ui/*  (shadcn)
    features/events/*, features/gallery/*, features/studio/*, features/lab/*, features/admin/*
    routes/__root.tsx, index.tsx, galeria.$eventId.tsx, estudio.index.tsx, estudio.$eventId.tsx, calibracao.tsx, backoffice.tsx
  tests/setup.ts, tests/msw.ts, tests/render.tsx, tests/**/*.test.ts(x)
  e2e/playwright.config.ts, e2e/parity.ts, e2e/smoke.spec.ts
Makefile, Dockerfile, .dockerignore, .github/workflows/ci.yml, README.md
static/                                    # removido na Task 22
```

Convenção dos commits: Sentry (`ref(ui): ...`, `feat(api): ...`), terminando com o trailer `Co-Authored-By` das instruções do sistema.

**Comandos:** `export PATH="$HOME/.local/bin:$PATH"` (uv). Backend: `make db`, `make migrate`, `make api`, `make worker`, `make test`, `make lint`. Front (a partir da Task 4): `make web`, `make web-test`, `make web-lint`, `make gen-api`. Antes de cada commit: `make lint` (se mexeu no backend) e `make web-lint && make web-test` (se mexeu no front).

---

### Task 1: `GET /api/events/{id}`

**Files:**
- Modify: `backend/src/foco/modules/events/service.py`, `backend/src/foco/modules/events/router.py`
- Test: `backend/tests/test_events.py`

- [ ] **Step 1: Escrever os testes (acrescentar ao fim de `backend/tests/test_events.py`)**

```python
def test_busca_um_evento_no_mesmo_formato_da_lista(client, session):
    ev = make_event(session, "Festa")
    p = make_photo(session, ev, width=1000, height=1000, faces=[((100, 200, 300, 400), unit(0), 0.9)])
    make_event(session, "Outro")
    session.commit()
    one = client.get(f"/api/events/{ev.id}")
    assert one.status_code == 200
    [same] = [e for e in client.get("/api/events").json() if e["id"] == ev.id]
    assert one.json() == same
    assert one.json()["cover"] == [{"id": p.id, "fx": 0.2, "fy": 0.3}]


def test_busca_evento_inexistente_404(client):
    r = client.get("/api/events/999999")
    assert r.status_code == 404
    assert r.json() == {"detail": "evento não encontrado"}


def test_busca_evento_fora_do_bigint_422(client):
    assert client.get("/api/events/99999999999999999999").status_code == 422
```

- [ ] **Step 2: Ver falhar**

Run: `cd backend && uv run pytest tests/test_events.py -q`
Expected: os 3 novos falham (405 Method Not Allowed: não há `GET /api/events/{id}`).

- [ ] **Step 3: Refatorar `list_events` em `backend/src/foco/modules/events/service.py`**

Trocar a função `list_events` inteira por:

```python
def _summaries(session: Session, event_ids: list[int] | None = None) -> list[EventSummary]:
    """Eventos com contagens, capa e ponto de foco. `event_ids=None`: todos."""
    counts_q = select(
        Photo.event_id,
        func.count().label("n_photos"),
        func.count().filter(Photo.status == "done").label("n_done"),
        func.count().filter(Photo.status.in_(PENDING)).label("n_pending"),
        func.coalesce(func.sum(Photo.n_faces), 0).label("n_faces"),
    ).group_by(Photo.event_id)
    events_q = select(Event)
    done_q = select(Photo.id, Photo.event_id, Photo.width, Photo.height).where(Photo.status == "done")
    if event_ids is not None:
        counts_q = counts_q.where(Photo.event_id.in_(event_ids))
        events_q = events_q.where(Event.id.in_(event_ids))
        done_q = done_q.where(Photo.event_id.in_(event_ids))
    counts = counts_q.subquery()
    rows = session.execute(
        events_q.add_columns(counts.c.n_photos, counts.c.n_done, counts.c.n_pending, counts.c.n_faces)
        .outerjoin(counts, counts.c.event_id == Event.id)
        .order_by(func.coalesce(Event.event_date, cast(Event.created_at, Date)).desc(), Event.id.desc())
    ).all()
    by_event: dict[int, list] = {}
    for p in session.execute(done_q.order_by(Photo.id)).all():
        by_event.setdefault(p.event_id, []).append(p)
    cover_ids = {ev.id: covers.pick_cover(by_event.get(ev.id, [])) for ev, *_ in rows}
    focus = covers.focus_points(session, [pid for ids in cover_ids.values() for pid in ids])
    return [
        EventSummary(
            id=ev.id,
            name=ev.name,
            event_date=ev.event_date,
            location=ev.location,
            created_at=ev.created_at,
            n_photos=n_photos or 0,
            n_done=n_done or 0,
            n_pending=n_pending or 0,
            n_faces=n_faces or 0,
            cover=[CoverPhoto(id=pid, **focus[pid]) for pid in cover_ids[ev.id]],
        )
        for ev, n_photos, n_done, n_pending, n_faces in rows
    ]


def list_events(session: Session) -> list[EventSummary]:
    return _summaries(session)


def get_event(session: Session, event_id: int) -> EventSummary:
    """Um evento só: a galeria pública abre sem carregar a lista inteira."""
    found = _summaries(session, [event_id])
    if not found:
        raise NotFound("evento não encontrado")
    return found[0]
```

- [ ] **Step 4: Rota em `backend/src/foco/modules/events/router.py`**

Depois de `list_events`:

```python
@router.get("/{event_id}")
def get_event(event_id: BigId, session: Session = Depends(get_session)) -> EventSummary:
    return service.get_event(session, event_id)
```

- [ ] **Step 5: Rodar**

Run: `make test && make lint`
Expected: tudo passa (os 3 novos incluídos).

- [ ] **Step 6: Commit**

```bash
git add backend/src/foco/modules/events backend/tests/test_events.py
git commit -m "feat(api): Add GET /api/events/{id}

The public gallery page only needs its own event; loading every event with
covers just to pick one was wasteful.

Co-Authored-By: <trailer das instruções do sistema>"
```

---

### Task 2: Servir o SPA

**Files:**
- Modify: `backend/src/foco/main.py`
- Create: `backend/tests/test_spa.py`

- [ ] **Step 1: Escrever `backend/tests/test_spa.py`**

```python
import pytest


@pytest.fixture
def spa(make_client, tmp_path):
    root = tmp_path / "dist"
    (root / "assets").mkdir(parents=True)
    (root / "index.html").write_text("<!doctype html><html><body>SPA</body></html>")
    (root / "assets" / "app-abc123.js").write_text("console.log(1)")
    (root / "favicon.svg").write_text("<svg/>")
    (tmp_path / "segredo.txt").write_text("não")
    return make_client(static_dir=root)


def test_raiz_devolve_index_sem_cache(spa):
    r = spa.get("/")
    assert r.status_code == 200 and "SPA" in r.text
    assert r.headers["cache-control"] == "no-cache"


def test_rota_do_front_devolve_index(spa):
    for path in ("/galeria/4", "/estudio", "/calibracao?e=4", "/backoffice"):
        r = spa.get(path)
        assert r.status_code == 200 and "SPA" in r.text, path


def test_asset_com_hash_tem_cache_longo(spa):
    r = spa.get("/assets/app-abc123.js")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "public, max-age=31536000, immutable"


def test_arquivo_da_raiz_do_dist(spa):
    r = spa.get("/favicon.svg")
    assert r.status_code == 200 and r.text == "<svg/>"


def test_api_desconhecida_continua_404_json(spa):
    r = spa.get("/api/nao-existe")
    assert r.status_code == 404
    assert r.json() == {"detail": "rota não encontrada"}


def test_nao_sai_da_pasta_do_dist(spa):
    r = spa.get("/%2e%2e/segredo.txt")
    assert "não" != r.text


def test_sem_pasta_estatica_a_api_funciona(make_client, tmp_path):
    c = make_client(static_dir=tmp_path / "nao-existe")
    assert c.get("/api/health").status_code == 200
```

- [ ] **Step 2: Ver falhar**

Run: `cd backend && uv run pytest tests/test_spa.py -q`
Expected: falham `test_raiz_devolve_index_sem_cache` (sem `cache-control`), `test_rota_do_front_devolve_index` (404), `test_asset_com_hash_tem_cache_longo`, `test_api_desconhecida_continua_404_json` e `test_sem_pasta_estatica_a_api_funciona` (o `StaticFiles` recusa pasta inexistente).

- [ ] **Step 3: Implementar em `backend/src/foco/main.py`**

Imports (juntar aos existentes):

```python
from pathlib import Path

from fastapi.responses import FileResponse

from foco.core.errors import NotFound
```

Acima de `create_app`:

```python
class ImmutableStaticFiles(StaticFiles):
    """Arquivos com hash no nome (o Vite gera assets/app-3f9a.js): podem ficar
    em cache para sempre, porque um build novo gera outro nome."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


def mount_spa(app: FastAPI, static_dir: Path) -> None:
    """Frontend como SPA: o roteamento é do navegador (/galeria/4, /estudio...),
    então qualquer caminho que não seja da API nem um arquivo devolve o index.html.

    Sem a pasta (ex.: CI do backend, antes do build do front) só a API existe.
    """
    root = static_dir.resolve()
    index = root / "index.html"
    if not index.is_file():
        logging.getLogger("uvicorn.error").warning("frontend não encontrado em %s", root)
        return
    if (root / "assets").is_dir():
        app.mount("/assets", ImmutableStaticFiles(directory=root / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        if path == "api" or path.startswith("api/"):
            raise NotFound("rota não encontrada")
        candidate = (root / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(root):
            return FileResponse(candidate)
        # o index muda a cada build: o navegador sempre revalida
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
```

Em `create_app`, trocar as duas últimas linhas antes do `return`:

```python
    # Frontend: por último, para o catch-all não "engolir" as rotas /api.
    mount_spa(app, settings.static_dir)
    return app
```

E remover o import de `StaticFiles`? **Não**: `ImmutableStaticFiles` herda dele; mantenha.

- [ ] **Step 4: Rodar**

Run: `make test && make lint`
Expected: tudo passa, incluindo o `test_frontend_servido` antigo (o `static/` atual tem `index.html`, e `app.js`/`style.css`/`fonts/` são servidos pelo ramo "arquivo existente").

- [ ] **Step 5: Conferir o app antigo no navegador**

Run: `make db && make migrate && make api` e abrir http://127.0.0.1:8000: o app antigo carrega igual (CSS, fontes, JS). Parar a API.

- [ ] **Step 6: Commit**

```bash
git add backend/src/foco/main.py backend/tests/test_spa.py
git commit -m "feat(api): Serve the frontend as a single-page app

Unknown non-API paths now return index.html so the React router can own
real URLs, hashed assets get a long immutable cache, and a missing
frontend folder no longer prevents the API from starting.

Co-Authored-By: <trailer>"
```

---

### Task 3: Respostas tipadas nas rotas que devolvem `dict`

O OpenAPI só descreve o que tem schema. Estas rotas devolvem `dict` e sairiam como `{}` nos tipos do front. Esta tarefa dá um modelo a cada uma **sem mudar o JSON** (os testes atuais do backend garantem isso).

**Files:**
- Modify: `backend/src/foco/modules/search/router.py` (+ create `backend/src/foco/modules/search/schemas.py`)
- Modify: `backend/src/foco/modules/photos/schemas.py`, `backend/src/foco/modules/photos/router.py`
- Modify: `backend/src/foco/modules/events/schemas.py`, `backend/src/foco/modules/events/router.py`
- Modify: `backend/src/foco/modules/admin/router.py` (+ create `backend/src/foco/modules/admin/schemas.py`)
- Test: `backend/tests/test_openapi.py`

- [ ] **Step 1: Escrever `backend/tests/test_openapi.py`**

```python
"""O front gera os tipos a partir do OpenAPI: nenhuma resposta pode ficar sem schema."""


def _response_schema(spec, path, method):
    content = spec["paths"][path][method]["responses"]["200"].get("content", {})
    return content.get("application/json", {}).get("schema", {})


def test_respostas_json_tem_schema(client):
    spec = client.get("/openapi.json").json()
    untyped = []
    for path, methods in spec["paths"].items():
        for method, op in methods.items():
            if "200" not in op["responses"]:
                continue
            schema = _response_schema(spec, path, method)
            content = op["responses"]["200"].get("content", {})
            if "application/json" in content and (not schema or schema == {"type": "object"}
                                                   or schema.get("additionalProperties") is True):
                untyped.append(f"{method.upper()} {path}")
    assert untyped == []
```

- [ ] **Step 2: Ver falhar**

Run: `cd backend && uv run pytest tests/test_openapi.py -q`
Expected: FAIL listando pelo menos `POST /api/search`, `GET /api/stats`, `POST /api/events/{event_id}/photos`, `DELETE /api/events/{event_id}`, `GET /api/admin/session`, `GET /api/admin/features`, `PUT /api/admin/features/{key}`, `GET /api/health`.

- [ ] **Step 3: `backend/src/foco/modules/search/schemas.py`**

```python
from pydantic import BaseModel


class FaceHit(BaseModel):
    face_id: int
    photo_id: int
    score: float
    bbox: list[float]           # x1, y1, x2, y2 em px da foto original
    width: int | None
    height: int | None
    filename: str


class DebugHit(FaceHit):
    above: bool                 # acima do corte


class SelfieInfo(BaseModel):
    bbox: list[float]
    det_score: float
    n_faces: int
    all_bboxes: list[list[float]]
    width: int
    height: int
    warning: str | None


class SearchOut(BaseModel):
    """Campos opcionais só aparecem quando fazem sentido (a rota usa
    response_model_exclude_unset): `selfie` na busca com selfie; tempos e
    top 30 só com a Calibração ligada."""

    query_token: str
    threshold: float
    total_photos: int
    indexed_faces: int
    matches: list[FaceHit]
    selfie: SelfieInfo | None = None
    timings_ms: dict[str, float] | None = None
    timings_from_cache: bool | None = None
    debug_top: list[DebugHit] | None = None
```

Em `backend/src/foco/modules/search/router.py`: decorador `@router.post("/search", response_model=SearchOut, response_model_exclude_unset=True)`, anotação de retorno `-> SearchOut` e `return SearchOut(**service.search(...))` (o dict do service vira o modelo; `exclude_unset` mantém as chaves ausentes ausentes e o `warning: null` presente).

- [ ] **Step 4: Fotos (`backend/src/foco/modules/photos/schemas.py`)**

Acrescentar:

```python
class UploadResult(BaseModel):
    """Um item da resposta do upload: a foto salva (com `duplicate`) ou um erro
    ({filename, status: "error", error}). A rota usa response_model_exclude_unset."""

    id: int | None = None
    filename: str | None = None
    status: str
    n_faces: int | None = None
    proc_ms: float | None = None
    error: str | None = None
    width: int | None = None
    height: int | None = None
    duplicate: bool | None = None


class StatsOut(BaseModel):
    events: int
    photos: int
    done: int
    pending: int
    errors: int
    faces: int
    avg_ms_per_photo: float | None


class ProgressOut(BaseModel):
    """Payload de cada mensagem do SSE de progresso (não aparece no OpenAPI do
    SSE, mas o front importa o tipo deste schema)."""

    items: list[PhotoOut]
    done: bool
    queue: int
```

Em `photos/router.py`: upload com `response_model=list[UploadResult], response_model_exclude_unset=True` e retorno `[UploadResult(**r) for r in ...]`; `stats` com `-> StatsOut` e `return StatsOut(**service.stats(...))`.

`ProgressOut` não é resposta de rota JSON; para entrar no OpenAPI, registre-o como modelo extra: em `backend/src/foco/main.py`, após incluir os routers, sobrescreva `app.openapi` para adicionar `ProgressOut` a `components.schemas`:

```python
from fastapi.openapi.utils import get_openapi

from foco.modules.photos.schemas import ProgressOut


def _openapi_with_extras(app: FastAPI):
    def build():
        if app.openapi_schema:
            return app.openapi_schema
        spec = get_openapi(title=app.title, version=app.version, routes=app.routes)
        # Payload do SSE de progresso: o front importa o tipo daqui.
        spec.setdefault("components", {}).setdefault("schemas", {})["ProgressOut"] = ProgressOut.model_json_schema(
            ref_template="#/components/schemas/{model}"
        )
        app.openapi_schema = spec
        return spec

    return build
```

e em `create_app`, depois dos routers: `app.openapi = _openapi_with_extras(app)`. Se `ProgressOut.model_json_schema` gerar `$defs` para `PhotoOut`, mova-os para `components.schemas` (o `PhotoOut` já existe lá: use o mesmo nome) — o teste do Step 1 e o `openapi-typescript` na Task 4 conferem.

- [ ] **Step 5: Eventos, admin e health**

- `events/schemas.py`: `class DeleteOut(BaseModel): deleted: int; photos: int`. Rota delete `-> DeleteOut` com `return DeleteOut(**service.delete_event(...))`.
- `admin/schemas.py`:

```python
from pydantic import BaseModel


class AdminSession(BaseModel):
    enabled: bool
    logged_in: bool


class FeatureInfo(BaseModel):
    key: str
    label: str
    description: str
    enabled: bool
```

  `session_state -> AdminSession`, `list_features -> list[FeatureInfo]`, `set_feature -> FeatureInfo` (construir os modelos a partir dos dicts).
- `main.py` health: `class Health(BaseModel): ok: bool` e `-> Health` com `return Health(ok=True)`.

- [ ] **Step 6: Rodar**

Run: `make test && make lint`
Expected: todos passam — os testes existentes provam que o JSON não mudou; `test_openapi` passa.

- [ ] **Step 7: Commit**

```bash
git add backend
git commit -m "feat(api): Declare response models for every JSON route

The frontend generates its types from the OpenAPI document, and routes
returning bare dicts showed up as untyped objects. The JSON shape is
unchanged; optional search fields stay absent when unset.

Co-Authored-By: <trailer>"
```

---

### Task 4: Scaffold do frontend

**Files:**
- Create: `frontend/` (package.json, pnpm-lock.yaml, vite.config.ts, tsconfig*.json, biome.json, index.html, src/main.tsx, src/routes/__root.tsx, src/routes/index.tsx, tests/setup.ts, tests/smoke.test.tsx, .gitignore), `backend/scripts/export_openapi.py`, `frontend/src/api/openapi.json`, `frontend/src/api/schema.d.ts`
- Modify: `Makefile`, `.gitignore`

- [ ] **Step 1: Criar o projeto**

```bash
cd /home/iranbatista/www/study/face-tracking
pnpm create vite@latest frontend --template react-ts
cd frontend
pnpm add react react-dom @tanstack/react-router @tanstack/react-query openapi-fetch clsx tailwind-merge class-variance-authority
pnpm add -D @tanstack/router-plugin tailwindcss @tailwindcss/vite @biomejs/biome vitest jsdom \
  @testing-library/react @testing-library/user-event @testing-library/jest-dom msw openapi-typescript \
  @playwright/test @types/node
```

Remover o que o template trouxe e não usamos: `src/App.tsx`, `src/App.css`, `src/index.css`, `src/assets/`, `public/vite.svg`, ESLint (`eslint.config.js` e as deps `eslint*`, `@eslint/*`, `typescript-eslint`, `globals`: `pnpm remove ...`).

- [ ] **Step 2: `frontend/vite.config.ts`**

```ts
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    // o backend (make api) continua em :8000; SSE e uploads passam pelo proxy
    proxy: { "/api": { target: "http://127.0.0.1:8000", changeOrigin: false } },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    css: false,
  },
});
```

(O `tanstackRouter` precisa vir **antes** do `react()`.)

- [ ] **Step 3: `frontend/tsconfig.json` (strict) e `frontend/biome.json`**

No `tsconfig.app.json` do template, garantir `"strict": true`, `"noUncheckedIndexedAccess": true`, `"types": ["vitest/globals", "@testing-library/jest-dom"]` e incluir `tests`. Alias: `"paths": { "@/*": ["./src/*"] }` (e `resolve.alias` equivalente no Vite: `{ "@": path.resolve(__dirname, "src") }`).

`frontend/biome.json`:

```json
{
  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",
  "files": {
    "includes": ["**", "!src/routeTree.gen.ts", "!src/api/schema.d.ts", "!src/api/openapi.json", "!dist", "!e2e/.parity"]
  },
  "formatter": { "indentStyle": "space", "indentWidth": 2, "lineWidth": 110 },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "assist": { "actions": { "source": { "organizeImports": "on" } } }
}
```

- [ ] **Step 4: `frontend/package.json` scripts**

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "biome check . && tsc -b --noEmit",
    "fmt": "biome check --write .",
    "gen:api": "openapi-typescript src/api/openapi.json -o src/api/schema.d.ts",
    "parity": "tsx e2e/parity.ts",
    "e2e": "playwright test -c e2e/playwright.config.ts"
  },
  "engines": { "node": ">=22" }
}
```

(`tsx` entra como devDependency na Task 9.)

- [ ] **Step 5: Esqueleto do router**

`frontend/src/main.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { routeTree } from "./routeTree.gen";

export const queryClient = new QueryClient();
const router = createRouter({ routeTree, context: { queryClient } });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById("root");
if (!root) throw new Error("#root não encontrado");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
```

`frontend/src/routes/__root.tsx` (provisório, a Task 8 completa):

```tsx
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => <Outlet />,
});
```

`frontend/src/routes/index.tsx` (provisório):

```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: () => <h1>Galerias</h1> });
```

`frontend/index.html`: `lang="pt-BR"`, título `Foco`, `meta viewport` e `theme-color` iguais aos de `static/index.html:4-8`, `<div id="root"></div>` e `<script type="module" src="/src/main.tsx">`. O favicon SVG inline de `static/index.html:8` vira `frontend/public/favicon.svg` (mesmo SVG, decodificado) com `<link rel="icon" href="/favicon.svg">`.

- [ ] **Step 6: Testes: setup + smoke**

`frontend/tests/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());
```

`frontend/tests/smoke.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

test("o ambiente de testes renderiza React", () => {
  render(<h1>Foco</h1>);
  expect(screen.getByRole("heading", { name: "Foco" })).toBeInTheDocument();
});
```

- [ ] **Step 7: Exportar o OpenAPI e gerar os tipos**

`backend/scripts/export_openapi.py`:

```python
"""Exporta o OpenAPI do app para o frontend gerar os tipos (make gen-api).

Não sobe servidor nem conecta no banco: create_app() só monta as rotas. As
variáveis abaixo só existem para as Settings validarem fora do ambiente de dev.
"""

import json
import os
import sys

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://x:x@127.0.0.1:1/x")
os.environ.setdefault("SECRET_KEY", "x" * 32)

from foco.main import create_app  # noqa: E402

json.dump(create_app().openapi(), sys.stdout, ensure_ascii=False, indent=2, sort_keys=True)
sys.stdout.write("\n")
```

- [ ] **Step 8: `Makefile` (acrescentar)**

```makefile
F := pnpm --dir frontend

.PHONY: web web-test web-lint web-fmt gen-api

web:       ## frontend React em http://127.0.0.1:5173 (precisa de make api)
	$(F) dev

web-test:
	$(F) test

web-lint:
	$(F) lint

web-fmt:
	$(F) fmt

gen-api:   ## OpenAPI do backend -> frontend/src/api (openapi.json + schema.d.ts)
	$(B) uv run python scripts/export_openapi.py > ../frontend/src/api/openapi.json
	$(F) gen:api
```

Run: `make gen-api`
Expected: `frontend/src/api/openapi.json` e `frontend/src/api/schema.d.ts` criados; `grep -c '"SearchOut"' frontend/src/api/openapi.json` ≥ 1.

- [ ] **Step 9: `.gitignore` (raiz, acrescentar)**

```
# frontend
frontend/node_modules/
frontend/dist/
frontend/e2e/.parity/
frontend/test-results/
```

- [ ] **Step 10: Rodar tudo**

Run: `make web-test && make web-lint && pnpm --dir frontend build`
Expected: 1 teste passa; biome e tsc limpos; build gera `frontend/dist/index.html`. `src/routeTree.gen.ts` foi gerado pelo plugin (versionar).

Run: `make api` (outro terminal) e `make web`, abrir http://127.0.0.1:5173 → "Galerias". `curl -s 127.0.0.1:5173/api/health` → `{"ok":true}` (proxy).

- [ ] **Step 11: Commit**

```bash
git add frontend backend/scripts Makefile .gitignore
git commit -m "feat(ui): Scaffold the React frontend

Vite, React, strict TypeScript, TanStack Router and Query, Tailwind,
Biome and Vitest, with /api proxied to the backend in dev and API types
generated from the backend's OpenAPI document.

Co-Authored-By: <trailer>"
```

---

### Task 5: Tokens, fontes, base e ícones

**Files:**
- Create: `frontend/src/styles/app.css`, `frontend/src/styles/components.css`, `frontend/src/styles/fonts/{anton.woff2,albert-sans.woff2,OFL-anton.txt,OFL-albert-sans.txt}`, `frontend/src/components/Icon.tsx`, `frontend/src/components/Illustration.tsx`, `frontend/tests/components/Icon.test.tsx`
- Modify: `frontend/src/main.tsx` (importar o CSS)

- [ ] **Step 1: Copiar as fontes** de `static/fonts/` para `frontend/src/styles/fonts/` (os 4 arquivos).

- [ ] **Step 2: `frontend/src/styles/app.css`**

Estrutura (os valores vêm **exatamente** de `static/style.css`):

```css
@import "tailwindcss";
@import "./components.css";

/* Fontes servidas pelo próprio app (sem CDN) — static/style.css:6-15 */
@font-face { font-family: "Anton"; src: url(./fonts/anton.woff2) format("woff2"); font-weight: 400; font-style: normal; font-display: swap; }
@font-face { font-family: "Albert Sans"; src: url(./fonts/albert-sans.woff2) format("woff2-variations"); font-weight: 100 900; font-style: normal; font-display: swap; }

/* Breakpoints do CSS original (desktop-first) */
@custom-variant mobile (@media (max-width: 820px));
@custom-variant short (@media (max-height: 500px));
@custom-variant touch (@media (hover: none) and (pointer: coarse));
@custom-variant nohover (@media (hover: none));

@theme {
  /* static/style.css:17-37 — copie TODOS os tokens do :root, com os mesmos valores */
  --color-parede: #FBFBF9;
  --color-papel: #FFFFFF;
  --color-passe: #ECEBE7;
  --color-linha: #E2E1DC;
  --color-grafite: #23262B;
  --color-grafite-2: #3A3E45;
  --color-chumbo: #62676F;
  --color-viridian: #1F5C4A;
  --color-viridian-tint: rgba(31, 92, 74, .07);
  --color-erro: #9B2C2C;
  --font-titulo: "Anton", "Impact", "Arial Narrow", sans-serif;
  --font-sans: "Albert Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --text-t-xs: .78rem;
  --text-t-sm: .86rem;
  --text-t-base: 1rem;
  --text-t-md: 1.15rem;
  --text-t-lg: 1.6rem;
  --text-t-xl: clamp(2.4rem, 4.2vw, 3.4rem);
  --text-t-2xl: clamp(3.4rem, 7.4vw, 6.4rem);
  --spacing-gutter: clamp(16px, 4vw, 48px);
  --radius-foco: 6px;
  /* + qualquer outro token de static/style.css:17-37 que não esteja acima (linhas 28, 31-32, 35-37) */
}

/* Base — static/style.css:38-73 (body, tipografia, .display e os ajustes de acento em caixa-alta) */
@layer base {
  html { color-scheme: light; -webkit-text-size-adjust: 100%; }
  body {
    margin: 0; min-height: 100vh;
    background: var(--color-parede); color: var(--color-grafite);
    font: 400 15.5px/1.55 var(--font-sans);
    font-feature-settings: "kern", "liga";
    -webkit-font-smoothing: antialiased;
  }
  :focus-visible { outline: 2px solid var(--color-viridian); outline-offset: 2px; }
  /* .display: porte literal de static/style.css:58-73 */
}
```

- [ ] **Step 3: `frontend/src/styles/components.css`** — por enquanto só `@layer components {}` com um comentário explicando a regra (keyframes, pseudo-elementos, grades por atributo). As telas acrescentam aqui.

- [ ] **Step 4: Ícones**

`frontend/src/components/Icon.tsx`: um componente `Icon({ name, className })` que renderiza `<svg className={cn("ico", className)} aria-hidden viewBox="0 0 24 24">` com os **paths de cada `<symbol>` de `static/index.html:14-93`** (mark, upload, download, camera, shutter, close, plus, lock, face, images, check, alert, copy, search, chev-l, chev-r, chev-d, edit, trash, eye, pin, gear), preservando `fill`/`stroke`/`stroke-width`/`linecap`/`linejoin` de cada symbol. `IconName` é a união literal desses nomes. A classe `.ico` (tamanho/alinhamento) vem de `static/style.css` (procure `.ico`) para `components.css`.

`frontend/src/components/Illustration.tsx`: `Prints` (o `il-prints` de `static/index.html:54-66`) e `ContactStrip` (o SVG inline de `static/index.html:306-323`), com a classe `illus` da mesma forma.

`frontend/tests/components/Icon.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { Icon } from "@/components/Icon";

test("ícone é decorativo e tem o traço do original", () => {
  const { container } = render(<Icon name="search" />);
  const svg = container.querySelector("svg");
  expect(svg).toHaveAttribute("aria-hidden", "true");
  expect(svg).toHaveClass("ico");
  expect(container.querySelector("circle")).toHaveAttribute("r", "6");
});
```

- [ ] **Step 5: `main.tsx`** ganha `import "./styles/app.css";` no topo.

- [ ] **Step 6: Rodar** `make web-test && make web-lint`. Expected: passa.

- [ ] **Step 7: Commit** `ref(ui): Add Foco design tokens, fonts and icons` (corpo curto + trailer).

---

### Task 6: Camada da API

**Files:**
- Create: `frontend/src/api/client.ts`, `frontend/src/api/types.ts`, `frontend/src/api/queries.ts`, `frontend/src/api/upload.ts`, `frontend/tests/msw.ts`, `frontend/tests/render.tsx`, `frontend/tests/api/client.test.ts`, `frontend/tests/api/queries.test.tsx`

- [ ] **Step 1: Testes do cliente — `frontend/tests/api/client.test.ts`**

```ts
import { HttpResponse, http } from "msw";
import { describe, expect, test } from "vitest";
import { ApiError, api, unwrap } from "@/api/client";
import { server } from "../msw";

describe("unwrap", () => {
  test("devolve o corpo em 2xx", async () => {
    server.use(http.get("*/api/features", () => HttpResponse.json({ calibration: true })));
    await expect(unwrap(api.GET("/api/features"))).resolves.toEqual({ calibration: true });
  });

  test("erro com detail em texto vira ApiError(status, detail)", async () => {
    server.use(http.get("*/api/events/{id}", () => HttpResponse.json({ detail: "evento não encontrado" }, { status: 404 })));
    const err = await unwrap(api.GET("/api/events/{event_id}", { params: { path: { event_id: 9 } } })).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
    expect(err.message).toBe("evento não encontrado");
  });

  test("422 do pydantic (detail em lista) usa o statusText", async () => {
    server.use(http.get("*/api/features", () => HttpResponse.json({ detail: [{ msg: "x" }] }, { status: 422, statusText: "Unprocessable Entity" })));
    const err = await unwrap(api.GET("/api/features")).catch((e) => e);
    expect(err.message).toBe("Unprocessable Entity");
  });
});
```

`frontend/tests/msw.ts`:

```ts
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";

export const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

(Importe `../msw` nos testes que usam rede — ou inclua-o no `setupFiles` do Vitest; escolha um e seja consistente.)

- [ ] **Step 2: Ver falhar** — `make web-test` → FAIL: `@/api/client` não existe.

- [ ] **Step 3: `frontend/src/api/types.ts`**

```ts
/** Tipos da API, todos derivados do schema gerado (nunca escritos à mão). */
import type { components } from "./schema";

type S = components["schemas"];
export type EventSummary = S["EventSummary"];
export type EventOut = S["EventOut"];
export type EventIn = S["EventIn"];
export type CoverPhoto = S["CoverPhoto"];
export type SheetPhoto = S["SheetPhoto"];
export type PhotoOut = S["PhotoOut"];
export type UploadResult = S["UploadResult"];
export type StatsOut = S["StatsOut"];
export type ProgressOut = S["ProgressOut"];
export type SearchOut = S["SearchOut"];
export type FaceHit = S["FaceHit"];
export type DebugHit = S["DebugHit"];
export type SelfieInfo = S["SelfieInfo"];
export type AdminSession = S["AdminSession"];
export type FeatureInfo = S["FeatureInfo"];
```

- [ ] **Step 4: `frontend/src/api/client.ts`**

```ts
/** Único ponto de acesso HTTP à API (fora daqui só o upload com progresso, em upload.ts). */
import createClient from "openapi-fetch";
import type { paths } from "./schema";
import type { SearchOut } from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// origem explícita: em testes (jsdom) fetch não aceita URL relativa
export const api = createClient<paths>({ baseUrl: globalThis.location?.origin ?? "" });

function detailOf(error: unknown): string | null {
  const d = (error as { detail?: unknown } | undefined)?.detail;
  return typeof d === "string" && d ? d : null; // 422 do pydantic vem como lista
}

/** Resposta do openapi-fetch -> dado, ou ApiError com o `detail` do backend. */
export async function unwrap<T>(p: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await p;
  if (!response.ok) throw new ApiError(response.status, detailOf(error) ?? response.statusText);
  return data as T;
}

/** Busca por selfie (multipart). O openapi-fetch não serializa FormData com tipos do form, então vai por fetch. */
export async function searchPhotos(form: FormData): Promise<SearchOut> {
  const response = await fetch(`${globalThis.location?.origin ?? ""}/api/search`, { method: "POST", body: form });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) throw new ApiError(response.status, detailOf(body) ?? response.statusText);
  return body as SearchOut;
}

export const thumbUrl = (id: number) => `/api/photos/${id}/thumb`;
export const mediumUrl = (id: number) => `/api/photos/${id}/medium`;
export const downloadUrl = (id: number) => `/api/photos/${id}/full?download=1`;
export const zipUrl = (ids: number[]) => `/api/zip?ids=${ids.join(",")}`;
export const progressUrl = (eventId: number, ids: number[]) => `/api/events/${eventId}/progress?ids=${ids.join(",")}`;
```

- [ ] **Step 5: `frontend/src/api/queries.ts`**

```ts
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "./client";
import type { EventIn } from "./types";

export const qk = {
  events: ["events"] as const,
  event: (id: number) => ["events", id] as const,
  photos: (id: number) => ["events", id, "photos"] as const,
  stats: (id: number) => ["stats", id] as const,
  features: ["features"] as const,
  adminSession: ["admin", "session"] as const,
  adminFeatures: ["admin", "features"] as const,
};

/** 4xx não adianta repetir (404 de evento, 401...); 5xx e rede, até 2 vezes. */
export function shouldRetry(count: number, error: unknown): boolean {
  const status = (error as { status?: number }).status;
  return !(status && status < 500) && count < 2;
}

export const fetchEvent = (id: number) =>
  unwrap(api.GET("/api/events/{event_id}", { params: { path: { event_id: id } } }));

export function useEvents(opts: { pollWhilePending?: boolean } = {}) {
  return useQuery({
    queryKey: qk.events,
    queryFn: () => unwrap(api.GET("/api/events")),
    // Estúdio: atualiza a cada 3 s só enquanto algum evento indexa
    refetchInterval: opts.pollWhilePending
      ? (q) => (q.state.data?.some((e) => e.n_pending > 0) ? 3000 : false)
      : false,
  });
}

export const useEvent = (id: number) => useQuery({ queryKey: qk.event(id), queryFn: () => fetchEvent(id) });

export const usePhotos = (id: number) =>
  useQuery({
    queryKey: qk.photos(id),
    queryFn: () => unwrap(api.GET("/api/events/{event_id}/photos", { params: { path: { event_id: id } } })),
  });

export const useStats = (id: number) =>
  useQuery({
    queryKey: qk.stats(id),
    queryFn: () => unwrap(api.GET("/api/stats", { params: { query: { event_id: id } } })),
  });

// erro: tudo desligado, como no app antigo
export const fetchFeatures = () =>
  unwrap(api.GET("/api/features")).catch(() => ({}) as Record<string, boolean>);

export const useFeatures = () => useQuery({ queryKey: qk.features, queryFn: fetchFeatures, staleTime: 30_000 });

export function invalidateEvent(qc: QueryClient, id: number) {
  for (const key of [qk.events, qk.event(id), qk.photos(id), qk.stats(id)]) qc.invalidateQueries({ queryKey: key });
}

export function useSaveEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: number; body: EventIn }) =>
      id
        ? unwrap(api.PATCH("/api/events/{event_id}", { params: { path: { event_id: id } }, body }))
        : unwrap(api.POST("/api/events", { body })),
    onSuccess: (ev) => invalidateEvent(qc, ev.id),
  });
}

export function useDeleteEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrap(api.DELETE("/api/events/{event_id}", { params: { path: { event_id: id } } })),
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: qk.event(id) });
      qc.invalidateQueries({ queryKey: qk.events });
    },
  });
}

export const useAdminSession = () =>
  useQuery({ queryKey: qk.adminSession, queryFn: () => unwrap(api.GET("/api/admin/session")), retry: false });

export const useAdminFeatures = (enabled: boolean) =>
  useQuery({
    queryKey: qk.adminFeatures,
    queryFn: () => unwrap(api.GET("/api/admin/features")),
    enabled,
    retry: false,
  });

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => unwrap(api.POST("/api/admin/login", { body: { password } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.POST("/api/admin/logout")),
    onSettled: () => qc.invalidateQueries({ queryKey: ["admin"] }),
  });
}

export function useSetFeature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      unwrap(api.PUT("/api/admin/features/{key}", { params: { path: { key } }, body: { enabled } })),
    onSuccess: (f) => {
      qc.setQueryData<Record<string, boolean>>(qk.features, (old) => ({ ...old, [f.key]: f.enabled }));
      qc.invalidateQueries({ queryKey: qk.adminFeatures });
    },
  });
}
```

(Se os nomes dos parâmetros de path no `schema.d.ts` gerado forem diferentes de `event_id`/`key`, use os gerados.)

Exporte também, com `queryOptions` do TanStack Query, as opções das leituras usadas pelas rotas — `eventsQuery`, `eventQuery(id)`, `photosQuery(id)`, `statsQuery(id)`, `featuresQuery` — e faça os hooks acima usarem as mesmas opções. Os loaders das rotas (Task 9 em diante) chamam `context.queryClient.ensureQueryData(eventQuery(id))`: assim o carregamento cai no `pendingComponent` e o erro no `errorComponent` da rota, e o componente lê o cache com o hook.

- [ ] **Step 6: `frontend/src/api/upload.ts`**

```ts
/** Upload de UMA foto com progresso de envio. XMLHttpRequest (e não fetch)
 *  porque só ele reporta progresso de upload. Única exceção à regra "HTTP só
 *  pelo client.ts". */
import type { UploadResult } from "./types";

export type UploadFn = (eventId: number, file: File, onProgress: (sent: number) => void) => Promise<UploadResult>;

export const xhrUpload: UploadFn = (eventId, file, onProgress) =>
  new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("files", file);
    xhr.open("POST", `/api/events/${eventId}/photos`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status === 413) return resolve({ status: "error", error: "Arquivo grande demais" });
      try {
        resolve(
          xhr.status === 200
            ? (JSON.parse(xhr.responseText) as UploadResult[])[0] ?? { status: "error", error: "Resposta vazia" }
            : { status: "error", error: `Erro ${xhr.status}` },
        );
      } catch {
        resolve({ status: "error", error: "Resposta inválida" });
      }
    };
    xhr.onerror = () => resolve({ status: "error", error: "Falha de conexão" });
    xhr.send(form);
  });
```

- [ ] **Step 7: Helper de render — `frontend/tests/render.tsx`**

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";

export function newQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

export function renderWithQuery(ui: ReactNode, qc = newQueryClient()) {
  return { qc, ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>) };
}
```

(A Task 8 acrescenta aqui um `renderRoute(path)` que monta o router real em memória.)

- [ ] **Step 8: `frontend/tests/api/queries.test.tsx`**

```tsx
import { renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { expect, test } from "vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import { shouldRetry, useEvents } from "@/api/queries";
import { server } from "../msw";
import { newQueryClient } from "../render";

test("shouldRetry: não repete 4xx, repete 5xx até 2x", () => {
  expect(shouldRetry(0, { status: 404 })).toBe(false);
  expect(shouldRetry(0, { status: 500 })).toBe(true);
  expect(shouldRetry(2, { status: 500 })).toBe(false);
  expect(shouldRetry(0, new TypeError("rede"))).toBe(true);
});

test("useEvents com polling: refaz enquanto há pendente e para quando zera", async () => {
  let calls = 0;
  server.use(
    http.get("*/api/events", () => {
      calls += 1;
      return HttpResponse.json([{ id: 1, n_pending: calls < 2 ? 1 : 0 }]);
    }),
  );
  const qc = newQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useEvents({ pollWhilePending: true }), { wrapper });
  await waitFor(() => expect(result.current.data?.[0]?.n_pending).toBe(0), { timeout: 5000 });
  const settled = calls;
  await new Promise((r) => setTimeout(r, 3500));
  expect(calls).toBe(settled);
}, 10_000);
```

(O `QueryClient` de produção em `main.tsx` passa a usar `retry: shouldRetry`.)

- [ ] **Step 9: Rodar** `make web-test && make web-lint` → passa. **Commit** `feat(ui): Add typed API client, queries and upload helper`.

---

### Task 7: `lib/` (formatação, texto, geometria)

Porte **literal** das funções puras de `static/app.js`, com testes. Mesma saída, mesmos arredondamentos.

**Files:**
- Create: `frontend/src/lib/format.ts`, `frontend/src/lib/text.ts`, `frontend/src/lib/geometry.ts`, `frontend/src/lib/storage.ts`, `frontend/tests/lib/*.test.ts`

- [ ] **Step 1: Testes — `frontend/tests/lib/format.test.ts`**

```ts
import { expect, test } from "vitest";
import { fmtDate, fmtEta, fmtEventDate, fmtMs, pct, plural, precisionWord } from "@/lib/format";

test("pct", () => expect(pct(0.691)).toBe("69%"));
test("fmtMs", () => {
  expect(fmtMs(250.4)).toBe("250 ms");
  expect(fmtMs(3624.5)).toBe("3,6 s");
});
test("plural", () => {
  expect(plural(1, "foto", "fotos")).toBe("1 foto");
  expect(plural(0, "foto", "fotos")).toBe("0 fotos");
});
test("fmtEventDate: data local sem fuso", () => {
  expect(fmtEventDate("2026-09-13")).toBe("13 de setembro de 2026");
  expect(fmtEventDate(null)).toBeNull();
});
test("fmtDate: ISO com fuso", () => {
  expect(fmtDate("2026-09-29T12:00:00+00:00")).toBe("29 de setembro de 2026");
});
test("fmtEta", () => {
  expect(fmtEta(2000)).toBe("cerca de 5 s restantes");
  expect(fmtEta(42_000)).toBe("cerca de 42 s restantes");
  expect(fmtEta(60_000)).toBe("cerca de 1 min restante");
  expect(fmtEta(150_000)).toBe("cerca de 3 min restantes");
});
test("precisionWord", () => {
  expect(precisionWord(0.3)).toBe("Ampla");
  expect(precisionWord(0.4)).toBe("Equilibrada");
  expect(precisionWord(0.48)).toBe("Equilibrada");
  expect(precisionWord(0.5)).toBe("Rigorosa");
});
```

`frontend/tests/lib/text.test.ts`:

```ts
import { expect, test } from "vitest";
import { fold } from "@/lib/text";

test("fold: sem acento e sem caixa", () => {
  expect(fold("Florianópolis")).toBe("florianopolis");
  expect(fold(null)).toBe("");
});
```

`frontend/tests/lib/geometry.test.ts`:

```ts
import { expect, test } from "vitest";
import { faceCropStyle, faceZoom, focusPos, galleryColumns, rulerRows, rulerX, zoomTransform } from "@/lib/geometry";

test("focusPos com e sem foco", () => {
  expect(focusPos({ fx: 0.2, fy: 0.3 })).toBe("20.0% 30.0%");
  expect(focusPos({})).toBe("50.0% 33.0%");
});

test("faceCropStyle: mesmo cálculo do app antigo", () => {
  const s = faceCropStyle({ url: "u", bbox: [100, 100, 200, 200], width: 1000, height: 800 }, 1.5);
  expect(s.backgroundImage).toBe("url(u)");
  expect(s.backgroundSize).toBe("666.6666666666667% 533.3333333333334%");
  expect(s.backgroundPosition).toBe("8.823529411764707% 11.538461538461538%");
});

test("faceZoom: rosto grande não amplia, pequeno amplia até 3x", () => {
  expect(faceZoom({ bbox: [0, 0, 200, 200], width: 1000, height: 1000 })).toBeNull();
  const z = faceZoom({ bbox: [500, 500, 550, 550], width: 1000, height: 1000 });
  expect(z).toEqual({ scale: 3, cx: 0.525, cy: 0.525 });
});

test("zoomTransform: foto ampliada nunca deixa borda vazia", () => {
  const frame = { left: 0, top: 0, width: 1000, height: 600 };
  const stage = { left: 0, top: 0, right: 1000, bottom: 600 };
  expect(zoomTransform(frame, stage, { scale: 2, cx: 0.99, cy: 0.5 })).toBe("translate(-500.0px, 0.0px) scale(2.000)");
});

test("galleryColumns", () => {
  expect(galleryColumns(375)).toBe(2);
  expect(galleryColumns(1280)).toBe(4);
});

test("rulerX e rulerRows (sobreposição até ~40% na mesma linha)", () => {
  expect(rulerX(0.5)).toBe("calc(20px + (100% - 40px) * 0.5)");
  expect(rulerX(2)).toBe("calc(20px + (100% - 40px) * 1)");
  const rows = rulerRows([0.40, 0.401, 0.9], 800);
  expect(rows.dot).toBe(32);
  expect(rows.rows).toEqual([0, 1, 0]);
  expect(rows.count).toBe(2);
});
```

- [ ] **Step 2: Ver falhar** (`make web-test`).

- [ ] **Step 3: Implementar** — porte das funções:

| arquivo | função | origem em `static/app.js` |
|---|---|---|
| `format.ts` | `pct`, `fmtMs`, `plural`, `fmtDate` | 68-75 |
| `format.ts` | `fmtEventDate` | 221-226 |
| `format.ts` | `fmtEta` | 549-554 |
| `format.ts` | `precisionWord` | 846 |
| `text.ts` | `fold` | 253 |
| `geometry.ts` | `focusPos(p: {fx?: number|null; fy?: number|null})` | 120 |
| `geometry.ts` | `faceCropStyle({url,bbox,width,height}, pad=1.5): CSSProperties` (devolve o objeto de estilo em vez de mutar o nó) | 104-114 |
| `geometry.ts` | `faceZoom` | 941-949 |
| `geometry.ts` | `zoomTransform(frameRect, stageRect, zoom)` — recebe os retângulos já medidos (com o transform zerado) em vez de ler o DOM | 955-973 |
| `geometry.ts` | `galleryColumns(width)` | 899-902 |
| `geometry.ts` | `rulerX(score)` | 1026 |
| `geometry.ts` | `rulerRows(scoresSortedAsc: number[], widthPx): {dot, rows: number[], count}` — o algoritmo de linhas da régua | 1048-1056 |
| `storage.ts` | `getLastEvent(): number | null` e `setLastEvent(id: number | null)` com `try/catch` (chave `"event"`) | 171, 1204 |

Os valores dos testes foram calculados com as fórmulas originais; se algum der diferente, a implementação está divergindo do original — corrija a implementação, não o teste.

- [ ] **Step 4: Rodar** → passa. **Commit** `ref(ui): Port formatting and geometry helpers`.

---

### Task 8: Componentes base (shadcn) com a cara do Foco

**Files:**
- Create: `frontend/components.json`, `frontend/src/lib/utils.ts`, `frontend/src/components/ui/{button,dialog,slider,switch,input,label,select,skeleton,sonner}.tsx`, `frontend/tests/components/ui.test.tsx`
- Modify: `frontend/src/styles/app.css`, `frontend/src/styles/components.css`

- [ ] **Step 1: Inicializar o shadcn** — `cd frontend && pnpm dlx shadcn@latest init` (Tailwind v4, alias `@/components`, `@/lib/utils`, estilo base neutro). Depois `pnpm dlx shadcn@latest add button dialog slider switch input label select skeleton sonner`.

- [ ] **Step 2: Mapear as variáveis do shadcn para os tokens do Foco** no `app.css` (sem tema escuro — o app é só claro, por decisão de produto: `static/style.css:4`): `--background: var(--color-parede)`, `--foreground: var(--color-grafite)`, `--card`/`--popover: var(--color-papel)`, `--primary: var(--color-grafite)`, `--primary-foreground: var(--color-papel)`, `--muted: var(--color-passe)`, `--muted-foreground: var(--color-chumbo)`, `--border`/`--input: var(--color-linha)`, `--ring: var(--color-viridian)`, `--destructive: var(--color-erro)`, `--radius: 6px`. Remova o bloco `.dark` gerado.

- [ ] **Step 3: Ajustar cada componente ao visual do app antigo**

| componente | variantes/visual | origem (`static/style.css`) |
|---|---|---|
| `Button` | `variant`: `default` (`.btn`), `primary` (`.btn.primary`), `danger` (`.btn.danger`), `text` (`.text-btn`, com `.text-btn.danger`), `icon` (`.icon-btn`, `size="small"` = `.icon-btn.small`). Ícone + texto com o mesmo espaçamento. `asChild` para links (`<a>` e `<Link>`). | 75-93 e as regras de `.icon-btn`/`.text-btn` (procure no arquivo) |
| `Slider` | trilho fino preenchido até o valor (o `--p` de hoje), polegar redondo; `min .15`, `max .80`, `step .01`; teclado do Radix | 94-126 |
| `Switch` | verde de foco no estado ligado | 600-613 |
| `Dialog` | painel pequeno centralizado (diálogo de evento) e a variante `lightbox` (tela cheia, fundo escuro) | 537-564 e 443-476 |
| `Select` | seletor de evento da Calibração: botão com rótulo "Evento" + valor + chevron; lista com nome + "N fotos" | 565-583 |
| `Input`/`Label` | `.field` (rótulo acima, `<em>opcional</em>`) | procure `.field` |
| `Skeleton` | bloco `bg-passe` com pulso suave (respeitando `motion-reduce`) | novo (usar a animação `pulse` de 533) |
| `Toaster` (sonner) | como `#toast` de hoje: ícone de check + texto, some em ~2,2 s | procure `.toast` |

- [ ] **Step 4: Testes — `frontend/tests/components/ui.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

test("Button primary e asChild em link", () => {
  render(
    <>
      <Button variant="primary">Criar</Button>
      <Button asChild>
        <a href="/x">Ir</a>
      </Button>
    </>,
  );
  expect(screen.getByRole("button", { name: "Criar" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Ir" })).toHaveAttribute("href", "/x");
});

test("Slider responde ao teclado com passo 0,01", async () => {
  const onChange = vi.fn();
  render(<Slider aria-label="Precisão" min={0.15} max={0.8} step={0.01} value={[0.4]} onValueChange={onChange} />);
  const thumb = screen.getByRole("slider");
  thumb.focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(onChange).toHaveBeenCalledWith([0.41]);
});

test("Switch é um switch acessível", async () => {
  const onChange = vi.fn();
  render(<Switch aria-label="Calibração" checked={false} onCheckedChange={onChange} />);
  await userEvent.click(screen.getByRole("switch", { name: "Calibração" }));
  expect(onChange).toHaveBeenCalledWith(true);
});
```

(jsdom não tem `ResizeObserver`/`PointerEvent` completos, que o Radix usa: adicione polyfills mínimos em `tests/setup.ts` se os testes pedirem.)

- [ ] **Step 5: Rodar** → passa. **Commit** `ref(ui): Add base components styled with Foco tokens`.

---

### Task 9: Layout raiz, rotas, links antigos, flags e paridade

**Files:**
- Modify: `frontend/src/routes/__root.tsx`, `frontend/src/routes/index.tsx`
- Create: `frontend/src/routes/{galeria.$eventId,estudio.index,estudio.$eventId,calibracao,backoffice}.tsx` (stubs), `frontend/src/components/Masthead.tsx`, `frontend/src/components/RouteStates.tsx`, `frontend/src/lib/legacyHash.ts`, `frontend/src/lib/title.ts`, `frontend/tests/lib/legacyHash.test.ts`, `frontend/tests/routes/root.test.tsx`, `frontend/e2e/playwright.config.ts`, `frontend/e2e/parity.ts`
- Modify: `frontend/tests/render.tsx` (`renderRoute`)

- [ ] **Step 1: Teste do redirect — `frontend/tests/lib/legacyHash.test.ts`**

```ts
import { expect, test } from "vitest";
import { legacyHashTarget } from "@/lib/legacyHash";

test.each([
  ["#galeria?e=4", "/galeria/4"],
  ["#galeria", "/"],
  ["#estudio?e=4", "/estudio/4"],
  ["#estudio", "/estudio"],
  ["#calibracao?e=4", "/calibracao?e=4"],
  ["#calibracao", "/calibracao"],
  ["#backoffice", "/backoffice"],
])("%s -> %s", (hash, target) => expect(legacyHashTarget(hash)).toBe(target));

test.each(["", "#", "#qualquer", "#galeria?e=abc"])("ignora %s", (hash) => {
  expect(legacyHashTarget(hash)).toBe(hash === "#galeria?e=abc" ? "/" : null);
});
```

- [ ] **Step 2: `frontend/src/lib/legacyHash.ts`**

```ts
/** Links antigos (#galeria?e=4...) -> rotas novas. null = não é link antigo. */
export function legacyHashTarget(hash: string): string | null {
  const [name, query = ""] = hash.replace(/^#/, "").split("?");
  const e = Number(new URLSearchParams(query).get("e")) || null;
  switch (name) {
    case "galeria":
      return e ? `/galeria/${e}` : "/";
    case "estudio":
      return e ? `/estudio/${e}` : "/estudio";
    case "calibracao":
      return e ? `/calibracao?e=${e}` : "/calibracao";
    case "backoffice":
      return "/backoffice";
    default:
      return null;
  }
}
```

- [ ] **Step 3: `frontend/src/lib/title.ts`** — `useDocumentTitle(title: string)` (efeito que define `document.title`), com os títulos de hoje: `Foco`, `<evento>, Foco`, `Estúdio, Foco`, `<evento>, Estúdio, Foco`, `Calibração, Foco`, `Backoffice, Foco`.

- [ ] **Step 4: `__root.tsx`**

```tsx
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet, redirect } from "@tanstack/react-router";
import { Masthead } from "@/components/Masthead";
import { Toaster } from "@/components/ui/sonner";
import { SelfieSearchProvider } from "@/features/gallery/SelfieSearchProvider";
import { UploadQueueProvider } from "@/features/studio/UploadQueueProvider";
import { legacyHashTarget } from "@/lib/legacyHash";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  beforeLoad: ({ location }) => {
    // links compartilhados antes das URLs novas: #galeria?e=4 -> /galeria/4
    const target = legacyHashTarget(location.hash ? `#${location.hash}` : globalThis.location?.hash ?? "");
    if (target) throw redirect({ href: target, replace: true });
  },
  component: RootLayout,
});

function RootLayout() {
  return (
    <SelfieSearchProvider>
      <UploadQueueProvider>
        <Masthead />
        <main>
          <Outlet />
        </main>
        <Toaster />
      </UploadQueueProvider>
    </SelfieSearchProvider>
  );
}
```

Como os providers só são implementados nas Tasks 12 e 16, crie agora **stubs** que só renderizam `children` (`export function SelfieSearchProvider({ children }) { return children; }`), com um comentário apontando a task. Confira como o TanStack Router instalado expõe o hash em `location` (`location.hash` sem `#` na v1) e ajuste.

- [ ] **Step 5: `Masthead.tsx`** — porte de `static/index.html:96-107` + `static/style.css:127-155` (e as regras de `.masthead`/`.nav`/`.gear` do bloco mobile 614-729): marca (ícone `mark` + "Foco") com `<Link to="/">`, nav com `Galerias` (`/`, ativa também em `/galeria/*`), `Estúdio` (`/estudio*`), `Calibração` (`/calibracao`, **só se** `useFeatures().data?.calibration === true`), engrenagem para `/backoffice` com `aria-label="Backoffice"`. O link ativo recebe `aria-current="page"` (use `activeProps` do `<Link>`).

- [ ] **Step 6: `RouteStates.tsx`** — `RoutePending` (esqueleto genérico: faixa de título + blocos `Skeleton`), `RouteError({ error, reset })` (mensagem do `ApiError.message` ou "Não foi possível carregar." + `Button` "Tentar de novo" que chama `reset()` e `router.invalidate()`), `NotFoundEvent` (ilustração `Prints` + "Evento não encontrado" + link "Voltar para as galerias"/"Voltar para o estúdio" conforme a área). Visual dos estados vazios: `static/style.css:299-302`.

- [ ] **Step 7: Stubs das rotas** — cada arquivo com `createFileRoute(...)`, `pendingComponent: RoutePending`, `errorComponent: RouteError` e um componente provisório com o `<h1 class="display">` da tela. `galeria.$eventId.tsx` e `estudio.$eventId.tsx` validam o parâmetro: `params: { parse: (p) => ({ eventId: Number(p.eventId) }) }` e, se não for inteiro ≥ 1, `throw notFound()`. `galeria.$eventId.tsx` declara `validateSearch` com `foto?: number`; `calibracao.tsx` com `e?: number` e `rosto?: number`.

`calibracao.tsx` — guarda da flag:

```tsx
beforeLoad: async ({ context }) => {
  const flags = await context.queryClient.ensureQueryData({ queryKey: qk.features, queryFn: fetchFeatures });
  if (!flags.calibration) throw redirect({ to: "/", replace: true });
},
```

(`fetchFeatures` vem de `queries.ts`, Task 6.)

**Padrão de dados nas rotas** (vale para todas as telas): o `loader` faz `ensureQueryData` das queries da tela; um `ApiError` 404 de evento vira `throw notFound()` (e a rota define `notFoundComponent: NotFoundEvent`); outros erros sobem para o `errorComponent`. O componente usa os hooks da Task 6, que leem o mesmo cache e continuam atualizando (polling, invalidação).

- [ ] **Step 8: Testes de rota — `frontend/tests/render.tsx` ganha `renderRoute(path)`** (cria o router real com `createMemoryHistory({ initialEntries: [path] })`, o `routeTree` gerado e um `QueryClient` de teste; devolve `{ router, qc }` após `await router.load()`), e `frontend/tests/routes/root.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { expect, test } from "vitest";
import { server } from "../msw";
import { renderRoute } from "../render";

function flags(calibration: boolean) {
  server.use(
    http.get("*/api/features", () => HttpResponse.json({ calibration })),
    http.get("*/api/events", () => HttpResponse.json([])),
  );
}

test("Calibração some da nav com a flag desligada", async () => {
  flags(false);
  await renderRoute("/");
  expect(screen.getByRole("link", { name: "Galerias" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Calibração" })).not.toBeInTheDocument();
});

test("Calibração aparece com a flag ligada", async () => {
  flags(true);
  await renderRoute("/");
  expect(await screen.findByRole("link", { name: "Calibração" })).toBeInTheDocument();
});

test("/calibracao com a flag desligada volta para /", async () => {
  flags(false);
  const { router } = await renderRoute("/calibracao");
  expect(router.state.location.pathname).toBe("/");
});

test("link antigo com # redireciona", async () => {
  flags(false);
  const { router } = await renderRoute("/#estudio?e=4");
  expect(router.state.location.pathname).toBe("/estudio/4");
});
```

- [ ] **Step 9: Ferramenta de paridade — `frontend/e2e/playwright.config.ts` e `frontend/e2e/parity.ts`**

`playwright.config.ts`: `use.launchOptions.executablePath = process.env.PW_CHROMIUM || undefined`, headless.

`parity.ts` (roda com `pnpm parity`; adicione `tsx` às devDependencies):

```ts
/** Screenshots do app antigo (:8000, static/) e do novo (:5173) lado a lado.
 *  Uso: PARITY_EVENT=<id com fotos prontas> [PARITY_SELFIE=<caminho>] [PW_CHROMIUM=...] pnpm parity [tela...]
 *  Saída: e2e/.parity/index.html (abra no navegador). Comparação a olho. */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";

const OLD = process.env.PARITY_OLD ?? "http://127.0.0.1:8000";
const NEW = process.env.PARITY_NEW ?? "http://127.0.0.1:5173";
const EVENT = process.env.PARITY_EVENT;
const SELFIE = process.env.PARITY_SELFIE;
const WIDTHS = [375, 768, 1280];
const OUT = new URL("./.parity/", import.meta.url).pathname;

type Screen = { name: string; old: string; new: string; prepare?: (page: Page, which: "old" | "new") => Promise<void> };

const selfie = async (page: Page, which: "old" | "new") => {
  if (!SELFIE) return;
  const input = which === "old" ? "#selfie-input" : 'input[type="file"][accept="image/*"]';
  await page.setInputFiles(input, SELFIE);
  await page.waitForTimeout(2500);
};

const SCREENS: Screen[] = [
  { name: "galerias", old: "/#galeria", new: "/" },
  { name: "galeria", old: `/#galeria?e=${EVENT}`, new: `/galeria/${EVENT}` },
  { name: "galeria-resultado", old: `/#galeria?e=${EVENT}`, new: `/galeria/${EVENT}`, prepare: selfie },
  { name: "estudio", old: "/#estudio", new: "/estudio" },
  { name: "estudio-evento", old: `/#estudio?e=${EVENT}`, new: `/estudio/${EVENT}` },
  { name: "calibracao", old: `/#calibracao?e=${EVENT}`, new: `/calibracao?e=${EVENT}`, prepare: selfie },
  { name: "backoffice", old: "/#backoffice", new: "/backoffice" },
];

const only = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
mkdirSync(OUT, { recursive: true });
const rows: string[] = [];
for (const s of SCREENS.filter((x) => !only.length || only.includes(x.name))) {
  for (const w of WIDTHS) {
    const cells: string[] = [];
    for (const which of ["old", "new"] as const) {
      const page = await browser.newPage({ viewport: { width: w, height: 900 } });
      await page.goto((which === "old" ? OLD : NEW) + s[which]);
      await page.waitForLoadState("networkidle");
      await s.prepare?.(page, which);
      await page.waitForTimeout(600); // animações de entrada
      const file = `${s.name}-${w}-${which}.png`;
      await page.screenshot({ path: OUT + file, fullPage: true });
      await page.close();
      cells.push(`<td><div>${which} ${w}px</div><img src="${file}"></td>`);
    }
    rows.push(`<tr><th>${s.name}</th>${cells.join("")}</tr>`);
  }
}
await browser.close();
writeFileSync(
  `${OUT}index.html`,
  `<!doctype html><meta charset="utf-8"><title>Paridade</title><style>img{width:100%;border:1px solid #ccc}td{vertical-align:top;width:50%}</style><table>${rows.join("")}</table>`,
);
console.log(`abra ${OUT}index.html`);
```

Como usar em cada tarefa de tela: com `make api`, `make worker` e `make web` rodando e um evento com fotos indexadas, `PARITY_EVENT=<id> PW_CHROMIUM=... pnpm --dir frontend parity <tela>` e comparar a olho as colunas "old" e "new" em cada largura. Diferenças aceitas: só os 4 ajustes da spec.

- [ ] **Step 10: Rodar** `make web-test && make web-lint`; subir `make api` + `make web` e conferir a nav em http://127.0.0.1:5173 (e que `http://127.0.0.1:5173/#estudio` vai para `/estudio`). `pnpm --dir frontend parity galerias` gera a página (o lado "new" ainda é o stub).

- [ ] **Step 11: Commit** `feat(ui): Add root layout, routes, legacy link redirects and parity tool`.

---

### Tasks de tela (10–18): o que vale para todas

- **Paridade**: o componente reproduz o markup e o CSS de origem indicados. Classes CSS viram utilitários do Tailwind com os tokens do `app.css`; o que não couber (keyframes, pseudo-elementos, grade por `data-*`) vai para `components.css` com o mesmo nome de classe do original. Textos em pt-BR **idênticos** (copie do original).
- **Acessibilidade**: preserve `aria-*`, `role`, `sr-only`, `alt` e a ordem de foco do original.
- **Imagens**: `photoImg` do original (`static/app.js:124-129`: `srcset` thumb 400w / medium 1600w, `sizes`, `loading="lazy"`, `decoding="async"`, `object-position` com `focusPos`) vira `features/events/PhotoImg.tsx`; `loadProgressive` (`240-248`) vira o hook `useProgressiveSrc(photoId, size)` em `features/events/useProgressiveSrc.ts` (thumb na hora, troca pela média quando carregar; cancela se o id mudar).
- **Estados**: cada tela usa `RoutePending`/`RouteError`/`NotFoundEvent` da Task 9, com o padrão de dados nas rotas (loader com `ensureQueryData`, 404 → `notFound()`).
- **Última etapa de cada tarefa**: paridade (`pnpm parity <tela>`) nas 3 larguras, anotar no relatório as diferenças que restarem e por quê.

---

### Task 10: Índice público de galerias (`/`)

**Files:**
- Modify: `frontend/src/routes/index.tsx`
- Create: `frontend/src/features/events/{PhotoImg,useProgressiveSrc,EventFacts,GalleryCover}.tsx`, `frontend/src/features/gallery/GalleryIndex.tsx`, `frontend/tests/features/gallery-index.test.tsx`

**Origem:** `static/index.html:111-128`; `static/app.js:227-236` (factsEl), `250-280` (renderIndex, galCover); `static/style.css:205-213` (fatos), `477-512` (índices, card, capa do card) + regras de `.index-head`, `.search`, `.gal-*` no bloco mobile `614-729`.

**Contrato:**
- `EventFacts({ ev, count = true })`: data (fmtEventDate) | local | "N fotos" separados por filete (não por "·"); nada se vazio.
- `GalleryCover({ cover })`: 1, 2 (díptico) ou 3 fotos (grande + duas), `data-n`, `sizes` como no original (`276`).
- `GalleryIndex`: `useEvents()`; só eventos com `n_done > 0`; busca (`fold` em `nome + local`, debounce 120 ms) visível só com 4+ publicados; card = `<Link to="/galeria/$eventId">`; vazio: "Nenhuma galeria publicada ainda." ou `Nenhuma galeria com “<termo>”. Tente o nome do evento ou a cidade.`
- Título do documento: `Foco`.

- [ ] **Step 1: Testes — `frontend/tests/features/gallery-index.test.tsx`**

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { expect, test } from "vitest";
import { server } from "../msw";
import { renderRoute } from "../render";

const ev = (id: number, name: string, n_done: number, location: string | null = null) => ({
  id, name, location, event_date: null, created_at: "2026-09-29T12:00:00+00:00",
  n_photos: n_done, n_done, n_pending: 0, n_faces: 0, cover: n_done ? [{ id: id * 10, fx: 0.5, fy: 0.3 }] : [],
});

function events(list: unknown[]) {
  server.use(
    http.get("*/api/features", () => HttpResponse.json({ calibration: false })),
    http.get("*/api/events", () => HttpResponse.json(list)),
  );
}

test("mostra só eventos com fotos prontas, com link para a galeria", async () => {
  events([ev(1, "Corrida", 3), ev(2, "Vazio", 0)]);
  await renderRoute("/");
  const link = await screen.findByRole("link", { name: /Corrida/ });
  expect(link).toHaveAttribute("href", "/galeria/1");
  expect(screen.queryByText("Vazio")).not.toBeInTheDocument();
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument(); // menos de 4
});

test("busca sem acento aparece com 4+ galerias", async () => {
  events([ev(1, "Corrida", 1, "Florianópolis"), ev(2, "Casamento", 1), ev(3, "Show", 1), ev(4, "Feira", 1)]);
  await renderRoute("/");
  await userEvent.type(await screen.findByRole("searchbox"), "florianopolis");
  expect(await screen.findByRole("link", { name: /Corrida/ })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Casamento/ })).not.toBeInTheDocument();
});

test("estado vazio", async () => {
  events([]);
  await renderRoute("/");
  expect(await screen.findByText("Nenhuma galeria publicada ainda.")).toBeInTheDocument();
});

test("erro de rede mostra Tentar de novo", async () => {
  server.use(
    http.get("*/api/features", () => HttpResponse.json({})),
    http.get("*/api/events", () => HttpResponse.json({ detail: "banco indisponível" }, { status: 503 })),
  );
  await renderRoute("/");
  expect(await screen.findByText("banco indisponível")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Ver falhar**, **Step 3: implementar**, **Step 4: rodar** `make web-test && make web-lint`, **Step 5: paridade** `pnpm parity galerias`, **Step 6: commit** `ref(ui): Port the public gallery index`.

---

### Task 11: Página do evento (`/galeria/$eventId`): capa e estados

**Files:**
- Modify: `frontend/src/routes/galeria.$eventId.tsx`
- Create: `frontend/src/features/gallery/{EventHero,Collage}.tsx`, `frontend/tests/features/gallery-event.test.tsx`

**Origem:** `static/index.html:131-147`; `static/app.js:284-312` (renderGalleryEvent, renderCollage); `static/style.css:156-204` (capa, mosaico por `data-n`, keyframe `settle`, degradê, filete).

**Contrato:**
- Dados: loader com `ensureQueryData(eventQuery(eventId))` e `useEvent(eventId)` (endpoint novo da Task 1). 404 → `notFound()` → `NotFoundEvent` ("Evento não encontrado"; o original dizia "Galeria não encontrada" no título — use "Galeria não encontrada" aqui, que é o texto da tela pública).
- `Collage({ cover })`: até 5 fotos, `data-n`, áreas `ct-a`…`ct-e`, `--i` para o atraso da animação, `useProgressiveSrc(id, "medium")`; não recria (nem reanima) se os ids da capa não mudaram.
- `EventHero`: com capa → mosaico + degradê + link "Todas as galerias" + título + fatos (`EventFacts` com contagem); sem capa → cabeçalho simples.
- Sem fotos publicadas: estado vazio "As fotos deste evento ainda não foram publicadas. Volte mais tarde." e **sem** o bloco de busca.
- Com fotos: renderiza a área de busca (Task 12) e os resultados (Task 13) — por enquanto um marcador.
- Título: `<evento>, Foco`. Guardar o evento como último aberto (`setLastEvent`).

- [ ] **Step 1: Testes — `frontend/tests/features/gallery-event.test.tsx`**

```tsx
import { screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { expect, test } from "vitest";
import { server } from "../msw";
import { renderRoute } from "../render";

const base = { location: "SP", event_date: "2026-09-13", created_at: "2026-09-29T12:00:00+00:00", n_pending: 0, n_faces: 3 };

function event(body: unknown, status = 200) {
  server.use(
    http.get("*/api/features", () => HttpResponse.json({})),
    http.get("*/api/events/:id", () => HttpResponse.json(body, { status })),
  );
}

test("evento com fotos mostra capa, fatos e a busca", async () => {
  event({ ...base, id: 4, name: "Corrida", n_photos: 2, n_done: 2, cover: [{ id: 7, fx: 0.5, fy: 0.3 }, { id: 8, fx: 0.5, fy: 0.3 }] });
  await renderRoute("/galeria/4");
  expect(await screen.findByRole("heading", { level: 1, name: "Corrida" })).toBeInTheDocument();
  expect(screen.getByText("13 de setembro de 2026")).toBeInTheDocument();
  expect(screen.getByText("2 fotos")).toBeInTheDocument();
  expect(document.title).toBe("Corrida, Foco");
});

test("evento sem fotos publicadas", async () => {
  event({ ...base, id: 5, name: "Em breve", n_photos: 0, n_done: 0, cover: [] });
  await renderRoute("/galeria/5");
  expect(await screen.findByText("As fotos deste evento ainda não foram publicadas. Volte mais tarde.")).toBeInTheDocument();
});

test("evento inexistente", async () => {
  event({ detail: "evento não encontrado" }, 404);
  await renderRoute("/galeria/999");
  expect(await screen.findByText("Galeria não encontrada")).toBeInTheDocument();
});

test("id inválido na URL é 404 sem chamar a API", async () => {
  event({});
  await renderRoute("/galeria/abc");
  expect(await screen.findByText("Galeria não encontrada")).toBeInTheDocument();
});
```

- [ ] **Steps 2–6** como na Task 10 (paridade: `pnpm parity galeria`). Commit `ref(ui): Port the event gallery hero`.

---

### Task 12: Busca da selfie (provider + visor)

**Files:**
- Modify: `frontend/src/features/gallery/SelfieSearchProvider.tsx` (substitui o stub)
- Create: `frontend/src/features/gallery/{Viewfinder,SelfieFinder}.tsx`, `frontend/src/features/gallery/useCamera.ts`, `frontend/tests/features/selfie-search.test.tsx`

- [ ] **Step 1: Testes do provider — `frontend/tests/features/selfie-search.test.tsx`**

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { expect, test } from "vitest";
import { qk } from "@/api/queries";
import { SelfieSearchProvider, useSelfieSearch } from "@/features/gallery/SelfieSearchProvider";
import { server } from "../msw";
import { newQueryClient } from "../render";

const selfie = { bbox: [0, 0, 10, 10], det_score: 0.9, n_faces: 1, all_bboxes: [[0, 0, 10, 10]], width: 100, height: 100, warning: null };
const hit = { face_id: 1, photo_id: 7, score: 0.69, bbox: [1, 2, 3, 4], width: 100, height: 100, filename: "a.jpg" };

function setup(calibration = false) {
  const qc = newQueryClient();
  qc.setQueryData(qk.features, { calibration });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <SelfieSearchProvider>{children}</SelfieSearchProvider>
    </QueryClientProvider>
  );
  return { qc, ...renderHook(() => useSelfieSearch(), { wrapper }) };
}

const forms: FormData[] = [];
function searchReplies(...replies: Array<() => Response>) {
  forms.length = 0;
  server.use(
    http.post("*/api/search", async ({ request }) => {
      forms.push(await request.formData());
      const next = replies.shift();
      if (!next) throw new Error("busca inesperada");
      return next();
    }),
  );
}
const blob = () => new Blob(["x"], { type: "image/jpeg" });

test("selfie -> token; slider busca pelo token e reaproveita a selfie e os tempos", async () => {
  searchReplies(
    () => HttpResponse.json({ query_token: "T1", threshold: 0.4, total_photos: 2, indexed_faces: 3, matches: [hit], selfie, timings_ms: { detection: 300, search: 2 } }),
    () => HttpResponse.json({ query_token: "T1", threshold: 0.3, total_photos: 2, indexed_faces: 3, matches: [hit], timings_ms: { search: 1 }, timings_from_cache: true }),
  );
  const { result } = setup();
  act(() => result.current.setEvent(4));
  act(() => result.current.useSelfie(blob()));
  await waitFor(() => expect(result.current.state.status).toBe("done"));
  expect(forms[0]?.get("event_id")).toBe("4");
  expect(forms[0]?.get("selfie")).toBeInstanceOf(File);

  act(() => result.current.setThreshold(0.3));
  await waitFor(() => expect(forms).toHaveLength(2));
  expect(forms[1]?.get("query_token")).toBe("T1");
  expect(forms[1]?.get("selfie")).toBeNull();
  await waitFor(() => expect(result.current.state.result?.threshold).toBe(0.3));
  expect(result.current.state.result?.selfie).toEqual(selfie);
  expect(result.current.state.result?.timings_ms).toEqual({ detection: 300, search: 1 });
});

test("410 reenvia a selfie guardada uma vez", async () => {
  searchReplies(
    () => HttpResponse.json({ query_token: "T1", threshold: 0.4, total_photos: 1, indexed_faces: 1, matches: [], selfie }),
    () => HttpResponse.json({ detail: "Busca expirada. Envie a selfie de novo." }, { status: 410 }),
    () => HttpResponse.json({ query_token: "T2", threshold: 0.35, total_photos: 1, indexed_faces: 1, matches: [], selfie }),
  );
  const { result } = setup();
  act(() => result.current.setEvent(4));
  act(() => result.current.useSelfie(blob()));
  await waitFor(() => expect(result.current.state.status).toBe("done"));
  act(() => result.current.setThreshold(0.35));
  await waitFor(() => expect(forms).toHaveLength(3));
  expect(forms[2]?.get("selfie")).toBeInstanceOf(File);
  await waitFor(() => expect(result.current.state.queryToken).toBe("T2"));
});

test("422 mostra a mensagem de rosto não encontrado", async () => {
  searchReplies(() => HttpResponse.json({ detail: "Nenhum rosto" }, { status: 422 }));
  const { result } = setup();
  act(() => result.current.setEvent(4));
  act(() => result.current.useSelfie(blob()));
  await waitFor(() => expect(result.current.state.status).toBe("error"));
  expect(result.current.state.message).toEqual({
    text: "Não encontramos um rosto nesta foto. Tente de frente, com mais luz.",
    kind: "err",
  });
});

test("vários rostos: aviso", async () => {
  searchReplies(() =>
    HttpResponse.json({ query_token: "T", threshold: 0.4, total_photos: 1, indexed_faces: 1, matches: [], selfie: { ...selfie, n_faces: 3, warning: "3 rostos" } }),
  );
  const { result } = setup();
  act(() => result.current.setEvent(4));
  act(() => result.current.useSelfie(blob()));
  await waitFor(() => expect(result.current.state.message.kind).toBe("warn"));
  expect(result.current.state.message.text).toBe("3 rostos na selfie. Usamos o maior.");
});

test("cura: calibração ligada mas resposta sem top 30 desliga a flag", async () => {
  searchReplies(() => HttpResponse.json({ query_token: "T", threshold: 0.4, total_photos: 1, indexed_faces: 1, matches: [], selfie }));
  const { result, qc } = setup(true);
  act(() => result.current.setEvent(4));
  act(() => result.current.useSelfie(blob()));
  await waitFor(() => expect(qc.getQueryData(qk.features)).toEqual({ calibration: false }));
});

test("trocar de evento limpa a busca e mantém o corte", async () => {
  searchReplies(() => HttpResponse.json({ query_token: "T", threshold: 0.45, total_photos: 1, indexed_faces: 1, matches: [hit], selfie }));
  const { result } = setup();
  act(() => result.current.setEvent(4));
  act(() => result.current.setThreshold(0.45));
  act(() => result.current.useSelfie(blob()));
  await waitFor(() => expect(result.current.state.status).toBe("done"));
  act(() => result.current.setEvent(5));
  expect(result.current.state).toMatchObject({ eventId: 5, result: null, queryToken: null, selfieBlob: null, selfieUrl: null, status: "idle", threshold: 0.45 });
});
```

(jsdom não tem `URL.createObjectURL`: defina `URL.createObjectURL = () => "blob:x"` e `URL.revokeObjectURL = () => {}` em `tests/setup.ts`.)

- [ ] **Step 2: Ver falhar.**

- [ ] **Step 3: `frontend/src/features/gallery/SelfieSearchProvider.tsx`**

```tsx
/** Busca por selfie, compartilhada entre Galeria e Calibração (como no app antigo).
 *  Nunca persistida (nem localStorage, nem URL): a selfie é dado biométrico. */
import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { ApiError, searchPhotos } from "@/api/client";
import { qk } from "@/api/queries";
import type { SearchOut, SelfieInfo } from "@/api/types";

export type SearchStatus = "idle" | "searching" | "done" | "error";
export type Message = { text: string; kind: "" | "warn" | "err" };

export interface SearchState {
  eventId: number | null;
  selfieBlob: Blob | null;
  selfieUrl: string | null;
  queryToken: string | null;
  selfieInfo: SelfieInfo | null;
  firstTimings: Record<string, number> | null;
  threshold: number;
  result: SearchOut | null;
  status: SearchStatus;
  message: Message;
}

const NO_FACE = "Não encontramos um rosto nesta foto. Tente de frente, com mais luz.";
const EMPTY: Message = { text: "", kind: "" };

const initial = (threshold = 0.4, eventId: number | null = null): SearchState => ({
  eventId, selfieBlob: null, selfieUrl: null, queryToken: null, selfieInfo: null, firstTimings: null,
  threshold, result: null, status: "idle", message: EMPTY,
});

interface SelfieSearch {
  state: SearchState;
  setEvent: (id: number | null) => void;
  useSelfie: (blob: Blob) => void;
  setThreshold: (value: number) => void;
}

const Ctx = createContext<SelfieSearch | null>(null);

/** `initialState` só para testes (montar uma tela já com resultado). */
export function SelfieSearchProvider({ children, initialState }: { children: ReactNode; initialState?: Partial<SearchState> }) {
  const qc = useQueryClient();
  const [state, setState] = useState<SearchState>(() => ({ ...initial(), ...initialState }));
  const ref = useRef(state);
  const update = useCallback((fn: (s: SearchState) => SearchState) => {
    ref.current = fn(ref.current); // estado mais novo já disponível para as buscas assíncronas
    setState(ref.current);
  }, []);
  const request = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  const run = useCallback(
    async (blob?: Blob): Promise<void> => {
      const cur = ref.current;
      if (!cur.eventId) return;
      const form = new FormData();
      form.append("event_id", String(cur.eventId));
      form.append("threshold", String(cur.threshold));
      if (blob) form.append("selfie", blob, "selfie.jpg");
      else if (cur.queryToken) form.append("query_token", cur.queryToken);
      else return;
      const id = ++request.current;
      if (blob) update((s) => ({ ...s, status: "searching", message: { text: "Procurando você nas fotos do evento", kind: "" } }));
      try {
        const r = await searchPhotos(form);
        if (id !== request.current) return; // resposta velha: o slider já pediu outra
        const selfieInfo = r.selfie ?? ref.current.selfieInfo;
        const firstTimings = r.selfie ? (r.timings_ms ?? null) : ref.current.firstTimings;
        // A busca pelo token não traz a selfie nem os tempos da detecção: reaproveita os da primeira.
        const timings = !r.selfie && r.timings_ms && firstTimings ? { ...firstTimings, search: r.timings_ms.search ?? 0 } : r.timings_ms;
        const result: SearchOut = { ...r, selfie: selfieInfo ?? undefined, timings_ms: timings };
        // Desligaram a Calibração com a página aberta: a resposta veio sem o top 30.
        const flags = qc.getQueryData<Record<string, boolean>>(qk.features);
        if (!r.debug_top && flags?.calibration) qc.setQueryData(qk.features, { ...flags, calibration: false });
        update((s) => ({
          ...s,
          queryToken: r.query_token,
          selfieInfo,
          firstTimings,
          result,
          status: "done",
          message: blob
            ? r.selfie?.warning
              ? { text: `${r.selfie.n_faces} rostos na selfie. Usamos o maior.`, kind: "warn" }
              : EMPTY
            : s.message,
        }));
      } catch (e) {
        if (id !== request.current) return;
        // token expirado (410): reenvia a selfie guardada; a retentativa vai com a selfie, então não entra em loop
        if (e instanceof ApiError && e.status === 410 && !blob && ref.current.selfieBlob) return run(ref.current.selfieBlob);
        const text = e instanceof ApiError && e.status === 422 ? NO_FACE : (e as Error).message;
        update((s) => ({ ...s, ...(blob ? { result: null } : {}), status: "error", message: { text, kind: "err" } }));
      }
    },
    [qc, update],
  );

  const setEvent = useCallback(
    (id: number | null) => {
      if (id === ref.current.eventId) return;
      request.current += 1; // ignora respostas do evento anterior
      clearTimeout(debounce.current);
      if (ref.current.selfieUrl) URL.revokeObjectURL(ref.current.selfieUrl);
      update((s) => initial(s.threshold, id));
    },
    [update],
  );

  const useSelfie = useCallback(
    (blob: Blob) => {
      if (ref.current.selfieUrl) URL.revokeObjectURL(ref.current.selfieUrl);
      update((s) => ({ ...s, selfieBlob: blob, selfieUrl: URL.createObjectURL(blob), status: "searching" }));
      void run(blob);
    },
    [run, update],
  );

  const setThreshold = useCallback(
    (value: number) => {
      update((s) => ({ ...s, threshold: value }));
      clearTimeout(debounce.current);
      debounce.current = setTimeout(() => {
        if (ref.current.queryToken) void run();
      }, 150);
    },
    [run, update],
  );

  const value = useMemo(() => ({ state, setEvent, useSelfie, setThreshold }), [state, setEvent, useSelfie, setThreshold]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSelfieSearch(): SelfieSearch {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSelfieSearch fora do SelfieSearchProvider");
  return ctx;
}
```

(O Biome pode reclamar do nome `useSelfie` por parecer hook: é uma ação do contexto; renomeie para `submitSelfie` se o lint exigir, nos testes também.)

- [ ] **Step 4: Visor e bloco de busca**

**Origem:** `static/index.html:148-177`; `static/app.js:729-742` (setViewfinder), `796-843` (useSelfie, inputs, câmera); `static/style.css:214-252` (bloco, visor, colchetes AF, keyframes `af-lock`/`af-hunt`) + mobile.

**Contrato:**
- `useCamera()`: `{ stream, open(), close(), shoot(): Promise<Blob> }` com `getUserMedia({ video: { width: 1280, height: 960, facingMode: "user" } })`; `shoot` desenha num canvas e gera JPEG 0,92; `close` para as tracks; para ao desmontar. Erro: `Não foi possível abrir a câmera. Permita o acesso no navegador.` (NotAllowedError) ou `Não foi possível abrir a câmera. <mensagem>`.
- `Viewfinder({ mode, selfieUrl, face })`: modos `empty` (silhueta), `cam` (vídeo), `searching` (selfie inteira, colchetes "caçando"), `face` (recorte `faceCropStyle(..., 1.9)` e animação de trava, reiniciada a cada busca nova). Deriva o modo de `state.status` + câmera aberta.
- `SelfieFinder`: título "Encontre suas fotos", texto, `Enviar selfie` (input file `accept="image/*"`, reseta o value), `Usar a câmera`/`Fechar câmera`, `Tirar foto` (só com câmera), aviso de privacidade com cadeado, mensagem (`role="status"`, classes `warn`/`err`).
- Na rota `/galeria/$eventId`: `setEvent(eventId)` ao montar/trocar.

- [ ] **Step 5: Rodar, paridade** (`pnpm parity galeria-resultado` com `PARITY_SELFIE`), **commit** `ref(ui): Port the selfie search and viewfinder`.

---

### Task 13: Resultados da busca

**Files:**
- Create: `frontend/src/features/gallery/{ResultsBar,ResultsGrid}.tsx`, `frontend/tests/features/results.test.tsx`

**Origem:** `static/index.html:179-191`; `static/app.js:845-923` (precisão, renderGallery, masonry, zip); `static/style.css:253-298` (barra de resultados grudada, fotos, `score-tag`, `nohover`).

**Contrato:**
- `ResultsBar`: contagem ("N fotos com você"/"1 foto com você"/"Nenhuma foto encontrada" + " de X no evento"), precisão (`Slider` 0,15–0,80, rótulo `Precisão` + palavra `precisionWord`, extremos "mais fotos"/"mais certeza"), `Baixar todas` (`<a href={zipUrl(ids)}>` como botão; desabilitado sem resultados).
- `ResultsGrid`: masonry — cada foto na coluna mais baixa, proporção da API (`height/width`, calha 0,02), colunas por `galleryColumns(largura do container)` recalculadas no resize (debounce 150 ms, `ResizeObserver`); card `<button aria-label="Abrir <arquivo>">` com a foto (`srcset` thumb/medium, `sizes="(max-width: 600px) 50vw, 25vw"`, `width`/`height`) e `score-tag` com `pct(score)`; clique abre o visualizador (Task 14: navega com `search: { foto: photo_id }`). Sem resultados: `Nenhuma foto passou do nível de precisão atual. Mova a precisão para "mais fotos" ou tente uma selfie de frente, com boa luz.`
- Só aparece com `state.result` e evento com fotos.

- [ ] **Step 1: Testes — `frontend/tests/features/results.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { ResultsBar } from "@/features/gallery/ResultsBar";

const m = (photo_id: number) => ({ face_id: photo_id, photo_id, score: 0.7, bbox: [0, 0, 1, 1], width: 100, height: 80, filename: `${photo_id}.jpg` });

test("contagem e link do zip", () => {
  render(<ResultsBar matches={[m(3), m(5)]} totalPhotos={10} threshold={0.4} onThreshold={() => {}} />);
  expect(screen.getByText("2 fotos com você")).toBeInTheDocument();
  expect(screen.getByText("de 10 no evento")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Baixar todas/ })).toHaveAttribute("href", "/api/zip?ids=3,5");
  expect(screen.getByText("Equilibrada")).toBeInTheDocument();
});

test("sem resultados", () => {
  render(<ResultsBar matches={[]} totalPhotos={10} threshold={0.7} onThreshold={() => {}} />);
  expect(screen.getByText("Nenhuma foto encontrada")).toBeInTheDocument();
  expect(screen.getByText("Rigorosa")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Baixar todas/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Baixar todas/ })).toBeDisabled();
});
```

(O masonry é coberto por `galleryColumns` na Task 7 e pela paridade visual.)

- [ ] **Steps 2–6** (paridade `galeria-resultado`). Commit `ref(ui): Port search results and masonry grid`.

---

### Task 14: Visualizador de foto (`?foto` / `?rosto`)

**Files:**
- Create: `frontend/src/features/gallery/{Lightbox,useLightboxParam}.tsx`, `frontend/tests/features/lightbox.test.tsx`
- Modify: `frontend/src/routes/galeria.$eventId.tsx` (e a Calibração usa o mesmo componente na Task 17)

**Origem:** `static/index.html:411-431`; `static/app.js:925-1011` (marcador, faceZoom, zoomTransform, setWhere, openModal, fechar); `static/style.css:443-476` (lightbox, marcação que "trava") + `730-738` (celular deitado) + mobile.

**Contrato:**
- `Lightbox({ match, onClose })`: `Dialog` variante lightbox; imagem com `useProgressiveSrc(photo_id, "medium")`, `width`/`height` da foto, `alt` = arquivo; colchetes AF no rosto (`drawAF` de `91-100` vira um `<div class="af-box">` posicionado em %) que aparecem "travando" por ~2 s ao abrir; `Onde estou?` alterna marcação fixa + zoom (`faceZoom`/`zoomTransform` medindo `frame` e `stage` com o transform zerado) e vira "Ver foto inteira" quando há zoom; barra com `<strong>` "69% de semelhança", legenda com o arquivo (`title` com o score de 3 casas), `Baixar foto` (`downloadUrl`), `Fechar`, botão X; clicar no espaço vazio em volta fecha; `body` recebe a classe `modal-open` enquanto aberto.
- `useLightboxParam(param: "foto" | "rosto", items)`: lê o search param; resolve o item (`photo_id` para `foto`, `face_id` para `rosto`); `open(item)` navega com push; `close()` faz `history.back()` se a abertura foi um push nesta sessão (ref), senão navega com `replace` sem o parâmetro; se o parâmetro existir mas o item não (recarregou sem busca, ou id fora dos resultados) → remove com `replace`.

- [ ] **Step 1: Testes — `frontend/tests/features/lightbox.test.tsx`**

Monte a rota `/galeria/4` com MSW (evento com capa) e o `SelfieSearchProvider` já com resultado, pelo `initialState` (Task 12). O `__root` repassa um `initialSearch` opcional do contexto do router ao provider; `renderRoute(path, { search })` preenche esse contexto.

```tsx
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { expect, test } from "vitest";
import { server } from "../msw";
import { renderRoute } from "../render";

const hit = { face_id: 11, photo_id: 7, score: 0.691, bbox: [10, 10, 30, 30], width: 100, height: 80, filename: "praia.jpg" };
const result = { query_token: "T", threshold: 0.4, total_photos: 1, indexed_faces: 1, matches: [hit] };

function api() {
  server.use(
    http.get("*/api/features", () => HttpResponse.json({})),
    http.get("*/api/events/:id", () =>
      HttpResponse.json({ id: 4, name: "Corrida", location: null, event_date: null, created_at: "2026-09-29T12:00:00+00:00",
        n_photos: 1, n_done: 1, n_pending: 0, n_faces: 1, cover: [{ id: 7, fx: 0.5, fy: 0.3 }] }),
    ),
  );
}

test("abrir a foto põe ?foto na URL; voltar fecha", async () => {
  api();
  const { router } = await renderRoute("/galeria/4", { search: { eventId: 4, result, status: "done" } });
  await userEvent.click(await screen.findByRole("button", { name: "Abrir praia.jpg" }));
  expect(router.state.location.search).toEqual({ foto: 7 });
  expect(screen.getByText("69% de semelhança")).toBeInTheDocument();
  act(() => router.history.back());
  await waitFor(() => expect(screen.queryByText("69% de semelhança")).not.toBeInTheDocument());
  expect(router.state.location.search).toEqual({});
});

test("Fechar volta no histórico", async () => {
  api();
  const { router } = await renderRoute("/galeria/4", { search: { eventId: 4, result, status: "done" } });
  await userEvent.click(await screen.findByRole("button", { name: "Abrir praia.jpg" }));
  await userEvent.click(screen.getByRole("button", { name: "Fechar" }));
  await waitFor(() => expect(router.state.location.search).toEqual({}));
});

test("recarregar com ?foto sem busca remove o parâmetro", async () => {
  api();
  const { router } = await renderRoute("/galeria/4?foto=7");
  await waitFor(() => expect(router.state.location.search).toEqual({}));
  expect(screen.queryByText("69% de semelhança")).not.toBeInTheDocument();
});
```

(`renderRoute(path, { search })` passa `initialState` ao `SelfieSearchProvider` — estenda o helper. Com dois botões chamados "Fechar" (X com `aria-label="Fechar"` e o de texto), use `getAllByRole(...)[1]` ou dê ao X o `aria-label` original `Fechar` e selecione pelo texto visível.)

- [ ] **Steps 2–6** (paridade: abra uma foto no `galeria-resultado` — acrescente um `prepare` que clica na 1ª foto se precisar). Commit `feat(ui): Port the photo viewer with back-button support`.

---

### Task 15: Estúdio — lista de eventos e diálogo de evento

**Files:**
- Modify: `frontend/src/routes/estudio.index.tsx`
- Create: `frontend/src/features/studio/{EventRows,EventDialog}.tsx`, `frontend/tests/features/studio-index.test.tsx`

**Origem:** `static/index.html:195-209` (lista), `377-409` (diálogo); `static/app.js:314-340` (renderStudioIndex + polling), `389-456` (diálogo criar/editar/excluir); `static/style.css:514-536` (linhas, `pulse`), `537-564` (diálogo) + mobile (a linha vira faixa com o mosaico no celular).

**Contrato:**
- `EventRows`: `useEvents({ pollWhilePending: true })`; cada linha é `<Link to="/estudio/$eventId">` com miniatura (desktop) / faixa com `GalleryCover` (celular), nome, fatos sem contagem, "N foto(s)", "N rosto(s)", status (`Indexando N foto(s)` busy / `Na galeria` live / `Sem fotos`), chevron. Vazio: texto + botão "Criar o primeiro evento".
- Cabeçalho: "Estúdio", texto, `Novo evento`.
- `EventDialog({ event?, open, onOpenChange })`: campos Nome (obrigatório, `maxlength=120`, placeholder "Ex.: Corrida de Rua 2026"), Data (`type="date"`), Local (opcional, 120); título "Novo evento"/"Editar evento"; botão "Criar evento"/"Salvar"; erro do servidor no próprio diálogo (`role="alert"`); ao criar → toast "Evento criado" e navegar para `/estudio/<id>`; ao salvar → toast "Evento salvo". Editar mostra `Excluir evento` (text danger), que troca para a confirmação: título "Excluir evento?", texto `As N fotos de “<nome>” e os rostos encontrados nelas serão apagados deste servidor, e o link da galeria deixa de funcionar. Isso não pode ser desfeito.` (ou `“<nome>” será apagado. Isso não pode ser desfeito.` sem fotos), botão "Excluir evento" (danger), "Cancelar" volta aos campos. Excluir → toast "Evento excluído", `setLastEvent(null)`, navegar para `/estudio`. Botão de envio desabilitado durante a mutação. Usa `useSaveEvent`/`useDeleteEvent`.
- Título: `Estúdio, Foco`.

- [ ] **Step 1: Testes — `frontend/tests/features/studio-index.test.tsx`**

```tsx
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { expect, test } from "vitest";
import { server } from "../msw";
import { renderRoute } from "../render";

const ev = (over: object) => ({ id: 1, name: "Corrida", location: null, event_date: null, created_at: "2026-09-29T12:00:00+00:00",
  n_photos: 0, n_done: 0, n_pending: 0, n_faces: 0, cover: [], ...over });

function base(list: unknown[]) {
  server.use(
    http.get("*/api/features", () => HttpResponse.json({})),
    http.get("*/api/events", () => HttpResponse.json(list)),
  );
}

test("status de cada evento", async () => {
  base([ev({ id: 1, n_pending: 2, n_photos: 2 }), ev({ id: 2, name: "Show", n_done: 3, n_photos: 3 }), ev({ id: 3, name: "Nada" })]);
  await renderRoute("/estudio");
  expect(await screen.findByText("Indexando 2 fotos")).toBeInTheDocument();
  expect(screen.getByText("Na galeria")).toBeInTheDocument();
  expect(screen.getByText("Sem fotos")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Show/ })).toHaveAttribute("href", "/estudio/2");
});

test("criar evento navega para o estúdio do evento", async () => {
  base([]);
  server.use(http.post("*/api/events", async ({ request }) => {
    const body = (await request.json()) as { name: string };
    return HttpResponse.json({ id: 9, name: body.name, event_date: null, location: null });
  }));
  const { router } = await renderRoute("/estudio");
  await userEvent.click(await screen.findByRole("button", { name: "Criar o primeiro evento" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("Nome"), "Festa");
  await userEvent.click(within(dialog).getByRole("button", { name: "Criar evento" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/estudio/9"));
});

test("erro do servidor aparece no diálogo", async () => {
  base([]);
  server.use(http.post("*/api/events", () => HttpResponse.json({ detail: "Dê um nome ao evento." }, { status: 400 })));
  await renderRoute("/estudio");
  await userEvent.click(await screen.findByRole("button", { name: "Novo evento" }));
  await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Criar evento" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Dê um nome ao evento.");
});
```

- [ ] **Steps 2–6** (paridade `estudio`, e abrir o diálogo à mão). Commit `ref(ui): Port the studio event list and event dialog`.

---

### Task 16: Fila de upload (provider)

**Files:**
- Modify: `frontend/src/features/studio/UploadQueueProvider.tsx` (substitui o stub)
- Create: `frontend/tests/features/upload-queue.test.tsx`

- [ ] **Step 1: Testes — `frontend/tests/features/upload-queue.test.tsx`**

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { expect, test, vi } from "vitest";
import type { UploadResult } from "@/api/types";
import { type EventSourceLike, UploadQueueProvider, useUploadQueue } from "@/features/studio/UploadQueueProvider";
import { newQueryClient } from "../render";

type Pending = { file: File; resolve: (r: UploadResult) => void; progress: (s: number) => void };

function setup() {
  const pending: Pending[] = [];
  const upload = vi.fn((_: number, file: File, progress: (s: number) => void) =>
    new Promise<UploadResult>((resolve) => pending.push({ file, resolve, progress })));
  const streams: Array<EventSourceLike & { url: string; emit: (d: unknown) => void; closed: boolean }> = [];
  const openProgress = (url: string) => {
    const es = { url, closed: false, onmessage: null as ((m: { data: string }) => void) | null, onerror: null,
      close() { this.closed = true; }, emit(d: unknown) { this.onmessage?.({ data: JSON.stringify(d) }); } };
    streams.push(es);
    return es;
  };
  const qc = newQueryClient();
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <UploadQueueProvider upload={upload} openProgress={openProgress} sseDelayMs={0}>{children}</UploadQueueProvider>
    </QueryClientProvider>
  );
  return { pending, upload, streams, invalidate, ...renderHook(() => useUploadQueue(), { wrapper }) };
}

const files = (n: number) => Array.from({ length: n }, (_, i) => new File(["x"], `f${i}.jpg`, { type: "image/jpeg" }));
const phases = (r: { current: ReturnType<typeof useUploadQueue> }) => r.current.batch?.items.map((it) => it.phase);

test("no máximo 3 envios ao mesmo tempo", async () => {
  const { result, pending } = setup();
  act(() => result.current.addFiles(4, files(5)));
  await waitFor(() => expect(pending).toHaveLength(3));
  expect(phases(result)).toEqual(["uploading", "uploading", "uploading", "waiting", "waiting"]);
  act(() => pending[0]?.resolve({ id: 1, status: "queued", filename: "f0.jpg", n_faces: 0, duplicate: false }));
  await waitFor(() => expect(pending).toHaveLength(4));
});

test("progresso de envio e fases pelo SSE", async () => {
  const { result, pending, streams } = setup();
  act(() => result.current.addFiles(4, files(1)));
  await waitFor(() => expect(pending).toHaveLength(1));
  act(() => pending[0]?.progress(0.5));
  expect(result.current.batch?.items[0]?.sent).toBe(0.5);
  act(() => pending[0]?.resolve({ id: 7, status: "queued", filename: "f0.jpg", n_faces: 0, duplicate: false }));
  await waitFor(() => expect(streams).toHaveLength(1));
  expect(streams[0]?.url).toBe("/api/events/4/progress?ids=7");
  act(() => streams[0]?.emit({ items: [{ id: 7, status: "processing" }], done: false, queue: 1 }));
  expect(phases(result)).toEqual(["processing"]);
  act(() => streams[0]?.emit({ items: [{ id: 7, status: "done", n_faces: 3, proc_ms: 900 }], done: true, queue: 0 }));
  expect(result.current.batch?.items[0]).toMatchObject({ phase: "done", n_faces: 3, proc_ms: 900 });
  expect(streams[0]?.closed).toBe(true);
});

test("duplicata e arquivo inválido", async () => {
  const { result, pending } = setup();
  act(() => result.current.addFiles(4, files(2)));
  await waitFor(() => expect(pending).toHaveLength(2));
  act(() => {
    pending[0]?.resolve({ id: 1, status: "done", filename: "f0.jpg", n_faces: 2, duplicate: true });
    pending[1]?.resolve({ status: "error", filename: "f1.jpg", error: "arquivo não é uma imagem válida" });
  });
  await waitFor(() => expect(phases(result)).toEqual(["dup", "error"]));
  expect(result.current.batch?.items[1]?.error).toBe("arquivo não é uma imagem válida");
});

test("lote terminado + novas fotos começa um resumo novo; outro evento também", async () => {
  const { result, pending } = setup();
  act(() => result.current.addFiles(4, files(1)));
  await waitFor(() => expect(pending).toHaveLength(1));
  act(() => pending[0]?.resolve({ id: 1, status: "done", filename: "f0.jpg", n_faces: 0, duplicate: true }));
  await waitFor(() => expect(phases(result)).toEqual(["dup"]));
  act(() => result.current.addFiles(4, files(1)));
  expect(result.current.batch?.items).toHaveLength(1);
  act(() => result.current.addFiles(5, files(1)));
  expect(result.current.batch?.eventId).toBe(5);
});

test("fechar o resumo no meio ignora respostas atrasadas", async () => {
  const { result, pending } = setup();
  act(() => result.current.addFiles(4, files(1)));
  await waitFor(() => expect(pending).toHaveLength(1));
  act(() => result.current.reset());
  act(() => pending[0]?.resolve({ id: 1, status: "queued", filename: "f0.jpg", n_faces: 0, duplicate: false }));
  expect(result.current.batch).toBeNull();
});

test("fim do lote invalida fotos, stats e eventos", async () => {
  const { result, pending, invalidate } = setup();
  act(() => result.current.addFiles(4, files(1)));
  await waitFor(() => expect(pending).toHaveLength(1));
  act(() => pending[0]?.resolve({ id: 1, status: "done", filename: "f0.jpg", n_faces: 1, duplicate: true }));
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["events", 4, "photos"] }));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["stats", 4] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["events"] });
});
```

- [ ] **Step 2: Ver falhar.**

- [ ] **Step 3: `frontend/src/features/studio/UploadQueueProvider.tsx`**

```tsx
/** Fila de upload do Estúdio. Fica no __root para o resumo sobreviver à
 *  navegação (sair do evento e voltar mostra o mesmo lote).
 *  Cada foto: aguardando -> enviando -> na fila -> detectando -> pronta. */
import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { progressUrl } from "@/api/client";
import { invalidateEvent } from "@/api/queries";
import type { ProgressOut, UploadResult } from "@/api/types";
import { type UploadFn, xhrUpload } from "@/api/upload";

export type Phase = "waiting" | "uploading" | "queued" | "processing" | "done" | "dup" | "error";
export interface UploadItem {
  key: string;
  file: File;
  phase: Phase;
  sent: number;
  n_faces: number;
  proc_ms: number | null;
  id: number | null;
  error: string | null;
}
export interface Batch {
  eventId: number;
  items: UploadItem[];
}
export interface EventSourceLike {
  onmessage: ((m: { data: string }) => void) | null;
  onerror: (() => void) | null;
  close(): void;
}

const FINAL = new Set<Phase>(["done", "dup", "error"]);
export const isFinal = (it: UploadItem) => FINAL.has(it.phase);
// quanto cada fase vale na barra geral (envio = primeira metade, indexação = segunda)
const PHASE_PROGRESS: Record<Phase, number> = { waiting: 0, uploading: 0, queued: 0.5, processing: 0.75, done: 1, dup: 1, error: 1 };
export const itemProgress = (it: UploadItem) => (it.phase === "uploading" ? it.sent * 0.5 : PHASE_PROGRESS[it.phase]);
const MAX_PARALLEL = 3; // rápido, sem abrir 200 conexões de uma vez

type Action =
  | { type: "add"; eventId: number; items: UploadItem[] }
  | { type: "patch"; key: string; patch: Partial<UploadItem> }
  | { type: "patchById"; id: number; patch: Partial<UploadItem> }
  | { type: "reset" };

function reducer(batch: Batch | null, a: Action): Batch | null {
  switch (a.type) {
    case "add":
      return batch && batch.eventId === a.eventId
        ? { ...batch, items: [...batch.items, ...a.items] }
        : { eventId: a.eventId, items: a.items };
    case "patch":
      return batch && { ...batch, items: batch.items.map((it) => (it.key === a.key ? { ...it, ...a.patch } : it)) };
    case "patchById":
      return (
        batch && {
          ...batch,
          items: batch.items.map((it) => (it.id === a.id && !isFinal(it) ? { ...it, ...a.patch } : it)),
        }
      );
    case "reset":
      return null;
  }
}

function resultPatch(r: UploadResult): Partial<UploadItem> {
  if (r.duplicate) return { phase: r.status === "done" ? "dup" : "queued", n_faces: r.n_faces ?? 0, id: r.id ?? null };
  if (r.status === "error") return { phase: "error", error: r.error ?? "Erro" };
  return {
    phase: r.status === "done" ? "done" : (r.status as Phase),
    id: r.id ?? null,
    n_faces: r.n_faces ?? 0,
    proc_ms: r.proc_ms ?? null,
  };
}

interface UploadQueue {
  batch: Batch | null;
  addFiles: (eventId: number, files: File[]) => void;
  reset: () => void;
}

const Ctx = createContext<UploadQueue | null>(null);
let seq = 0;

export function UploadQueueProvider({
  children,
  upload = xhrUpload,
  openProgress = (url) => new EventSource(url) as unknown as EventSourceLike,
  sseDelayMs = 300,
}: {
  children: ReactNode;
  upload?: UploadFn;
  openProgress?: (url: string) => EventSourceLike;
  sseDelayMs?: number;
}) {
  const qc = useQueryClient();
  const [batch, dispatch] = useReducer(reducer, null);
  const batchRef = useRef(batch);
  batchRef.current = batch;
  const queue = useRef<UploadItem[]>([]);
  const running = useRef(0);
  const session = useRef(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // fotos, stats e lista mudam a cada foto pronta: agrupa as atualizações
  const refreshSoon = useCallback(
    (eventId: number) => {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => invalidateEvent(qc, eventId), 800);
    },
    [qc],
  );

  const pump = useCallback(() => {
    while (running.current < MAX_PARALLEL && queue.current.length) {
      const it = queue.current.shift() as UploadItem;
      const sess = session.current;
      const eventId = batchRef.current?.eventId as number;
      running.current += 1;
      dispatch({ type: "patch", key: it.key, patch: { phase: "uploading", sent: 0 } });
      upload(eventId, it.file, (sent) => {
        if (sess === session.current) dispatch({ type: "patch", key: it.key, patch: { sent } });
      })
        .then((r) => {
          if (sess !== session.current) return; // resumo fechado no meio do envio
          dispatch({ type: "patch", key: it.key, patch: resultPatch(r) });
          refreshSoon(eventId);
        })
        .finally(() => {
          running.current -= 1;
          pump();
        });
    }
  }, [upload, refreshSoon]);

  const reset = useCallback(() => {
    session.current += 1;
    queue.current = [];
    dispatch({ type: "reset" });
  }, []);

  const addFiles = useCallback(
    (eventId: number, files: File[]) => {
      if (!files.length) return;
      const cur = batchRef.current;
      // sessão anterior terminada (ou de outro evento): começa um resumo novo
      if (cur && (cur.items.every(isFinal) || cur.eventId !== eventId)) {
        session.current += 1;
        queue.current = [];
        batchRef.current = null;
        dispatch({ type: "reset" });
      }
      const items = files.map<UploadItem>((file) => ({
        key: `u${++seq}`, file, phase: "waiting", sent: 0, n_faces: 0, proc_ms: null, id: null, error: null,
      }));
      batchRef.current = { eventId, items: [...(batchRef.current?.items ?? []), ...items] };
      dispatch({ type: "add", eventId, items });
      queue.current.push(...items);
      pump();
    },
    [pump],
  );

  // SSE com as fotos ainda pendentes; reabre quando fotos novas ganham id
  const watchKey = batch ? `${batch.eventId}:${batch.items.filter((it) => it.id != null).map((it) => it.id).join(",")}` : "";
  useEffect(() => {
    const cur = batchRef.current;
    if (!cur || !watchKey) return;
    let es: EventSourceLike | null = null;
    const timer = setTimeout(() => {
      const ids = cur.items.filter((it) => it.id != null && !isFinal(it)).map((it) => it.id as number);
      if (!ids.length) return;
      es = openProgress(progressUrl(cur.eventId, ids));
      es.onmessage = (msg) => {
        const data = JSON.parse(msg.data) as ProgressOut;
        for (const p of data.items) {
          dispatch({
            type: "patchById",
            id: p.id,
            patch: p.status === "error"
              ? { phase: "error", error: p.error || "Erro ao processar" }
              : { phase: p.status as Phase, n_faces: p.n_faces, proc_ms: p.proc_ms ?? null },
          });
        }
        refreshSoon(cur.eventId);
        if (data.done) es?.close(); // sem close o EventSource reconecta sozinho
      };
      es.onerror = () => es?.close();
    }, sseDelayMs);
    return () => {
      clearTimeout(timer);
      es?.close();
    };
  }, [watchKey, openProgress, sseDelayMs, refreshSoon]);

  // lote terminou: atualiza tudo na hora (sem esperar o agrupamento)
  const finished = !!batch && batch.items.length > 0 && batch.items.every(isFinal);
  useEffect(() => {
    if (finished && batchRef.current) {
      clearTimeout(refreshTimer.current);
      invalidateEvent(qc, batchRef.current.eventId);
    }
  }, [finished, qc]);

  const value = useMemo(() => ({ batch, addFiles, reset }), [batch, addFiles, reset]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUploadQueue(): UploadQueue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useUploadQueue fora do UploadQueueProvider");
  return ctx;
}
```

(O teste "fim do lote invalida..." espera chamadas `invalidateQueries({ queryKey: [...] })` — é o que `invalidateEvent` faz. Se o teste de concorrência pedir o `batchRef` atualizado antes do `pump`, é por isso que `addFiles` já o atualiza à mão.)

- [ ] **Step 4: Rodar** `make web-test && make web-lint`. **Commit** `ref(ui): Add the upload queue provider`.

---

### Task 17: Estúdio — página do evento

**Files:**
- Modify: `frontend/src/routes/estudio.$eventId.tsx`
- Create: `frontend/src/features/studio/{StudioHead,Figures,Dropzone,UploadBatch,ContactSheet}.tsx`, `frontend/tests/features/studio-event.test.tsx`

**Origem:** `static/index.html:211-275`; `static/app.js:342-387` (renderStudioEvent, copiar link, stats, folha), `490-501` (dropzone), `556-611` (paintItem/paintSummary/lista/fechar), `694-706` (sessionFinished); `static/style.css:303-393` (cabeçalho, figuras, dropzone com `touch:` trocando os textos, resumo, `crawl`, folha) + mobile.

**Contrato:**
- `useEvent(eventId)`; 404 → `NotFoundEvent` área estúdio. Título `<evento>, Estúdio, Foco`. `setLastEvent(eventId)`.
- Migalhas "Eventos › <nome>" (`aria-current="page"`).
- Cabeçalho: nome, fatos sem contagem ou "Criado em <fmtDate(created_at)>" se não houver data nem local; ações `Copiar link` (copia `${origin}/galeria/<id>` com toast "Link da galeria copiado"; se o clipboard falhar, `prompt("Copie o link da galeria:", url)`), `Ver galeria` (`<Link to="/galeria/$eventId">`), `Editar` (abre o `EventDialog` da Task 15; excluir leva para `/estudio`).
- `Figures`: `useStats(eventId)` — Fotos (`done`), Rostos, "Tempo por foto"/"Por foto" (`fmtMs(avg)` ou "–"), Na fila.
- `Dropzone`: arrastar/soltar (filtra `image/*`, classe `over`), Enter/Espaço abre o seletor, input `multiple`; textos de mouse × toque como no original; chama `addFiles(eventId, files)`.
- `UploadBatch`: só se `batch?.eventId === eventId`; rótulo (`Enviando`/`Indexando`/`Pronto`/`Pronto, N foto(s) com erro`) com a classe de status, "X de N fotos", extra (`N rostos encontrados`, ETA `fmtEta(restantes × média)`), barra geral (média de `itemProgress`, classe `done`), contagem por fase (pronta/detectando/na fila/enviando/já enviada/com erro), `Ver fotos`/`Ocultar fotos` (lista recolhível de altura fixa com barra por linha só no que está acontecendo), `Fechar resumo do envio` (só quando tudo terminou → `reset()`). Ao terminar com erros: a lista abre com as fotos com erro no topo. Textos por linha como `paintItem` (`529-547`).
- `ContactSheet`: `usePhotos(eventId)`; `done` → miniatura com `object-position` e contagem de rostos (ícone `face`); senão "Erro"/"Detectando"/"Na fila". Vazio: `As fotos enviadas aparecem aqui, com o número de rostos encontrados em cada uma.`

- [ ] **Step 1: Testes — `frontend/tests/features/studio-event.test.tsx`**

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { expect, test, vi } from "vitest";
import { server } from "../msw";
import { renderRoute } from "../render";

const ev = { id: 4, name: "Corrida", location: null, event_date: null, created_at: "2026-09-29T12:00:00+00:00",
  n_photos: 2, n_done: 1, n_pending: 1, n_faces: 3, cover: [] };

function api() {
  server.use(
    http.get("*/api/features", () => HttpResponse.json({})),
    http.get("*/api/events/:id", () => HttpResponse.json(ev)),
    http.get("*/api/stats", () => HttpResponse.json({ events: 1, photos: 2, done: 1, pending: 1, errors: 0, faces: 3, avg_ms_per_photo: 3624.5 })),
    http.get("*/api/events/:id/photos", () =>
      HttpResponse.json([
        { id: 2, filename: "b.jpg", status: "processing", n_faces: 0, proc_ms: null, error: null, width: 10, height: 10, fx: 0.5, fy: 0.3 },
        { id: 1, filename: "a.jpg", status: "done", n_faces: 3, proc_ms: 900, error: null, width: 10, height: 10, fx: 0.5, fy: 0.3 },
      ]),
    ),
  );
}

test("cabeçalho, figuras e folha de contato", async () => {
  api();
  await renderRoute("/estudio/4");
  expect(await screen.findByRole("heading", { level: 1, name: "Corrida" })).toBeInTheDocument();
  expect(screen.getByText("Criado em 29 de setembro de 2026")).toBeInTheDocument();
  expect(await screen.findByText("3,6 s")).toBeInTheDocument();
  expect(screen.getByText("Detectando")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Ver galeria/ })).toHaveAttribute("href", "/galeria/4");
  expect(document.title).toBe("Corrida, Estúdio, Foco");
});

test("copiar link da galeria", async () => {
  api();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  await renderRoute("/estudio/4");
  await userEvent.click(await screen.findByRole("button", { name: /Copiar link/ }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${location.origin}/galeria/4`));
});
```

(O `UploadBatch` é coberto pelo provider na Task 16; confira o visual na paridade subindo fotos de verdade.)

- [ ] **Steps 2–6** (paridade `estudio-evento`; suba 3–4 fotos em cada app e compare o resumo do envio durante e depois). Commit `ref(ui): Port the studio event page with uploads`.

---

### Task 18: Calibração e Backoffice

**Files:**
- Modify: `frontend/src/routes/calibracao.tsx`, `frontend/src/routes/backoffice.tsx`
- Create: `frontend/src/features/lab/{EventPicker,Ruler,Timings,TopList}.tsx`, `frontend/src/features/admin/{Backoffice,LoginForm,FeatureSwitches}.tsx`, `frontend/tests/features/lab.test.tsx`, `frontend/tests/features/admin.test.tsx`

**Calibração — origem:** `static/index.html:277-349`; `static/app.js:458-488` (seletor), `1013-1097` (STAGES, régua, tempos, top 30, moveCutLine), `174-188` (evento inicial); `static/style.css:394-442` (calibração) + `565-583` (seletor) + mobile.

**Contrato da Calibração:**
- Guarda da flag (Task 9) + efeito: se `useFeatures().data?.calibration` virar `false` com a página aberta (a "cura" da busca), navegar para `/` com `replace`.
- Evento: `?e` ou, sem ele, o último aberto (`getLastEvent()`) se tiver fotos prontas, senão o primeiro com `n_done > 0` de `useEvents()`; ao escolher sem `?e`, `navigate({ search: { e: id }, replace: true })`. `setEvent(id)` no `SelfieSearchProvider`.
- `EventPicker` (`Select`): rótulo "Evento", valor = nome ou "Nenhum evento com fotos", itens = eventos com fotos (nome + "N fotos"); escolher navega para `?e=<id>`.
- `Testar selfie`/`Selfie` (input file) → `submitSelfie`; corte (`Slider` compartilhando o `threshold`, com `output` de 2 casas).
- Sem `result.debug_top`: estado vazio (`ContactStrip` + "Faça uma busca na Galeria ou envie uma selfie aqui para ver onde fica a fronteira.").
- `Ruler`: 11 marcas (`rulerX(i/10)`), faixa "aceito" e linha de corte ("corte 0.40") que se movem na hora com o slider (antes da resposta), pontos com `faceCropStyle` (thumb) nas linhas de `rulerRows`, classe `above` pelo corte atual, `dot` de 26/32 px conforme a largura (medida com `ResizeObserver`), altura `38 + linhas × (dot + 4) + 12`; eixo "0 sem relação / 0.5 / 1 idêntico". Clique abre o visualizador com `?rosto=<face_id>` (Task 14).
- `Timings`: barra proporcional e legenda com as etapas presentes de `STAGES` (`1017-1023`, mesmas cores e rótulos), "Total", e a nota do token quando `timings_from_cache`.
- `TopList`: 30 itens com recorte do rosto, score de 3 casas, "Nº, foto <id>", `above` pelo corte; clique abre o visualizador.
- Título `Calibração, Foco`.

**Backoffice — origem:** `static/index.html:351-374`; `static/app.js:1099-1199`; `static/style.css:584-613`.

**Contrato do Backoffice:**
- Estados: carregando (nada visível, como hoje), `off` ("Backoffice desativado: defina `ADMIN_PASSWORD` no servidor e reinicie."), `fail` ("Não foi possível falar com o servidor. Tente de novo."), `login`, `panel`.
- `LoginForm`: "Senha de admin" (`type=password`, `autocomplete=current-password`), `Entrar` (desabilitado enviando), erro em `role="alert"` com o `detail` ("Senha incorreta.") ou "Backoffice desativado." (404); em erro, foco e seleção voltam para a senha; sucesso limpa o campo.
- `FeatureSwitches`: um item por flag (nome como `<label>`, descrição, `Switch` com `aria-describedby`), toggle otimista que volta se a API recusar (erro no item), 401 → volta ao login com "Sessão expirada. Entre de novo.", toast `<label>: ligada|desligada`, e a nav (Calibração) reage na hora (via `useSetFeature`). Guarda de ocupado sem `disabled` (o Chrome largaria o foco).
- `Sair` (text button com X) → `useLogout` e volta ao login.
- Título `Backoffice, Foco`.

- [ ] **Step 1: Testes — `frontend/tests/features/lab.test.tsx`**

```tsx
import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { expect, test } from "vitest";
import { server } from "../msw";
import { renderRoute } from "../render";

const events = [
  { id: 2, name: "Sem fotos", location: null, event_date: null, created_at: "2026-09-29T12:00:00+00:00", n_photos: 0, n_done: 0, n_pending: 0, n_faces: 0, cover: [] },
  { id: 3, name: "Corrida", location: null, event_date: null, created_at: "2026-09-29T12:00:00+00:00", n_photos: 1, n_done: 1, n_pending: 0, n_faces: 2, cover: [] },
];

test("sem ?e escolhe o primeiro evento com fotos", async () => {
  server.use(
    http.get("*/api/features", () => HttpResponse.json({ calibration: true })),
    http.get("*/api/events", () => HttpResponse.json(events)),
  );
  const { router } = await renderRoute("/calibracao");
  await waitFor(() => expect(router.state.location.search).toEqual({ e: 3 }));
  expect(await screen.findByText("Faça uma busca na Galeria ou envie uma selfie aqui para ver onde fica a fronteira.")).toBeInTheDocument();
});

test("com resultado: régua, tempos e top 30", async () => {
  server.use(
    http.get("*/api/features", () => HttpResponse.json({ calibration: true })),
    http.get("*/api/events", () => HttpResponse.json(events)),
  );
  const top = [
    { face_id: 1, photo_id: 7, score: 0.9, bbox: [0, 0, 5, 5], width: 10, height: 10, filename: "a.jpg", above: true },
    { face_id: 2, photo_id: 8, score: 0.2, bbox: [0, 0, 5, 5], width: 10, height: 10, filename: "b.jpg", above: false },
  ];
  await renderRoute("/calibracao?e=3", {
    search: { eventId: 3, status: "done", result: { query_token: "T", threshold: 0.4, total_photos: 1, indexed_faces: 2,
      matches: [], debug_top: top, timings_ms: { detection: 300, search: 2 }, timings_from_cache: false } },
  });
  expect(await screen.findByText("corte 0.40")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "score 0.900, a.jpg" })).toHaveClass("above");
  expect(screen.getByText("Detecção (SCRFD)")).toBeInTheDocument();
  expect(screen.getByText("302 ms")).toBeInTheDocument();
  expect(screen.getByText("1º, foto 7")).toBeInTheDocument();
});
```

`frontend/tests/features/admin.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { expect, test } from "vitest";
import { server } from "../msw";
import { renderRoute } from "../render";

const flag = { key: "calibration", label: "Calibração", description: "Top 30...", enabled: false };

test("backoffice desativado", async () => {
  server.use(
    http.get("*/api/features", () => HttpResponse.json({})),
    http.get("*/api/admin/session", () => HttpResponse.json({ enabled: false, logged_in: false })),
  );
  await renderRoute("/backoffice");
  expect(await screen.findByText(/Backoffice desativado: defina/)).toBeInTheDocument();
});

test("senha errada mostra o erro e mantém o login", async () => {
  server.use(
    http.get("*/api/features", () => HttpResponse.json({})),
    http.get("*/api/admin/session", () => HttpResponse.json({ enabled: true, logged_in: false })),
    http.post("*/api/admin/login", () => HttpResponse.json({ detail: "Senha incorreta." }, { status: 401 })),
  );
  await renderRoute("/backoffice");
  await userEvent.type(await screen.findByLabelText("Senha de admin"), "x");
  await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Senha incorreta.");
});

test("ligar a flag atualiza a nav; recusa volta o switch", async () => {
  let calls = 0;
  server.use(
    http.get("*/api/features", () => HttpResponse.json({ calibration: false })),
    http.get("*/api/admin/session", () => HttpResponse.json({ enabled: true, logged_in: true })),
    http.get("*/api/admin/features", () => HttpResponse.json([flag])),
    http.put("*/api/admin/features/calibration", () => {
      calls += 1;
      return calls === 1
        ? HttpResponse.json({ ...flag, enabled: true })
        : HttpResponse.json({ detail: "falhou" }, { status: 500 });
    }),
  );
  await renderRoute("/backoffice");
  const sw = await screen.findByRole("switch", { name: "Calibração" });
  await userEvent.click(sw);
  expect(await screen.findByRole("link", { name: "Calibração" })).toBeInTheDocument();
  await userEvent.click(sw);
  expect(await screen.findByText("falhou")).toBeInTheDocument();
  await waitFor(() => expect(sw).toBeChecked());
});

test("sessão expirada volta ao login", async () => {
  server.use(
    http.get("*/api/features", () => HttpResponse.json({})),
    http.get("*/api/admin/session", () => HttpResponse.json({ enabled: true, logged_in: true })),
    http.get("*/api/admin/features", () => HttpResponse.json([flag])),
    http.put("*/api/admin/features/calibration", () => HttpResponse.json({ detail: "Entre no backoffice." }, { status: 401 })),
  );
  await renderRoute("/backoffice");
  await userEvent.click(await screen.findByRole("switch", { name: "Calibração" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Sessão expirada. Entre de novo.");
});
```

- [ ] **Steps 2–6** (paridade `calibracao` e `backoffice`; ligue a Calibração pelo backoffice antes, com `ADMIN_PASSWORD` no `.env`). Commits separados: `ref(ui): Port the calibration view` e `ref(ui): Port the backoffice`.

---

### Task 19: Revisão geral de paridade

- [ ] **Step 1:** Com `make api`, `make worker` e `make web` rodando, um evento com 5+ fotos indexadas e a Calibração ligada: `PARITY_EVENT=<id> PARITY_SELFIE=<selfie> PW_CHROMIUM=... pnpm --dir frontend parity` (todas as telas).
- [ ] **Step 2:** Abrir `frontend/e2e/.parity/index.html`, comparar cada par em 375/768/1280 px. Listar no relatório cada diferença que **não** seja um dos 4 ajustes, com a tela e a largura.
- [ ] **Step 3:** Corrigir as diferenças (uma por vez, com o teste da tela passando), repetir o Step 1 até a lista zerar ou só sobrar diferença de renderização de fonte.
- [ ] **Step 4:** Conferir à mão o que screenshot não pega: animações (trava do foco, entrada da capa, pulso do status, `crawl` da barra), `prefers-reduced-motion` (`static/style.css:739-741`), foco por teclado em todas as telas (Tab/Enter/Esc, seletor da Calibração com setas), câmera (em `localhost`).
- [ ] **Step 5: Commit** `fix(ui): Close remaining parity gaps` (se houve correções).

---

### Task 20: E2E local (Playwright, modelo real)

**Files:**
- Create: `frontend/e2e/smoke.spec.ts`

- [ ] **Step 1: `frontend/e2e/smoke.spec.ts`**

```ts
/** Fluxo completo contra o backend real (make api + make worker + make web) e o modelo de verdade.
 *  SMOKE_PHOTO=<foto do evento> SMOKE_SELFIE=<selfie da mesma pessoa> ADMIN_PASSWORD=<do .env> PW_CHROMIUM=... pnpm --dir frontend e2e */
import { expect, test } from "@playwright/test";

const BASE = process.env.BASE ?? "http://127.0.0.1:5173";
const { SMOKE_PHOTO, SMOKE_SELFIE, ADMIN_PASSWORD } = process.env;

test("evento de ponta a ponta", async ({ page, request }) => {
  test.skip(!SMOKE_PHOTO || !SMOKE_SELFIE, "defina SMOKE_PHOTO e SMOKE_SELFIE");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // 1. criar evento pela UI
  await page.goto(`${BASE}/estudio`);
  await page.getByRole("button", { name: /Novo evento|Criar o primeiro evento/ }).first().click();
  const name = `Smoke ${Date.now()}`;
  await page.getByLabel("Nome").fill(name);
  await page.getByRole("button", { name: "Criar evento" }).click();
  await page.waitForURL(/\/estudio\/\d+$/);
  const eventId = Number(page.url().split("/").pop());

  // 2. upload + indexação
  await page.locator('input[type="file"][multiple]').setInputFiles(SMOKE_PHOTO as string);
  await expect(page.getByText(/^Pronto/)).toBeVisible({ timeout: 120_000 });

  // 3. selfie na galeria + slider via token
  await page.goto(`${BASE}/galeria/${eventId}`);
  await page.locator('input[type="file"]:not([multiple])').first().setInputFiles(SMOKE_SELFIE as string);
  await expect(page.getByText(/fotos? com você/)).toBeVisible({ timeout: 30_000 });
  const viaToken = page.waitForRequest((r) => r.url().endsWith("/api/search") && (r.postData() ?? "").includes("query_token"));
  await page.getByRole("slider").first().press("ArrowLeft");
  await viaToken;

  // 4. visualizador + voltar do navegador
  await page.getByRole("button", { name: /^Abrir / }).first().click();
  await expect(page).toHaveURL(/\?foto=\d+/);
  await page.goBack();
  await expect(page).not.toHaveURL(/foto=/);
  await expect(page.getByText(/fotos? com você/)).toBeVisible();

  // 5. zip
  const zip = await request.get(await page.getByRole("link", { name: /Baixar todas/ }).getAttribute("href") ?? "");
  expect(zip.status()).toBe(200);

  // 6. backoffice + calibração
  if (ADMIN_PASSWORD) {
    await page.goto(`${BASE}/backoffice`);
    const pw = page.getByLabel("Senha de admin");
    if (await pw.isVisible().catch(() => false)) {
      await pw.fill(ADMIN_PASSWORD);
      await page.getByRole("button", { name: "Entrar" }).click();
    }
    const sw = page.getByRole("switch", { name: "Calibração" });
    if (!(await sw.isChecked())) await sw.click();
    await page.goto(`${BASE}/calibracao?e=${eventId}`);
    await page.locator('input[type="file"]').first().setInputFiles(SMOKE_SELFIE as string);
    await expect(page.getByText(/^corte /)).toBeVisible({ timeout: 30_000 });
  }

  // 7. excluir o evento pelo diálogo
  await page.goto(`${BASE}/estudio/${eventId}`);
  await page.getByRole("button", { name: /Editar/ }).click();
  await page.getByRole("button", { name: /Excluir evento/ }).click();
  await page.getByRole("button", { name: "Excluir evento" }).last().click();
  await page.waitForURL(`${BASE}/estudio`);

  // 8. link antigo
  await page.goto(`${BASE}/#estudio`);
  await expect(page).toHaveURL(`${BASE}/estudio`);

  expect(errors).toEqual([]);
});
```

- [ ] **Step 2: Rodar** com as fotos que o usuário forneceu na verificação do backend (peça os caminhos se não estiverem à mão) → passa.
- [ ] **Step 3: Commit** `test(ui): Add local end-to-end smoke test`.

---

### Task 21: CI do frontend e checagem do contrato

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: No job `backend`, depois do `pytest`:**

```yaml
      - name: OpenAPI em dia com o frontend
        run: |
          uv run python scripts/export_openapi.py > /tmp/openapi.json
          diff -u ../frontend/src/api/openapi.json /tmp/openapi.json
```

- [ ] **Step 2: Job novo `frontend`:**

```yaml
  frontend:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: frontend/pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm build
      - name: Tipos da API em dia com o openapi.json
        run: pnpm gen:api && git diff --exit-code src/api/schema.d.ts
```

(O `pnpm/action-setup` lê a versão do `packageManager` do `package.json`; adicione `"packageManager": "pnpm@11.1.1"` lá.)

- [ ] **Step 3:** Validar o YAML (`python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`) e simular os passos localmente (`make gen-api && git diff --exit-code frontend/src/api`, `pnpm --dir frontend install --frozen-lockfile && make web-lint && make web-test && pnpm --dir frontend build`).
- [ ] **Step 4: Commit** `ci: Add frontend job and API contract checks`.

---

### Task 22: Troca — build no Docker, remover `static/`, README

**Files:**
- Modify: `Dockerfile`, `.dockerignore`, `README.md`, `backend/tests/test_health.py` (o `test_frontend_servido` usava `static/`)
- Delete: `static/`

- [ ] **Step 1: `Dockerfile` — estágio do front no topo**

```dockerfile
# ---- frontend: build do React ----
FROM node:22-slim AS web
RUN corepack enable
WORKDIR /web
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

# ---- app ----
FROM python:3.11-slim
```

e trocar `COPY static ./static` por `COPY --from=web /web/dist ./static`.

- [ ] **Step 2: `.dockerignore`** — acrescentar `frontend/node_modules/`, `frontend/dist/`, `frontend/e2e/.parity/`, `frontend/test-results/`.

- [ ] **Step 3: Testes do backend sem `static/`** — o `STATIC_DIR` padrão das `Settings` (`REPO_ROOT / "static"`) passa a ser `REPO_ROOT / "frontend" / "dist"` (em dev, `make web` serve o front; o backend só serve o `dist/` depois de `pnpm build`). Em `backend/tests/conftest.py`, `STATIC_DIR` aponta para um `tmp_path` com um `index.html` mínimo (o `test_spa.py` já cobre o SPA); ajuste `test_frontend_servido` para usar esse diretório.

- [ ] **Step 4: Remover o app antigo** — `git rm -r static`. Conferir que nada mais referencia `static/` (exceto a spec/plano, que são histórico): `grep -rn "static/" --include=*.py --include=*.ts --include=*.tsx --include=Dockerfile --include=Makefile --include=*.yml --include=*.md . | grep -v "^./docs/"`.

- [ ] **Step 5: README** — seção "Arquitetura" ganha a linha do `frontend/` (React + Vite + TS, `src/routes`, `src/features`, `src/api` com tipos gerados); "Desenvolvimento" ganha `make web` (terceiro terminal) e abre em http://127.0.0.1:5173; `make gen-api` depois de mudar a API; `make web-test`/`make web-lint`; os links antigos com `#` continuam funcionando. Na seção de deploy, nada muda além de o build demorar um pouco mais.

- [ ] **Step 6: Verificar o stack de produção local**

```bash
docker network create web 2>/dev/null || true
docker compose up -d --build --remove-orphans
docker compose ps -a
docker compose exec foco-api curl -fsS localhost:8000/api/health
docker compose exec foco-api curl -fsS -o /dev/null -w "%{http_code} %{content_type}\n" localhost:8000/galeria/1
docker compose exec foco-api sh -c 'curl -fsS -I localhost:8000/assets/$(ls /app/static/assets | head -1) | grep -i cache-control'
docker compose down
```

Expected: health `{"ok":true}`; `/galeria/1` → `200 text/html`; asset com `cache-control: public, max-age=31536000, immutable`. Depois, dev de novo: `make db` e `make test` passam.

- [ ] **Step 7: Rodar tudo** — `make test && make lint && make web-test && make web-lint && pnpm --dir frontend build`.

- [ ] **Step 8: Commit** `ref: Replace the vanilla frontend with the React app`.

---

## Critérios de pronto (da spec)

- As 6 telas e os 2 diálogos com paridade aprovada (Task 19), mais os 4 ajustes.
- Links antigos com `#` redirecionam (Task 9 + E2E).
- Nenhum `fetch` fora de `src/api/`; nenhum tipo de resposta escrito à mão (`grep -rn "fetch(" frontend/src --include=*.ts* | grep -v "src/api/"` vazio).
- `make web-test`, `make web-lint`, `make test`, `make lint` e o CI passam; schema em dia.
- E2E local passa.
- `docker compose up -d --build` serve o SPA pelo `foco-api`, com rotas diretas funcionando ao recarregar.
- `static/` removido; README atualizado.
