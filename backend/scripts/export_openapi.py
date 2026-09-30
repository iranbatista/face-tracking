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
