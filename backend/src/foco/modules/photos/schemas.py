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
