import pytest


@pytest.fixture
def spa(make_client, tmp_path):
    root = tmp_path / "dist"
    (root / "assets").mkdir(parents=True)
    (root / "index.html").write_text("<!doctype html><html><body>SPA</body></html>")
    (root / "assets" / "app-abc123.js").write_text("console.log(1)")
    (root / "favicon.svg").write_text("<svg/>")
    (tmp_path / "segredo.txt").write_text("não")
    return make_client(static_dir=root)


def test_raiz_devolve_index_sem_cache(spa):
    r = spa.get("/")
    assert r.status_code == 200 and "SPA" in r.text
    assert r.headers["cache-control"] == "no-cache"


def test_rota_do_front_devolve_index(spa):
    for path in ("/galeria/4", "/estudio", "/calibracao?e=4", "/backoffice"):
        r = spa.get(path)
        assert r.status_code == 200 and "SPA" in r.text, path


def test_asset_com_hash_tem_cache_longo(spa):
    r = spa.get("/assets/app-abc123.js")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "public, max-age=31536000, immutable"


def test_arquivo_da_raiz_do_dist(spa):
    r = spa.get("/favicon.svg")
    assert r.status_code == 200 and r.text == "<svg/>"


def test_api_desconhecida_continua_404_json(spa):
    r = spa.get("/api/nao-existe")
    assert r.status_code == 404
    assert r.json() == {"detail": "rota não encontrada"}


def test_nao_sai_da_pasta_do_dist(spa):
    r = spa.get("/%2e%2e/segredo.txt")
    assert "não" != r.text


def test_sem_pasta_estatica_a_api_funciona(make_client, tmp_path):
    c = make_client(static_dir=tmp_path / "nao-existe")
    assert c.get("/api/health").status_code == 200
