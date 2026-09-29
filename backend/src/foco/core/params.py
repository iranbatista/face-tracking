from typing import Annotated

from fastapi import Path

MAX_BIGINT = 2**63 - 1

# Id na URL: dentro do bigint do Postgres, senão o banco estoura (500) em vez de 422.
BigId = Annotated[int, Path(ge=1, le=MAX_BIGINT)]
