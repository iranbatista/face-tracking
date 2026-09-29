# Foco: busca de fotos de evento por reconhecimento facial

O fotógrafo sobe as fotos de um evento, e o participante envia uma selfie para
encontrar as fotos em que aparece. Tudo roda local, em CPU. Nenhuma imagem sai
da máquina (o único download é o modelo `buffalo_l`, feito uma vez só).

## Instalação

```bash
python3.11 -m venv .venv          # Python 3.10+
source .venv/bin/activate
pip install -r requirements.txt
```

Se o `venv` reclamar de `ensurepip` (Debian/Ubuntu sem `python3.X-venv`):

```bash
python3.11 -m venv --without-pip .venv
curl -sS https://bootstrap.pypa.io/get-pip.py | .venv/bin/python
```

Na primeira execução o InsightFace baixa o `buffalo_l` (~280 MB) para `~/.insightface/models/`.

## Uso

```bash
uvicorn api:app --reload          # escuta só em http://127.0.0.1:8000
```

1. **Fotógrafo:** crie um evento, arraste as fotos. Cada uma mostra quantos rostos foram achados.
2. **Participante:** envie uma selfie (ou use a webcam), ajuste a semelhança mínima.
3. **Debug:** veja os 30 rostos mais parecidos, inclusive os abaixo do corte, e o tempo de cada etapa. Só aparece se a **Calibração** estiver ligada no [backoffice](#backoffice) (vem desligada).

Os dados ficam em `data/` (SQLite + originais + thumbnails). Para recomeçar do zero, apague essa pasta.

## Arquivos

| arquivo | papel |
|---|---|
| `detector.py` | carrega imagem, redimensiona, detecta rostos (SCRFD) e gera embeddings (ArcFace) |
| `store.py` | SQLite (fonte da verdade) + índice FAISS por evento (reconstruído no startup) |
| `features.py` | funcionalidades que o backoffice liga e desliga (padrões no código, overrides no SQLite) |
| `admin_auth.py` | sessão do backoffice: senha única (`ADMIN_PASSWORD`) e cookie assinado |
| `api.py` | endpoints FastAPI, worker de indexação em thread, SSE de progresso |
| `static/` | interface: `index.html`, `style.css`, `app.js` (sem build, sem CDN) |

## API

```bash
curl -X POST localhost:8000/api/events -H 'content-type: application/json' -d '{"name":"Corrida"}'
curl localhost:8000/api/events
curl -X POST localhost:8000/api/events/1/photos -F files=@a.jpg -F files=@b.jpg
curl -N "localhost:8000/api/events/1/progress?ids=1,2"      # SSE
curl -X POST localhost:8000/api/search -F event_id=1 -F threshold=0.4 -F selfie=@eu.jpg
curl -X POST localhost:8000/api/search -F event_id=1 -F threshold=0.3 -F query_id=<do passo anterior>
curl localhost:8000/api/photos/1/thumb -o t.jpg
curl "localhost:8000/api/photos/1/full?download=1" -O -J
curl "localhost:8000/api/zip?ids=1,2" -o fotos.zip
curl "localhost:8000/api/stats?event_id=1"
curl localhost:8000/api/features
curl -c cj -H 'content-type: application/json' -d '{"password":"..."}' localhost:8000/api/admin/login
curl -b cj -X PUT -H 'content-type: application/json' -d '{"enabled":true}' localhost:8000/api/admin/features/calibration
```

## Backoffice

Em `/#backoffice` o admin liga e desliga funcionalidades para todos os
visitantes, sem novo deploy. Hoje só tem a **Calibração**, que vem
**desligada**: com ela desligada a aba some e `/api/search` não devolve o top 30
nem os tempos (o top 30 mostra rostos de outras pessoas abaixo do corte).
A flag esconde a ferramenta de calibração, não é um controle de privacidade:
quem passa pelo `basic_auth` do Caddy ainda vê todas as fotos do evento na
Galeria e no Estúdio. O corte de semelhança é limitado no servidor ao intervalo
dos sliders (0.15 a 0.80).

O backoffice só existe se `ADMIN_PASSWORD` estiver definida. Use uma senha
longa e aleatória: o cookie de sessão é assinado com ela.

```bash
ADMIN_PASSWORD='uma-senha-longa' uvicorn api:app --reload     # local
```

Na VPS, crie um `.env` ao lado do `docker-compose.yml` (fica fora do git):

```bash
echo "ADMIN_PASSWORD=$(openssl rand -base64 24)" > .env && cat .env
docker compose up -d
```

A sessão dura 12 h. "Sair" só apaga o cookie deste navegador; para derrubar
todas as sessões (ex.: cookie copiado), troque a senha no `.env` e rode
`docker compose up -d` de novo.

Testes (sem modelo, com banco temporário):

```bash
pip install -r requirements-dev.txt
python -m pytest -q
```

## Desempenho medido (CPU, WSL2)

- Indexação: ~2 a 4 s por foto com 4 a 6 rostos. O custo principal é o ArcFace, ~250 a 500 ms por rosto.
- Busca com selfie nova: ~0.7 s (detecção + embedding). Mover o slider: <1 ms (só FAISS, embedding em cache).
- Container limitado a 2 cores reais (perfil de VPS pequena): ~5.4 s por foto, ~2.3 s por
  selfie, ~750 MB de RAM. Imagem Docker: 2.8 GB.

## Deploy na VPS (Docker + Caddy)

Mesmo padrão do bg-removal: container sem porta publicada na rede Docker externa
`web`, com o Caddy da VPS fazendo HTTPS e proxy.

**Antes:** confira a arquitetura da VPS com `uname -m`. Os arquivos foram pensados
para `x86_64` (linha CX/CPX). Na linha ARM (CAX, `aarch64`) é preciso confirmar
que `insightface` e `faiss-cpu` têm wheel para ARM.

```bash
# 1. Na VPS: clonar (data/ está no .gitignore, as fotos locais não vão junto)
git clone git@github.com:iranbatista/face-tracking.git ~/face-tracking

# 2. Build e subir (build ~3-5 min, baixa o modelo de ~280MB)
cd ~/face-tracking
docker compose up -d --build
docker compose logs -f          # esperar "modelo buffalo_l carregado"

# 3. Testar por dentro, antes do Caddy
docker compose exec foco-api curl -s localhost:8000/api/stats

# 4. Caddy: colar o bloco de Caddyfile.example no Caddyfile (com a senha)
docker exec -it caddy caddy hash-password
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

Os dados ficam em `~/face-tracking/data/` na VPS. Para backup, copie essa pasta.
Para atualizar: `git pull && docker compose up -d --build` na VPS. Os dados em
`data/` não são afetados, ficam fora do git e fora da imagem.

Para testar o container localmente: `docker compose -f docker-compose.dev.yml up --build`
(abre em `127.0.0.1:8000` e grava os dados em `data-docker/`).
