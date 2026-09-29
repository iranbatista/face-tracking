"""Chaves dos arquivos no Storage. Miniatura e versão média são nomeadas pelo
hash do conteúdo: a mesma foto em dois eventos compartilha os arquivos."""

from pathlib import Path

EXTS = (".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff")


def original_key(event_id: int, sha256: str, filename: str | None) -> str:
    ext = Path(filename or "").suffix.lower()
    return f"photos/{event_id}/{sha256}{ext if ext in EXTS else '.jpg'}"


def thumb_key(sha256: str) -> str:
    return f"thumbs/{sha256}.jpg"


def medium_key(sha256: str) -> str:
    return f"medium/{sha256}.jpg"
