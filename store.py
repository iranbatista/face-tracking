"""
store.py — onde as coisas ficam guardadas.

Duas camadas com papéis diferentes:

  * SQLite  = fonte da verdade. Eventos, fotos, rostos (bbox) e o próprio
              embedding de cada rosto (como BLOB de 512 float32 = 2KB).
  * FAISS   = índice em memória para responder "quais vetores são mais
              parecidos com este?" rápido. É reconstruído a partir do SQLite
              quando o servidor sobe, então nunca "dessincroniza" do banco.

Por que FAISS IndexFlatIP?
  - "Flat" = busca exata, compara a consulta com TODOS os vetores (força
    bruta). Com dezenas de milhares de rostos isso ainda leva milissegundos
    em CPU. Índices aproximados (IVF, HNSW) só compensam em milhões.
  - "IP" = Inner Product (produto interno). Como os embeddings estão
    normalizados (norma 1), produto interno == similaridade de cosseno.

Um índice por evento: a busca de um participante só faz sentido dentro do
evento dele, e isso deixa cada busca menor.
"""

import os
import sqlite3
import threading
from pathlib import Path

import faiss
import numpy as np

# FACES_DATA_DIR permite rodar uma instância separada (ex.: testes) sem
# misturar com os dados reais em ./data
DATA_DIR = Path(os.environ.get("FACES_DATA_DIR", Path(__file__).parent / "data"))
DB_PATH = DATA_DIR / "faces.db"
DIM = 512  # tamanho do embedding do ArcFace (w600k_r50)

# O FAISS paraleliza com OpenMP por padrão. Para índices pequenos (PoC, até
# ~100k rostos) o custo de acordar 12 threads é maior que a busca em si, e
# elas disputam CPU com o onnxruntime. Medido aqui: 30ms -> 0.2ms com 1 thread.
faiss.omp_set_num_threads(1)

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    event_date TEXT,                   -- data em que o evento aconteceu (AAAA-MM-DD)
    location   TEXT,                   -- cidade / lugar, livre
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS photos (
    id         INTEGER PRIMARY KEY,
    event_id   INTEGER NOT NULL REFERENCES events(id),
    sha256     TEXT NOT NULL,
    filename   TEXT NOT NULL,          -- nome original enviado
    path       TEXT NOT NULL,          -- arquivo original em disco
    thumb_path TEXT NOT NULL,
    width      INTEGER, height INTEGER,
    status     TEXT NOT NULL,          -- queued | processing | done | error
    n_faces    INTEGER DEFAULT 0,
    proc_ms    REAL,                   -- tempo gasto indexando esta foto
    error      TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(event_id, sha256)           -- mesma foto não entra 2x no evento
);
CREATE TABLE IF NOT EXISTS faces (
    id        INTEGER PRIMARY KEY,     -- também é o ID do vetor no FAISS
    photo_id  INTEGER NOT NULL REFERENCES photos(id),
    event_id  INTEGER NOT NULL,
    x1 REAL, y1 REAL, x2 REAL, y2 REAL, -- bbox em px da foto ORIGINAL
    det_score REAL,
    embedding BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS faces_event ON faces(event_id);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER);
