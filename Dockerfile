FROM python:3.11-slim

# libgl1 + libglib2.0-0: o insightface puxa o opencv-python "completo", que
# precisa dessas libs mesmo sem interface gráfica. curl: HEALTHCHECK.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
        curl \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    INSIGHTFACE_ROOT=/models \
    FACES_DATA_DIR=/data

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Baixa o buffalo_l (~280MB) no build, para o container não depender da
# internet nem atrasar o primeiro boot baixando o modelo.
RUN python -c "from insightface.app import FaceAnalysis; \
FaceAnalysis(name='buffalo_l', root='/models', allowed_modules=['detection','recognition'], providers=['CPUExecutionProvider'])"

COPY detector.py store.py api.py ./
COPY static ./static

EXPOSE 8000

# start-period cobre a carga do modelo + reconstrução do índice FAISS no boot.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -fsS http://localhost:8000/api/stats || exit 1

# 0.0.0.0 aqui é DENTRO do container: nenhuma porta é publicada no host, só o
# Caddy alcança o serviço pela rede "web".
# UM worker só (padrão): fila de indexação, índice FAISS e cache de selfies
# vivem na memória do processo. Com 2 workers, cada um teria o seu e a busca
# não enxergaria as fotos indexadas pelo outro.
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000"]
