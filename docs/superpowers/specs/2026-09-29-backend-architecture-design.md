# Arquitetura do backend: módulos, Postgres, pgvector e worker

Data: 2026-09-29

## Objetivo

Reestruturar o backend do Foco para ele crescer sem virar confusão. Os
próximos passos do produto são autenticação de usuários, mais funcionalidades
na galeria e um sistema de vendas. Este subprojeto não implementa nenhum
deles: prepara o terreno para que cada um entre como um módulo novo, sem
mexer no resto.

Este é o **subprojeto 1 de 2**. O subprojeto 2 troca o frontend vanilla
(`static/`) por React + Vite + TypeScript e tem spec própria.

## Problemas de hoje

- `api.py` (671 linhas) junta rotas, SQL, regra de negócio (foco da capa,
  zip, dedupe), worker de indexação e sessão do admin.
- SQL escrito à mão, espalhado entre `api.py` e `store.py`. Migração manual
  via `PRAGMA table_info`.
- Config lida de `os.environ` em vários pontos.
- Estado em memória no processo (fila `queue.Queue`, índices FAISS, cache de
  selfies `_queries`): o app só roda com um processo e o índice é
  reconstruído a cada boot.
- Código morto em `api.py:243-264` (segunda versão de `_focus_points` depois
  do `return`).
- Testes cobrem só o backoffice.

## Decisões

| tema | decisão |
|---|---|
| Ordem | Incremental: backend primeiro (este spec), React depois |
| Linguagem do backend | Python + FastAPI (InsightFace prende o backend em Python) |
| Organização | Pacote `foco` com módulos por domínio (router / service / models / schemas) |
| Banco | PostgreSQL 17 com pgvector |
| Acesso a dados | SQLAlchemy 2 **síncrono** + psycopg 3 |
| Migrações | Alembic (autogenerate) |
| Busca vetorial | pgvector, busca exata filtrada por evento (sai o FAISS) |
| Cache da selfie | Token assinado devolvido ao cliente, sem estado no servidor |
| Tarefas em background | Procrastinate (fila no próprio Postgres), processo `worker` separado |
| Worker x microserviço | Worker no mesmo código. `vision/` isolado para virar serviço se um dia precisar de GPU |
| Dados atuais | Descartados: começa do zero, sem script de migração |
| Ferramentas | uv, ruff, pytest, Makefile, GitHub Actions |

Fora do escopo: React, autenticação de usuários, vendas, armazenamento em S3,
LISTEN/NOTIFY no progresso.

## 1. Estrutura

```
backend/
  pyproject.toml            # uv: deps + lock, config do ruff e do pytest
  uv.lock
  alembic.ini
  migrations/               # env.py + versions/
  src/foco/
    main.py                 # create_app(): routers, /api/health, arquivos estáticos
    worker.py               # app Procrastinate
    core/
      config.py             # Settings (pydantic-settings)
      db.py                 # engine, SessionLocal, Base, dependência get_session
      storage.py            # Storage (Protocol) + LocalStorage
      signing.py            # HMAC com SECRET_KEY: sign/verify de payloads com expiração
    vision/
      detector.py           # wrapper InsightFace (o detector.py atual)
    modules/
      events/   models.py schemas.py service.py router.py
      photos/   models.py schemas.py service.py router.py tasks.py
      search/   service.py router.py token.py
      features/ models.py registry.py service.py router.py
      admin/    auth.py router.py
  tests/
static/                     # frontend vanilla atual, intocado exceto a busca (seção 4)
docker-compose.yml
docker-compose.dev.yml
Dockerfile
Makefile
.env.example
```

Os arquivos da raiz (`api.py`, `store.py`, `detector.py`, `features.py`,
`admin_auth.py`, `requirements*.txt`, `pytest.ini`) somem ao final.

### Regras das camadas

- **router:** só HTTP. Valida a entrada com schema pydantic, chama o service
  e devolve um schema. Não escreve SQL nem regra de negócio.
- **service:** regra de negócio. Recebe a `Session` por parâmetro e chama
  `session.commit()` explicitamente.
- **models:** modelos SQLAlchemy 2 (`Mapped[...]`, `mapped_column`).
- **schemas:** entrada e saída da API (pydantic v2).
- Um módulo usa outro só pelo `service` (ex.: `search.service` chama
  `events.service.get_or_404`). Nunca pelo router, nunca pelos models de
  outro módulo para escrever.
