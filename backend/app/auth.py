"""Authentication: PBKDF2 password hashing + HS256 JWT (stdlib only).

Kept dependency-free on purpose — no bcrypt/pyjwt — so the service builds
anywhere. Tokens are short-lived bearer JWTs carrying the account id.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time

from fastapi import Depends, Header, HTTPException

from .config import get_settings

_PBKDF2_ROUNDS = 200_000
TOKEN_TTL = 7 * 24 * 3600  # 7 days


# ---- Password hashing -------------------------------------------------------
def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _PBKDF2_ROUNDS)
    return f"pbkdf2${_PBKDF2_ROUNDS}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, rounds, salt_b64, hash_b64 = stored.split("$")
        if algo != "pbkdf2":
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(hash_b64)
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, int(rounds))
        return hmac.compare_digest(dk, expected)
    except Exception:
        return False


# ---- JWT (HS256) ------------------------------------------------------------
def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _secret() -> bytes:
    return get_settings().webhook_hmac_secret.encode()


def create_token(*, user_id: str, account_id: str, role: str) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    now = int(time.time())
    payload = {"sub": user_id, "acc": account_id, "role": role, "iat": now, "exp": now + TOKEN_TTL}
    seg = _b64url(json.dumps(header).encode()) + "." + _b64url(json.dumps(payload).encode())
    sig = hmac.new(_secret(), seg.encode(), hashlib.sha256).digest()
    return seg + "." + _b64url(sig)


def decode_token(token: str) -> dict:
    try:
        seg, sig_b64 = token.rsplit(".", 1)
        expected = hmac.new(_secret(), seg.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(_b64url_decode(sig_b64), expected):
            raise ValueError("bad signature")
        payload = json.loads(_b64url_decode(seg.split(".", 1)[1]))
        if payload.get("exp", 0) < time.time():
            raise ValueError("expired")
        return payload
    except Exception as exc:
        raise HTTPException(401, "invalid or expired token") from exc


# ---- FastAPI dependencies ---------------------------------------------------
async def current_claims(authorization: str = Header(default="")) -> dict:
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "missing bearer token")
    return decode_token(authorization.split(" ", 1)[1].strip())


async def require_account(claims: dict = Depends(current_claims)) -> str:
    return claims["acc"]
