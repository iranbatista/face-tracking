"""Testes rodam contra um data/ temporário, nunca contra as fotos reais.

FACES_DATA_DIR precisa estar definido ANTES de importar store: o caminho do
banco é calculado no import.
"""

import os
import tempfile

os.environ["FACES_DATA_DIR"] = tempfile.mkdtemp(prefix="foco-test-")

import pytest  # noqa: E402

import store  # noqa: E402

store.init_db()


@pytest.fixture(autouse=True)
def clean_settings():
    """Cada teste começa com todas as flags no padrão."""
    with store.db() as c:
        c.execute("DELETE FROM settings")
    yield
