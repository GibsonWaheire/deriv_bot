from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from app.core.config import settings
from app.services.auth_service import exchange_deriv_token, decode_jwt

router = APIRouter()
bearer = HTTPBearer()


class CallbackRequest(BaseModel):
    token: str
    account: str


@router.post("/callback")
async def callback(body: CallbackRequest):
    try:
        result = await exchange_deriv_token(body.token, body.account)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/me")
async def me(creds: HTTPAuthorizationCredentials = Depends(bearer)):
    payload = decode_jwt(creds.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    return payload


@router.post("/logout")
async def logout():
    return {"message": "Logged out"}
