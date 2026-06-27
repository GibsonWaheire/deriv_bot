import json
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from app.core.deps import get_current_user
from app.core.redis_client import get_redis
from app.services.auth_service import do_full_auth, create_jwt, decode_jwt

router = APIRouter()


class CallbackRequest(BaseModel):
    code: str
    code_verifier: str


@router.post("/callback")
async def callback(body: CallbackRequest):
    """
    Receives OAuth2 PKCE code + verifier from frontend.
    Exchanges for Deriv access token → fetches accounts → gets OTP WS URL.
    Stores OTP URL in Redis. Returns our JWT (no sensitive tokens in JWT).
    """
    try:
        info = await do_full_auth(body.code, body.code_verifier)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Deriv API unreachable: {e}")

    # Store OTP WS URL and access token in Redis (60 min TTL — OTP is short-lived)
    account_id = info["deriv_account_id"]
    redis = get_redis()
    await redis.setex(
        f"otp:{account_id}",
        3600,
        json.dumps({
            "ws_url": info["_otp_ws_url"],
            "access_token": info["_access_token"],
        }),
    )

    access_token = create_jwt(info)
    user = {k: v for k, v in info.items() if not k.startswith("_")}
    return {"access_token": access_token, "token_type": "bearer", "user": user}


@router.get("/me")
def me(user: dict = Depends(get_current_user)):
    return user


@router.post("/logout")
def logout():
    return {"message": "Logged out"}
