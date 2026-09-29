"""
token.py — o embedding da selfie volta para o navegador, assinado.

Mover o slider refaz a busca SEM rodar a rede de novo (~1 ms em vez de
~300 ms): o navegador devolve o token e o servidor só confere a assinatura.
Nada da selfie fica no servidor entre requests (nem disco, nem banco, nem
memória), e qualquer réplica da API atende.

float16: 1 KB em vez de 2 KB; o score muda só na 4ª casa decimal.
"""

import numpy as np

from foco.core import signing
from foco.modules.photos.models import EMBEDDING_DIM

PURPOSE = "search"
TTL = 3600


def issue(embedding: np.ndarray, key: str, now: float | None = None) -> str:
    return signing.sign(embedding.astype(np.float16).tobytes(), purpose=PURPOSE, key=key, ttl=TTL, now=now)


def read(tok: str | None, key: str, now: float | None = None) -> np.ndarray | None:
    """Embedding float32 de norma 1, ou None se o token é inválido ou expirou."""
    payload = signing.verify(tok, purpose=PURPOSE, key=key, now=now)
    if payload is None or len(payload) != EMBEDDING_DIM * 2:
        return None
    emb = np.frombuffer(payload, dtype=np.float16).astype(np.float32)
    norm = np.linalg.norm(emb)
    return emb / norm if norm else None