- Sem camada "repository" separada: o service usa a Session direto. Se uma
  consulta for reusada por vários services, ela vira função no service dono
  da tabela.

### Configuração: `core/config.py`

`Settings(BaseSettings)`, lida do ambiente e do `.env`, instanciada uma vez
(`get_settings()` com `lru_cache`, sobrescrita nos testes via dependência):

| campo | padrão | uso |
|---|---|---|
| `database_url` | obrigatório | `postgresql+psycopg://...` |
| `data_dir` | `./data` | raiz do `LocalStorage` |
| `secret_key` | obrigatório | assinatura do token da selfie e do cookie do admin |
| `admin_password` | `""` | vazio = backoffice desligado (comportamento atual) |
| `insightface_root` | `~/.insightface` | onde fica o `buffalo_l` |

Nenhum outro arquivo lê `os.environ`.

### Armazenamento: `core/storage.py`

```python
class Storage(Protocol):
    def save(self, key: str, data: bytes) -> None: ...
    def open(self, key: str) -> BinaryIO: ...
    def path(self, key: str) -> Path: ...     # para FileResponse no LocalStorage
    def exists(self, key: str) -> bool: ...
    def delete(self, key: str) -> None: ...   # não falha se não existir
```

- `LocalStorage(data_dir)` grava com troca atômica (arquivo `.tmp` +
  `replace`), como o `medium` faz hoje.
- Chaves são relativas: `photos/<event_id>/<sha256><ext>`,
  `thumbs/<sha256>.jpg`, `medium/<sha256>.jpg`.
- O banco guarda só a chave do original. Miniatura e versão média derivam do
  `sha256`.
- `path()` existe só porque o `LocalStorage` serve arquivo via
  `FileResponse`. Um storage S3 futuro trocaria por URL assinada. Essa troca
  fica fora deste escopo.

## 2. Dados

### Tabelas

```sql
CREATE EXTENSION IF NOT EXISTS vector;

events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL,
  event_date  date,
  location    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
)

photos (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id     bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  sha256       text NOT NULL,
  filename     text NOT NULL,
  storage_key  text NOT NULL,
  width        integer,
  height       integer,
  status       text NOT NULL CHECK (status IN ('queued','processing','done','error')),
  n_faces      integer NOT NULL DEFAULT 0,
  proc_ms      real,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, sha256)
)
-- índice: photos(event_id, status)

faces (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  photo_id   bigint NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  event_id   bigint NOT NULL,          -- desnormalizado para o filtro da busca
  x1 real, y1 real, x2 real, y2 real,  -- bbox em px da foto original
  det_score  real,
  embedding  vector(512) NOT NULL
)
-- índices: faces(event_id), faces(photo_id)

feature_flags (
  key         text PRIMARY KEY,
  enabled     boolean NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
)
```

- `GENERATED ALWAYS AS IDENTITY` nunca reusa um id excluído, então a tabela
  `meta` e o `next_event_id` somem. O motivo continua valendo: um link antigo
  de galeria não pode abrir o evento de outra pessoa.
- `event_date` vira `date`, e a validação de formato fica no schema pydantic.
- `updated_at` é atualizado pelo ORM (`onupdate=func.now()`).
- `feature_flags` substitui a tabela genérica `settings`. O padrão de cada
  flag continua no código (`features/registry.py`). A linha só existe quando
  o admin sobrescreve. Flag nova não precisa de migração, e uma chave que
  saiu do registro é ignorada.

### Busca vetorial

Embeddings normalizados (norma 1), então o operador `<#>` do pgvector (produto
interno negativo) vale `-cosseno`.

```sql
-- matches: todos os rostos acima do corte
SELECT id, photo_id, (embedding <#> :q) * -1 AS score
FROM faces
WHERE event_id = :e AND (embedding <#> :q) < -:threshold
ORDER BY embedding <#> :q;

-- calibração: top 30, com ou sem corte
... WHERE event_id = :e ORDER BY embedding <#> :q LIMIT 30;
```

- **Sem índice HNSW/IVF.** O btree em `faces(event_id)` restringe ao evento, e
  a comparação com cada rosto do evento é exata, como o `IndexFlatIP` de
  hoje. Índice aproximado com filtro por evento perde resultados, e só
  compensa com milhões de rostos por evento.
