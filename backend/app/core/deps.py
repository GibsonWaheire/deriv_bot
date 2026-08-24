from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.services.auth_service import decode_jwt
from app.core.config import settings

bearer = HTTPBearer()

_DEV_USER = {
    "deriv_account_id": "DEV_ACCOUNT",
    "email": "dev@local",
    "currency": "USD",
    "country": "",
    "balance": 0,
    "account_type": "demo",
}


def get_current_user(creds: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    """JWT dependency — inject into any protected route."""
    # Accept dev-token when no OAuth client is configured
    if creds.credentials == "dev-token" and not settings.deriv_client_id:
        return _DEV_USER
    payload = decode_jwt(creds.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return payload
