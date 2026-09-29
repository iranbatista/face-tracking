import numpy as np
import pytest
from conftest import SECRET
from factories import make_event, make_photo, unit
from fakes import png

from foco.modules.features import service as features
from foco.modules.search import service, token

BOX = (10, 10, 50, 50)


@pytest.fixture
def ev(session):
    """Foto 1: a pessoa 1. Foto 2: outra pessoa (unit(2), score 0 com a selfie)."""
    e = make_event(session)
    make_photo(session, e, faces=[(BOX, unit(1), 0.9)])
    make_photo(session, e, faces=[(BOX, unit(2), 0.9)])
    session.commit()
    return e


def search(client, eid, **data):
    files = {"selfie": ("s.png", data.pop("selfie"), "image/png")} if "selfie" in data else None
    return client.post("/api/search", data={"event_id": eid, "threshold": 0.4, **data}, files=files)


def test_selfie_acha_a_foto(client, ev):
    r = search(client, ev.id, selfie=png(r=1))
    assert r.status_code == 200, r.text
    body = r.json()
    assert [m["score"] for m in body["matches"]] == [1.0]
    assert body["selfie"]["n_faces"] == 1 and body["selfie"]["warning"] is None
    assert (body["total_photos"], body["indexed_faces"]) == (2, 2)
    assert body["query_token"]
    for k in ("debug_top", "timings_ms", "timings_from_cache"):
        assert k not in body


def test_token_refaz_a_busca_sem_selfie(client, ev, detector):
    tok = search(client, ev.id, selfie=png(r=1)).json()["query_token"]
    r = search(client, ev.id, query_token=tok)
    assert r.status_code == 200
    assert len(r.json()["matches"]) == 1
    assert "selfie" not in r.json()
    assert detector.calls == 1  # a rede não rodou de novo


def test_varios_rostos_na_selfie_usa_o_maior(client, ev):
    body = search(client, ev.id, selfie=png(r=1, g=2)).json()
    assert body["selfie"]["n_faces"] == 2 and body["selfie"]["warning"]
    assert [m["score"] for m in body["matches"]] == [1.0]  # o maior é a pessoa 1


def test_um_resultado_por_foto(client, session):
    e = make_event(session)
    near = unit(1) + 0.1 * unit(3)
    make_photo(session, e, faces=[(BOX, unit(1), 0.9), (BOX, near / np.linalg.norm(near), 0.9)])
    session.commit()
    matches = search(client, e.id, selfie=png(r=1)).json()["matches"]
    assert len(matches) == 1 and matches[0]["score"] == 1.0


def test_calibracao_ligada(client, ev, session):
    features.set_enabled(session, "calibration", True)
    body = search(client, ev.id, selfie=png(r=1)).json()
    assert [d["above"] for d in body["debug_top"]] == [True, False]
    assert {"decode", "detection", "embedding", "search"} <= body["timings_ms"].keys()
    assert body["timings_from_cache"] is False

    body = search(client, ev.id, query_token=body["query_token"]).json()
    assert body["timings_ms"].keys() == {"search"}
    assert body["timings_from_cache"] is True


def test_calibracao_desligada_nem_calcula_top30(client, ev, monkeypatch):
    calls = []
    original = service._query
    monkeypatch.setattr(service, "_query", lambda *a, **k: calls.append(k) or original(*a, **k))
    search(client, ev.id, selfie=png(r=1))
    assert calls and all("limit" not in k for k in calls)


def test_threshold_limitado_ao_intervalo_dos_sliders(client, ev):
    body = search(client, ev.id, selfie=png(r=1), threshold=-1).json()
    assert body["threshold"] == 0.15 and len(body["matches"]) == 1  # o desconhecido (0) não volta
    assert search(client, ev.id, selfie=png(r=1), threshold=5).json()["threshold"] == 0.80


def test_token_adulterado_410(client, ev):
    r = search(client, ev.id, query_token="lixo.lixo")
    assert r.status_code == 410
    assert r.json() == {"detail": "Busca expirada. Envie a selfie de novo."}


def test_token_expirado_410(client, ev):
    old = token.issue(unit(1), SECRET, now=1)
    assert search(client, ev.id, query_token=old).status_code == 410


def test_sem_selfie_nem_token_400(client, ev):
    assert search(client, ev.id).status_code == 400


def test_selfie_sem_rosto_422(client, ev):
    assert search(client, ev.id, selfie=png()).status_code == 422


def test_selfie_invalida_422(client, ev):
    assert search(client, ev.id, selfie=b"nao e imagem").status_code == 422


def test_evento_inexistente_404(client):
    assert search(client, 999_999, selfie=png(r=1)).status_code == 404


def test_evento_fora_do_bigint_422(client):
    assert search(client, 99999999999999999999, selfie=png(r=1)).status_code == 422