- `store.search`, `store.search_threshold`, `store.faces_by_ids` e toda a
  reconstrução no boot viram consultas no `search.service`, com o join em
  `photos` para trazer `filename/width/height` numa ida só.

### Migrações

- Alembic com `target_metadata = Base.metadata` e autogenerate.
- A primeira revisão cria a extensão `vector` e as quatro tabelas.
- O serviço `migrate` do compose roda `alembic upgrade head` antes de `api`
  e `worker` subirem. Em dev: `make migrate`.
- Toda mudança de schema vira uma revisão revisada à mão antes do commit.

### Sessão

- `db.py`: `engine = create_engine(settings.database_url, pool_pre_ping=True)`
  e `SessionLocal = sessionmaker(engine, expire_on_commit=False)`.
- `get_session()` é uma dependência FastAPI que abre a Session no request e
  fecha no fim (com rollback se nada foi commitado).
- Services fazem `commit()` explicitamente. As tarefas do worker abrem a
  própria Session com `with SessionLocal() as s:`.

## 3. Módulos

Contrato HTTP igual ao de hoje, exceto a busca (seção 4) e o `/api/health`
novo. Os caminhos continuam em `/api/...`.

| módulo | rotas | o que sai de onde |
|---|---|---|
| `events` | `POST/GET /api/events`, `PATCH/DELETE /api/events/{id}` | `_clean_event`, `_get_event`, listagem com capas. `_pick_cover` e `_focus_points` (versão com `det_score`, sem o código morto) vão para `photos.service`, e `events` chama |
| `photos` | `POST/GET /api/events/{id}/photos`, `GET /api/events/{id}/progress` (SSE), `GET /api/photos/{id}/thumb`, `/medium`, `/full`, `GET /api/zip`, `GET /api/stats` | upload, dedupe, miniatura, medium sob demanda, zip, stats |
| `search` | `POST /api/search` | seção 4 |
| `features` | `GET /api/features` | registro + overrides |
| `admin` | `/api/admin/login`, `logout`, `session`, `features`, `features/{key}` | o `admin_auth.py` atual |
| `main` | `GET /api/health` | `SELECT 1` no banco; 200 ou 503 |

### Admin: chave do cookie

Hoje o HMAC do cookie deriva só de `ADMIN_PASSWORD`. Passa a derivar dos dois
segredos: `key = HMAC(SECRET_KEY, "admin:" + sha256(ADMIN_PASSWORD))`.
Trocar qualquer um dos dois derruba as sessões, e o cookie não serve mais de
alvo para força bruta offline da senha. O resto (TTL de 12 h, `FAIL_DELAY`,
formato `<exp>.<hmac>`, cookie `httponly`/`samesite=strict`/`secure` atrás de
HTTPS) fica como está.

### Excluir evento

1. O service lista as chaves dos originais e os `sha256` das fotos do evento.
2. `DELETE FROM events WHERE id = :e` (o `CASCADE` apaga fotos e rostos) e
   commit.
3. `delete_event_files.defer(event_id, keys, shas)`. A tarefa apaga os
   originais e, para cada `sha256` que nenhuma outra foto usa mais, a
   miniatura e a versão média.

## 4. Busca sem estado no servidor

`POST /api/search` recebe `event_id`, `threshold` e **um** destes:
`selfie` (arquivo) ou `query_token` (texto). Nenhum dos dois → 400.

### Com selfie

1. Decodifica, detecta, escolhe o maior rosto (regra atual) e gera o
   embedding.
2. Monta o `query_token` com `search/token.py`:
   `base64url(expira_unix(8 bytes) || embedding float16 (1024 bytes))` +
   `"." + hmac_sha256(SECRET_KEY, "search:" + payload)`. Validade de 1 h.
   Uns 1,4 KB.
3. Responde como hoje, trocando `query_id` por `query_token`. `selfie`
   (bbox, `n_faces`, `all_bboxes`, `warning`, dimensões) e, com calibração,
   `timings_ms` completos.

### Com query_token

1. `token.verify` confere o HMAC em tempo constante e a expiração. Inválido
   ou expirado → **410** `"Busca expirada. Envie a selfie de novo."`.
2. Converte o embedding para float32 e roda só as consultas.
3. Responde sem `selfie`. Com calibração, `timings_ms` traz só `search` e
   `timings_from_cache: true`.

### Garantias

- O embedding da selfie não vai para o disco, para o banco nem fica na memória
  do servidor entre requests. Hoje ele ficava na memória.