CREATE TABLE IF NOT EXISTS settings (  -- overrides do backoffice (ver features.py)
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def next_event_id(c) -> int:
    """Próximo ID de evento, que NUNCA reaproveita o de um evento excluído.

    Sem isso o SQLite reusa o maior ID depois de uma exclusão, e um link antigo
    de galeria (#galeria?e=4) passaria a abrir o evento de outra pessoa.
    """
    row = c.execute("SELECT value FROM meta WHERE key='last_event_id'").fetchone()
    top = c.execute("SELECT COALESCE(MAX(id), 0) FROM events").fetchone()[0]
    nid = max(row[0] if row else 0, top) + 1
    c.execute("INSERT INTO meta (key, value) VALUES ('last_event_id', ?)"
              " ON CONFLICT(key) DO UPDATE SET value=excluded.value", (nid,))
    return nid


def db():
    """Uma conexão nova por operação: simples e segura entre threads."""
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    DATA_DIR.mkdir(exist_ok=True)
    with db() as c:
        c.execute("PRAGMA journal_mode=WAL")  # leitura não bloqueia a escrita do worker
        c.executescript(SCHEMA)
        # Migração: bancos criados antes de existirem data e local do evento.
        # CREATE TABLE IF NOT EXISTS não altera tabela que já existe, então
        # as colunas novas são adicionadas aqui, uma vez.
        cols = {r["name"] for r in c.execute("PRAGMA table_info(events)")}
        for col in ("event_date", "location"):
            if col not in cols:
                c.execute(f"ALTER TABLE events ADD COLUMN {col} TEXT")


# ---------------------------------------------------------------- FAISS ----

_indexes: dict[int, faiss.Index] = {}
_lock = threading.Lock()  # worker adiciona enquanto a API busca


def _new_index():
    # IndexIDMap permite usar nossos próprios IDs (faces.id) em vez de 0,1,2...
    # assim um resultado do FAISS aponta direto para a linha no SQLite.
    return faiss.IndexIDMap(faiss.IndexFlatIP(DIM))


def load_indexes():
    """Reconstrói todos os índices a partir dos embeddings no SQLite."""
    with db() as c:
        rows = c.execute("SELECT id, event_id, embedding FROM faces").fetchall()
    by_event: dict[int, list] = {}
    for r in rows:
        by_event.setdefault(r["event_id"], []).append(r)
    with _lock:
        _indexes.clear()
        for ev, rs in by_event.items():
            idx = _new_index()
            vecs = np.stack([np.frombuffer(r["embedding"], dtype=np.float32) for r in rs])
            idx.add_with_ids(vecs, np.array([r["id"] for r in rs], dtype=np.int64))
            _indexes[ev] = idx
    return len(rows)


def index_size(event_id: int) -> int:
    with _lock:
        idx = _indexes.get(event_id)
        return idx.ntotal if idx else 0


def search(event_id: int, query: np.ndarray, k: int):
    """Top-k rostos mais parecidos. Retorna [(face_id, score), ...] ordenado.

    O score é o cosseno: ~0.6-0.9 para a mesma pessoa em boas fotos,
    ~0.0-0.2 para pessoas diferentes. A zona cinzenta fica no meio.
    """
    with _lock:
        idx = _indexes.get(event_id)
        if idx is None or idx.ntotal == 0:
            return []
        scores, ids = idx.search(query.reshape(1, -1), min(k, idx.ntotal))
    return [(int(i), float(s)) for i, s in zip(ids[0], scores[0]) if i != -1]


def search_threshold(event_id: int, query: np.ndarray, threshold: float):
    """TODOS os rostos com score > threshold (range search do FAISS).

    Diferente do top-k: aqui não fixamos quantos resultados queremos, e sim
    "quão parecido" precisa ser. É exatamente a pergunta do participante:
    "me mostre todas as fotos onde provavelmente sou eu".
    """
    with _lock:
        idx = _indexes.get(event_id)
        if idx is None or idx.ntotal == 0:
            return []
        lims, scores, ids = idx.range_search(query.reshape(1, -1), threshold)
    res = [(int(i), float(s)) for i, s in zip(ids[lims[0]:lims[1]], scores[lims[0]:lims[1]])]
    return sorted(res, key=lambda x: -x[1])


# ------------------------------------------------------------ escrita -----

def save_faces(photo_id: int, event_id: int, faces: list, proc_ms: float):
    """Grava rostos no SQLite e no FAISS, e marca a foto como pronta."""
    with db() as c:
        # O evento pode ter sido excluído enquanto esta foto era indexada:
        # nesse caso não grava nada (senão sobrariam rostos órfãos no índice).
        if c.execute("SELECT 1 FROM photos WHERE id=?", (photo_id,)).fetchone() is None:
            return
        ids = []
        for f in faces:
            cur = c.execute(
                "INSERT INTO faces (photo_id, event_id, x1, y1, x2, y2, det_score, embedding)"
                " VALUES (?,?,?,?,?,?,?,?)",
                (photo_id, event_id, *f["bbox"], f["det_score"], f["embedding"].tobytes()),
            )
            ids.append(cur.lastrowid)
        c.execute(
            "UPDATE photos SET status='done', n_faces=?, proc_ms=? WHERE id=?",
            (len(faces), proc_ms, photo_id),
        )
    if faces:
        vecs = np.stack([f["embedding"] for f in faces])
        with _lock:
            idx = _indexes.setdefault(event_id, _new_index())
            idx.add_with_ids(vecs, np.array(ids, dtype=np.int64))


def drop_event_index(event_id: int):
    """Remove o índice FAISS de um evento excluído."""
    with _lock:
        _indexes.pop(event_id, None)


def set_status(photo_id: int, status: str, error: str | None = None):
    with db() as c:
        c.execute("UPDATE photos SET status=?, error=? WHERE id=?", (status, error, photo_id))


def faces_by_ids(ids: list[int]) -> dict[int, sqlite3.Row]:
    """Metadata (bbox, foto de origem) para os IDs retornados pelo FAISS."""
    if not ids:
        return {}
    q = ",".join("?" * len(ids))
    with db() as c:
        rows = c.execute(
            f"SELECT f.id, f.photo_id, f.x1, f.y1, f.x2, f.y2, f.det_score,"
            f" p.filename, p.width, p.height"
            f" FROM faces f JOIN photos p ON p.id = f.photo_id WHERE f.id IN ({q})",
            ids,
        ).fetchall()
    return {r["id"]: r for r in rows}


# ----------------------------------------------------------- settings -----

def get_setting(key: str) -> str | None:
    with db() as c:
        row = c.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else None


def set_setting(key: str, value: str):
    with db() as c:
        c.execute("INSERT INTO settings (key, value) VALUES (?, ?)"
                  " ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))
