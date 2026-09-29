"""schema do Procrastinate (fila de tarefas)

Aplica uma cópia congelada do schema.sql do Procrastinate 3.10.0
(migrations/sql/procrastinate_3.10.0.sql), não o da versão instalada: assim um
banco novo sempre passa pelas mesmas revisões. Ao atualizar o Procrastinate,
crie uma revisão nova aplicando os arquivos de procrastinate/sql/migrations/
entre a versão antiga e a nova.

Revision ID: 0002
Revises: 0001
"""

from pathlib import Path

from alembic import op

revision = "0002"
down_revision = "0001"
SCHEMA_SQL = Path(__file__).resolve().parents[1] / "sql" / "procrastinate_3.10.0.sql"

branch_labels = None
depends_on = None


def upgrade() -> None:
    # psycopg puro (driver_connection): o script tem várias instruções e funções
    # plpgsql; pelo SQLAlchemy ele passaria pelo parser de parâmetros.
    op.get_bind().connection.driver_connection.execute(SCHEMA_SQL.read_text(encoding="utf-8"))


def downgrade() -> None:
    raise NotImplementedError("remover o schema do Procrastinate apaga a fila: faça à mão se precisar")
