"""
api.py — servidor FastAPI: endpoints HTTP + worker de indexação em background.

Rodar:  uvicorn api:app --reload        (escuta só em 127.0.0.1:8000)

Por que um worker em thread separada?
  Indexar uma foto em CPU leva ~0.3-1s. Se o upload esperasse a indexação,
  subir 200 fotos travaria a requisição por minutos. Então o upload só SALVA
  o arquivo e coloca o ID numa fila; uma thread consome a fila, uma foto por
  vez, e o navegador acompanha o progresso via Server-Sent Events (SSE).
"""

import asyncio
import hashlib
import io
import json
import queue
import threading
import time
import uuid
import zipfile
from collections import OrderedDict
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import detector
import store

PHOTOS_DIR = store.DATA_DIR / "photos"
THUMBS_DIR = store.DATA_DIR / "thumbs"
STATIC_DIR = Path(__file__).parent / "static"

# ------------------------------------------------------------- worker -----

jobs: "queue.Queue[int]" = queue.Queue()


def process_photo(photo_id: int):
    """Indexa uma foto: detectar rostos -> embeddings -> SQLite + FAISS."""
    with store.db() as c:
        p = c.execute("SELECT * FROM photos WHERE id=?", (photo_id,)).fetchone()
    if p is None:
        return
    store.set_status(photo_id, "processing")
    t0 = time.perf_counter()
    try:
        img = detector.load_image(Path(p["path"]).read_bytes())
        faces, _ = detector.analyze(img)
        store.save_faces(photo_id, p["event_id"], faces, (time.perf_counter() - t0) * 1000)
    except Exception as e:  # foto corrompida etc.: marca erro e segue a fila
        store.set_status(photo_id, "error", str(e))


def worker_loop():
    while True:
        process_photo(jobs.get())
        jobs.task_done()


@asynccontextmanager
async def lifespan(app: FastAPI):
    store.init_db()
    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
    THUMBS_DIR.mkdir(parents=True, exist_ok=True)
    n = store.load_indexes()
    print(f"[startup] índice FAISS reconstruído com {n} rostos")
    # Fotos que estavam na fila quando o servidor caiu voltam para a fila.
    with store.db() as c:
        pending = c.execute(
            "SELECT id FROM photos WHERE status IN ('queued','processing') ORDER BY id"
        ).fetchall()
    for r in pending:
        jobs.put(r["id"])
    threading.Thread(target=worker_loop, daemon=True).start()
    # Carrega o modelo agora para a primeira requisição não pagar esse custo.
    await asyncio.to_thread(detector.get_model)
    print("[startup] modelo buffalo_l carregado")
    yield


app = FastAPI(title="Face Search PoC", lifespan=lifespan)

# ------------------------------------------------------------- eventos ----


class EventIn(BaseModel):
    name: str


@app.post("/api/events")
def create_event(body: EventIn):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "nome vazio")
    with store.db() as c:
        cur = c.execute("INSERT INTO events (name) VALUES (?)", (name,))
    return {"id": cur.lastrowid, "name": name}


@app.get("/api/events")
def list_events():
    with store.db() as c:
        rows = c.execute(
            """SELECT e.id, e.name, e.created_at,
                      COUNT(p.id) AS n_photos,
                      COALESCE(SUM(p.n_faces), 0) AS n_faces
               FROM events e LEFT JOIN photos p ON p.event_id = e.id
               GROUP BY e.id ORDER BY e.id DESC"""
        ).fetchall()
    return [dict(r) for r in rows]


def _get_event(event_id: int):
    with store.db() as c:
        ev = c.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
    if ev is None:
        raise HTTPException(404, "evento não encontrado")
    return ev


# ------------------------------------------------------------- upload -----


def _photo_json(r) -> dict:
    return {k: r[k] for k in ("id", "filename", "status", "n_faces", "proc_ms", "error", "width", "height")}


