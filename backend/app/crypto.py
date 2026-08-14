from __future__ import annotations

import base64
import hashlib
import hmac
import json

from cryptography.fernet import Fernet, InvalidToken

from .config import get_settings

_SECRET_MARKER = "enc::"
# Fields inside auth_config that must never leave the backend in cleartext.
SECRET_FIELDS = {"token", "password", "clientSecret", "client_secret", "apiKey", "api_key"}


def _fernet() -> Fernet:
    key = get_settings().secret_key.encode()
    # Accept either a valid Fernet key or an arbitrary passphrase.
    try:
        return Fernet(key)
    except (ValueError, TypeError):
        derived = base64.urlsafe_b64encode(hashlib.sha256(key).digest())
        return Fernet(derived)


def encrypt(value: str) -> str:
    return _SECRET_MARKER + _fernet().encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    if not value.startswith(_SECRET_MARKER):
        return value
    token = value[len(_SECRET_MARKER):]
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        return ""


def is_encrypted(value: object) -> bool:
    return isinstance(value, str) and value.startswith(_SECRET_MARKER)


def encrypt_auth_config(config: dict) -> dict:
    """Encrypt secret fields in-place-safe. Already-encrypted values are left alone."""
    out = dict(config or {})
    for k, v in out.items():
        if k in SECRET_FIELDS and isinstance(v, str) and v and not is_encrypted(v):
            out[k] = encrypt(v)
    return out


def decrypt_auth_config(config: dict) -> dict:
    out = dict(config or {})
    for k, v in out.items():
        if k in SECRET_FIELDS and is_encrypted(v):
            out[k] = decrypt(v)
    return out


def redact_auth_config(config: dict) -> dict:
    """Never send secrets to the frontend — replace with a boolean marker."""
    out = dict(config or {})
    for k in list(out.keys()):
        if k in SECRET_FIELDS and out.get(k):
            out[k] = "__set__"
    return out


def sign_payload(payload: dict) -> str:
    secret = get_settings().webhook_hmac_secret.encode()
    body = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    return "sha256=" + hmac.new(secret, body, hashlib.sha256).hexdigest()


def sign_flow_token(submission_id: str, form_id: str) -> str:
    """Пропуск на следующий шаг многошаговой формы.

    Второй шаг дописывает данные в УЖЕ существующее заполнение, а submit —
    публичный эндпоинт. Без подписи чужой submissionId (48 бит, перебираемо)
    позволил бы дописать что угодно в чужую заявку, поэтому идентификатор
    возвращается только вместе с этим токеном и принимается только с ним.
    """
    secret = get_settings().webhook_hmac_secret.encode()
    body = f"{form_id}:{submission_id}".encode()
    return hmac.new(secret, body, hashlib.sha256).hexdigest()


def verify_flow_token(token: str | None, submission_id: str, form_id: str) -> bool:
    if not token:
        return False
    return hmac.compare_digest(token, sign_flow_token(submission_id, form_id))
