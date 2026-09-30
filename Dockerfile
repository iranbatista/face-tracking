# ---- frontend: build do React ----
FROM node:22-slim AS web
RUN corepack enable
WORKDIR /web
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

# ---- app ----
FROM python:3.11-slim

# libgl1 + libglib2.0-0: o insightface puxa o opencv-python "completo", que
# precisa dessas libs mesmo sem interface gráfica. curl: HEALTHCHECK.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
        curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.12.21 /uv /uvx /usr/local/bin/

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_NO_CACHE=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH" \
    INSIGHTFACE_ROOT=/models \
    DATA_DIR=/data \
    STATIC_DIR=/app/static

WORKDIR /app

# Dependências primeiro (camada em cache enquanto o uv.lock não muda).
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Baixa o buffalo_l (~280MB) no build, para o container não depender da
# internet nem atrasar o primeiro boot baixando o modelo.
RUN python -c "from insightface.app import FaceAnalysis; \
FaceAnalysis(name='buffalo_l', root='/models', allowed_modules=['detection','recognition'], providers=['CPUExecutionProvider'])" \
    && rm -f /models/models/buffalo_l.zip

COPY backend/src ./src
COPY backend/alembic.ini ./
COPY backend/migrations ./migrations
RUN uv sync --frozen --no-dev
COPY --from=web /web/dist ./static

# Sem root. O host precisa dar a pasta de arquivos para o uid 1000 (ver README).
RUN useradd --system --uid 1000 foco && mkdir -p /data && chown foco /data
USER foco

EXPOSE 8000

# start-period cobre a carga do modelo no boot.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -fsS http://localhost:8000/api/health || exit 1

# 0.0.0.0 aqui é DENTRO do container: nenhuma porta é publicada no host, só o
# Caddy alcança o serviço pela rede "web".
CMD ["uvicorn", "--factory", "foco.main:create_app", "--host", "0.0.0.0", "--port", "8000"]
