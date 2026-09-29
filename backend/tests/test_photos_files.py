import io
import zipfile

from fakes import png
from sqlalchemy import update

from foco.modules.photos.keys import medium_key
from foco.modules.photos.models import Photo


def seed(client, data=None, name="a.png"):
    eid = client.post("/api/events", json={"name": "E"}).json()["id"]
    item = client.post(
        f"/api/events/{eid}/photos", files=[("files", (name, data or png(r=1), "image/png"))]
    ).json()[0]
    return eid, item


def test_thumb(client):
    _, p = seed(client)
    r = client.get(f"/api/photos/{p['id']}/thumb")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    assert "max-age=86400" in r.headers["cache-control"]


def test_medium_de_foto_pequena_e_a_original(client):
    _, p = seed(client)
    r = client.get(f"/api/photos/{p['id']}/medium")
    assert r.content == png(r=1)


def test_medium_de_foto_grande_e_gerada_uma_vez(client, storage, session):
    _, p = seed(client, png(r=1, size=(2000, 1000)))
    sha = session.get(Photo, p["id"]).sha256
    r = client.get(f"/api/photos/{p['id']}/medium")
    assert r.headers["content-type"] == "image/jpeg"
    assert storage.exists(medium_key(sha))
    mtime = storage.path(medium_key(sha)).stat().st_mtime_ns
    client.get(f"/api/photos/{p['id']}/medium")
    assert storage.path(medium_key(sha)).stat().st_mtime_ns == mtime


def test_full_com_download(client):
    _, p = seed(client, name="minha foto.png")
    r = client.get(f"/api/photos/{p['id']}/full?download=1")
    assert r.content == png(r=1)
    assert "attachment" in r.headers["content-disposition"]


def test_foto_inexistente_404(client):
    for kind in ("thumb", "medium", "full"):
        assert client.get(f"/api/photos/999999/{kind}").status_code == 404


def test_zip(client):
    _, p = seed(client, name="a.png")
    r = client.get(f"/api/zip?ids={p['id']}")
    assert r.headers["content-type"] == "application/zip"
    names = zipfile.ZipFile(io.BytesIO(r.content)).namelist()
    assert names == [f"{p['id']:05d}_a.png"]


def test_zip_sem_ids_400(client):
    assert client.get("/api/zip?ids=abc").status_code == 400


def test_stats(client, session):
    eid, p = seed(client)
    session.execute(update(Photo).where(Photo.id == p["id"]).values(status="done", n_faces=2, proc_ms=100.0))
    session.commit()
    s = client.get(f"/api/stats?event_id={eid}").json()
    assert s == {
        "events": 1,
        "photos": 1,
        "done": 1,
        "pending": 0,
        "errors": 0,
        "faces": 2,
        "avg_ms_per_photo": 100.0,
    }
