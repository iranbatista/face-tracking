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
import datetime
import hashlib
import io
import json
import queue
import shutil
import threading
import time
import uuid
import zipfile
from collections import OrderedDict
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, StrictBool

import admin_auth
import detector
import features
import store

PHOTOS_DIR = store.DATA_DIR / "photos"
THUMBS_DIR = store.DATA_DIR / "thumbs"
MEDIUM_DIR = store.DATA_DIR / "medium"   # 1600px, gerado sob demanda (capa e visualizador)
MEDIUM_SIDE = 1600
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
    MEDIUM_DIR.mkdir(parents=True, exist_ok=True)
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
    event_date: str | None = None   # AAAA-MM-DD, vem de <input type="date">
    location: str | None = None


def _clean_event(body: EventIn) -> tuple[str, str | None, str | None]:
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Dê um nome ao evento.")
    date = (body.event_date or "").strip() or None
    if date:
        try:
            datetime.date.fromisoformat(date)
        except ValueError:
            raise HTTPException(400, "Data inválida.")
    location = (body.location or "").strip() or None
    return name[:120], date, location and location[:120]


@app.post("/api/events")
def create_event(body: EventIn):
    name, date, location = _clean_event(body)
    with store.db() as c:
        eid = store.next_event_id(c)
        c.execute("INSERT INTO events (id, name, event_date, location) VALUES (?,?,?,?)",
                  (eid, name, date, location))
    return {"id": eid, "name": name, "event_date": date, "location": location}


@app.patch("/api/events/{event_id}")
def update_event(event_id: int, body: EventIn):
    _get_event(event_id)
    name, date, location = _clean_event(body)
    with store.db() as c:
        c.execute("UPDATE events SET name=?, event_date=?, location=? WHERE id=?",
                  (name, date, location, event_id))
    return {"id": event_id, "name": name, "event_date": date, "location": location}


@app.delete("/api/events/{event_id}")
def delete_event(event_id: int):
    """Apaga o evento com TODAS as fotos, rostos e arquivos. Não tem volta.

    Fotos ainda na fila do worker são ignoradas quando chegarem a vez delas:
    process_photo não acha mais a linha no banco, e save_faces também confere.
    """
    _get_event(event_id)
    with store.db() as c:
        files = c.execute("SELECT path, thumb_path, sha256 FROM photos WHERE event_id=?", (event_id,)).fetchall()
        c.execute("DELETE FROM faces WHERE event_id=?", (event_id,))
        c.execute("DELETE FROM photos WHERE event_id=?", (event_id,))
        c.execute("DELETE FROM events WHERE id=?", (event_id,))
    store.drop_event_index(event_id)
    for f in files:
        Path(f["path"]).unlink(missing_ok=True)
        # a miniatura é nomeada pelo hash: só apaga se nenhum outro evento usa a mesma foto
        with store.db() as c:
            shared = c.execute("SELECT 1 FROM photos WHERE sha256=?", (f["sha256"],)).fetchone()
        if not shared:
            Path(f["thumb_path"]).unlink(missing_ok=True)
            (MEDIUM_DIR / f"{f['sha256']}.jpg").unlink(missing_ok=True)
    shutil.rmtree(PHOTOS_DIR / str(event_id), ignore_errors=True)
    return {"deleted": event_id, "photos": len(files)}


@app.get("/api/events")
def list_events():
    with store.db() as c:
        rows = c.execute(
            """SELECT e.id, e.name, e.event_date, e.location, e.created_at,
                      COUNT(p.id) AS n_photos,
                      COALESCE(SUM(p.status = 'done'), 0) AS n_done,
                      COALESCE(SUM(p.status IN ('queued','processing')), 0) AS n_pending,
                      COALESCE(SUM(p.n_faces), 0) AS n_faces,
                      -- capa da página pública: a primeira foto já indexada
                      (SELECT id FROM photos c WHERE c.event_id = e.id AND c.status = 'done'
                        ORDER BY c.id LIMIT 1) AS cover_photo_id
               FROM events e LEFT JOIN photos p ON p.event_id = e.id
               GROUP BY e.id
               ORDER BY COALESCE(e.event_date, date(e.created_at)) DESC, e.id DESC"""
        ).fetchall()
        done = c.execute(
            "SELECT event_id, id, width, height FROM photos WHERE status='done' ORDER BY id"
        ).fetchall()
    by_event: dict[int, list] = {}
    for p in done:
        by_event.setdefault(p["event_id"], []).append(p)
    covers = {r["id"]: _pick_cover(by_event.get(r["id"], [])) for r in rows}
    focus = _focus_points([pid for ids in covers.values() for pid in ids])
    return [{**dict(r), "cover_ids": covers[r["id"]],
             "cover": [{"id": pid, **focus[pid]} for pid in covers[r["id"]]]} for r in rows]


# Foto sem rosto detectado: mira no terço de cima, onde costumam estar as pessoas.
DEFAULT_FOCUS = {"fx": 0.5, "fy": 0.33}


