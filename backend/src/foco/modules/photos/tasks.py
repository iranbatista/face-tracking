"""
tasks.py — tarefas do worker. Só casca: montam Session/Storage/Detector e
chamam indexing.py, onde está a lógica (e os testes).
"""

from procrastinate import JobContext, RetryStrategy
from procrastinate.exceptions import AlreadyEnqueued

from foco.core.config import get_settings
from foco.core.db import get_sessionmaker
from foco.core.storage import LocalStorage
from foco.modules.photos import indexing
from foco.vision.detector import get_detector
from foco.worker import app

MAX_ATTEMPTS = 3


def _storage() -> LocalStorage:
    return LocalStorage(get_settings().data_dir)


@app.task(
    name="index_photo",
    pass_context=True,
    retry=RetryStrategy(max_attempts=MAX_ATTEMPTS, exponential_wait=5),
)
def index_photo(context: JobContext, photo_id: int) -> None:
    with get_sessionmaker()() as session:
        indexing.index_photo(
            session, _storage(), get_detector(), photo_id, final_attempt=context.job.attempts >= MAX_ATTEMPTS
        )


def defer_index(photo_id: int) -> None:
    """Enfileira a indexação. Se a foto já está esperando na fila, fica como está."""
    try:
        index_photo.configure(queueing_lock=f"photo:{photo_id}").defer(photo_id=photo_id)
    except AlreadyEnqueued:
        pass