- Qualquer réplica da API atende qualquer pedido.
- O float16 muda o score só na 4ª casa decimal. O corte mínimo é 0,15.
- O threshold continua limitado a `[0.15, 0.80]` no servidor.
- Calibração desligada: sem `debug_top` e sem `timings_ms`, e o top 30 nem é
  calculado (regra atual).

### Ajuste no `static/app.js`

- `state.queryId` → `state.queryToken`, e o campo enviado vira `query_token`.
- Guardar `r.selfie` e `r.timings_ms` da resposta com selfie em `state`. Nas
  respostas via token, reaproveitar `selfie` e juntar os tempos guardados com
  o `search` novo, para a Calibração exibir o mesmo de hoje.
- Resposta 410: reenviar a `selfieBlob` guardada (mesmo caminho que hoje
  trata o `query_id` esquecido).

## 5. Worker

- `worker.py` define `app = procrastinate.App(connector=PsycopgConnector(...))`
  com a mesma `DATABASE_URL`. As tabelas do Procrastinate entram por uma
  revisão Alembic, que aplica o schema SQL que a lib fornece. Atualizar a
  versão do Procrastinate exige uma revisão nova com as migrações dela.
- O processo roda `procrastinate --app=foco.worker.app worker --concurrency=1`.
  Indexar é CPU pura e o onnxruntime já usa várias threads.
- O modelo `buffalo_l` é carregado uma vez por processo, no primeiro uso, pelo
  `vision.detector.get_model()` (como hoje). API e worker carregam cada um o
  seu, ~300 MB de RAM cada.

### Tarefas

| tarefa | comportamento |
|---|---|
| `index_photo(photo_id)` | Marca `processing`, lê o original do `Storage`, detecta, apaga os rostos anteriores da foto, insere os novos, marca `done` com `n_faces` e `proc_ms`. Foto inexistente (evento excluído) → retorna sem erro. `retry=RetryStrategy(max_attempts=3, exponential_wait=5)`. Na última falha, marca `error` com a mensagem. `queueing_lock=f"photo:{photo_id}"` evita duplicata na fila |
| `delete_event_files(event_id, keys, shas)` | Seção 3 |
| `requeue_stuck` (periódica, a cada 5 min) | Fotos em `queued`/`processing` com `updated_at` há mais de 10 min voltam para a fila via `index_photo.defer` (`AlreadyEnqueued` do `queueing_lock` é capturado: a foto já está na fila). Cobre "commit feito, defer falhou" e o worker morto no meio da foto |

### Upload

1. A API faz o hash e deduplica por `(event_id, sha256)`.
2. Decodifica e gera a miniatura na hora (o Estúdio mostra na hora).
3. Salva o original e a miniatura no `Storage`.
4. Insere em `photos` com `status='queued'` e faz commit.
5. `index_photo.defer(photo_id=...)`.

### Progresso (SSE)

Igual a hoje: polling no banco a cada 0,4 s, enviando só quando muda.
O campo `queue` vira `COUNT(*)` de fotos em `queued`/`processing` (de todos
os eventos), no lugar do `jobs.qsize()`.

### Sai do código

A thread `worker_loop`, o `queue.Queue`, a reenfileiração e a reconstrução
de índices no `lifespan`. O `lifespan` da API passa a só pré-carregar o
modelo.

### Futuro (não implementar agora)

As tarefas de vendas entram no mesmo worker numa fila própria
(`queue="orders"`), para indexação em massa não atrasar e-mail de compra. Se
precisar de GPU, `vision/` vira um serviço HTTP de embeddings (imagem entra,
rostos saem) e só `vision/detector.py` muda.

## 6. Deploy e dev

### `docker-compose.yml` (VPS)

| serviço | imagem / comando | redes | depende de |
|---|---|---|---|
| `db` | `pgvector/pgvector:pg17`, dados em `./data/postgres`, healthcheck `pg_isready` | `backend` | nada |
| `migrate` | app, `alembic upgrade head`, `restart: "no"` | `backend` | `db` saudável |
| `api` | app, `uvicorn foco.main:app --host 0.0.0.0 --port 8000`, `container_name: face-tracking`, healthcheck em `/api/health` | `web`, `backend` | `migrate` concluído com sucesso |
| `worker` | app, comando do Procrastinate | `backend` | `migrate` concluído com sucesso |

