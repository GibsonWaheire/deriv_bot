"""
Automation Bot — BotSession runs the full signal → trade loop autonomously.

Flow:
  1. Poll broadcaster cache every 2s for qualifying signals (Grade A or A+B)
  2. On match: get proposal, check payout% ≥ threshold, schedule_entry → buy
  3. Subscribe to open contract for settlement detection
  4. Log WIN/LOSS, adjust martingale stake, check hard-stop conditions

Hard stops (require explicit user resume):
  - Daily loss > max_daily_loss_pct of starting balance
  - 3 consecutive losses
"""
import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Literal

from app.services.deriv_client import (
    DerivWS,
    execute_buy,
    get_proposal,
    subscribe_open_contract,
)

logger = logging.getLogger(__name__)

MIN_PAYOUT_PCT = 70.0        # minimum payout % before accepting a trade
MAX_LOG_ENTRIES = 200        # cap in-memory log
MAX_MARTINGALE_MULT = 4      # cap martingale at 4× base stake
POLL_INTERVAL_S = 2.0        # seconds between signal checks


@dataclass
class BotConfig:
    symbols: list[str]
    stake: float
    min_grade: Literal["A", "AB"]      # "A" = Grade A only, "AB" = A and B
    max_trades_per_hour: int = 20
    max_daily_loss_pct: float = 20.0   # % of starting balance
    stake_strategy: Literal["flat", "martingale"] = "flat"
    starting_balance: float = 1000.0   # reference for daily loss limit


@dataclass
class LogEntry:
    time: float
    event: str     # watching | signal_found | trade_placed | trade_settled | skip | paused | resumed | stopped | error
    message: str
    details: dict = field(default_factory=dict)


