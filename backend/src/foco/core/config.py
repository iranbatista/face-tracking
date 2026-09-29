"""
config.py — toda a configuração do app, lida do ambiente (e do .env).

Nenhum outro arquivo lê os.environ: quem precisa de um valor recebe as
Settings (Depends(get_settings) nas rotas, get_settings() no worker).
"""

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/src/foco/core/config.py -> raiz do repositório (em dev).
# No Docker, DATA_DIR e STATIC_DIR vêm do ambiente.
REPO_ROOT = Path(__file__).resolve().parents[4]


class Settings(BaseSettings):
    # ../.env = raiz do repo (quando o processo roda de backend/). O .env de
    # backend/, se existir, sobrescreve. Variáveis de ambiente vencem os dois.
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    database_url: str  # postgresql+psycopg://...
    secret_key: str = Field(min_length=32)  # token da selfie e cookie do admin
    data_dir: Path = REPO_ROOT / "data"  # raiz do LocalStorage
    static_dir: Path = REPO_ROOT / "static"  # frontend
    admin_password: str = ""  # vazia = backoffice desligado
    insightface_root: str = "~/.insightface"  # onde fica o buffalo_l

    @property
    def pg_conninfo(self) -> str:
        """A mesma URL sem o driver do SQLAlchemy, para o psycopg puro (Procrastinate)."""
        return self.database_url.replace("postgresql+psycopg://", "postgresql://", 1)


@lru_cache
def get_settings() -> Settings:
    return Settings()
