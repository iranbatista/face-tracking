from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from foco.core.db import get_session


def test_health_ok(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_health_sem_banco_503(client):
    dead = Session(bind=create_engine("postgresql+psycopg://x:x@127.0.0.1:1/x"))
    client.app.dependency_overrides[get_session] = lambda: dead
    assert client.get("/api/health").status_code == 503


def test_frontend_servido(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "<html" in r.text.lower()
