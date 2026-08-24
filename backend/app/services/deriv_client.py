"""
Deriv WebSocket client — public (ticks) and trading (buy/sell) connections.
"""
import asyncio
import itertools
import json
import logging
import time
from typing import Callable

import httpx
import websockets
from websockets.exceptions import ConnectionClosed

from app.core.config import settings
from app.core.redis_client import get_redis

logger = logging.getLogger(__name__)

PUBLIC_WS_URL = "wss://api.derivws.com/trading/v1/options/ws/public"
OLD_WS_URL    = "wss://ws.derivws.com/websockets/v3?app_id=1089"  # accepts a1-xxx tokens directly

_req_id_counter = itertools.count(1)  # Deriv requires integer req_id
DERIV_REST_BASE = "https://api.derivws.com"


class DerivWS:
    """
    Async Deriv WebSocket wrapper.
    - Matches request/response via req_id
    - Dispatches subscription callbacks
    - Pings every 25s, exponential-backoff reconnect (1s → 30s max)
    """

    def __init__(self, ws_url: str):
        self._url = ws_url
        self._ws = None
        self._pending: dict[int, asyncio.Future] = {}
        self._subscriptions: dict[str, Callable] = {}   # sub_id → callback
        self._topic_subs: dict[str, list[Callable]] = {}  # msg_type → [callbacks]
        self._running = False
        self._recv_task: asyncio.Task | None = None
        self._ping_task: asyncio.Task | None = None

    async def connect(self):
        """Establish connection and start background recv/ping tasks."""
        self._running = True
        self._ws = await websockets.connect(self._url, ping_interval=None)
        self._recv_task = asyncio.create_task(self._recv_loop())
        self._ping_task = asyncio.create_task(self._ping_loop())
        logger.info(f"Deriv WS connected: {self._url[:60]}")

    async def _recv_loop(self):
        """Receive loop with automatic exponential-backoff reconnect."""
        backoff = 1
        while self._running:
            try:
                async for raw in self._ws:
                    backoff = 1
                    try:
                        msg = json.loads(raw)
                        await self._dispatch(msg)
                    except Exception as e:
                        logger.error(f"Dispatch error: {e}")
            except (ConnectionClosed, OSError) as e:
                if not self._running:
                    break
                logger.warning(f"WS disconnected ({e}). Reconnecting in {backoff}s")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)
                try:
                    self._ws = await websockets.connect(self._url, ping_interval=None)
                    logger.info("WS reconnected")
                except Exception as re:
                    logger.error(f"Reconnect failed: {re}")

    async def _dispatch(self, msg: dict):
        req_id = msg.get("req_id")
        if req_id and req_id in self._pending:
            fut = self._pending.pop(req_id)
            if not fut.done():
                fut.set_result(msg)

        sub_obj = msg.get("subscription")
        sub_id = sub_obj.get("id") if isinstance(sub_obj, dict) else None
        if sub_id and sub_id in self._subscriptions:
            asyncio.create_task(self._invoke(self._subscriptions[sub_id], msg))

        msg_type = msg.get("msg_type")
        if msg_type in self._topic_subs:
            for cb in self._topic_subs[msg_type]:
                asyncio.create_task(self._invoke(cb, msg))

    async def _invoke(self, cb: Callable, msg: dict):
        try:
            if asyncio.iscoroutinefunction(cb):
                await cb(msg)
            else:
                cb(msg)
        except Exception as e:
            logger.error(f"Callback error: {e}")

    async def _ping_loop(self):
        while self._running:
            await asyncio.sleep(25)
            try:
                await self._raw_send({"ping": 1})
            except Exception:
                pass

    async def _raw_send(self, payload: dict):
        if self._ws and not self._ws.closed:
            await self._ws.send(json.dumps(payload))

    async def send(self, payload: dict, timeout: float = 10.0) -> dict:
        """Send a request and await its paired response."""
        req_id = next(_req_id_counter)  # must be int — Deriv rejects strings
        payload = {**payload, "req_id": req_id}
        loop = asyncio.get_running_loop()
        fut = loop.create_future()
        self._pending[req_id] = fut
        await self._raw_send(payload)
        try:
            return await asyncio.wait_for(asyncio.shield(fut), timeout=timeout)
        except asyncio.TimeoutError:
            self._pending.pop(req_id, None)
            raise TimeoutError(f"Deriv WS timed out: {list(payload.keys())}")

    async def subscribe(self, payload: dict, callback: Callable) -> str:
        """Send a subscribe request and register callback for future pushes."""
        msg = await self.send(payload)
        sub_obj = msg.get("subscription")
        sub_id = sub_obj.get("id") if isinstance(sub_obj, dict) else None
        if sub_id:
            self._subscriptions[sub_id] = callback
        return sub_id or ""

    def on(self, msg_type: str, callback: Callable):
        """Register a listener for all messages of a given type."""
        self._topic_subs.setdefault(msg_type, []).append(callback)

    def off(self, msg_type: str, callback: Callable):
        """Remove a previously registered topic listener."""
        try:
            self._topic_subs.get(msg_type, []).remove(callback)
        except ValueError:
            pass

    async def forget(self, sub_id: str):
        await self.send({"forget": sub_id})
        self._subscriptions.pop(sub_id, None)

    async def forget_all(self, *types: str):
        await self.send({"forget_all": list(types)})
        self._subscriptions.clear()

    async def close(self):
        self._running = False
        if self._ping_task:
            self._ping_task.cancel()
        if self._recv_task:
            self._recv_task.cancel()
        if self._ws:
            await self._ws.close()

    @property
    def connected(self) -> bool:
        return self._ws is not None and not self._ws.closed


