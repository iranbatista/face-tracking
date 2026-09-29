"""Capa do evento e ponto de foco das miniaturas (para object-position no front)."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from foco.modules.photos.models import Face, Photo

# Foto sem rosto detectado: mira no terço de cima, onde costumam estar as pessoas.
DEFAULT_FOCUS = {"fx": 0.5, "fy": 0.33}


def pick_cover(photos: list, n: int = 5) -> list[int]:
    """Fotos da capa em mosaico: até `n`, espalhadas do início ao fim do
    evento (fotos seguidas costumam ser quase iguais). A primeira vai no quadro
    grande, então preferimos uma horizontal para ela.

    `photos`: objetos com .id, .width, .height, em ordem de envio."""
    if len(photos) <= n:
        picks = list(photos)
    else:
        step = (len(photos) - 1) / (n - 1)
        picks = [photos[round(i * step)] for i in range(n)]
    wide = next((p for p in picks if (p.width or 0) >= (p.height or 0)), None)
    if wide:
        picks.remove(wide)
        picks.insert(0, wide)
    return [p.id for p in picks]


def focus_points(session: Session, photo_ids: list[int]) -> dict[int, dict]:
    """Ponto de foco de cada foto, em fração da largura/altura (0..1).

    1. Escolhe o rosto principal pela pontuação área x confiança do detector.
       Rosto cortado pela borda da foto vale só 30%: é um pedaço de alguém
       que estava fora do quadro, não o assunto da foto.
    2. Junta os rostos de pontuação parecida (>= 60%) que estão NA MESMA
       ALTURA do principal: a fileira de uma foto de grupo.
    3. O foco é o centro desses rostos, com peso pela área.

    Tirar a média de TODOS os rostos falhava: com duas pessoas em alturas
    diferentes, o centro caía entre elas, onde não há ninguém.
    """
    out = {pid: dict(DEFAULT_FOCUS) for pid in photo_ids}
    if not photo_ids:
        return out
    rows = session.execute(
        select(Face.photo_id, Face.x1, Face.y1, Face.x2, Face.y2, Face.det_score, Photo.width, Photo.height)
        .join(Photo, Photo.id == Face.photo_id)
        .where(Face.photo_id.in_(photo_ids))
    ).all()
    by_photo: dict[int, list] = {}
    for r in rows:
        by_photo.setdefault(r.photo_id, []).append(r)
    for pid, fs in by_photo.items():
        W, H = fs[0].width, fs[0].height
        if not (W and H):
            continue
        faces = []
        for r in fs:
            w, h = max(r.x2 - r.x1, 1), max(r.y2 - r.y1, 1)
            cut = r.x1 < -2 or r.y1 < -2 or r.x2 > W + 2 or r.y2 > H + 2
            score = w * h * (r.det_score or 1) * (0.3 if cut else 1)
            faces.append(
                {"score": score, "area": w * h, "h": h, "cx": (r.x1 + r.x2) / 2, "cy": (r.y1 + r.y2) / 2}
            )
        best = max(faces, key=lambda f: f["score"])
        row = [
            f
            for f in faces
            if f["score"] >= 0.6 * best["score"] and abs(f["cy"] - best["cy"]) <= 1.2 * best["h"]
        ]
        total = sum(f["area"] for f in row)
        fx = sum(f["area"] * f["cx"] for f in row) / total / W
        fy = sum(f["area"] * f["cy"] for f in row) / total / H
        out[pid] = {"fx": round(min(max(fx, 0), 1), 3), "fy": round(min(max(fy, 0), 1), 3)}
    return out
