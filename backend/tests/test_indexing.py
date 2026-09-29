import datetime as dt

import pytest
from conftest import deferred
from factories import make_event, make_photo
from fakes import FakeDetector, png
from sqlalchemy import delete, func, select

from foco.core.storage import LocalStorage
from foco.modules.events.models import Event
from foco.modules.photos import indexing, tasks
from foco.modules.photos.keys import medium_key, thumb_key
from foco.modules.photos.models import Face, Photo


@pytest.fixture
def storage(tmp_path):
    return LocalStorage(tmp_path)


@pytest.fixture
def det():
    return FakeDetector()


def queued_photo(session, storage, data):
    ev = make_event(session)
    p = make_photo(session, ev, status="queued")
    storage.save(p.storage_key, data)
    session.commit()
    return p


def n_faces(session, photo_id):
    return session.scalar(select(func.count()).select_from(Face).where(Face.photo_id == photo_id))


def test_indexa(session, storage, det):
    p = queued_photo(session, storage, png(r=3, g=5))
    indexing.index_photo(session, storage, det, p.id)
    session.refresh(p)
    assert (p.status, p.n_faces, p.error) == ("done", 2, None)
    assert p.proc_ms is not None
    assert n_faces(session, p.id) == 2


def test_rodar_duas_vezes_nao_duplica(session, storage, det):
    p = queued_photo(session, storage, png(r=3))
    indexing.index_photo(session, storage, det, p.id)
    indexing.index_photo(session, storage, det, p.id)
    assert n_faces(session, p.id) == 1


def test_foto_sem_rosto(session, storage, det):
    p = queued_photo(session, storage, png())
    indexing.index_photo(session, storage, det, p.id)
    session.refresh(p)
    assert (p.status, p.n_faces) == ("done", 0)


def test_foto_inexistente_nao_falha(session, storage, det):
    indexing.index_photo(session, storage, det, 999_999)
    assert det.calls == 0


def test_arquivo_corrompido_vira_erro_sem_retry(session, storage, det):
    p = queued_photo(session, storage, b"nao e imagem")
    indexing.index_photo(session, storage, det, p.id, final_attempt=False)
    session.refresh(p)
    assert p.status == "error" and p.error


def test_falha_de_decodificacao_que_nao_e_oserror_vira_erro(session, storage, det, monkeypatch):
    p = queued_photo(session, storage, png(r=3))

    def boom(data):
        raise ValueError("bomba")

    monkeypatch.setattr("foco.modules.photos.indexing.load_image", boom)
    indexing.index_photo(session, storage, det, p.id, final_attempt=False)
    session.refresh(p)
    assert p.status == "error" and "bomba" in p.error


def test_erro_ao_salvar_na_ultima_tentativa_vira_erro(session, storage, det, monkeypatch):
    p = queued_photo(session, storage, png(r=3))

    def boom(*a, **kw):
        raise RuntimeError("banco caiu")

    monkeypatch.setattr("foco.modules.photos.indexing.Face", boom)
    indexing.index_photo(session, storage, det, p.id, final_attempt=True)
    session.refresh(p)
    assert p.status == "error" and "banco caiu" in p.error


def test_erro_ao_salvar_antes_da_ultima_tentativa_sobe(session, storage, det, monkeypatch):
    p = queued_photo(session, storage, png(r=3))
    monkeypatch.setattr("foco.modules.photos.indexing.Face", lambda **kw: 1 / 0)
    with pytest.raises(ZeroDivisionError):
        indexing.index_photo(session, storage, det, p.id, final_attempt=False)


def test_falha_do_detector_tenta_de_novo(session, storage, det):
    p = queued_photo(session, storage, png(b=255))
    with pytest.raises(RuntimeError):
        indexing.index_photo(session, storage, det, p.id, final_attempt=False)
    session.refresh(p)
    assert p.status == "processing"


def test_falha_na_ultima_tentativa_vira_erro(session, storage, det):
    p = queued_photo(session, storage, png(b=255))
    indexing.index_photo(session, storage, det, p.id, final_attempt=True)
    session.refresh(p)
    assert p.status == "error" and "falha simulada" in p.error


def test_evento_excluido_no_meio(session, storage, det):
    p = queued_photo(session, storage, png(r=3))
    photo_id, event_id = p.id, p.event_id  # o rollback expira `p` e a linha não existe mais

    def excluir_evento():
        session.execute(delete(Event).where(Event.id == event_id))
        session.commit()

    det.on_analyze = excluir_evento
    indexing.index_photo(session, storage, det, photo_id)  # não levanta
    session.expunge_all()
    assert session.get(Photo, photo_id) is None
    assert n_faces(session, photo_id) == 0


def test_defer_index_nao_duplica_na_fila(jobs):
    tasks.defer_index(5)
    tasks.defer_index(5)
    assert deferred(jobs, "index_photo") == [{"photo_id": 5}]


def test_stuck_photo_ids(session):
    ev = make_event(session)
    q = make_photo(session, ev, status="queued")
    pr = make_photo(session, ev, status="processing")
    make_photo(session, ev, status="done")
    make_photo(session, ev, status="error")
    session.commit()
    now = dt.datetime.now(dt.UTC)
    assert indexing.stuck_photo_ids(session, now=now) == []  # recém-criadas
    later = now + dt.timedelta(minutes=11)
    assert indexing.stuck_photo_ids(session, now=later) == [q.id, pr.id]


def test_delete_event_files_preserva_miniatura_compartilhada(session, storage):
    a, b = make_event(session, "A"), make_event(session, "B")
    sha_shared, sha_only_a = "a" * 64, "b" * 64
    pa1 = make_photo(session, a, sha=sha_shared)
    pa2 = make_photo(session, a, sha=sha_only_a)
    make_photo(session, b, sha=sha_shared)  # mesma foto no evento B
    for p in (pa1, pa2):
        storage.save(p.storage_key, b"orig")
    for sha in (sha_shared, sha_only_a):
        storage.save(thumb_key(sha), b"t")
        storage.save(medium_key(sha), b"m")
    keys = [pa1.storage_key, pa2.storage_key]
    session.execute(delete(Event).where(Event.id == a.id))
    session.commit()

    indexing.delete_event_files(session, storage, a.id, keys, [sha_shared, sha_only_a])

    assert not storage.exists(pa1.storage_key) and not storage.exists(pa2.storage_key)
    assert storage.exists(thumb_key(sha_shared)) and storage.exists(medium_key(sha_shared))
    assert not storage.exists(thumb_key(sha_only_a)) and not storage.exists(medium_key(sha_only_a))
    assert not storage.path(f"photos/{a.id}").exists()


def test_delete_event_files_ignora_evento_que_ainda_existe(session, storage):
    ev = make_event(session)
    p = make_photo(session, ev)
    storage.save(p.storage_key, b"orig")
    session.commit()
    indexing.delete_event_files(session, storage, ev.id, [p.storage_key], [p.sha256])
    assert storage.exists(p.storage_key)
