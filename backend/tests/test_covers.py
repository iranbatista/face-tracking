from types import SimpleNamespace as P

from factories import make_event, make_photo, unit

from foco.modules.photos.covers import DEFAULT_FOCUS, focus_points, pick_cover


def test_capa_com_poucas_fotos_poe_horizontal_primeiro():
    photos = [P(id=1, width=600, height=800), P(id=2, width=800, height=600)]
    assert pick_cover(photos) == [2, 1]


def test_capa_espalha_pelo_evento():
    photos = [P(id=i, width=800, height=600) for i in range(1, 11)]
    assert pick_cover(photos) == [1, 3, 5, 8, 10]  # round() arredonda 4.5 para 4


def test_foco_sem_rosto_usa_padrao(session):
    ev = make_event(session)
    p = make_photo(session, ev)
    assert focus_points(session, [p.id]) == {p.id: DEFAULT_FOCUS}


def test_foco_no_centro_do_rosto(session):
    ev = make_event(session)
    p = make_photo(session, ev, width=1000, height=1000, faces=[((100, 200, 300, 400), unit(0), 0.9)])
    assert focus_points(session, [p.id])[p.id] == {"fx": 0.2, "fy": 0.3}


def test_foco_ignora_rosto_pequeno_em_outra_altura(session):
    # Rosto principal em cima; um rosto bem menor lá embaixo não puxa o foco.
    ev = make_event(session)
    p = make_photo(
        session,
        ev,
        width=1000,
        height=1000,
        faces=[
            ((400, 100, 600, 300), unit(0), 0.9),
            ((100, 800, 150, 850), unit(1), 0.9),
        ],
    )
    assert focus_points(session, [p.id])[p.id] == {"fx": 0.5, "fy": 0.2}


def test_foco_lista_vazia(session):
    assert focus_points(session, []) == {}
