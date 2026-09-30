from pydantic import BaseModel


class FaceHit(BaseModel):
    face_id: int
    photo_id: int
    score: float
    bbox: list[float]  # x1, y1, x2, y2 em px da foto original
    width: int | None
    height: int | None
    filename: str


class DebugHit(FaceHit):
    above: bool  # acima do corte


class SelfieInfo(BaseModel):
    bbox: list[float]
    det_score: float
    n_faces: int
    all_bboxes: list[list[float]]
    width: int
    height: int
    warning: str | None


class SearchOut(BaseModel):
    """Campos opcionais só aparecem quando fazem sentido (a rota usa
    response_model_exclude_unset): `selfie` na busca com selfie; tempos e
    top 30 só com a Calibração ligada."""

    query_token: str
    threshold: float
    total_photos: int
    indexed_faces: int
    matches: list[FaceHit]
    selfie: SelfieInfo | None = None
    timings_ms: dict[str, float] | None = None
    timings_from_cache: bool | None = None
    debug_top: list[DebugHit] | None = None
