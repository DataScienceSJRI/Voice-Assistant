import logging

import httpx
import jwt as pyjwt
from jwt.exceptions import InvalidTokenError
from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from config import SUPABASE_URL, SUPABASE_JWT_SECRET, ADMIN_EMAILS

logger = logging.getLogger(__name__)

security = HTTPBearer()

_jwks_cache: list = []


async def _get_jwks() -> list:
    global _jwks_cache
    if _jwks_cache:
        return _jwks_cache
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json")
        resp.raise_for_status()
        _jwks_cache = resp.json().get("keys", [])
        logger.info("JWKS loaded: %d key(s)", len(_jwks_cache))
    return _jwks_cache


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    token = credentials.credentials
    try:
        header = pyjwt.get_unverified_header(token)
        alg    = header.get("alg", "")
        logger.info("Token alg: %s", alg)

        if alg == "HS256":
            payload = pyjwt.decode(
                token,
                SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                audience="authenticated",
            )
        else:
            # RS256 or newer Supabase algorithms — validate via JWKS
            from jwt import PyJWK
            kid      = header.get("kid")
            keys     = await _get_jwks()
            key_data = next((k for k in keys if k.get("kid") == kid), keys[0] if keys else None)
            if not key_data:
                raise InvalidTokenError("No matching JWKS key found")
            signing_key = PyJWK(key_data).key
            payload = pyjwt.decode(
                token,
                signing_key,
                algorithms=[alg],
                audience="authenticated",
            )

        user_id = payload.get("sub")
        email   = payload.get("email", "")
        name    = (payload.get("user_metadata") or {}).get("full_name") or email
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token payload")
        return {"id": user_id, "email": email, "name": name, "is_admin": email in ADMIN_EMAILS}
    except InvalidTokenError as e:
        logger.warning("JWT validation failed: %s", e)
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin only")
    return user
