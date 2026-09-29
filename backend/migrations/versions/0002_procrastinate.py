"""schema do Procrastinate (fila de tarefas)

Aplica o SQL que a própria lib fornece. Ao atualizar a versão do
Procrastinate, crie uma revisão nova aplicando os arquivos de
procrastinate/sql/migrations/ entre a versão antiga e a nova.

Revision ID: 0002
Revises: 0001
"""

from alembic import op
from procrastinate.schema import SchemaManager

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # psycopg puro (driver_connection): o script tem várias instruções e funções
    # plpgsql; pelo SQLAlchemy ele passaria pelo parser de parâmetros.
    op.get_bind().connection.driver_connection.execute(SchemaManager.get_schema())


def downgrade() -> None:
    raise NotImplementedError("remover o schema do Procrastinate apaga a fila: faça à mão se precisar")
