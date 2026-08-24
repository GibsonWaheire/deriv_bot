"""
Trade API — proposal, buy, sell, open positions, history.
All routes protected by JWT.
"""
import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.deps import get_current_user
from app.core.redis_client import get_redis
from app.services.deriv_client import (
    DerivWS,
    connect_trading_ws,
    execute_buy,
    get_proposal,
    sell_contract,
)
from app.services.timing import schedule_entry

logger = logging.getLogger(__name__)
router = APIRouter()

# Per-account trading WS pool (in-process; restarted per worker)
_trading_ws: dict[str, DerivWS] = {}


async def _get_ws(account_id: str) -> DerivWS:
    """
    Return a live trading WS for this account (OTP-based).
    If the stored OTP URL has expired, re-fetches a fresh one using the
    cached access_token before raising an error.
    """
    ws = _trading_ws.get(account_id)
    if ws and ws.connected:
        return ws

    redis = get_redis()
    cached = await redis.get(f"otp:{account_id}")
    if not cached:
        raise HTTPException(
            status_code=401,
            detail="Session expired — please log in again",
        )

    try:
        data = json.loads(cached)
    except json.JSONDecodeError:
        raise HTTPException(status_code=401, detail="Session corrupted — please log in again")

    # Try connecting with the cached OTP URL
    try:
        ws = await connect_trading_ws(data["ws_url"])
        _trading_ws[account_id] = ws
        return ws
    except Exception as first_err:
        logger.warning(f"OTP WS connect failed for {account_id}: {first_err} — re-fetching OTP URL")

    # OTP URL likely expired — re-fetch using stored access_token
    access_token = data.get("access_token")
    if not access_token:
        raise HTTPException(status_code=401, detail="Session expired — please log in again")

    try:
        from app.services.auth_service import get_otp_ws_url
        new_url = await get_otp_ws_url(account_id, access_token)
        await redis.setex(
            f"otp:{account_id}", 3600,
            json.dumps({"ws_url": new_url, "access_token": access_token}),
        )
        ws = await connect_trading_ws(new_url)
        _trading_ws[account_id] = ws
        return ws
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Deriv connection failed: {e}")


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

class ProposalRequest(BaseModel):
    symbol: str
    contract_type: str
    barrier: str = ""
    duration: int = 1
    stake: float = 10.0


class BuyRequest(BaseModel):
    proposal_id: str
    price: float
    # Optional timing context from the frontend (passed from /ws/signals timing msg)
    last_tick_epoch: float | None = None
    tick_interval_ms: float | None = None
    rtt_ms: float | None = None


class SellRequest(BaseModel):
    contract_id: int


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/proposal")
async def proposal(body: ProposalRequest, user: dict = Depends(get_current_user)):
    """Get a live payout quote for a contract."""
    ws = await _get_ws(user["deriv_account_id"])
    try:
        return await get_proposal(
            body.symbol, body.contract_type, body.barrier,
            body.duration, body.stake, ws,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Deriv proposal timed out")


@router.post("/buy")
async def buy(body: BuyRequest, user: dict = Depends(get_current_user)):
    """
    Execute a buy. If timing context is provided, waits for the optimal
    entry window before firing the order to Deriv.
    """
    ws = await _get_ws(user["deriv_account_id"])
    try:
        if body.last_tick_epoch and body.tick_interval_ms and body.rtt_ms:
            result = await schedule_entry(
                body.last_tick_epoch,
                body.rtt_ms,
                body.tick_interval_ms,
                execute_buy,
                body.proposal_id, body.price, ws,
            )
        else:
            result = await execute_buy(body.proposal_id, body.price, ws)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Deriv buy timed out")


@router.post("/sell")
async def sell(body: SellRequest, user: dict = Depends(get_current_user)):
    """Early exit — sell open contract at market price."""
    ws = await _get_ws(user["deriv_account_id"])
    try:
        return await sell_contract(body.contract_id, ws)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Deriv sell timed out")


@router.get("/balance")
async def live_balance(user: dict = Depends(get_current_user)):
    """Fetch live account balance from Deriv."""
    ws = await _get_ws(user["deriv_account_id"])
    try:
        msg = await ws.send({"balance": 1})
        if "error" in msg:
            raise HTTPException(status_code=400, detail=msg["error"]["message"])
        return {"balance": float(msg["balance"]["balance"]), "currency": msg["balance"]["currency"]}
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Deriv balance timed out")


@router.get("/history")
async def history(
    limit: int = 25,
    offset: int = 0,
    user: dict = Depends(get_current_user),
):
    """Completed trade history from Deriv profit_table."""
    ws = await _get_ws(user["deriv_account_id"])
    try:
        msg = await ws.send({
            "profit_table": 1,
            "limit": limit,
            "offset": offset,
            "description": 1,
        })
        if "error" in msg:
            raise HTTPException(status_code=400, detail=msg["error"]["message"])
        return msg.get("profit_table", {})
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Deriv history timed out")


@router.get("/open")
async def open_positions(user: dict = Depends(get_current_user)):
    """Open contracts from Deriv portfolio."""
    ws = await _get_ws(user["deriv_account_id"])
    try:
        msg = await ws.send({"portfolio": 1})
        if "error" in msg:
            raise HTTPException(status_code=400, detail=msg["error"]["message"])
        return msg.get("portfolio", {})
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Deriv portfolio timed out")
