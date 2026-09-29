"""
signing.py — tokens assinados (HMAC-SHA256) com prazo de validade, sem estado.

Formato: base64url(expira_unix 8 bytes || payload) + "." + base64url(hmac)

`purpose` entra no HMAC: um token emitido para uma finalidade (ex.: busca por
selfie) não vale em outra (ex.: sessão do admin), mesmo com a mesma chave.
"""

import base64
import hashlib
import hmac
import time

MAX_TOKEN_LEN = 4096  # o token da selfie tem ~1,4 KB


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _mac(key: str, purpose: str, body: bytes) -> bytes:
    return hmac.new(key.encode(), purpose.encode() + b"\0" + body, hashlib.sha256).digest()


def sign(payload: bytes, *, purpose: str, key: str, ttl: int, now: float | None = None) -> str:
    expires = int(time.time() if now is None else now) + ttl
    body = expires.to_bytes(8, "big") + payload
    return f"{_b64(body)}.{_b64(_mac(key, purpose, body))}"


def verify(token: str | None, *, purpose: str, key: str, now: float | None = None) -> bytes | None:
    """Payload se o token é autêntico e está no prazo. Qualquer outra coisa: None."""
    if not token or len(token) > MAX_TOKEN_LEN or token.count(".") != 1:
        return None
    body_b64, mac_b64 = token.split(".")
    try:
        body, mac = _unb64(body_b64), _unb64(mac_b64)
    except ValueError:  # base64 inválido ou caractere não-ASCII
        return None
    # compare_digest: tempo constante, não revela quantos bytes acertou
    if len(body) < 8 or not hmac.compare_digest(mac, _mac(key, purpose, body)):
        return None
    if int.from_bytes(body[:8], "big") <= (time.time() if now is None else now):
        return None
    return body[8:]