# ---------------------------------------------------------------------------
# High-level helpers
# ---------------------------------------------------------------------------

async def connect_public_ws() -> DerivWS:
    """Open a public (no-auth) WS for ticks and market data."""
    ws = DerivWS(PUBLIC_WS_URL)
    await ws.connect()
    return ws


async def connect_trading_ws(otp_url: str) -> DerivWS:
    """Open an authenticated trading WS using an OTP URL."""
    ws = DerivWS(otp_url)
    await ws.connect()
    return ws


async def get_authenticated_ws_url(account_id: str, access_token: str) -> str:
    """Return OTP WS URL from Redis cache, or re-fetch if expired."""
    redis = get_redis()
    cached = await redis.get(f"otp:{account_id}")
    if cached:
        data = json.loads(cached)
        return data["ws_url"]
    url = await _fetch_otp_url(account_id, access_token)
    await redis.setex(
        f"otp:{account_id}", 3600,
        json.dumps({"ws_url": url, "access_token": access_token}),
    )
    return url


async def _fetch_otp_url(account_id: str, access_token: str) -> str:
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


async def fetch_tick_history(
    symbol: str, count: int = 5000, ws: DerivWS | None = None
) -> dict:
    """
    Fetch historical ticks for a symbol.
    Returns {"prices": [...], "times": [...]}.
    Opens a temporary public WS if none supplied.
    """
    owned = ws is None
    if owned:
        ws = await connect_public_ws()
    try:
        msg = await ws.send({
            "ticks_history": symbol,
            "end": "latest",
            "count": count,
            "style": "ticks",
        })
        if "error" in msg:
            raise ValueError(msg["error"]["message"])
        hist = msg.get("history", {})
        return {"prices": hist.get("prices", []), "times": hist.get("times", [])}
    finally:
        if owned:
            await ws.close()


async def measure_rtt(ws: DerivWS) -> float:
    """Measure round-trip latency in ms using the time endpoint."""
    t0 = time.monotonic()
    await ws.send({"time": 1})
    return (time.monotonic() - t0) * 1000


