import pytest
from pydantic import ValidationError

from foco.core.config import Settings

URL = "postgresql+psycopg://u:p@h:5432/d"


def test_le_do_ambiente(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", URL)
    monkeypatch.setenv("SECRET_KEY", "s" * 32)
    monkeypatch.setenv("ADMIN_PASSWORD", "x")
    s = Settings(_env_file=None)
    assert s.database_url == URL
    assert s.admin_password == "x"


def test_pg_conninfo_sem_driver_do_sqlalchemy(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", URL)
    monkeypatch.setenv("SECRET_KEY", "s" * 32)
    assert Settings(_env_file=None).pg_conninfo == "postgresql://u:p@h:5432/d"


def test_admin_password_vazia_por_padrao(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", URL)
    monkeypatch.setenv("SECRET_KEY", "s" * 32)
    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)
    assert Settings(_env_file=None).admin_password == ""


def test_secret_key_curta_recusada(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", URL)
    monkeypatch.setenv("SECRET_KEY", "curta")
    with pytest.raises(ValidationError):
        Settings(_env_file=None)