class BotSession:
    """Per-user automation session. One instance per account_id."""

    def __init__(self, account_id: str, ws: DerivWS, config: BotConfig):
        self.account_id = account_id
        self.ws = ws
        self.config = config

        self.status: Literal["running", "paused", "stopped"] = "running"
        self.log: list[LogEntry] = []

        # Metrics
        self.trades_total = 0
        self.trades_won = 0
        self.net_pnl = 0.0
        self.consecutive_losses = 0
        self.daily_loss = 0.0
        self.current_stake = config.stake
        self._trades_this_hour: list[float] = []   # epoch timestamps

        # State
        self.current_watch: str = "Initialising…"
        self._active_trade: dict | None = None
        self._last_acted_fired_at: float = 0.0    # fired_at of last traded signal
        self._task: asyncio.Task | None = None

    # ------------------------------------------------------------------
    # Public control API
    # ------------------------------------------------------------------

    def start(self):
        self._task = asyncio.create_task(self._run())

    def pause(self):
        if self.status == "running":
            self.status = "paused"
            self._log("paused", "Bot paused by user")

    def resume(self):
        if self.status == "paused":
            self.status = "running"
            self._log("resumed", "Bot resumed by user")

    def stop(self):
        self.status = "stopped"
        self._log("stopped", "Bot stopped")
        if self._task:
            self._task.cancel()

    def get_status(self) -> dict:
        return {
            "status": self.status,
            "trades_total": self.trades_total,
            "trades_won": self.trades_won,
            "win_rate": round(self.trades_won / self.trades_total, 3) if self.trades_total else 0.0,
            "net_pnl": round(self.net_pnl, 2),
            "consecutive_losses": self.consecutive_losses,
            "daily_loss": round(self.daily_loss, 2),
            "daily_loss_limit": round(
                self.config.starting_balance * self.config.max_daily_loss_pct / 100, 2
            ),
            "current_stake": round(self.current_stake, 2),
            "current_watch": self.current_watch,
            "config": {
                "symbols": self.config.symbols,
                "stake": self.config.stake,
                "min_grade": self.config.min_grade,
                "max_trades_per_hour": self.config.max_trades_per_hour,
                "max_daily_loss_pct": self.config.max_daily_loss_pct,
                "stake_strategy": self.config.stake_strategy,
                "starting_balance": self.config.starting_balance,
            },
            "log": [
                {"time": e.time, "event": e.event, "message": e.message, "details": e.details}
                for e in self.log[-50:]
            ],
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _log(self, event: str, message: str, details: dict | None = None):
        entry = LogEntry(time=time.time(), event=event, message=message, details=details or {})
        self.log.append(entry)
        if len(self.log) > MAX_LOG_ENTRIES:
            self.log = self.log[-MAX_LOG_ENTRIES:]
        logger.info(f"[Bot:{self.account_id}] {message}")

    def _find_signal(self) -> dict | None:
        """Return the highest-confidence qualifying signal from broadcaster cache."""
        # Import here to avoid circular import at module level
        from app.core.ws_manager import broadcaster

        allowed = {"A"} if self.config.min_grade == "A" else {"A", "B"}
        best: dict | None = None
        best_conf = 0.0

        for symbol in self.config.symbols:
            for sig in broadcaster._last_signals.get(symbol, []):
                if sig.get("grade") not in allowed:
                    continue
                # Skip signals we've already acted on (same snapshot)
                if sig.get("fired_at", 0) <= self._last_acted_fired_at:
                    continue
                conf = sig.get("confidence", 0.0)
                if conf > best_conf:
                    best_conf = conf
                    best = sig

        return best

    def _within_hourly_limit(self) -> bool:
        now = time.time()
        self._trades_this_hour = [t for t in self._trades_this_hour if now - t < 3600]
        return len(self._trades_this_hour) < self.config.max_trades_per_hour

    # ------------------------------------------------------------------
    # Main loop
    # ------------------------------------------------------------------

    async def _run(self):
        self._log("watching", f"Bot started · symbols: {', '.join(self.config.symbols)} · grade: {self.config.min_grade}")

        while self.status != "stopped":
            try:
                if self.status == "paused":
                    await asyncio.sleep(1)
                    continue

                if self._active_trade:
                    self.current_watch = f"Contract #{self._active_trade['contract_id']} open · waiting for settlement…"
                    await asyncio.sleep(1)
                    continue

                if not self._within_hourly_limit():
                    self.current_watch = "Hourly trade limit reached · waiting…"
                    await asyncio.sleep(5)
                    continue

                signal = self._find_signal()
                if not signal:
                    syms = ", ".join(self.config.symbols)
                    grade_label = "Grade A" if self.config.min_grade == "A" else "Grade A or B"
                    self.current_watch = f"Watching {syms} · waiting for {grade_label} signal…"
                    await asyncio.sleep(POLL_INTERVAL_S)
                    continue

                await self._act_on_signal(signal)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"[Bot:{self.account_id}] loop error: {e}")
                self._log("error", f"Loop error: {e}")
                await asyncio.sleep(2)

    async def _act_on_signal(self, signal: dict):
        symbol = signal["symbol"]
        name = signal.get("name", symbol)
        ct = signal["contract_type"]
        barrier = signal.get("barrier", "")
        duration = signal.get("duration", 1)
        confidence = signal.get("confidence", 0.0)
        grade = signal.get("grade", "?")
        fired_at = signal.get("fired_at", 0.0)

        label = f"Digit {barrier} {ct}" if barrier else ct
        self.current_watch = f"Signal [{grade}] {name} · {label} {confidence:.0%} · fetching proposal…"
        self._log("signal_found", f"Signal [{grade}]: {name} {label} {confidence:.0%}", {
            "symbol": symbol,
            "contract_type": ct,
            "barrier": barrier,
            "confidence": confidence,
            "grade": grade,
        })

        # Mark as acted so we don't re-enter this snapshot
        self._last_acted_fired_at = fired_at

        # Get proposal
        try:
            proposal = await get_proposal(symbol, ct, barrier, duration, self.current_stake, self.ws)
        except Exception as e:
            self._log("error", f"Proposal failed: {e}")
            return

        # Check payout threshold
        if proposal["payout_pct"] < MIN_PAYOUT_PCT:
            self._log("skip", f"Payout {proposal['payout_pct']:.1f}% < {MIN_PAYOUT_PCT:.0f}% threshold — skipping")
            return

        # Execute buy
        self.current_watch = f"Entering: {label} · stake ${self.current_stake:.2f} · payout ${proposal['payout']:.2f}…"
        try:
            result = await execute_buy(proposal["proposal_id"], proposal["ask_price"], self.ws)
        except Exception as e:
            self._log("error", f"Buy failed: {e}")
            return

        contract_id = result["contract_id"]
        buy_price = result["buy_price"]
        payout = result["payout"]

        self.trades_total += 1
        self._trades_this_hour.append(time.time())
        self._active_trade = {
            "contract_id": contract_id,
            "buy_price": buy_price,
            "payout": payout,
        }
        self._log("trade_placed", f"Contract #{contract_id} opened · stake ${buy_price:.2f} · payout ${payout:.2f}", {
            "contract_id": contract_id,
            "buy_price": buy_price,
            "payout": payout,
        })

        # Monitor in background — does not block the main loop
        asyncio.create_task(self._monitor(contract_id, buy_price))

    async def _monitor(self, contract_id: int, buy_price: float):
        """Subscribe to contract updates and wait for WIN/LOSS settlement."""
        settled = asyncio.Event()
        outcome: dict = {}

        async def on_update(msg: dict):
            poc = msg.get("proposal_open_contract", {})
            if poc.get("is_sold") or poc.get("status") in ("won", "lost"):
                outcome["profit"] = float(poc.get("profit", 0))
                outcome["status"] = poc.get("status", "unknown")
                settled.set()

        sub_id = ""
        try:
            sub_id = await subscribe_open_contract(contract_id, on_update, self.ws)
            await asyncio.wait_for(settled.wait(), timeout=120)
        except asyncio.TimeoutError:
            self._log("error", f"Contract #{contract_id} settlement timed out")
            self._active_trade = None
            return
        finally:
            if sub_id:
                try:
                    await self.ws.forget(sub_id)
                except Exception:
                    pass

        profit = outcome.get("profit", 0.0)
        status = outcome.get("status", "unknown")
        won = status == "won"

        if won:
            self.trades_won += 1
            self.consecutive_losses = 0
            self.net_pnl += profit
            self._log("trade_settled", f"WIN +${profit:.2f} · contract #{contract_id}", {"profit": profit, "won": True})
            if self.config.stake_strategy == "martingale":
                self.current_stake = self.config.stake   # reset to base on win
        else:
            self.consecutive_losses += 1
            self.daily_loss += buy_price
            self.net_pnl -= buy_price
            self._log("trade_settled", f"LOSS -${buy_price:.2f} · contract #{contract_id}", {"profit": profit, "won": False})
            if self.config.stake_strategy == "martingale":
                self.current_stake = min(
                    self.current_stake * 2,
                    self.config.stake * MAX_MARTINGALE_MULT,
                )

        self._active_trade = None

        # Hard-stop checks
        loss_limit = self.config.starting_balance * self.config.max_daily_loss_pct / 100
        if self.daily_loss >= loss_limit:
            self.status = "paused"
            self._log("paused",
                f"Daily loss limit reached (${self.daily_loss:.2f} of ${loss_limit:.2f}) — manual resume required")
        elif self.consecutive_losses >= 3:
            self.status = "paused"
            self._log("paused", "3 consecutive losses — manual resume required")
