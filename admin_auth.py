"""
admin_auth.py — sessão do backoffice: uma senha só, um cookie assinado.

Sem banco de sessões e sem dependência nova. O cookie é
"<expira_unix>.<hmac>", e o HMAC (SHA-256) usa uma chave derivada de
ADMIN_PASSWORD. Consequências:
  - ninguém forja ou estende um cookie sem saber a senha;
  - trocar a senha (e reiniciar o container) derruba todas as sessões.

ADMIN_PASSWORD vazia = backoffice desligado (a API responde 404).
"""

import hashlib
import hmac
import os
import re
import time

COOKIE = "foco_admin"
TTL = 12 * 3600      # validade da sessão, em segundos
FAIL_DELAY = 1.0     # espera após senha errada: freia força bruta (testes zeram)


def password() -> str:
    """Lida a cada chamada (não no import) para os testes poderem trocá-la."""
    return os.environ.get("ADMIN_PASSWORD", "")


def _b(s: str) -> bytes:
    # surrogatepass: surrogates soltos (JSON, os.environ) não estouram o encode
    return s.encode("utf-8", "surrogatepass")


def check_password(given: str, pw: str) -> bool:
    # compare_digest: tempo constante, não revela quantos caracteres acertou
    return bool(pw) and hmac.compare_digest(_b(given), _b(pw))


def _key(pw: str) -> bytes:
    # Assume ADMIN_PASSWORD longa e aleatória: sha256 é rápido, senha fraca
    # poderia sofrer força bruta offline a partir de um cookie roubado.
    return hashlib.sha256(b"foco-admin:" + _b(pw)).digest()


def sign(expires: int, pw: str) -> str:
    mac = hmac.new(_key(pw), str(expires).encode(), hashlib.sha256).hexdigest()
    return f"{expires}.{mac}"


def verify(token: str | None, pw: str, now: float | None = None) -> bool:
    if not token or not pw:
        return False
    if not re.fullmatch(r"[0-9]{1,12}\.[0-9a-f]{64}", token):
        return False
    exp = token.partition(".")[0]
    if not hmac.compare_digest(_b(token), _b(sign(int(exp), pw))):
        return False
    return int(exp) > (time.time() if now is None else now)
