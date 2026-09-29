import json

from factories import make_event, make_photo

from foco.modules.photos import service


def events_of(text):
    return [json.loads(line[len("data: ") :]) for line in text.splitlines() if line.startswith("data: ")]


def test_snapshot_sem_ids_pega_so_pendentes(session):
    ev = make_event(session)
    q = make_photo(session, ev, status="queued")
    make_photo(session, ev, status="done")
    snap = service.progress_snapshot(session, ev.id, [])
    assert [i["id"] for i in snap["items"]] == [q.id]
    assert snap["done"] is False and snap["queue"] == 1


def test_snapshot_com_ids(session):
    ev = make_event(session)
    a = make_photo(session, ev, status="done")
    b = make_photo(session, ev, status="error")
    snap = service.progress_snapshot(session, ev.id, [a.id, b.id])
    assert {i["id"] for i in snap["items"]} == {a.id, b.id}
    assert snap["done"] is True


def test_sse_termina_quando_tudo_acaba(client, session):
    ev = make_event(session)
    p = make_photo(session, ev, status="done")
    session.commit()
    r = client.get(f"/api/events/{ev.id}/progress?ids={p.id}")
    assert r.headers["content-type"].startswith("text/event-stream")
    [msg] = events_of(r.text)
    assert msg["done"] is True and msg["items"][0]["status"] == "done"


def test_sse_evento_inexistente_404(client):
    assert client.get("/api/events/999999/progress").status_code == 404
