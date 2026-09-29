# Backoffice de funcionalidades (feature flags)

Data: 2026-09-29

## Objetivo

Um painel de backoffice, protegido por senha de admin, para ligar e desligar
funcionalidades do Foco sem redeploy. A primeira funcionalidade controlada é a
**Calibração** (aba `#calibracao`: top 30 rostos mais parecidos com a selfie,
incluindo os abaixo do corte, e os tempos de cada etapa).

## Decisões

| tema | decisão |
|---|---|
| Efeito de desligar | Esconder na UI **e** bloquear na API (`/api/search` deixa de devolver `debug_top` e `timings_ms`) |
| Acesso ao backoffice | Senha de admin no próprio app (`ADMIN_PASSWORD`), sessão por cookie assinado |
| Escopo das flags | Globais (valem para todos os eventos) |
| Padrão da calibração | Desligada, inclusive no deploy atual |
| Admin com flag desligada | Também não vê. Flag vale para todos, sem bypass |
| Armazenamento | Tabela `settings` no SQLite existente (`data/faces.db`) |

Fora do escopo: proteger o Estúdio com a sessão admin, flags por evento, vários
usuários admin.

## Backend

### Registro de funcionalidades: `features.py` (novo)

```python
FEATURES = {
    "calibration": {
        "label": "Calibração",
        "description": "Top 30 rostos + tempos, para ajustar o corte.",
        "default": False,
    },
}
```

- O código é a fonte da lista de flags existentes. Adicionar uma funcionalidade
  é adicionar uma entrada aqui, sem migração.
- O banco guarda só overrides, com chave `feature.<key>` e valor `"1"` ou `"0"`.
- Funções:
  - `is_enabled(key) -> bool`: override se existir, senão `default`. Chave
    desconhecida levanta `KeyError`.
  - `all_flags() -> dict[str, bool]`: estado efetivo de todas.
  - `describe() -> list[dict]`: `key`, `label`, `description`, `enabled`, para
    o backoffice.
  - `set_enabled(key, enabled)`: grava o override. Chave desconhecida levanta
    `KeyError`.

### Persistência: `store.py`

Nova tabela no `SCHEMA` (criada no startup por `CREATE TABLE IF NOT EXISTS`,
então instalações existentes migram sozinhas):

