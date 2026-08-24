"""
Bot API — start, pause, resume, stop, status.
All routes protected by JWT.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.deps import get_current_user
from app.services.bot import BotConfig, BotSession

logger = logging.getLogger(__name__)
router = APIRouter()

# One BotSession per account_id (in-process, same worker)
_sessions: dict[str, BotSession] = {}


async def _get_trading_ws(account_id: str):
    """Reuse the trading WS pool from trade.py to avoid duplicate connections."""
    from app.api.trade import _get_ws
    return await _get_ws(account_id)


# ---------------------------------------------------------------------------
# Request schema
# ---------------------------------------------------------------------------

class BotStartRequest(BaseModel):
    symbols: list[str] = ["1HZ100V", "R_100"]
    stake: float = 10.0
    min_grade: str = "A"            # "A" or "AB"
    max_trades_per_hour: int = 20
    max_daily_loss_pct: float = 20.0
    stake_strategy: str = "flat"    # "flat" or "martingale"
    starting_balance: float = 1000.0
    max_consecutive_losses: int = 0  # 0 = disabled


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/start")
async def bot_start(body: BotStartRequest, user: dict = Depends(get_current_user)):
    """Start a new bot session. Stops any existing session first."""
    account_id = user["deriv_account_id"]

    if body.min_grade not in ("A", "AB"):
        raise HTTPException(status_code=400, detail="min_grade must be 'A' or 'AB'")
    if body.stake_strategy not in ("flat", "martingale"):
        raise HTTPException(status_code=400, detail="stake_strategy must be 'flat' or 'martingale'")
    if not body.symbols:
        raise HTTPException(status_code=400, detail="At least one symbol required")
    if body.stake <= 0:
        raise HTTPException(status_code=400, detail="Stake must be positive")

    # Stop existing session
    existing = _sessions.get(account_id)
    if existing and existing.status != "stopped":
        existing.stop()

    ws = await _get_trading_ws(account_id)
    config = BotConfig(
        symbols=body.symbols,
        stake=body.stake,
        min_grade=body.min_grade,       # type: ignore[arg-type]
        max_trades_per_hour=body.max_trades_per_hour,
        max_daily_loss_pct=body.max_daily_loss_pct,
        stake_strategy=body.stake_strategy,  # type: ignore[arg-type]
        starting_balance=body.starting_balance,
        max_consecutive_losses=body.max_consecutive_losses,
    )
    session = BotSession(account_id, ws, config)
    _sessions[account_id] = session
    session.start()
    logger.info(f"Bot started for {account_id}")
    return {"status": "running"}


@router.post("/pause")
async def bot_pause(user: dict = Depends(get_current_user)):
    session = _sessions.get(user["deriv_account_id"])
    if not session or session.status == "stopped":
        raise HTTPException(status_code=404, detail="No active bot session")
    session.pause()
    return {"status": "paused"}


@router.post("/resume")
async def bot_resume(user: dict = Depends(get_current_user)):
    session = _sessions.get(user["deriv_account_id"])
    if not session or session.status == "stopped":
        raise HTTPException(status_code=404, detail="No active bot session")
    session.resume()
    return {"status": "running"}


@router.post("/stop")
async def bot_stop(user: dict = Depends(get_current_user)):
    account_id = user["deriv_account_id"]
    session = _sessions.get(account_id)
    if not session:
        raise HTTPException(status_code=404, detail="No active bot session")
    session.stop()
    _sessions.pop(account_id, None)
    return {"status": "stopped"}


@router.get("/status")
async def bot_status(user: dict = Depends(get_current_user)):
    """Returns live bot state, metrics, and last 50 log entries."""
    session = _sessions.get(user["deriv_account_id"])
    if not session:
        return {"status": "idle"}
    return session.get_status()