def _focus_points(photo_ids: list[int]) -> dict[int, dict]:
    """Ponto de foco de cada foto, em fração da largura/altura (0..1).

    1. Escolhe o rosto principal pela pontuação área x confiança do detector.
       Rosto cortado pela borda da foto vale só 30%: é um pedaço de alguém
       que estava fora do quadro, não o assunto da foto.
    2. Junta os rostos de pontuação parecida (>= 60%) que estão NA MESMA
       ALTURA do principal: a fileira de uma foto de grupo.
    3. O foco é o centro desses rostos, com peso pela área.

    Tirar a média de TODOS os rostos falhava: com duas pessoas em alturas
    diferentes, o centro caía entre elas, onde não há ninguém. O frontend usa
    isso em `object-position` para que miniaturas cortadas não decapitem ninguém.
    """
    out = {pid: dict(DEFAULT_FOCUS) for pid in photo_ids}
    if not photo_ids:
        return out
    q = ",".join("?" * len(photo_ids))
    with store.db() as c:
        rows = c.execute(
            f"SELECT f.photo_id, f.x1, f.y1, f.x2, f.y2, f.det_score, p.width, p.height"
            f" FROM faces f JOIN photos p ON p.id = f.photo_id WHERE f.photo_id IN ({q})",
            photo_ids,
        ).fetchall()
    by_photo: dict[int, list] = {}
    for r in rows:
        by_photo.setdefault(r["photo_id"], []).append(r)
    for pid, fs in by_photo.items():
        W, H = fs[0]["width"], fs[0]["height"]
        if not (W and H):
            continue
        faces = []
        for r in fs:
            w, h = max(r["x2"] - r["x1"], 1), max(r["y2"] - r["y1"], 1)
            cut = r["x1"] < -2 or r["y1"] < -2 or r["x2"] > W + 2 or r["y2"] > H + 2
            score = w * h * (r["det_score"] or 1) * (0.3 if cut else 1)
            faces.append({"score": score, "area": w * h, "h": h,
                          "cx": (r["x1"] + r["x2"]) / 2, "cy": (r["y1"] + r["y2"]) / 2})
        best = max(faces, key=lambda f: f["score"])
        row = [f for f in faces
               if f["score"] >= 0.6 * best["score"] and abs(f["cy"] - best["cy"]) <= 1.2 * best["h"]]
        total = sum(f["area"] for f in row)
        fx = sum(f["area"] * f["cx"] for f in row) / total / W
        fy = sum(f["area"] * f["cy"] for f in row) / total / H
        out[pid] = {"fx": round(min(max(fx, 0), 1), 3), "fy": round(min(max(fy, 0), 1), 3)}
    return out
    q = ",".join("?" * len(photo_ids))
    with store.db() as c:
        rows = c.execute(
            f"SELECT f.photo_id, f.x1, f.y1, f.x2, f.y2, p.width, p.height"
            f" FROM faces f JOIN photos p ON p.id = f.photo_id WHERE f.photo_id IN ({q})",
            photo_ids,
        ).fetchall()
    faces: dict[int, list] = {}
    for r in rows:
        area = max(r["x2"] - r["x1"], 1) * max(r["y2"] - r["y1"], 1)
        faces.setdefault(r["photo_id"], []).append((area, (r["x1"] + r["x2"]) / 2, (r["y1"] + r["y2"]) / 2, r))
    for pid, fs in faces.items():
        width, height = fs[0][3]["width"], fs[0][3]["height"]
        if not (width and height):
            continue
        biggest = max(a for a, *_ in fs)
        main = [(a, cx, cy) for a, cx, cy, _ in fs if a >= 0.6 * biggest]
        total = sum(a for a, *_ in main)
        fx = sum(a * cx for a, cx, _ in main) / total / width
        fy = sum(a * cy for a, _, cy in main) / total / height
        out[pid] = {"fx": round(min(max(fx, 0), 1), 3), "fy": round(min(max(fy, 0), 1), 3)}
    return out


def _pick_cover(photos: list, n: int = 5) -> list[int]:
    """Fotos da capa em mosaico: até `n`, espalhadas do início ao fim do
    evento (fotos seguidas costumam ser quase iguais). A primeira vai no quadro
    grande, então preferimos uma horizontal para ela."""
    if len(photos) <= n:
        picks = list(photos)
    else:
        step = (len(photos) - 1) / (n - 1)
        picks = [photos[round(i * step)] for i in range(n)]
    wide = next((p for p in picks if (p["width"] or 0) >= (p["height"] or 0)), None)
    if wide:
        picks.remove(wide)
        picks.insert(0, wide)
    return [p["id"] for p in picks]


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


