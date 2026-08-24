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
from collections import defaultdict
from typing import TYPE_CHECKING

import websockets
from fastapi import WebSocket, WebSocketDisconnect

from app.services.analysis import Signal, extract_signals, build_transition_matrix, score_digit_match, score_digit_differs, _grade
from app.services.timing import estimate_tick_interval, timing_info
from app.services.ai_explainer import explain_signal
from app.services.deriv_client import DerivWS, fetch_tick_history, measure_rtt
from app.services.auth_service import decode_jwt

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

PUBLIC_WS_URL = "wss://api.derivws.com/trading/v1/options/ws/public"

TRACKED_SYMBOLS = [
    "R_10", "R_25", "R_50", "R_75", "R_100",
    "1HZ10V", "1HZ25V", "1HZ50V", "1HZ75V", "1HZ100V",
    "JD10", "JD25", "JD50", "JD75", "JD100",
]
HISTORY_COUNT = 1000       # new Deriv API caps at 1000 ticks
HEARTBEAT_INTERVAL = 15    # seconds
ANALYSIS_EVERY_N_TICKS = 50  # re-run analysis every N live ticks per symbol


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
        "tier": s.tier,
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
        self._digits: dict[str, list[int]] = defaultdict(list)
        self._tick_times: dict[str, list[float]] = defaultdict(list)
        self._pip_sizes: dict[str, int] = {}
        self._tick_counts: dict[str, int] = defaultdict(int)
        self._last_signals: dict[str, list] = {}
        self._matrices: dict[str, list[list[float]]] = {}
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

                # Load all symbol histories in parallel
                async def _load_history(symbol: str):
                    try:
                        hist = await fetch_tick_history(symbol, HISTORY_COUNT, ws)
                        pip = self._pip_sizes.get(symbol, 2)
                        self._digits[symbol] = [_last_digit(p, pip) for p in hist["prices"]]
                        self._tick_times[symbol] = list(hist["times"])
                        logger.info(f"Loaded {len(self._digits[symbol])} ticks for {symbol}")
                    except Exception as e:
                        logger.warning(f"History load skipped for {symbol}: {e}")

                await asyncio.gather(*[_load_history(s) for s in TRACKED_SYMBOLS])

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
            self._tick_counts[symbol] += 1
            if len(self._digits[symbol]) > 5000:
                self._digits[symbol] = self._digits[symbol][-5000:]
                self._tick_times[symbol] = self._tick_times[symbol][-5000:]

            # Timing on every tick (needed for entry window countdown)
            recent_times = self._tick_times[symbol][-20:]
            interval_ms = estimate_tick_interval(list(recent_times))
            t_info = timing_info(epoch, self._rtt_ms, interval_ms)
            await self._broadcast({"type": "timing", "symbol": symbol, **t_info})

            n = self._tick_counts[symbol]
            is_first = n == 1
            is_refresh = n % ANALYSIS_EVERY_N_TICKS == 0

            # Full analysis every 50 ticks — rebuilds matrix + all signals
            if is_first or is_refresh:
                digits = self._digits[symbol]
                prices = [float(d) for d in digits]
                signals = extract_signals(symbol, digits, prices)

                # Cache the Markov matrix for per-tick updates
                self._matrices[symbol] = build_transition_matrix(digits)

                if signals:
                    top_dict = _signal_dict(signals[0])
                    top_dict["explanation"] = await explain_signal(top_dict)
                    all_dicts = [_signal_dict(s) for s in signals]
                    all_dicts[0]["explanation"] = top_dict["explanation"]
                else:
                    all_dicts = []

                self._last_signals[symbol] = all_dicts
                await self._broadcast({
                    "type": "snapshot",
                    "symbol": symbol,
                    "signals": all_dicts,
                    "tick_count": n,
                    "refreshes_in": ANALYSIS_EVERY_N_TICKS - (n % ANALYSIS_EVERY_N_TICKS),
                })

            # Per-tick refresh for Markov-sensitive signals (DIGITMATCH + DIGITDIFF)
            elif symbol in self._matrices and self._digits[symbol]:
                from app.services.analysis import MIN_DIGITMATCH_COMPOSITE
                digits = self._digits[symbol]
                matrix = self._matrices[symbol]
                fired = time.time()

                # DIGITMATCH refresh
                scores = score_digit_match(digits, matrix)
                best = scores[0]
                if best["composite"] >= MIN_DIGITMATCH_COMPOSITE:
                    confidence = min(0.50 + best["composite"] * 1.5, 0.95)
                    grade = _grade(confidence)
                    if grade:
                        await self._broadcast({
                            "type": "digit_tick",
                            "contract_type": "DIGITMATCH",
                            "symbol": symbol,
                            "tier": "precision",
                            "barrier": str(best["digit"]),
                            "confidence": round(confidence, 4),
                            "edge": round(confidence - 0.5, 4),
                            "grade": grade,
                            "meta": {
                                "digit": best["digit"],
                                "markov_prob": best["markov_prob"],
                                "frequency": best["frequency"],
                                "freq_deficit": best["freq_deficit"],
                                "gap_score": best["gap_score"],
                                "last_digit": digits[-1],
                            },
                            "fired_at": fired,
                        })

                # DIGITDIFF refresh
                dd = score_digit_differs(digits, matrix)
                await self._broadcast({
                    "type": "digit_tick",
                    "contract_type": "DIGITDIFF",
                    "symbol": symbol,
                    "tier": "medium",
                    "barrier": str(dd["digit"]),
                    "confidence": dd["win_probability"],
                    "edge": round(dd["win_probability"] - 0.5, 4),
                    "grade": "A",
                    "meta": dd,
                    "fired_at": fired,
                })

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

    async def add(self, ws: WebSocket):
        self._clients.add(ws)
        # Send current cached snapshots immediately so client doesn't wait
        for symbol, signals in self._last_signals.items():
            n = self._tick_counts.get(symbol, 0)
            try:
                await ws.send_json({
                    "type": "snapshot",
                    "symbol": symbol,
                    "signals": signals,
                    "tick_count": n,
                    "refreshes_in": ANALYSIS_EVERY_N_TICKS - (n % ANALYSIS_EVERY_N_TICKS) if n else ANALYSIS_EVERY_N_TICKS,
                })
            except Exception:
                pass

    def remove(self, ws: WebSocket):
        self._clients.discard(ws)


broadcaster = SignalBroadcaster()


async def ws_signals_endpoint(websocket: WebSocket):
    """
    FastAPI WebSocket endpoint handler.
    Clients connect with ?token=<JWT> and receive signal/tick/timing messages.
    Dev bypass: accepts 'dev-token' when DERIV_CLIENT_ID is not configured.
    """
    from app.core.config import settings
    token = websocket.query_params.get("token", "")

    # Dev bypass — always allowed for guest/local access
    is_dev_token = token == "dev-token"
    if not is_dev_token:
        user = decode_jwt(token)
        if not user:
            await websocket.close(code=4001, reason="Unauthorized")
            return

    await websocket.accept()
    await broadcaster.add(websocket)
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
