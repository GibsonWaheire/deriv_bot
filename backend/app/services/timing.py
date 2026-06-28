"""
Timing engine — compute optimal entry window for tick-precise order placement.
"""
import asyncio
import logging
import time
from typing import Awaitable, Callable

logger = logging.getLogger(__name__)

SAFETY_BUFFER_MS = 80  # ms headroom before next tick


def estimate_tick_interval(recent_times: list[float]) -> float:
    """
    Average ms between ticks from a list of epoch timestamps (seconds).
    Falls back to 1000ms if fewer than 2 samples.
    """
    if len(recent_times) < 2:
        return 1000.0
    diffs = [
        (recent_times[i + 1] - recent_times[i]) * 1000
        for i in range(len(recent_times) - 1)
    ]
    return sum(diffs) / len(diffs)


def compute_entry_window(tick_interval_ms: float, rtt_ms: float) -> float:
    """
    Time available after the current tick to submit an order that arrives
    before the next tick.
    Formula: tick_interval − rtt − SAFETY_BUFFER_MS
    Returns 0 if the result would be negative.
    """
    return max(tick_interval_ms - rtt_ms - SAFETY_BUFFER_MS, 0.0)


def should_fire_now(
    last_tick_epoch: float, rtt_ms: float, tick_interval_ms: float
) -> tuple[bool, float]:
    """
    (fire_now, ms_until_next_tick)
    fire_now: True if we are inside the safe entry window after the last tick.
    """
    elapsed_ms = (time.time() - last_tick_epoch) * 1000
    window_ms = compute_entry_window(tick_interval_ms, rtt_ms)
    fire_now = elapsed_ms < window_ms
    ms_until_next = max(tick_interval_ms - elapsed_ms, 0.0)
    return fire_now, ms_until_next


async def schedule_entry(
    last_tick_epoch: float,
    rtt_ms: float,
    tick_interval_ms: float,
    execute_fn: Callable[..., Awaitable],
    *args,
    **kwargs,
):
    """
    Wait until the optimal entry window opens, then call execute_fn(*args, **kwargs).
    If already inside the window, fires immediately.
    """
    fire_now, ms_until_next = should_fire_now(last_tick_epoch, rtt_ms, tick_interval_ms)
    if not fire_now:
        wait_s = ms_until_next / 1000.0
        logger.info(f"Timing: waiting {wait_s:.3f}s for entry window")
        await asyncio.sleep(wait_s)
    return await execute_fn(*args, **kwargs)


def timing_info(
    last_tick_epoch: float, rtt_ms: float, tick_interval_ms: float
) -> dict:
    """Timing snapshot to broadcast to the frontend."""
    entry_window_ms = compute_entry_window(tick_interval_ms, rtt_ms)
    _, ms_until_next = should_fire_now(last_tick_epoch, rtt_ms, tick_interval_ms)
    return {
        "rtt_ms": round(rtt_ms, 1),
        "tick_interval_ms": round(tick_interval_ms, 1),
        "entry_window_ms": round(entry_window_ms, 1),
        "next_tick_in_ms": round(ms_until_next, 1),
    }
