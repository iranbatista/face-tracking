from unittest.mock import ANY

from conftest import deferred
from factories import make_event, make_photo, unit
from sqlalchemy import func, select

from foco.modules.photos.models import Photo


def test_cria(client):
    body = {"name": "  Corrida  ", "event_date": "2026-09-01", "location": " SP "}
    r = client.post("/api/events", json=body)
    assert r.status_code == 200
    assert r.json() == {"id": ANY, "name": "Corrida", "event_date": "2026-09-01", "location": "SP"}


def test_nome_vazio_400(client):
    r = client.post("/api/events", json={"name": "   "})
    assert r.status_code == 400
    assert r.json() == {"detail": "Dê um nome ao evento."}


def test_data_invalida_400(client):
    r = client.post("/api/events", json={"name": "X", "event_date": "31/12/2026"})
    assert r.status_code == 400
    assert r.json() == {"detail": "Data inválida."}


def test_campos_opcionais_vazios_viram_null(client):
    r = client.post("/api/events", json={"name": "X", "event_date": "", "location": "  "})
    assert r.json()["event_date"] is None and r.json()["location"] is None


def test_edita(client):
    eid = client.post("/api/events", json={"name": "A"}).json()["id"]
    r = client.patch(f"/api/events/{eid}", json={"name": "B", "location": "Rio"})
    assert r.json() == {"id": eid, "name": "B", "event_date": None, "location": "Rio"}


def test_edita_inexistente_404(client):
    assert client.patch("/api/events/999999", json={"name": "B"}).status_code == 404


def test_lista_mais_recente_primeiro(client):
    client.post("/api/events", json={"name": "Velho", "event_date": "2020-01-01"})
    client.post("/api/events", json={"name": "Novo", "event_date": "2026-01-01"})
    assert [e["name"] for e in client.get("/api/events").json()] == ["Novo", "Velho"]


def test_lista_com_contagens_e_capa(client, session):
    ev = make_event(session, "Festa")
    p = make_photo(session, ev, width=1000, height=1000, faces=[((100, 200, 300, 400), unit(0), 0.9)])
    make_photo(session, ev, status="queued")
    session.commit()
    [e] = client.get("/api/events").json()
    assert (e["n_photos"], e["n_done"], e["n_pending"], e["n_faces"]) == (2, 1, 1, 1)
    assert e["cover"] == [{"id": p.id, "fx": 0.2, "fy": 0.3}]
    assert e["created_at"]


def test_exclui_evento_e_agenda_arquivos(client, session, jobs):
    ev = make_event(session)
    p = make_photo(session, ev)
    session.commit()
    r = client.delete(f"/api/events/{ev.id}")
    assert r.json() == {"deleted": ev.id, "photos": 1}
    assert session.scalar(select(func.count()).select_from(Photo)) == 0
    assert deferred(jobs, "delete_event_files") == [
        {"event_id": ev.id, "keys": [p.storage_key], "shas": [p.sha256]}
    ]


def test_exclui_evento_mesmo_se_agendar_limpeza_falhar(client, session, jobs, monkeypatch):
    def boom(**kwargs):
        raise RuntimeError("fila fora do ar")

    monkeypatch.setattr("foco.modules.photos.tasks.delete_event_files.defer", boom)
    ev = make_event(session)
    make_photo(session, ev)
    session.commit()
    r = client.delete(f"/api/events/{ev.id}")
    assert r.status_code == 200
    assert r.json() == {"deleted": ev.id, "photos": 1}
    assert client.get("/api/events").json() == []


def test_exclui_inexistente_404(client):
    assert client.delete("/api/events/999999").status_code == 404
