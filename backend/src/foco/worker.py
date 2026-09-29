"""
worker.py — fila de tarefas em background (Procrastinate, sobre o próprio Postgres).

Rodar:  procrastinate --app=foco.worker.app worker --concurrency=1

Por que um processo separado?
  Indexar uma foto em CPU leva ~0.3-4 s. O upload só SALVA o arquivo e
  enfileira; o worker consome a fila, uma foto por vez, e o navegador
  acompanha pelo SSE de progresso (que lê o status no banco). A fila fica no
  Postgres: reiniciar qualquer processo não perde nada.

concurrency=1: indexar é CPU pura e o onnxruntime já usa várias threads.
"""

import procrastinate

from foco.core.config import get_settings

app = procrastinate.App(
    connector=procrastinate.PsycopgConnector(conninfo=get_settings().pg_conninfo),
    import_paths=["foco.modules.photos.tasks"],
)
