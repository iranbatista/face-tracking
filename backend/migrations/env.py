"""Alembic: a URL vem das Settings (DATABASE_URL), não do alembic.ini."""

from alembic import context
from sqlalchemy import create_engine

import foco.models  # noqa: F401  registra todos os modelos
from foco.core.config import get_settings
from foco.core.db import Base


def include_name(name, type_, parent_names):
    # As tabelas do Procrastinate vêm do schema dele (0002), não dos nossos
    # modelos: sem isto o autogenerate proporia apagá-las.
    return not (type_ == "table" and name and name.startswith("procrastinate_"))


def run_migrations_online() -> None:
    engine = create_engine(get_settings().database_url)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=Base.metadata, include_name=include_name)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


run_migrations_online()