- A rede `backend` é interna. `web` continua externa, e o Caddy alcança só a
  `api`. O `Caddyfile` não muda (o upstream continua `face-tracking:8000`).
- Nenhuma porta publicada no host (padrão atual da VPS).
- Os arquivos continuam em `./data` (bind mount em `/data` na `api` e no
  `worker`).
- Segredos no `.env` ao lado do compose: `POSTGRES_PASSWORD`, `SECRET_KEY`,
  `ADMIN_PASSWORD`. O `.env.example` fica versionado, sem valores.
- Logs com `json-file`, `max-size: 10m`, `max-file: 3` em todos os serviços.
- README documenta o backup: `docker compose exec db pg_dump -U foco foco >
  backup.sql` + o rsync de `data/`.

### Dockerfile

- Base `python:3.11-slim` com as mesmas libs de sistema de hoje.
- `uv sync --frozen --no-dev` a partir do `uv.lock`.
- `buffalo_l` baixado no build (como hoje).
- Copia `src/`, `migrations/`, `alembic.ini` e `static/`.
- Roda como usuário não-root.
- O estágio `node` para o React entra no subprojeto 2.

### Dev

- `docker-compose.dev.yml` sobe só o `db`, publicado em `127.0.0.1:5432`.
- `Makefile`:
  - `make db`: sobe o Postgres de dev
  - `make migrate`: `alembic upgrade head`
  - `make migration m="..."`: nova revisão autogerada
  - `make api`: `uv run uvicorn foco.main:app --reload`
  - `make worker`: worker do Procrastinate
  - `make test`: pytest
  - `make lint`: ruff check + ruff format --check

## 7. Testes

- **Postgres de verdade** (pgvector não tem equivalente em SQLite). `conftest`
  cria o banco `foco_test` uma vez por sessão com `alembic upgrade head`. Cada
  teste roda dentro de uma transação externa com SAVEPOINT, desfeita no fim.
  A Session do teste é injetada via `app.dependency_overrides[get_session]`.
- **Detector falso:** a dependência `get_detector` é sobrescrita por um fake
  que devolve rostos e embeddings determinísticos, derivados do conteúdo da
  imagem. Os testes não carregam o modelo. Um teste `@pytest.mark.slow` usa o
  modelo real e fica fora do `make test` padrão.
- **Procrastinate** com `InMemoryConnector`. Os testes executam as tarefas
  enfileiradas explicitamente.
- **Storage** em `tmp_path`.

Cobertura mínima:

- `features`, `admin` e assinatura do cookie: portar os testes atuais.
- `events`: criar, validar (nome vazio, data inválida), editar, listar com
  capa e foco, excluir (cascade + tarefa de arquivos + miniatura
  compartilhada preservada).
- `photos`: upload, dedupe, arquivo inválido, `index_photo` (sucesso,
  idempotência ao rodar 2x, foto excluída no meio, falha → `error`),
  `requeue_stuck`, zip, stats.
- `search`: corte, top 30 com calibração ligada e desligada, token válido,
  token adulterado → 410, token expirado → 410, sem selfie e sem token → 400,
  threshold fora do intervalo limitado.
- `health`: 200 com banco, 503 sem banco.
- **Smoke do frontend atual:** script Playwright contra o compose de dev:
  criar evento, subir foto, esperar indexar, buscar com selfie, mexer no
  slider. Garante que o `app.js` segue funcionando com o backend novo.

### CI

`.github/workflows/ci.yml`: a cada push e PR, service container
`pgvector/pgvector:pg17`, `uv sync`, `ruff check`, `ruff format --check`,
`pytest -m "not slow"`.

## Critérios de pronto

- `api.py`, `store.py`, `detector.py`, `features.py`, `admin_auth.py`,
  `requirements*.txt` e `pytest.ini` removidos da raiz.
- `docker compose up -d --build` na VPS sobe `db`, `migrate`, `api` e
  `worker`, e o app funciona pelo Caddy sem mudar o `Caddyfile`.
- Todas as funcionalidades atuais funcionam no `static/` atual: eventos,
  upload com progresso, galeria por selfie, slider, zip, calibração,
  backoffice.
- `make test` e o CI passam.
- Nenhum `os.environ` fora de `core/config.py`. Nenhum acesso ao banco fora
  dos services, das tasks, do `/api/health` e das migrações.
- README atualizado (instalação com uv, dev com Makefile, deploy, backup).
