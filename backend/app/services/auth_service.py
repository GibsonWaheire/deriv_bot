import json
import jwt
import websockets
from datetime import datetime, timedelta, timezone
from app.core.config import settings

DERIV_WS_URL = "wss://ws.binaryws.com/websockets/v3"


async def verify_deriv_token(token: str) -> dict:
    """Connect to Deriv WS, authorize the token, return account info."""
    url = f"{DERIV_WS_URL}?app_id={settings.deriv_app_id}"
    async with websockets.connect(url) as ws:
        await ws.send(json.dumps({"authorize": token}))
        raw = await ws.recv()
        msg = json.loads(raw)
        if msg.get("error"):
            raise ValueError(msg["error"].get("message", "Deriv auth failed"))
        auth = msg.get("authorize", {})
        return {
            "deriv_account_id": auth.get("loginid", ""),
            "email": auth.get("email", ""),
            "currency": auth.get("currency", "USD"),
            "country": auth.get("country", ""),
            "balance": auth.get("balance", 0),
        }


def create_jwt(account_info: dict) -> str:
    payload = {
        **account_info,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_jwt(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError:
        return None
