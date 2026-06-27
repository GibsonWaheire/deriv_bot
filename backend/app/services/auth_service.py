import httpx
import jwt
from datetime import datetime, timedelta, timezone
from app.core.config import settings

DERIV_TOKEN_URL = "https://auth.deriv.com/oauth2/token"
DERIV_REST_BASE = "https://api.derivws.com"


async def exchange_code_for_token(code: str, code_verifier: str) -> str:
    """Exchange OAuth2 authorization code for Deriv access token."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            DERIV_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "client_id": settings.deriv_client_id,
                "code": code,
                "code_verifier": code_verifier,
                "redirect_uri": settings.deriv_redirect_uri,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=10,
        )
        if resp.status_code != 200:
            raise ValueError(f"Token exchange failed: {resp.text}")
        return resp.json()["access_token"]


async def get_deriv_accounts(access_token: str) -> list[dict]:
    """Fetch all Options trading accounts for this user."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{DERIV_REST_BASE}/trading/v1/options/accounts",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Deriv-App-ID": settings.deriv_app_id,
            },
            timeout=10,
        )
        if resp.status_code != 200:
            raise ValueError(f"Account fetch failed: {resp.text}")
        return resp.json().get("data", [])


async def get_otp_ws_url(account_id: str, access_token: str) -> str:
    """Get a one-time authenticated WebSocket URL for this account."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{DERIV_REST_BASE}/trading/v1/options/accounts/{account_id}/otp",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Deriv-App-ID": settings.deriv_app_id,
            },
            timeout=10,
        )
        if resp.status_code != 200:
            raise ValueError(f"OTP fetch failed: {resp.text}")
        return resp.json()["data"]["url"]


async def do_full_auth(code: str, code_verifier: str) -> dict:
    """
    Full auth flow:
    code + verifier → access_token → accounts → OTP WS URL → user info dict
    """
    access_token = await exchange_code_for_token(code, code_verifier)
    accounts = await get_deriv_accounts(access_token)

    if not accounts:
        raise ValueError("No Deriv accounts found for this user")

    # Prefer real account; fall back to demo
    account = next((a for a in accounts if a.get("account_type") == "real"), accounts[0])
    account_id = account["account_id"]

    otp_ws_url = await get_otp_ws_url(account_id, access_token)

    return {
        "deriv_account_id": account_id,
        "email": account.get("email", ""),
        "currency": account.get("currency", "USD"),
        "balance": account.get("balance", 0),
        "account_type": account.get("account_type", "demo"),
        "_otp_ws_url": otp_ws_url,       # stored in Redis, not in JWT
        "_access_token": access_token,   # stored in Redis, not in JWT
    }


def create_jwt(account_info: dict) -> str:
    """Create our JWT — only public fields, no tokens."""
    public = {k: v for k, v in account_info.items() if not k.startswith("_")}
    public["exp"] = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    return jwt.encode(public, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_jwt(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError:
        return None
