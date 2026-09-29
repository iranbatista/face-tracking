"""
service.py — "quais fotos deste evento têm o rosto desta selfie?"

O THRESHOLD é o corte de similaridade (cosseno) acima do qual dizemos
"é a mesma pessoa". Ele é a única decisão "humana" do sistema:
  - mais alto => menos fotos erradas (falsos positivos), mas perde fotos
    suas com ângulo/luz ruins (falsos negativos);
  - mais baixo => acha mais fotos suas, mas começa a trazer desconhecidos.

Embeddings têm norma 1, então o `<#>` do pgvector (produto interno com sinal
trocado) é -cosseno: "score > corte" vira "embedding <#> q < -corte". A busca
é exata, rosto a rosto dentro do evento (ver a migração 0001).
"""

import math
import time

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from foco.core.errors import Gone, Invalid, Unprocessable
from foco.modules.events import service as events
from foco.modules.photos.models import Face, Photo
from foco.modules.search import token
from foco.vision.detector import Detector
from foco.vision.images import load_image

DEBUG_TOP_K = 30
# Mesmo intervalo dos sliders da UI. Abaixo dele os "matches" trariam
# desconhecidos (threshold negativo = todos os rostos do evento).
THRESHOLD_MIN, THRESHOLD_MAX = 0.15, 0.80


def _ms(t0: float) -> float:
    return (time.perf_counter() - t0) * 1000


def _selfie(detector: Detector, data: bytes) -> tuple[np.ndarray, dict, dict]:
    t0 = time.perf_counter()
    try:
        img = load_image(data)
    except Exception:
        raise Unprocessable("Não consegui abrir esta imagem.") from None
    timings = {"decode": _ms(t0)}
    faces, t = detector.analyze(img)
    timings.update(t)
    if not faces:
        raise Unprocessable("Nenhum rosto encontrado na selfie. Tente com mais luz e o rosto de frente.")
    # Várias pessoas na selfie? Usamos o maior rosto (provavelmente quem segura a câmera).
    faces.sort(key=lambda f: (f["bbox"][2] - f["bbox"][0]) * (f["bbox"][3] - f["bbox"][1]), reverse=True)
    main = faces[0]
    info = {
        "bbox": main["bbox"],
        "det_score": main["det_score"],
        "n_faces": len(faces),
        "all_bboxes": [f["bbox"] for f in faces],
        "width": img.width,
        "height": img.height,
        "warning": f"{len(faces)} rostos na selfie — usando o maior." if len(faces) > 1 else None,
    }
    return main["embedding"], info, timings


def _query(
    session: Session,
    event_id: int,
    emb: np.ndarray,
    *,
    threshold: float | None = None,
    limit: int | None = None,
) -> list[dict]:
    """Rostos do evento em ordem de semelhança: acima do corte, ou os `limit` primeiros."""
    dist = Face.embedding.max_inner_product(emb)  # = -cosseno
    q = (
        select(
            Face.id,
            Face.photo_id,
            Face.x1,
            Face.y1,
            Face.x2,
            Face.y2,
            (-dist).label("score"),
            Photo.filename,
            Photo.width,
            Photo.height,
        )
        .join(Photo, Photo.id == Face.photo_id)
        .where(Face.event_id == event_id, Photo.status == "done")
    )
    if threshold is not None:
        q = q.where(dist < -threshold)
    q = q.order_by(dist, Face.id)
    if limit is not None:
        q = q.limit(limit)
    return [
        {
            "face_id": r.id,
            "photo_id": r.photo_id,
            "score": round(float(r.score), 4),
            "_raw": float(r.score),
            "bbox": [r.x1, r.y1, r.x2, r.y2],
            "width": r.width,
            "height": r.height,
            "filename": r.filename,
        }
        for r in session.execute(q)
    ]


def search(
    session: Session,
    detector: Detector,
    secret_key: str,
    *,
    event_id: int,
    threshold: float,
    selfie: bytes | None,
    query_token: str | None,
    calibration: bool,
) -> dict:
    if not math.isfinite(threshold):
        raise Invalid("threshold inválido")
    threshold = min(max(threshold, THRESHOLD_MIN), THRESHOLD_MAX)
    events.get_or_404(session, event_id)
    out: dict = {}

    if selfie is not None:
        emb, out["selfie"], timings = _selfie(detector, selfie)
        query_token = token.issue(emb, secret_key)
        # Busca com o mesmo embedding (float16) que o token carrega: 1ª busca e sliders dão o mesmo score.
        emb = token.read(query_token, secret_key)
    elif query_token:
        emb = token.read(query_token, secret_key)
        if emb is None:
            raise Gone("Busca expirada. Envie a selfie de novo.")
        timings = {}  # a rede não rodou: o front reaproveita os tempos da 1ª busca
    else:
        raise Invalid("envie 'selfie' ou um 'query_token' válido")

    t0 = time.perf_counter()
    hits = _query(session, event_id, emb, threshold=threshold)
    # Calibração desligada: nada de top 30 (rostos de OUTRAS pessoas abaixo do corte). Nem calcula.
    top = _query(session, event_id, emb, limit=DEBUG_TOP_K) if calibration else []
    timings["search"] = _ms(t0)

    # Uma foto pode ter vários rostos parecidos com a selfie (ex.: gêmeos, ou
    # um reflexo). A galeria quer FOTOS: fica o melhor rosto de cada foto.
    # hits já vem ordenado por score, o 1º de cada foto vence.
    matches, seen = [], set()
    for h in hits:
        if h["photo_id"] not in seen:
            seen.add(h["photo_id"])
            matches.append(h)

    out.update(
        query_token=query_token,
        threshold=threshold,
        total_photos=session.scalar(
            select(func.count()).select_from(Photo).where(Photo.event_id == event_id, Photo.status == "done")
        ),
        indexed_faces=session.scalar(
            select(func.count())
            .select_from(Face)
            .join(Photo, Photo.id == Face.photo_id)
            .where(Face.event_id == event_id, Photo.status == "done")
        ),
        matches=matches,
    )
    if calibration:
        out["timings_ms"] = {k: round(v, 1) for k, v in timings.items()}
        out["timings_from_cache"] = selfie is None
        out["debug_top"] = [{**f, "above": f["_raw"] > threshold} for f in top]
    for f in (*matches, *(out.get("debug_top") or ())):
        f.pop("_raw", None)
    return out
