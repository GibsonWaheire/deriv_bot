"""
WebSocket signal broadcaster.
- One shared SignalBroadcaster connects to Deriv public WS.
- On every tick: runs analysis, enriches top signal with AI explanation, broadcasts to all clients.
- FastAPI /ws/signals endpoint: clients subscribe with their JWT.
"""
import asyncio
import json
import logging
import time
from typing import TYPE_CHECKING

import websockets
from fastapi import WebSocket, WebSocketDisconnect

from app.services.analysis import Signal, extract_signals
from app.services.timing import estimate_tick_interval, timing_info
from app.services.ai_explainer import explain_signal
from app.services.deriv_client import DerivWS, fetch_tick_history, measure_rtt
from app.services.auth_service import decode_jwt

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

PUBLIC_WS_URL = "wss://api.derivws.com/trading/v1/options/ws/public"

TRACKED_SYMBOLS = ["1HZ100V", "1HZ10V", "R_100", "R_50"]
HISTORY_COUNT = 5000
HEARTBEAT_INTERVAL = 15  # seconds


def _signal_dict(s: Signal) -> dict:
    return {
        "symbol": s.symbol,
        "name": s.name,
        "strategy": s.strategy,
        "contract_type": s.contract_type,
        "barrier": s.barrier,
        "duration": s.duration,
        "confidence": s.confidence,
        "edge": s.edge,
        "grade": s.grade,
        "explanation": s.explanation,
        "meta": s.meta,
        "fired_at": time.time(),
    }


def _last_digit(price: float, pip_size: int = 2) -> int:
    """Extract last digit from a price given its pip size."""
    return int(round(price * 10 ** pip_size)) % 10


class SignalBroadcaster:
    """
    Maintains one Deriv public WS, processes all ticks, broadcasts to connected clients.
    Shared singleton — one instance for the whole process.
    """

    def __init__(self):
        self._clients: set[WebSocket] = set()
        self._digits: dict[str, list[int]] = {s: [] for s in TRACKED_SYMBOLS}
        self._tick_times: dict[str, list[float]] = {s: [] for s in TRACKED_SYMBOLS}
        self._pip_sizes: dict[str, int] = {}
        self._rtt_ms: float = 50.0
        self._started = False

    async def start(self):
        if self._started:
            return
        self._started = True
        asyncio.create_task(self._run())

    async def _run(self):
        """Main loop: connect, load history, subscribe ticks, heartbeat."""
        while True:
            try:
                ws = DerivWS(PUBLIC_WS_URL)
                await ws.connect()

                self._rtt_ms = await measure_rtt(ws)
                logger.info(f"Deriv RTT: {self._rtt_ms:.1f}ms")

                for symbol in TRACKED_SYMBOLS:
                    try:
                        hist = await fetch_tick_history(symbol, HISTORY_COUNT, ws)
                        pip = self._pip_sizes.get(symbol, 2)
                        self._digits[symbol] = [
                            _last_digit(p, pip) for p in hist["prices"]
                        ]
                        self._tick_times[symbol] = list(hist["times"])
                        logger.info(
                            f"Loaded {len(self._digits[symbol])} ticks for {symbol}"
                        )
                    except Exception as e:
                        logger.warning(f"History load failed for {symbol}: {e}")

                for symbol in TRACKED_SYMBOLS:
                    await ws.subscribe(
                        {"ticks": symbol, "subscribe": 1},
                        self._make_handler(symbol),
                    )

                asyncio.create_task(self._heartbeat())

                # Keep running while WS is alive
                while ws.connected:
                    await asyncio.sleep(1)

            except Exception as e:
                logger.error(f"Broadcaster error: {e}. Restarting in 5s.")
                await asyncio.sleep(5)

    def _make_handler(self, symbol: str):
        async def on_tick(msg: dict):
            tick = msg.get("tick", {})
            if not tick:
                return
            price = float(tick.get("quote", 0))
            epoch = float(tick.get("epoch", time.time()))
            pip_size = int(tick.get("pip_size", 2))
            self._pip_sizes[symbol] = pip_size
            digit = _last_digit(price, pip_size)

            self._digits[symbol].append(digit)
            self._tick_times[symbol].append(epoch)
            # Keep last 5000
            if len(self._digits[symbol]) > 5000:
                self._digits[symbol] = self._digits[symbol][-5000:]
                self._tick_times[symbol] = self._tick_times[symbol][-5000:]

            await self._broadcast({
                "type": "tick",
                "symbol": symbol,
                "digit": digit,
                "price": price,
                "epoch": epoch,
            })

            # Run analysis on each tick
            digits = self._digits[symbol]
            prices = [float(d) for d in digits]  # use digits as price proxy for rise/fall
            signals = extract_signals(symbol, digits, prices)

            if signals:
                top = signals[0]
                top_dict = _signal_dict(top)
                top_dict["explanation"] = await explain_signal(top_dict)

                all_dicts = [_signal_dict(s) for s in signals]
                all_dicts[0]["explanation"] = top_dict["explanation"]

                recent_times = self._tick_times[symbol][-20:]
                interval_ms = estimate_tick_interval(list(recent_times))
                t_info = timing_info(epoch, self._rtt_ms, interval_ms)

                await self._broadcast({"type": "signal", "data": all_dicts})
                await self._broadcast({"type": "timing", **t_info})

        return on_tick

    async def _heartbeat(self):
        while True:
            await asyncio.sleep(HEARTBEAT_INTERVAL)
            await self._broadcast({"type": "ping"})

    async def _broadcast(self, msg: dict):
        dead: set[WebSocket] = set()
        for ws in self._clients:
            try:
                await ws.send_json(msg)
            except Exception:
                dead.add(ws)
        self._clients -= dead

    def add(self, ws: WebSocket):
        self._clients.add(ws)

    def remove(self, ws: WebSocket):
        self._clients.discard(ws)


broadcaster = SignalBroadcaster()


async def ws_signals_endpoint(websocket: WebSocket):
    """
    FastAPI WebSocket endpoint handler.
    Clients connect with ?token=<JWT> and receive signal/tick/timing messages.
    """
    token = websocket.query_params.get("token", "")
    user = decode_jwt(token)
    if not user:
        await websocket.close(code=4001, reason="Unauthorized")
        return

    await websocket.accept()
    broadcaster.add(websocket)
    try:
        while True:
            # Keep connection open; client can send pings
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        broadcaster.remove(websocket)