```sql
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

Helpers `get_setting(key) -> str | None` e `set_setting(key, value)` (upsert).

### Sessão admin: `admin_auth.py` (novo, só stdlib)

- `ADMIN_PASSWORD` lida do ambiente. Vazia ou ausente: backoffice desligado,
  todo `/api/admin/*` responde **404** e as flags ficam no padrão.
- Login: `hmac.compare_digest` entre a senha enviada e `ADMIN_PASSWORD`. Na
  falha, `await asyncio.sleep(1)` antes do 401, para frear força bruta.
- Token do cookie `foco_admin`: `"<expira_unix>.<hmac_sha256_hex>"`. O HMAC cobre
  `expira_unix` e usa uma chave derivada da senha
  (`sha256(b"foco-admin:" + senha)`), então trocar a senha invalida todas as
  sessões.
- Validade: 12 h.
- Atributos do cookie: `HttpOnly`, `SameSite=Strict`, `Path=/`. `Secure` quando
  a requisição chega por HTTPS (`X-Forwarded-Proto: https` do Caddy ou
  `request.url.scheme == "https"`).
- Funções puras e testáveis: `sign(expires, password)`,
  `verify(token, password, now) -> bool`.
- Dependência FastAPI `require_admin` para as rotas protegidas: 404 se o
  backoffice estiver desligado, 401 se o cookie faltar, for inválido ou tiver
  expirado.

### Endpoints (`api.py`)

| rota | acesso | resposta |
|---|---|---|
| `GET /api/features` | público | `{"calibration": false}` |
| `POST /api/admin/login` | público | corpo `{"password": "..."}`. 204 + cookie, ou 401 |
| `POST /api/admin/logout` | público | 204 e cookie apagado |
| `GET /api/admin/session` | público | `{"enabled": bool, "logged_in": bool}` (`enabled` = `ADMIN_PASSWORD` definida). Serve para a tela escolher entre login, painel ou aviso |
| `GET /api/admin/features` | `require_admin` | `describe()` |
| `PUT /api/admin/features/{key}` | `require_admin` | corpo `{"enabled": bool}`. 200 com o item atualizado, ou 404 se a chave não existir |

Corpo inválido: 422 (pydantic).

### Bloqueio em `/api/search`

Com `is_enabled("calibration")` falso, a resposta sai **sem** as chaves
`debug_top`, `timings_ms` e `timings_from_cache`. O cálculo do top 30
(`store.search(..., DEBUG_TOP_K)`) também é pulado. `matches` e o resto da
resposta não mudam, e a Galeria continua funcionando igual.

## Frontend

### Flags no boot (`static/app.js`)

- `state.features` começa como `{}` (tudo desligado) e é preenchido por
  `GET /api/features` junto com `loadEvents()`. Se a chamada falhar, fica tudo
  desligado.
- `route()`:
  - calibração desligada: o link `.nav a[data-nav=lab]` fica `hidden`. Quem
    abrir `#calibracao` é levado para `#galeria` com `history.replaceState`
    (sem entrada nova no histórico, sem loop no voltar).
  - calibração ligada: comportamento atual.
- Nova rota `backoffice` em `ROUTES`/`HASH_OF`/`SECTIONS`, sem link na nav.
- `renderDebug()`: resposta sem `debug_top` conta como "sem busca" (estado
  vazio), em vez de quebrar.
- `runSearch()`: se a resposta vier sem `debug_top` com a flag ligada no
  cliente (desligaram no backoffice com a página aberta), atualiza
  `state.features`, esconde a aba e, se estiver na Calibração, redireciona
  para a Galeria.

### Tela `#backoffice` (`static/index.html` + `static/style.css`)

`<section id="view-backoffice">`, com três estados escolhidos por
`GET /api/admin/session`:

1. **Desligado** (`enabled: false`): aviso "Backoffice desativado: defina
   ADMIN_PASSWORD no servidor."
2. **Login** (`logged_in: false`): campo de senha (`type=password`,
   `autocomplete=current-password`) e botão "Entrar". Em caso de erro, a
   mensagem aparece inline ("Senha incorreta"), o botão fica desabilitado
   durante o request e o Enter envia.
3. **Painel**: título "Backoffice", lista de funcionalidades (label, descrição e
   um switch `<input type=checkbox role=switch>` à direita) e botão "Sair".
   - O switch muda na hora e o `PUT` vai para a API. Se falhar, o switch volta e
     o erro aparece na linha. Se vier 401, volta para o login.
   - No sucesso, `state.features` é atualizado e `route()` roda de novo, então a
     aba Calibração aparece ou some sem recarregar a página.

Visual: reaproveita os tokens e padrões existentes (Anton no título, Albert Sans
no corpo, layout de lista do Estúdio). Funciona em 393px sem scroll horizontal.

## Deploy

- `docker-compose.yml`: `environment: ADMIN_PASSWORD: ${ADMIN_PASSWORD:-}`. O
  valor vem de um `.env` ao lado do compose na VPS.
- `.gitignore`: adicionar `.env` (hoje não está), para a senha nunca ir pro git.
- README: seção "Backoffice" explicando como definir a senha, onde acessar
  (`/#backoffice`) e que a calibração vem desligada.
- Efeito do deploy: a aba Calibração some da produção até ser ligada no
  backoffice.

## Testes

1. **pytest** (novo, dev only, `requirements-dev.txt` com pytest + httpx), sem
   carregar o modelo. Inclui testes dos endpoints com `TestClient` (sem
   lifespan) e do bloqueio em `/api/search` com um rosto e uma selfie
   sintéticos no cache:
   - `features.py` com `FACES_DATA_DIR` temporário: padrão, override
     ligado/desligado, chave desconhecida levanta `KeyError`.
   - `admin_auth.py`: token válido, assinatura adulterada, expirado, senha
     trocada, formato inválido.
2. **Smoke com curl** no servidor rodando:
   - `GET /api/features` → `calibration: false`;
   - `GET /api/admin/features` sem cookie → 401;
   - login errado → 401, login certo → `Set-Cookie`;
   - `PUT calibration true` → `/api/search` traz `debug_top`;
   - `PUT false` → `debug_top` some;
   - sem `ADMIN_PASSWORD` → `/api/admin/features` responde 404.
3. **Playwright**, desktop 1440 e mobile 393:
   - aba Calibração oculta por padrão;
   - `#calibracao` redireciona para `#galeria`;
   - login e ligar o switch fazem a aba aparecer sem reload;
   - desligar faz a aba sumir;
   - logout volta para a tela de login.
