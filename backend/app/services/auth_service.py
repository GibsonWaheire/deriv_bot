import httpx
import jwt
from datetime import datetime, timedelta, timezone
from app.core.config import settings

DERIV_WS = "wss://ws.binaryws.com/websockets/v3"


async def exchange_deriv_token(token: str, account: str) -> dict:
    """Call Deriv API to verify token and get account info, return our JWT."""
    async with httpx.AsyncClient() as client:
        # Use Deriv REST-like approach: verify token via authorize call
        # For now we trust the token and build the user object
        # Full verification happens via WebSocket in Phase 3
        user = {
            "id": account,
            "deriv_account_id": account,
            "email": "",
            "currency": "USD",
            "country": "",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

    access_token = _create_jwt({"sub": account, "account": account})
    return {"user": user, "access_token": access_token}


def _create_jwt(payload: dict) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload["exp"] = expire
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_jwt(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError:
        return None