@app.get("/api/events/{event_id}/photos")
def list_photos(event_id: int, limit: int = 500):
    """Fotos do evento, mais recentes primeiro (folha de contato do Estúdio)."""
    _get_event(event_id)
    with store.db() as c:
        rows = c.execute(
            "SELECT * FROM photos WHERE event_id=? ORDER BY id DESC LIMIT ?",
            (event_id, min(limit, 2000)),
        ).fetchall()
    focus = _focus_points([r["id"] for r in rows])
    return [{**_photo_json(r), **focus[r["id"]]} for r in rows]


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
# Mesmo intervalo dos sliders da UI. Abaixo dele os "matches" trariam
# desconhecidos (threshold negativo = todos os rostos do evento).
THRESHOLD_MIN, THRESHOLD_MAX = 0.15, 0.80


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
    threshold = min(max(threshold, THRESHOLD_MIN), THRESHOLD_MAX)
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

    # Calibração desligada no backoffice: nada de top 30 (rostos de OUTRAS
    # pessoas abaixo do corte) nem tempos. Nem calcula.
    calibration = features.is_enabled("calibration")

    t0 = time.perf_counter()
    hits = store.search_threshold(event_id, emb, threshold)  # tudo acima do corte
    top = store.search(event_id, emb, DEBUG_TOP_K) if calibration else []  # top-30, com ou sem corte
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

    out = {
        "query_id": query_id,
        "threshold": threshold,
        "selfie": q["info"],
        "total_photos": total_photos,
        "indexed_faces": store.index_size(event_id),
        "matches": matches,
    }
    if calibration:
        out["timings_ms"] = {k: round(v, 1) for k, v in timings.items()}
        out["timings_from_cache"] = from_cache
        out["debug_top"] = [{**_face_out(fid, s, meta), "above": s > threshold} for fid, s in top]
    return out


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


@app.get("/api/photos/{photo_id}/medium")
async def photo_medium(photo_id: int):
    """1600px: nítido na capa e no visualizador, sem baixar o original de 5MB+.
    Gerado na primeira vez que alguém pede e guardado (nome = hash da foto)."""
    p = _photo(photo_id)
    # original já pequena (ex.: foto de celular redimensionada): recomprimir só
    # aumentaria o arquivo, então entrega a própria original
    if max(p["width"] or 0, p["height"] or 0) <= MEDIUM_SIDE:
        return FileResponse(p["path"], headers={"Cache-Control": "max-age=86400"})
    path = MEDIUM_DIR / f"{p['sha256']}.jpg"
    if not path.exists():
        def build():
            img = detector.load_image(Path(p["path"]).read_bytes())
            data = detector.make_thumbnail(img, MEDIUM_SIDE, 85)
            tmp = path.with_name(f"{path.stem}.{uuid.uuid4().hex}.tmp")
            tmp.write_bytes(data)
            tmp.replace(path)   # troca atômica: dois pedidos ao mesmo tempo não corrompem o arquivo
        await asyncio.to_thread(build)
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "max-age=86400"})


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


# --------------------------------------------------------- backoffice -----
#
# Flags globais (features.py) e a sessão do admin (admin_auth.py). Sem
# ADMIN_PASSWORD o backoffice não existe: /api/admin/* responde 404 e as
# flags ficam no padrão.


@app.get("/api/features")
def get_features():
    """Público: o frontend decide o que mostrar (a API bloqueia por conta própria)."""
    return features.all_flags()


def require_admin(request: Request):
    pw = admin_auth.password()
    if not pw:
        raise HTTPException(404, "Backoffice desativado.")
    if not admin_auth.verify(request.cookies.get(admin_auth.COOKIE), pw):
        raise HTTPException(401, "Entre no backoffice.")


def _is_https(request: Request) -> bool:
    # Atrás do Caddy o uvicorn recebe HTTP; o esquema original vem no header.
    return request.headers.get("x-forwarded-proto", request.url.scheme) == "https"


class LoginIn(BaseModel):
    password: str


@app.post("/api/admin/login", status_code=204)
async def admin_login(body: LoginIn, request: Request, response: Response):
    pw = admin_auth.password()
    if not pw:
        raise HTTPException(404, "Backoffice desativado.")
    if not admin_auth.check_password(body.password, pw):
        await asyncio.sleep(admin_auth.FAIL_DELAY)
        raise HTTPException(401, "Senha incorreta.")
    token = admin_auth.sign(int(time.time()) + admin_auth.TTL, pw)
    response.set_cookie(admin_auth.COOKIE, token, max_age=admin_auth.TTL, path="/",
                        httponly=True, samesite="strict", secure=_is_https(request))


@app.post("/api/admin/logout", status_code=204)
def admin_logout(response: Response):
    response.delete_cookie(admin_auth.COOKIE, path="/", httponly=True, samesite="strict")


@app.get("/api/admin/session")
def admin_session(request: Request):
    pw = admin_auth.password()
    return {"enabled": bool(pw),
            "logged_in": admin_auth.verify(request.cookies.get(admin_auth.COOKIE), pw)}


@app.get("/api/admin/features", dependencies=[Depends(require_admin)])
def admin_features():
    return features.describe()


class FeatureIn(BaseModel):
    enabled: StrictBool


@app.put("/api/admin/features/{key}", dependencies=[Depends(require_admin)])
def admin_set_feature(key: str, body: FeatureIn):
    try:
        features.set_enabled(key, body.enabled)
    except KeyError:
        raise HTTPException(404, "Funcionalidade desconhecida.")
    return next(f for f in features.describe() if f["key"] == key)


# Frontend: montado por último para não "engolir" as rotas /api.
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("api:app", host="127.0.0.1", port=8000)
