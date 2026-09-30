from pydantic import BaseModel, ConfigDict


class PhotoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    filename: str
    status: str
    n_faces: int
    proc_ms: float | None
    error: str | None
    width: int | None
    height: int | None


class SheetPhoto(PhotoOut):
    fx: float  # ponto de foco (object-position)
    fy: float


class UploadResult(BaseModel):
    """Um item da resposta do upload: a foto salva (com `duplicate`) ou um erro
    ({filename, status: "error", error}). A rota usa response_model_exclude_unset."""

    id: int | None = None
    filename: str | None = None
    status: str
    n_faces: int | None = None
    proc_ms: float | None = None
    error: str | None = None
    width: int | None = None
    height: int | None = None
    duplicate: bool | None = None


class StatsOut(BaseModel):
    events: int
    photos: int
    done: int
    pending: int
    errors: int
    faces: int
    avg_ms_per_photo: float | None


class ProgressOut(BaseModel):
    """Payload de cada mensagem do SSE de progresso (não aparece no OpenAPI do
    SSE, mas o front importa o tipo deste schema)."""

    items: list[PhotoOut]
    done: bool
    queue: int