@app.post("/api/events/{event_id}/photos")
async def upload_photos(event_id: int, files: list[UploadFile] = File(...)):
    """Salva as fotos e as coloca na fila. NÃO indexa aqui (ver worker)."""
    _get_event(event_id)
    out = []
    for f in files:
        data = await f.read()
        # Hash do CONTEÚDO: se a mesma foto for enviada de novo (mesmo com
        # outro nome), o hash é igual e não reprocessamos.
        sha = hashlib.sha256(data).hexdigest()
        with store.db() as c:
            dup = c.execute(
                "SELECT * FROM photos WHERE event_id=? AND sha256=?", (event_id, sha)
            ).fetchone()
        if dup:
            out.append({**_photo_json(dup), "duplicate": True})
            continue
        try:
            img = await asyncio.to_thread(detector.load_image, data)
            thumb = await asyncio.to_thread(detector.make_thumbnail, img)
        except Exception:
            out.append({"filename": f.filename, "status": "error", "error": "arquivo não é uma imagem válida"})
            continue
        ext = Path(f.filename or "").suffix.lower()
        if ext not in (".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"):
            ext = ".jpg"
        path = PHOTOS_DIR / str(event_id) / f"{sha}{ext}"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)  # guardamos o original intacto para download
        thumb_path = THUMBS_DIR / f"{sha}.jpg"
        thumb_path.write_bytes(thumb)
        with store.db() as c:
            cur = c.execute(
                "INSERT INTO photos (event_id, sha256, filename, path, thumb_path, width, height, status)"
                " VALUES (?,?,?,?,?,?,?, 'queued')",
                (event_id, sha, f.filename, str(path), str(thumb_path), img.width, img.height),
            )
            row = c.execute("SELECT * FROM photos WHERE id=?", (cur.lastrowid,)).fetchone()
        jobs.put(row["id"])
        out.append({**_photo_json(row), "duplicate": False})
    return out


@app.get("/api/events/{event_id}/progress")
async def progress(event_id: int, ids: str = ""):
    """Server-Sent Events: empurra o status das fotos até todas terminarem.

    SSE é só uma resposta HTTP que nunca fecha, onde o servidor escreve
    linhas "data: ...\\n\\n". O navegador lê com `new EventSource(url)`.
    Mais simples que WebSocket quando a comunicação é só servidor -> cliente.
    """
    _get_event(event_id)
    wanted = [int(x) for x in ids.split(",") if x.strip().isdigit()]

    async def stream():
        last = None
        while True:
            with store.db() as c:
                if wanted:
                    q = ",".join("?" * len(wanted))
                    rows = c.execute(
                        f"SELECT * FROM photos WHERE event_id=? AND id IN ({q})", (event_id, *wanted)
                    ).fetchall()
                else:  # sem ids: tudo que ainda está pendente no evento
                    rows = c.execute(
                        "SELECT * FROM photos WHERE event_id=? AND status IN ('queued','processing')",
                        (event_id,),
                    ).fetchall()
            items = [_photo_json(r) for r in rows]
            done = all(i["status"] in ("done", "error") for i in items)
            payload = json.dumps({"items": items, "done": done, "queue": jobs.qsize()})
            if payload != last:  # só envia quando algo mudou
                yield f"data: {payload}\n\n"
                last = payload
            if done:
                return
            await asyncio.sleep(0.4)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache"})


# -------------------------------------------------------------- busca -----

# Cache do embedding das últimas selfies (só na memória, nunca em disco).
# Permite que o slider de threshold refaça a busca sem rodar a rede de novo:
# mover o slider custa só a busca no FAISS (~1ms), não a detecção (~300ms).
_queries: "OrderedDict[str, dict]" = OrderedDict()
MAX_QUERIES = 50
DEBUG_TOP_K = 30


def _face_out(face_id: int, score: float, meta) -> dict:
    m = meta[face_id]
    return {
        "face_id": face_id, "photo_id": m["photo_id"], "score": round(score, 4),
        "bbox": [m["x1"], m["y1"], m["x2"], m["y2"]],
        "width": m["width"], "height": m["height"], "filename": m["filename"],
    }


