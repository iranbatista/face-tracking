from conftest import deferred
from fakes import png

from foco.modules.photos.keys import thumb_key


def new_event(client):
    return client.post("/api/events", json={"name": "Evento"}).json()["id"]


def upload(client, eid, data, name="a.png"):
    return client.post(f"/api/events/{eid}/photos", files=[("files", (name, data, "image/png"))])


def test_upload_salva_e_enfileira(client, storage, jobs):
    eid = new_event(client)
    r = upload(client, eid, png(r=1))
    assert r.status_code == 200
    [item] = r.json()
    assert item["status"] == "queued" and item["duplicate"] is False
    assert (item["filename"], item["width"], item["height"]) == ("a.png", 64, 48)
    assert deferred(jobs, "index_photo") == [{"photo_id": item["id"]}]
    [orig] = storage.path(f"photos/{eid}").iterdir()
    assert orig.suffix == ".png"
    assert storage.exists(thumb_key(orig.stem))


def test_mesma_foto_de_novo_e_duplicada(client, jobs):
    eid = new_event(client)
    first = upload(client, eid, png(r=1)).json()[0]
    [again] = upload(client, eid, png(r=1), name="outro-nome.png").json()
    assert again["duplicate"] is True and again["id"] == first["id"]
    assert len(deferred(jobs, "index_photo")) == 1


def test_arquivo_invalido(client, jobs):
    eid = new_event(client)
    [item] = upload(client, eid, b"nao e imagem", name="x.png").json()
    assert item == {"filename": "x.png", "status": "error", "error": "arquivo não é uma imagem válida"}
    assert deferred(jobs, "index_photo") == []


def test_upload_evento_inexistente_404(client):
    assert upload(client, 999_999, png(r=1)).status_code == 404


def test_folha_de_contato(client):
    eid = new_event(client)
    a = upload(client, eid, png(r=1)).json()[0]
    b = upload(client, eid, png(r=2)).json()[0]
    sheet = client.get(f"/api/events/{eid}/photos").json()
    assert [p["id"] for p in sheet] == [b["id"], a["id"]]  # mais recente primeiro
    assert {"fx", "fy", "status", "n_faces"} <= sheet[0].keys()


def test_upload_simultaneo_devolve_a_existente(client, session, storage, jobs, monkeypatch):
    import hashlib

    from factories import make_event, make_photo

    from foco.modules.photos import service

    ev = make_event(session)
    data = png(r=7)
    existing = make_photo(session, ev, sha=hashlib.sha256(data).hexdigest())
    session.commit()
    real, calls = service._find_dup, []

    def racy(*args):
        calls.append(1)
        return None if len(calls) == 1 else real(*args)

    monkeypatch.setattr(service, "_find_dup", racy)
    item = service.add_photo(session, storage, ev.id, "a.png", data)
    assert item["duplicate"] is True and item["id"] == existing.id
    assert deferred(jobs, "index_photo") == []


def test_nome_do_arquivo_e_sanitizado(client, session):
    from foco.modules.photos.models import Photo

    eid = new_event(client)
    [item] = upload(client, eid, png(r=3), name="../../evil.png").json()
    assert item["filename"] == "evil.png"
    assert session.get(Photo, item["id"]).storage_key.startswith(f"photos/{eid}/")
    [bad] = upload(client, eid, b"x", name="..\\..\\x.png").json()
    assert bad["filename"] == "x.png"


def test_falha_ao_agendar_indexacao_nao_derruba_upload(client, monkeypatch):
    def boom(photo_id):
        raise RuntimeError("fila fora do ar")

    monkeypatch.setattr("foco.modules.photos.tasks.defer_index", boom)
    eid = new_event(client)
    r = upload(client, eid, png(r=4))
    assert r.status_code == 200 and r.json()[0]["status"] == "queued"
