"""
auth.py — sessão do backoffice: uma senha só (ADMIN_PASSWORD), um cookie assinado.

O cookie é um token de core/signing.py sem payload. A finalidade assinada
inclui o hash da senha, e a chave é a SECRET_KEY. Consequências:
  - ninguém forja ou estende um cookie sem a SECRET_KEY;
  - trocar a senha OU a SECRET_KEY (e reiniciar) derruba todas as sessões;
  - um cookie roubado não serve para testar senhas offline (precisaria da SECRET_KEY).

ADMIN_PASSWORD vazia = backoffice desligado (a API responde 404).
"""

import hashlib
import hmac

from foco.core import signing
from foco.core.config import Settings

COOKIE = "foco_admin"
TTL = 12 * 3600  # validade da sessão, em segundos
FAIL_DELAY = 1.0  # espera após senha errada: freia força bruta (testes zeram)


def _b(s: str) -> bytes:
    # surrogatepass: surrogates soltos (JSON, ambiente) não estouram o encode
    return s.encode("utf-8", "surrogatepass")


def _purpose(pw: str) -> str:
    return "admin:" + hashlib.sha256(_b(pw)).hexdigest()


def check_password(given: str, pw: str) -> bool:
    # compare_digest: tempo constante, não revela quantos caracteres acertou
    return bool(pw) and hmac.compare_digest(_b(given), _b(pw))


def issue(settings: Settings, now: float | None = None) -> str:
    return signing.sign(
        b"", purpose=_purpose(settings.admin_password), key=settings.secret_key, ttl=TTL, now=now
    )


def verify(token: str | None, settings: Settings, now: float | None = None) -> bool:
    if not settings.admin_password:
        return False
    payload = signing.verify(
        token, purpose=_purpose(settings.admin_password), key=settings.secret_key, now=now
    )
    return payload is not None
