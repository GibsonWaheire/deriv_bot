from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from app.services.auth_service import verify_deriv_token, create_jwt, decode_jwt

router = APIRouter()
bearer = HTTPBearer()


class CallbackRequest(BaseModel):
    token: str
    account: str


def get_current_user(creds: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    payload = decode_jwt(creds.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return payload


@router.post("/callback")
async def callback(body: CallbackRequest):
    """Verify Deriv token, return our JWT with account info embedded."""
    try:
        account_info = await verify_deriv_token(body.token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except Exception:
        raise HTTPException(status_code=502, detail="Could not reach Deriv API")

    access_token = create_jwt(account_info)
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": account_info,
    }


@router.get("/me")
def me(user: dict = Depends(get_current_user)):
    """Return current user from JWT — no DB needed."""
    return user


@router.post("/logout")
def logout():
    """Client just discards the JWT. Nothing to invalidate server-side."""
    return {"message": "Logged out"}