async def get_proposal(
    symbol: str,
    contract_type: str,
    barrier: str,
    duration: int,
    stake: float,
    ws: DerivWS,
) -> dict:
    """
    Request a payout proposal.
    Returns: {proposal_id, ask_price, payout, payout_pct, longcode}
    """
    payload: dict = {
        "proposal": 1,
        "amount": stake,
        "basis": "stake",
        "contract_type": contract_type,
        "currency": "USD",
        "duration": duration,
        "duration_unit": "t",
        "underlying_symbol": symbol,
    }
    if barrier:
        payload["barrier"] = barrier
    msg = await ws.send(payload)
    if "error" in msg:
        raise ValueError(msg["error"]["message"])
    p = msg["proposal"]
    ask = p["ask_price"]
    payout = p["payout"]
    return {
        "proposal_id": p["id"],
        "ask_price": ask,
        "payout": payout,
        "payout_pct": round((payout - ask) / ask * 100, 1) if ask else 0,
        "longcode": p.get("longcode", ""),
    }


async def execute_buy(proposal_id: str, ask_price: float, ws: DerivWS) -> dict:
    """
    Buy a contract.
    Returns: {contract_id, buy_price, payout, purchase_time, balance_after, transaction_id}
    """
    msg = await ws.send({"buy": proposal_id, "price": ask_price})
    if "error" in msg:
        raise ValueError(msg["error"]["message"])
    b = msg["buy"]
    return {
        "contract_id": b["contract_id"],
        "buy_price": b["buy_price"],
        "payout": b["payout"],
        "purchase_time": b["purchase_time"],
        "balance_after": b["balance_after"],
        "transaction_id": b["transaction_id"],
    }


async def sell_contract(contract_id: int, ws: DerivWS) -> dict:
    """Sell an open contract at market price."""
    msg = await ws.send({"sell": contract_id, "price": 0})
    if "error" in msg:
        raise ValueError(msg["error"]["message"])
    return msg.get("sell", {})


async def subscribe_open_contract(
    contract_id: int, callback: Callable, ws: DerivWS
) -> str:
    return await ws.subscribe(
        {"proposal_open_contract": 1, "contract_id": contract_id, "subscribe": 1},
        callback,
    )


async def subscribe_balance(callback: Callable, ws: DerivWS) -> str:
    return await ws.subscribe({"balance": 1, "subscribe": 1}, callback)


async def subscribe_transaction(callback: Callable, ws: DerivWS) -> str:
    return await ws.subscribe({"transaction": 1, "subscribe": 1}, callback)


# ---------------------------------------------------------------------------
# Direct token auth (old Deriv WS API — accepts a1-xxx tokens)
# ---------------------------------------------------------------------------

async def connect_with_token(token: str) -> tuple["DerivWS", dict]:
    """
    Connect to old Deriv WS and authorize with a personal API token (a1-xxx).
    Returns (ws, account_info). Caller is responsible for keeping ws alive.
    """
    ws = DerivWS(OLD_WS_URL)
    await ws.connect()
    result = await ws.send({"authorize": token})
    if "error" in result:
        await ws.close()
        raise ValueError(result["error"]["message"])
    auth = result["authorize"]
    info = {
        "account_id": auth.get("loginid", ""),
        "email": auth.get("email", ""),
        "currency": auth.get("currency", "USD"),
        "balance": float(auth.get("balance", 0)),
        "account_type": "demo" if auth.get("is_virtual") else "real",
    }
    return ws, info


async def get_proposal_v1(
    symbol: str,
    contract_type: str,
    barrier: str,
    duration: int,
    stake: float,
    ws: "DerivWS",
) -> dict:
    """Proposal using old Deriv API (uses 'symbol' not 'underlying_symbol')."""
    payload: dict = {
        "proposal": 1,
        "amount": stake,
        "basis": "stake",
        "contract_type": contract_type,
        "currency": "USD",
        "duration": duration,
        "duration_unit": "t",
        "symbol": symbol,
    }
    if barrier:
        payload["barrier"] = barrier
    msg = await ws.send(payload)
    if "error" in msg:
        raise ValueError(msg["error"]["message"])
    p = msg["proposal"]
    ask = p["ask_price"]
    payout = p["payout"]
    return {
        "proposal_id": p["id"],
        "ask_price": ask,
        "payout": payout,
        "payout_pct": round((payout - ask) / ask * 100, 1) if ask else 0,
        "longcode": p.get("longcode", ""),
    }
