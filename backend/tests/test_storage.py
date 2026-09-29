import pytest

from foco.core.storage import LocalStorage


@pytest.fixture
def st(tmp_path):
    return LocalStorage(tmp_path)


def test_salva_e_le(st):
    st.save("photos/1/a.jpg", b"123")
    assert st.exists("photos/1/a.jpg")
    assert st.read("photos/1/a.jpg") == b"123"


def test_sobrescreve_sem_deixar_tmp(st, tmp_path):
    st.save("thumbs/x.jpg", b"1")
    st.save("thumbs/x.jpg", b"2")
    assert st.read("thumbs/x.jpg") == b"2"
    assert [p.name for p in (tmp_path / "thumbs").iterdir()] == ["x.jpg"]


def test_apagar_inexistente_nao_falha(st):
    st.delete("nao/existe.jpg")
    assert not st.exists("nao/existe.jpg")


def test_delete_dir(st):
    st.save("photos/7/a.jpg", b"1")
    st.delete_dir("photos/7")
    assert not st.exists("photos/7/a.jpg")
    st.delete_dir("photos/7")  # de novo: não falha


def test_chave_fora_da_raiz_recusada(st):
    with pytest.raises(ValueError):
        st.path("../fora.txt")
    with pytest.raises(ValueError):
        st.save("/etc/passwd", b"x")
    for key in ["", ".", "a/.."]:
        with pytest.raises(ValueError):
            st.path(key)
    with pytest.raises(ValueError):
        st.delete_dir("")