@app.post("/api/search")
async def search(
    event_id: int = Form(...),
    threshold: float = Form(0.40),
    selfie: UploadFile | None = File(None),
    query_id: str | None = Form(None),
):
    """Busca as fotos de um evento que contêm o rosto da selfie.

    O THRESHOLD é o corte de similaridade (cosseno) acima do qual dizemos
    "é a mesma pessoa". Ele é a única decisão "humana" do sistema:
      - mais alto => menos fotos erradas (falsos positivos), mas perde fotos
        suas com ângulo/luz ruins (falsos negativos);
      - mais baixo => acha mais fotos suas, mas começa a trazer desconhecidos.
    """
    _get_event(event_id)
    timings = {}

    if selfie is not None:
        t0 = time.perf_counter()
        img = detector.load_image(await selfie.read())
        timings["decode"] = (time.perf_counter() - t0) * 1000
        faces, t = await asyncio.to_thread(detector.analyze, img)
        timings.update(t)
        if not faces:
            raise HTTPException(422, "Nenhum rosto encontrado na selfie. Tente com mais luz e o rosto de frente.")
        # Várias pessoas na selfie? Usamos o maior rosto (provavelmente quem segura a câmera).
        faces.sort(key=lambda f: (f["bbox"][2] - f["bbox"][0]) * (f["bbox"][3] - f["bbox"][1]), reverse=True)
        main = faces[0]
        info = {
            "bbox": main["bbox"], "det_score": main["det_score"], "n_faces": len(faces),
            "all_bboxes": [f["bbox"] for f in faces], "width": img.width, "height": img.height,
            "warning": (f"{len(faces)} rostos na selfie — usando o maior." if len(faces) > 1 else None),
        }
        query_id = uuid.uuid4().hex
        _queries[query_id] = {"embedding": main["embedding"], "info": info, "timings": dict(timings)}
        while len(_queries) > MAX_QUERIES:
            _queries.popitem(last=False)
    elif query_id and query_id in _queries:
        _queries.move_to_end(query_id)
    else:
        raise HTTPException(400, "envie 'selfie' ou um 'query_id' válido")

    q = _queries[query_id]
    emb: np.ndarray = q["embedding"]
    # Busca só pelo query_id: a selfie não foi reprocessada. Devolvemos os
    # tempos da primeira vez (marcados como cache) + o tempo da busca de agora.
    from_cache = selfie is None
    if from_cache:
        timings = dict(q["timings"])

    t0 = time.perf_counter()
    hits = store.search_threshold(event_id, emb, threshold)  # tudo acima do corte
    top = store.search(event_id, emb, DEBUG_TOP_K)           # top-30, com ou sem corte
    timings["search"] = (time.perf_counter() - t0) * 1000

    meta = store.faces_by_ids(list({i for i, _ in hits} | {i for i, _ in top}))

    # Uma foto pode ter vários rostos parecidos com a selfie (ex.: gêmeos, ou
    # um reflexo). Para a galeria queremos FOTOS, então ficamos com o melhor
    # rosto de cada foto. hits já vem ordenado por score, o 1º por foto vence.
    matches, seen = [], set()
    for fid, score in hits:
        pid = meta[fid]["photo_id"]
        if pid not in seen:
            seen.add(pid)
            matches.append(_face_out(fid, score, meta))

    with store.db() as c:
        total_photos = c.execute(
            "SELECT COUNT(*) FROM photos WHERE event_id=? AND status='done'", (event_id,)
        ).fetchone()[0]

    return {
        "query_id": query_id,
        "threshold": threshold,
        "selfie": q["info"],
        "timings_ms": {k: round(v, 1) for k, v in timings.items()},
        "timings_from_cache": from_cache,
        "total_photos": total_photos,
        "indexed_faces": store.index_size(event_id),
        "matches": matches,
        "debug_top": [{**_face_out(fid, s, meta), "above": s > threshold} for fid, s in top],
    }


# -------------------------------------------------------------- fotos -----


def _photo(photo_id: int):
    with store.db() as c:
        p = c.execute("SELECT * FROM photos WHERE id=?", (photo_id,)).fetchone()
    if p is None:
        raise HTTPException(404, "foto não encontrada")
    return p


@app.get("/api/photos/{photo_id}/thumb")
def photo_thumb(photo_id: int):
    return FileResponse(_photo(photo_id)["thumb_path"], media_type="image/jpeg",
                        headers={"Cache-Control": "max-age=86400"})


@app.get("/api/photos/{photo_id}/full")
def photo_full(photo_id: int, download: bool = False):
    p = _photo(photo_id)
    return FileResponse(p["path"], filename=p["filename"] if download else None)


@app.get("/api/zip")
def download_zip(ids: str):
    """Zip com as fotos originais. ZIP_STORED (sem compressão) porque JPEG
    já é comprimido: comprimir de novo só gasta CPU sem reduzir tamanho."""
    photo_ids = [int(x) for x in ids.split(",") if x.strip().isdigit()]
    if not photo_ids:
        raise HTTPException(400, "nenhuma foto")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
        for pid in photo_ids:
            p = _photo(pid)
            z.write(p["path"], arcname=f"{pid:05d}_{p['filename']}")
    return Response(buf.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": 'attachment; filename="minhas-fotos.zip"'})


@app.get("/api/stats")
def stats(event_id: int | None = None):
    where, args = ("WHERE event_id=?", (event_id,)) if event_id else ("", ())
    with store.db() as c:
        r = c.execute(
            f"""SELECT COUNT(*) AS photos,
                       SUM(status='done') AS done,
                       SUM(status IN ('queued','processing')) AS pending,
                       SUM(status='error') AS errors,
                       COALESCE(SUM(n_faces), 0) AS faces,
                       AVG(CASE WHEN status='done' THEN proc_ms END) AS avg_ms
                FROM photos {where}""",
            args,
        ).fetchone()
        n_events = c.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    return {
        "events": n_events,
        "photos": r["photos"], "done": r["done"] or 0, "pending": r["pending"] or 0,
        "errors": r["errors"] or 0, "faces": r["faces"],
        "avg_ms_per_photo": round(r["avg_ms"], 1) if r["avg_ms"] else None,
    }


# Frontend: montado por último para não "engolir" as rotas /api.
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("api:app", host="127.0.0.1", port=8000)
