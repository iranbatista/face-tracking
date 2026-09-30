# Foco: busca de fotos de evento por reconhecimento facial

O fotógrafo sobe as fotos de um evento, e o participante envia uma selfie para
encontrar as fotos em que aparece. Tudo roda local, em CPU. Nenhuma imagem sai
da máquina (o único download é o modelo `buffalo_l`, feito uma vez só).

## Arquitetura

| peça | papel |
|---|---|
| `backend/src/foco/` | pacote Python (FastAPI). `modules/` tem um pacote por domínio: `events`, `photos`, `search`, `features`, `admin` |
| `router.py` / `service.py` / `models.py` | HTTP / regra de negócio / tabelas (SQLAlchemy 2), em cada módulo |
| `core/` | config (`Settings`), banco, storage de arquivos, tokens assinados, erros |
| `vision/` | InsightFace: detecção (SCRFD) + embeddings (ArcFace). Sem estado |
| `worker.py` + `photos/tasks.py` | fila de tarefas (Procrastinate, no próprio Postgres): indexar fotos, apagar arquivos |
| Postgres + pgvector | fonte da verdade, inclusive os embeddings (`vector(512)`). A busca é SQL |
| `frontend/` | interface: React + Vite + TypeScript. `src/routes` (telas), `src/features` (por domínio), `src/api` (cliente com tipos gerados do OpenAPI). Sem CDN; o Docker gera o `dist/`, que a `foco-api` serve |

Módulo novo (ex.: vendas) = pasta nova em `modules/`, router incluído em `main.py`,
modelos importados em `models.py` e uma migração (`make migration m="..."`).

## Desenvolvimento

