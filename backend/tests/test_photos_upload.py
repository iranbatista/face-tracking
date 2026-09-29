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
