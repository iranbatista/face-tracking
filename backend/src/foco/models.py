"""Importa todos os modelos para registrá-los no Base.metadata (Alembic e testes).

Módulo novo com tabelas = uma linha nova aqui.
"""

from foco.modules.events.models import Event  # noqa: F401
from foco.modules.features.models import FeatureFlag  # noqa: F401
from foco.modules.photos.models import Face, Photo  # noqa: F401
