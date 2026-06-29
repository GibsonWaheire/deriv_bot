"""
Affiliate tracking API.
- POST /api/affiliate/register — called from auth callback when UTM params present
- POST /api/affiliate/first-trade — mark account as active (called by transaction subscription)
- GET  /api/affiliate/stats     — referred count, active traders, estimated commission
- GET  /api/affiliate/markup    — fetch markup revenue from Deriv REST API
"""
import logging
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.affiliate import ReferredUser

logger = logging.getLogger(__name__)
router = APIRouter()

DERIV_REST_BASE = "https://api.derivws.com"


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class RegisterRequest(BaseModel):
    deriv_account_id: str
    utm_source: str | None = None
    utm_medium: str | None = None
    utm_campaign: str | None = None
    sidc: str | None = None


class FirstTradeRequest(BaseModel):
    deriv_account_id: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/register")
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """
    Upsert a referred user record.
    Called from auth callback when UTM/sidc params are present in the OAuth state.
    No JWT required — called server-side during auth flow.
    """
    existing = await db.scalar(
        select(ReferredUser).where(ReferredUser.deriv_account_id == body.deriv_account_id)
    )
    if existing:
        return {"status": "already_registered"}

    user = ReferredUser(
        deriv_account_id=body.deriv_account_id,
        utm_source=body.utm_source,
        utm_medium=body.utm_medium,
        utm_campaign=body.utm_campaign,
        sidc=body.sidc,
        referred_at=datetime.now(timezone.utc),
    )
    db.add(user)
    await db.commit()
    logger.info(f"Affiliate registered: {body.deriv_account_id} (source: {body.utm_source})")
    return {"status": "registered"}


@router.post("/first-trade")
async def first_trade(body: FirstTradeRequest, db: AsyncSession = Depends(get_db)):
    """
    Mark a referred user as active after their first trade.
    Called internally when the `transaction` subscription fires a BUY event.
    """
    user = await db.scalar(
        select(ReferredUser).where(ReferredUser.deriv_account_id == body.deriv_account_id)
    )
    if not user:
        return {"status": "not_found"}
    if user.is_active:
        return {"status": "already_active"}

    user.is_active = True
    user.first_trade_at = datetime.now(timezone.utc)
    await db.commit()
    logger.info(f"Affiliate first trade: {body.deriv_account_id}")
    return {"status": "activated"}


@router.get("/stats")
async def stats(
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Aggregate referral stats."""
    total = await db.scalar(select(func.count()).select_from(ReferredUser))
    active = await db.scalar(
        select(func.count()).select_from(ReferredUser).where(ReferredUser.is_active == True)  # noqa: E712
    )
    return {
        "total_referred": total or 0,
        "active_traders": active or 0,
        "conversion_rate": round((active or 0) / (total or 1) * 100, 1),
    }


@router.get("/markup")
async def markup(
    date_from: str,
    date_to: str,
    _user: dict = Depends(get_current_user),
):
    """
    Fetch markup revenue from Deriv.
    date_from / date_to: YYYY-MM-DD strings.
    Requires DERIV_APP_ID and a valid access_token in Redis for the current user.
    """
    if not settings.affiliate_id:
        return {"error": "Affiliate ID not configured", "revenue": []}

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{DERIV_REST_BASE}/applications/v1/markup-statistics",
                params={"date_from": date_from, "date_to": date_to},
                headers={"Deriv-App-ID": settings.deriv_app_id},
                timeout=10,
            )
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Deriv markup API error: {resp.text}")
        return resp.json()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Deriv markup API timed out")
