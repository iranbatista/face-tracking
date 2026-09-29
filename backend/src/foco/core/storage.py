"""
storage.py — onde ficam os arquivos (originais, miniaturas, versões médias).

O banco guarda só CHAVES relativas ("photos/4/<sha>.jpg"), nunca caminhos
absolutos: trocar o LocalStorage por um S3 um dia não exige migrar dados.
"""

import shutil
import uuid
from pathlib import Path
from typing import Protocol

from fastapi import Depends

from foco.core.config import Settings, get_settings


class Storage(Protocol):
    def save(self, key: str, data: bytes) -> None: ...
    def read(self, key: str) -> bytes: ...
    def exists(self, key: str) -> bool: ...
    def delete(self, key: str) -> None: ...
    def delete_dir(self, prefix: str) -> None: ...
    def path(self, key: str) -> Path: ...  # para FileResponse (só faz sentido no disco local)


class LocalStorage:
    def __init__(self, root: Path):
        self.root = Path(root).resolve()

    def path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if not p.is_relative_to(self.root):
            raise ValueError(f"chave fora do storage: {key!r}")
        return p

    def save(self, key: str, data: bytes) -> None:
        p = self.path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        # troca atômica: dois pedidos ao mesmo tempo nunca deixam arquivo pela metade
        tmp = p.with_name(f"{p.name}.{uuid.uuid4().hex}.tmp")
        tmp.write_bytes(data)
        tmp.replace(p)

    def read(self, key: str) -> bytes:
        return self.path(key).read_bytes()

    def exists(self, key: str) -> bool:
        return self.path(key).exists()

    def delete(self, key: str) -> None:
        self.path(key).unlink(missing_ok=True)

    def delete_dir(self, prefix: str) -> None:
        shutil.rmtree(self.path(prefix), ignore_errors=True)


def get_storage(settings: Settings = Depends(get_settings)) -> Storage:
    return LocalStorage(settings.data_dir)
