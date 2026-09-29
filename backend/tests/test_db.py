from sqlalchemy import text


def test_sessao_conecta(session):
    assert session.execute(text("SELECT 1")).scalar() == 1


def test_commit_do_teste_nao_vaza_parte1(session):
    session.execute(text("CREATE TABLE tmp_isolamento (x int)"))
    session.commit()  # só libera o SAVEPOINT


def test_commit_do_teste_nao_vaza_parte2(session):
    assert session.execute(text("SELECT to_regclass('tmp_isolamento')")).scalar() is None