Pré-requisitos: Docker (no WSL, ligar a integração do Docker Desktop),
[uv](https://docs.astral.sh/uv/) (`curl -LsSf https://astral.sh/uv/install.sh | sh`)
e `make` (`sudo apt install -y make`; no Ubuntu/WSL ele não vem instalado).

```bash
[ -f .env ] || cp .env.example .env   # e preencha SECRET_KEY (openssl rand -hex 32)
make db                      # Postgres de dev em 127.0.0.1:5432
make migrate                 # cria as tabelas
make api                     # http://127.0.0.1:8000, com reload
make worker                  # em outro terminal: indexa as fotos enviadas
make web                     # em um terceiro terminal: abra http://127.0.0.1:5173
```

O `make web` (Vite) faz proxy de `/api` para o `make api`. A primeira vez pede
`pnpm --dir frontend install` (Node 22; o pnpm vem do `corepack enable`). Os links
antigos com `#` (ex.: `/#backoffice`) continuam funcionando: redirecionam para a rota nova.
O backend só serve o front depois de `pnpm --dir frontend build` (em produção, o Docker faz isso).

O Postgres de dev roda no projeto Compose `face-tracking-dev`, separado do de
produção (`make db` cuida disso; não precisa do comando `docker compose` por trás dele).

Os arquivos enviados em dev ficam em `data/files/` (o mesmo caminho da produção).

Na primeira execução o InsightFace baixa o `buffalo_l` (~280 MB) para `~/.insightface/models/`.

1. **Fotógrafo:** crie um evento, arraste as fotos. Cada uma mostra quantos rostos foram achados.
2. **Participante:** envie uma selfie (ou use a webcam), ajuste a semelhança mínima.
3. **Calibração:** os 30 rostos mais parecidos, inclusive os abaixo do corte, e o tempo de cada etapa. Só aparece se estiver ligada no [backoffice](#backoffice) (vem desligada).

Testes (Postgres de verdade, modelo falso): `make test`. Lint: `make lint` (corrigir: `make fmt`).
Front: `make web-test` e `make web-lint` (corrigir: `make web-fmt`).
Mudou a API? `make gen-api` regenera `frontend/src/api/openapi.json` e `schema.d.ts`
(o CI falha se ficarem defasados).
E2E local (com `make api`, `make worker` e `make web` no ar, modelo real):
`SMOKE_PHOTO=foto.jpg SMOKE_SELFIE=selfie.jpg ADMIN_PASSWORD=... PW_CHROMIUM=/caminho/chrome-headless-shell pnpm --dir frontend e2e`.
Teste com o modelo real: `cd backend && uv run pytest -m slow`.

Mudou um modelo? `make migration m="descreva a mudança"`, **revise** o arquivo
gerado em `backend/migrations/versions/` e rode `make migrate`.

## API

```bash
curl -X POST localhost:8000/api/events -H 'content-type: application/json' -d '{"name":"Corrida"}'
curl localhost:8000/api/events
curl -X POST localhost:8000/api/events/1/photos -F files=@a.jpg -F files=@b.jpg
curl -N "localhost:8000/api/events/1/progress?ids=1,2"      # SSE
curl -X POST localhost:8000/api/search -F event_id=1 -F threshold=0.4 -F selfie=@eu.jpg
curl -X POST localhost:8000/api/search -F event_id=1 -F threshold=0.3 -F query_token=<do passo anterior>
curl localhost:8000/api/photos/1/thumb -o t.jpg
curl "localhost:8000/api/photos/1/full?download=1" -O -J
curl "localhost:8000/api/zip?ids=1,2" -o fotos.zip
curl "localhost:8000/api/stats?event_id=1"
curl localhost:8000/api/health
curl localhost:8000/api/features
curl -c cj -H 'content-type: application/json' -d '{"password":"..."}' localhost:8000/api/admin/login
curl -b cj -X PUT -H 'content-type: application/json' -d '{"enabled":true}' localhost:8000/api/admin/features/calibration
```

O `query_token` carrega o embedding da selfie assinado pelo servidor e vale 1 h.
Nada da selfie fica guardado no servidor.

## Backoffice

Em `/backoffice` o admin liga e desliga funcionalidades para todos os
visitantes, sem novo deploy. Hoje só tem a **Calibração**, que vem
**desligada**: com ela desligada a aba some e `/api/search` não devolve o top 30
nem os tempos (o top 30 mostra rostos de outras pessoas abaixo do corte).
A flag esconde a ferramenta de calibração, não é um controle de privacidade:
quem passa pelo `basic_auth` do Caddy ainda vê todas as fotos do evento na
Galeria e no Estúdio. O corte de semelhança é limitado no servidor ao intervalo
dos sliders (0.15 a 0.80).

O backoffice só existe se `ADMIN_PASSWORD` estiver definida. A sessão dura 12 h.
"Sair" só apaga o cookie deste navegador; para derrubar todas as sessões, troque
`ADMIN_PASSWORD` ou `SECRET_KEY` no `.env` e rode `docker compose up -d`.

## Desempenho medido (CPU, WSL2)

Números medidos na versão anterior (processo único, FAISS); a busca agora é SQL no pgvector e não foi remedida.

- Indexação: ~2 a 4 s por foto com 4 a 6 rostos. O custo principal é o ArcFace, ~250 a 500 ms por rosto.
- Busca com selfie nova: ~0.7 s (detecção + embedding). Mover o slider: só a consulta SQL (o embedding vem em cache no `query_token`).
- Container limitado a 2 cores reais (perfil de VPS pequena): ~5.4 s por foto, ~2.3 s por
  selfie (versão anterior).
- RAM: a versão anterior usava ~750 MB num único processo. Agora a API e o worker
  carregam o `buffalo_l` (~300 MB cada) e ainda há o Postgres: espere cerca de
  1.5 GB no total.
- Imagem Docker: ~2.3 GB (medido: 2.28 GB).

## Deploy na VPS (Docker + Caddy)

Quatro serviços no `docker-compose.yml`: `db` (Postgres + pgvector), `migrate`
(aplica as migrações e sai), `foco-api` e `worker`. Só a `foco-api` está na rede
externa `web`, com o mesmo nome de container de antes (`face-tracking`): o bloco
do `Caddyfile.example` não muda.

**Antes:** confira a arquitetura da VPS com `uname -m`. Os arquivos foram pensados
para `x86_64` (linha CX/CPX).

Primeira instalação, ou migração da versão antiga (SQLite). A versão antiga
guardava tudo em `data/` (fotos de pessoas e embeddings faciais); a nova começa do zero. Pare a pilha antiga **antes** do
`git pull`: depois dele, o `docker compose down` leria o compose novo (que exige
`POSTGRES_PASSWORD`) e o container antigo continuaria rodando com o mesmo nome.

```bash
cd ~/face-tracking
docker compose down                       # para a pilha antiga (compose antigo)
git pull
mv data ../face-tracking-data-antigo      # dados antigos FORA do repo; apague depois de conferir a nova versão
# segredos: gera valores sem abrir editor; não sobrescreve o que já existe no .env
touch .env
[ -s .env ] && [ -n "$(tail -c1 .env)" ] && echo >> .env   # garante quebra de linha no fim
grep -q '^POSTGRES_PASSWORD=' .env || echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" >> .env
grep -q '^SECRET_KEY=' .env || echo "SECRET_KEY=$(openssl rand -hex 32)" >> .env
cat .env                                  # confira: ADMIN_PASSWORD, POSTGRES_PASSWORD, SECRET_KEY
mkdir -p data/files && sudo chown 1000:1000 data/files   # a app roda como uid 1000
docker compose up -d --build --remove-orphans   # build ~3-5 min (baixa o modelo)
docker compose ps -a                      # db/foco-api healthy, worker Up, migrate Exited (0)
docker compose exec foco-api curl -fsS localhost:8000/api/health
```

Atualizar: `git pull && docker compose up -d --build --remove-orphans`. As
migrações novas rodam sozinhas antes da API subir.

Backup:

```bash
docker compose exec -T db pg_dump -U foco foco | gzip > backup-$(date +%F).sql.gz   # banco
tar czf fotos-$(date +%F).tgz data/files                                          # arquivos
```

Restaurar (só em banco vazio, ex.: VPS nova). Restaure **antes** de subir a
`foco-api` e o `worker`, e depois suba tudo:

```bash
docker compose up -d db
gunzip -c backup-AAAA-MM-DD.sql.gz | docker compose exec -T db psql -U foco foco
tar xzf fotos-AAAA-MM-DD.tgz              # devolve data/files
docker compose up -d
```

Não copie `data/postgres` com o banco rodando: use o `pg_dump`.
