# Frontend em React: Vite, TypeScript, Tailwind e shadcn/ui

Data: 2026-09-29

## Objetivo

Trocar o frontend vanilla (`static/index.html`, `style.css`, `app.js`, ~2.400
linhas em 3 arquivos) por um app React organizado por área, pronto para
receber login de usuário, mais funcionalidades na galeria e vendas sem virar
um arquivo gigante.

Este é o **subprojeto 2 de 2** da reestruturação. O subprojeto 1 (backend em
`backend/src/foco`, Postgres + pgvector + worker) já está no `main`
(PR #1). O deploy na VPS acontece só depois deste subprojeto.

## Decisões

| tema | decisão |
|---|---|
| Escopo | Paridade com o app atual (mesmas telas, fluxos e identidade visual Foco) + 4 ajustes pontuais (abaixo) |
| Framework | React 19 + Vite + TypeScript (strict) |
| Estilos | Tailwind v4, com os tokens do Foco no `@theme` |
| Componentes base | shadcn/ui (Radix), estilizados com os tokens do Foco; só os que forem usados |
| Roteamento | TanStack Router (file-based, parâmetros e search params tipados) |
| Dados do servidor | TanStack Query |
| Cliente da API | `openapi-fetch` + tipos gerados por `openapi-typescript` do OpenAPI do FastAPI |
| Pacotes / lint | pnpm, Biome |
| Testes | Vitest + Testing Library + MSW; E2E Playwright local com o modelo real |
| Migração | Lado a lado em `frontend/`; troca num commit final, que remove `static/` |

### Ajustes pontuais (além da paridade)

1. **URLs de verdade:** `/galeria/4`, `/estudio/4`, `/calibracao`, `/backoffice`
   no lugar de `#galeria?e=4`. Links antigos com `#` são redirecionados.
2. **`GET /api/events/{id}`:** abrir uma galeria busca só o evento dela, não a
   lista inteira com capas.
3. **Carregando e erro em todas as telas:** esqueleto enquanto carrega; erro
   com a mensagem do servidor e "Tentar de novo". Hoje uma falha de
   `/api/events` deixa a tela vazia sem aviso.
4. **"Voltar" fecha o visualizador de foto:** a foto aberta vai para a URL
   (`?foto=12`); o voltar do navegador fecha o visualizador em vez de sair da
   galeria e perder a busca.

Fora do escopo: login de usuário, vendas, telas novas, PWA/offline, i18n (o
app continua só em pt-BR), SSR.

## Telas atuais (referência de paridade)

| rota nova | hoje | conteúdo |
|---|---|---|
| `/` | `#galeria` sem evento | lista pública de galerias (só eventos com fotos prontas), busca sem acento a partir de 4 eventos |
| `/galeria/$eventId` | `#galeria?e=4` | capa em mosaico, visor da selfie (arquivo ou câmera), resultados com slider de precisão, grade, "Baixar todas", visualizador com zoom no rosto |
| `/estudio` | `#estudio` | lista de eventos com status (indexando / na galeria / sem fotos), criar evento |
| `/estudio/$eventId` | `#estudio?e=4` | cabeçalho com fatos, copiar link, ver galeria, editar/excluir, dropzone, resumo do envio, stats, folha de contato |
| `/calibracao` (`?e=4`) | `#calibracao` | só com a flag `calibration`: seletor de evento, selfie, régua dos 30 rostos com linha de corte, tempos por etapa |
| `/backoffice` | `#backoffice` | login do admin, switches das funcionalidades |

Diálogos: criar/editar/excluir evento (com confirmação em duas etapas) e o
visualizador de foto.

## 1. Estrutura

```
frontend/
  package.json            # pnpm; scripts dev, build, test, lint, gen:api
  vite.config.ts          # proxy /api -> http://127.0.0.1:8000 em dev
  index.html
  src/
    main.tsx              # QueryClient + RouterProvider
    styles/
      app.css             # @import "tailwindcss"; @theme com os tokens do Foco
      fonts/              # anton.woff2, albert-sans.woff2 (+ licenças OFL), vindos de static/fonts
    api/
      openapi.json        # exportado do backend (make gen-api); não editar à mão
      schema.d.ts         # gerado do openapi.json (openapi-typescript); não editar à mão
      client.ts           # openapi-fetch; converte erro {detail} em ApiError(status, detail)
      queries.ts          # hooks de leitura e mutações (TanStack Query)
    routes/               # TanStack Router, file-based
      __root.tsx          # masthead, nav, toasts, redirect dos links com #, providers
      index.tsx
      galeria.$eventId.tsx
      estudio.index.tsx
      estudio.$eventId.tsx
      calibracao.tsx
      backoffice.tsx
    features/
      gallery/            # Viewfinder, SelfieSearch, ResultsGrid, Lightbox, SelfieSearchProvider
      studio/             # EventRows, EventDialog, Dropzone, UploadBatch, ContactSheet, UploadQueueProvider
      lab/                # EventPicker, Ruler, Timings
      admin/              # LoginForm, FeatureSwitches
      events/             # EventCover (mosaico), EventFacts, componentes comuns a galeria e estúdio
    components/ui/        # shadcn: Button, Dialog, Slider, Switch, Input, Label, Toast (Sonner), Skeleton
    lib/                  # formatação pt-BR (datas, ms, plural), fold(), focusPos(), faceCrop, ícones
  tests/                  # Vitest + Testing Library + MSW
  e2e/                    # Playwright (local): smoke.spec.ts, parity.ts
```

### Regras

- **Rotas** montam a tela: leem parâmetros da URL, chamam hooks de
  `api/queries.ts` e compõem componentes de `features/`.
- **`features/<área>/`** têm a lógica e os componentes daquela área. Uma área
  usa outra só por componentes/hooks exportados de propósito (ex.:
  `features/events` é usado por galeria e estúdio).
- **`components/ui/`** não sabe nada do domínio (é o shadcn estilizado).
- **Nenhum componente chama `fetch`.** Todo acesso à API passa por
  `api/queries.ts` (via `api/client.ts`). Exceção documentada: o upload com
  barra de progresso usa `XMLHttpRequest` dentro de `UploadQueueProvider`,
  porque `fetch` não reporta progresso de envio.
- **Tipos da API vêm do backend.** Nenhum tipo de resposta é escrito à mão:
  `components["schemas"][...]` e os tipos de `paths` do `schema.d.ts`.

### Estilos

- `styles/app.css` define no `@theme` os tokens de `static/style.css` `:root`:
  cores (`parede`, `papel`, `passe`, `linha`, `grafite`, `grafite-2`,
  `chumbo`, `viridian`, `viridian-tint`, `erro`), fontes (`titulo` = Anton,
  `sans` = Albert Sans), escala de texto (`t-xs` ... `t-2xl`, incluindo os
  `clamp()`), `gutter` e raio `r`. As classes utilitárias usam esses nomes
  (`bg-parede`, `text-chumbo`, `font-titulo`...).
- Fontes servidas pelo próprio app (sem CDN), como hoje.
- Os breakpoints do `style.css` atual viram breakpoints do Tailwind com os
  mesmos valores.
- Componentes do shadcn são gerados com o CLI e ajustados para os tokens do
  Foco (sem o tema padrão do shadcn).

## 2. Estado e fluxo de dados

| tipo | onde fica | exemplos |
|---|---|---|
| dado do servidor | TanStack Query | eventos, evento, fotos, stats, flags, sessão do admin |
| navegação | URL (TanStack Router, tipado) | `eventId`, `?foto=12` na galeria, `?e=4` na calibração |
| sessão da página | contextos no `__root` | busca da selfie, fila de upload |

### Chaves de query e invalidação

| query | chave | invalidada por |
|---|---|---|
| `useEvents()` | `["events"]` | criar/editar/excluir evento, mudança de status no upload |
| `useEvent(id)` | `["events", id]` | editar evento, upload |
| `usePhotos(id)` | `["events", id, "photos"]` | upload (fase muda) |
| `useStats(id)` | `["stats", id]` | upload (fase muda) |
| `useFeatures()` | `["features"]` | toggle no backoffice; "cura" da busca |
| `useAdminSession()` | `["admin", "session"]` | login, logout |
| `useAdminFeatures()` | `["admin", "features"]` | toggle |

`useEvents()` no Estúdio usa `refetchInterval` de 3 s **só enquanto algum
evento tem `n_pending > 0`**; volta a zero sozinho.

### Busca da selfie: `SelfieSearchProvider`

Contexto no `__root` porque Galeria e Calibração compartilham a mesma busca
(como hoje).

- Estado: `eventId`, `selfieBlob`, `selfieUrl` (object URL, revogado ao
  trocar), `queryToken`, `selfieInfo`, `firstTimings`, `threshold` (0,40
  inicial), `result`, `status` (`idle` | `searching` | `done` | `error`) e a
  mensagem de erro.
- **Nunca persistido** (nem `localStorage`, nem URL): a selfie é dado
  biométrico. Trocar de evento limpa tudo.
- Selfie nova → `POST /api/search` com `selfie`. Resposta com selfie guarda
  `queryToken`, `selfieInfo` e `firstTimings`.
- Slider → `POST` com `query_token` (debounce 150 ms). A resposta vem sem
  `selfie`; o provider reaproveita `selfieInfo` e junta `firstTimings` com o
  `search` novo (mesma regra do `app.js` atual).
- 410 → reenvia o `selfieBlob` guardado, uma vez (a retentativa vai com a
  selfie, então não entra em loop).
- 422 → "Não encontramos um rosto nesta foto. Tente de frente, com mais luz."
- Calibração aberta e resposta sem `debug_top` → atualiza `["features"]` com
  `calibration: false`, termina de desenhar o resultado e sai da rota (a
  "cura" de hoje).
- Câmera (`getUserMedia`) fica no `Viewfinder`, que entrega um `Blob` ao
  provider; o stream é parado ao desmontar.

### Fila de upload: `UploadQueueProvider`

Contexto no `__root` para o resumo do envio sobreviver à navegação (sair do
evento e voltar mostra o mesmo lote).

- Um lote por evento (`eventId`); soltar mais fotos durante o envio entra no
  mesmo lote.
- Até 3 envios simultâneos, um arquivo por request (`XMLHttpRequest` para ter
  `upload.onprogress`).
- Fases por arquivo: `waiting` → `sending` → `queued` → `processing` → `done`
  | `dup` | `error`, com a mesma fórmula de progresso de hoje
  (`PHASE_PROGRESS`) e a mesma ETA.
- Progresso da indexação por `EventSource` em
  `/api/events/{id}/progress?ids=...`; o SSE fecha quando `done`.
- Cada mudança de fase para `done`/`dup`/`error` invalida `["events", id,
  "photos"]`, `["stats", id]`, `["events"]` e `["events", id]`.
- Upload respondido com `status: "error"` (arquivo inválido) ou HTTP de erro
  → fase `error` com a mensagem.

### Visualizador de foto

- Abrir uma foto faz `navigate({ search: { foto: photoId } })` (push).
- Voltar remove `foto` e fecha o visualizador; fechar pelo botão ou Esc faz
  `history.back()` se a abertura foi um push nesta sessão, senão `replace`
  sem `foto`.
- Página aberta com `?foto=12` sem resultado de busca (ex.: recarregou; a
  selfie não é guardada) ou com uma foto que não está nos resultados →
  remove o parâmetro com `replace`.
- Zoom no rosto e o marcador "onde estou" seguem a lógica atual
  (`faceZoom`, `zoomTransform`, `showMarker`), portados para um hook.

### Links antigos com `#`

No `__root`, na primeira renderização, se `location.hash` tiver o formato
antigo, navega com `replace`:

| hash antigo | rota nova |
|---|---|
| `#galeria?e=4` | `/galeria/4` |
| `#galeria` | `/` |
| `#estudio?e=4` | `/estudio/4` |
| `#estudio` | `/estudio` |
| `#calibracao?e=4` | `/calibracao?e=4` |
| `#backoffice` | `/backoffice` |

Hash desconhecido é ignorado.

### Flags e guardas

- `useFeatures()` carregado no `__root`; enquanto carrega, tudo desligado
  (como hoje).
- `/calibracao`: `beforeLoad` redireciona para `/` quando `calibration` está
  desligada. O item da navegação some.
- Evento lembrado: `localStorage["event"]` guarda só o id do último evento
  aberto, usado pela Calibração para escolher o evento inicial (último aberto
  com fotos prontas, senão o primeiro com fotos). Leitura e escrita em
  `try/catch`.

### Carregando e erro

- Cada rota tem `pendingComponent` (esqueleto com o formato da tela, usando
  `Skeleton`) e `errorComponent` (mensagem do `detail` + botão "Tentar de
  novo", que refaz as queries da rota).
- 404 de evento em `/galeria/$eventId` e `/estudio/$eventId` → tela "Evento
  não encontrado" com link para voltar, não o erro genérico.
- Mutações (salvar/excluir evento, login, toggle) mostram erro no próprio
  formulário/diálogo ou num toast; nunca somem em silêncio.
- `document.title` por tela, como hoje (`Estúdio, Foco`, `<evento>,
  Estúdio, Foco`...).

## 3. Mudanças no backend

1. **`GET /api/events/{id}`** → `EventSummary` do evento (mesmo formato de
   um item de `GET /api/events`); 404 `"evento não encontrado"`. Reaproveita
   a montagem do `list_events` (contagens + capa + foco), sem trazer os
   outros eventos. Testes no backend.
2. **Servir o SPA** (`foco/main.py`), no lugar do `StaticFiles(html=True)`:
   - `/api/*` inalterado; rota `/api` desconhecida continua 404 JSON.
   - `/assets/*` (arquivos com hash no nome) com
     `Cache-Control: public, max-age=31536000, immutable`.
   - Arquivos existentes na raiz do `dist/` (ex.: `favicon`) servidos como
     estão.
   - Qualquer outro caminho → `index.html` com `Cache-Control: no-cache`.
   - Testes: `/galeria/4` devolve o `index.html`; `/api/nao-existe` → 404
     JSON; asset com hash tem o cache longo.
3. `STATIC_DIR` continua sendo a pasta servida; no Docker passa a apontar para
   o `dist/` do build (mesmo caminho `/app/static`).

## 4. Testes

### Unitários e de componentes (Vitest + Testing Library + MSW)

MSW simula a API no nível da rede, usando os tipos do `schema.d.ts`.

- `SelfieSearchProvider`: selfie → token; slider usa token e reaproveita
  `selfieInfo`/`firstTimings`; 410 → reenvio único; 422 → mensagem; "cura" da
  flag; troca de evento limpa.
- `UploadQueueProvider`: no máximo 3 simultâneos; fases e progresso; arquivo
  inválido; duplicata; invalidação das queries.
- Redirect dos links com `#` (tabela acima).
- Visualizador: `?foto` abre; voltar fecha; recarregar sem resultado limpa.
- Guarda de `/calibracao` com a flag ligada e desligada.
- `lib/`: `fmtEventDate`, `fmtDate` (ISO com fuso), `fmtMs`, `plural`,
  `fold`, `focusPos`, `precisionWord`.
- Estados de carregando/erro/404 de uma rota representativa (galeria).

### E2E (Playwright, local, modelo real)

`e2e/smoke.spec.ts`, rodando contra `make api` + `make worker` + `make web`:
criar evento pela UI, upload, esperar indexar, selfie na galeria, slider
(confirma busca via `query_token`), abrir foto + voltar do navegador, baixar
zip, login no backoffice e ligar a Calibração, ver a régua, excluir evento.
Fotos de teste por variável de ambiente (`SMOKE_PHOTO`, `SMOKE_SELFIE`).
Fica fora do CI (o modelo de 280 MB deixaria o CI lento).

### Paridade visual

`e2e/parity.ts` tira screenshots do app antigo (`static/`, servido pelo
backend em :8000 antes da troca) e do novo (:5173), nas mesmas telas e
estados, em 375, 768 e 1280 px, e gera uma página lado a lado. Comparação a
olho (fontes e antialiasing tornam diff de pixel ruidoso). Diferença aceita:
só os 4 ajustes. Cada tarefa de tela do plano termina com essa comparação.

### CI

O contrato fica versionado em dois arquivos: `frontend/src/api/openapi.json`
(exportado do backend) e `frontend/src/api/schema.d.ts` (gerado dele).
`make gen-api` atualiza os dois.

- Job `backend` (já existe): depois dos testes, exporta o OpenAPI e falha se
  for diferente do `openapi.json` versionado (mudou a API sem rodar
  `make gen-api`).
- Job `frontend` (novo): `pnpm install --frozen-lockfile`, `biome check`,
  `tsc --noEmit`, `vitest run`, `vite build`, e regenera o `schema.d.ts` a
  partir do `openapi.json` versionado, falhando se houver diferença. Não
  precisa de Python.

## 5. Build, dev e troca

### Dev

- `make web` → `pnpm --dir frontend dev` (Vite em http://127.0.0.1:5173,
  proxy de `/api` para :8000). Continua precisando de `make db`, `make api` e
  `make worker`.
- `make gen-api` → exporta o OpenAPI do backend para
  `frontend/src/api/openapi.json` (script Python em `backend/` que chama
  `create_app().openapi()`, sem servidor nem banco) e roda
  `openapi-typescript` para `frontend/src/api/schema.d.ts`.
- `make web-test`, `make web-lint`.

### Build e Docker

- `Dockerfile` ganha um primeiro estágio `node:22-slim` com pnpm (via
  corepack) que roda `pnpm install --frozen-lockfile && pnpm build` em
  `frontend/`. O estágio Python copia `frontend/dist` para `/app/static`.
- `.dockerignore` exclui `frontend/node_modules` e `frontend/dist`.

### Troca (última tarefa)

- `static/` é removido (as fontes já estão em `frontend/src/styles/fonts`).
- `Dockerfile` passa a construir o front.
- README: seção de dev com `make web`, arquitetura do front.
- Até essa tarefa, `static/` continua funcionando no `main`.

## Critérios de pronto

- As 6 telas e os 2 diálogos com paridade visual e de comportamento (comparação
  lado a lado aprovada), mais os 4 ajustes.
- Links antigos com `#` redirecionam para as rotas novas.
- Nenhum `fetch` fora de `api/`; nenhum tipo de resposta da API escrito à mão.
- `make web-test`, `make web-lint`, `make test` e o CI passam; o schema
  gerado está em dia.
- E2E local com o modelo real passa.
- `docker compose up -d --build` serve o SPA pelo `foco-api` (rotas diretas
  como `/galeria/4` funcionam ao recarregar).
- `static/` removido; README atualizado.
