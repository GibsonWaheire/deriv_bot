"""
Claude AI signal explainer with Redis caching (30s TTL).
Falls back to a template string if Claude is unavailable.
"""
import logging

import anthropic

from app.core.config import settings
from app.core.redis_client import get_redis

logger = logging.getLogger(__name__)

MODEL = "claude-haiku-4-5-20251001"
CACHE_TTL = 30  # seconds

_client: anthropic.AsyncAnthropic | None = None


def _get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _client


def _cache_key(signal_data: dict) -> str:
    symbol = signal_data.get("symbol", "")
    strategy = signal_data.get("strategy", "")
    barrier = signal_data.get("barrier", "")
    confidence = round(signal_data.get("confidence", 0.0), 1)
    return f"explain:{symbol}:{strategy}:{barrier}:{confidence}"


def _fallback(signal_data: dict) -> str:
    """Template explanation when Claude is unavailable."""
    strategy = signal_data.get("strategy", "")
    confidence = signal_data.get("confidence", 0.0)
    meta = signal_data.get("meta", {})

    if strategy == "digit_match":
        d = meta.get("digit", "?")
        markov = meta.get("markov_prob", 0.0)
        gap = meta.get("gap_score", 0.0)
        return (
            f"Digit {d} has a Markov transition probability of {markov:.1%} from the "
            f"last observed digit, exceeding the 10% baseline. "
            f"A gap score of {gap:.2f} indicates the digit is statistically overdue to appear."
        )
    if strategy == "even_odd":
        side = meta.get("side", "even")
        streak = meta.get("streak", 0)
        prob = meta.get("base_prob", 0.0)
        return (
            f"The {side} class has appeared {prob:.1%} of the time in recent history "
            f"with a current run of {streak} consecutive ticks. "
            f"Mean-reversion dynamics support a continuation of this bias."
        )
    if strategy == "rise_fall":
        direction = meta.get("direction", "rise")
        streak = meta.get("streak", 0)
        return (
            f"Price has moved {'up' if direction == 'rise' else 'down'} for "
            f"{streak} consecutive ticks, creating a {confidence:.1%} confidence signal. "
            f"Statistical momentum supports continuation of this directional move."
        )
    if strategy == "over_under":
        t = meta.get("threshold", 4)
        p_over = meta.get("p_over", 0.5)
        return (
            f"With barrier {t}, the over-probability is {p_over:.1%} versus the "
            f"expected 50%, representing a {confidence - 0.5:.1%} edge. "
            f"Recent digit distribution confirms this threshold bias."
        )
    return (
        f"Signal confidence is {confidence:.1%} based on statistical analysis "
        f"of recent tick data across multiple indicators."
    )


async def explain_signal(signal_data: dict) -> str:
    """
    Return a 2-sentence AI explanation for a signal.
    Uses Redis cache (30s TTL). Calls Claude Haiku if not cached.
    Falls back to template on error or missing API key.
    """
    if not settings.anthropic_api_key:
        return _fallback(signal_data)

    redis = get_redis()
    key = _cache_key(signal_data)

    cached = await redis.get(key)
    if cached:
        return cached.decode() if isinstance(cached, bytes) else cached

    meta = signal_data.get("meta", {})
    strategy = signal_data.get("strategy", "")
    confidence = signal_data.get("confidence", 0.0)
    barrier = signal_data.get("barrier", "")
    duration = signal_data.get("duration", 1)
    instrument = signal_data.get("name", signal_data.get("symbol", ""))

    stat_lines = [
        f"Strategy: {strategy}",
        f"Instrument: {instrument}",
        f"Confidence: {confidence:.1%}",
        f"Target: {'digit ' + barrier if barrier else strategy}",
        f"Duration: {duration} tick(s)",
    ]
    for k, v in meta.items():
        if isinstance(v, float):
            stat_lines.append(f"{k}: {v:.4f}")
        else:
            stat_lines.append(f"{k}: {v}")

    prompt = (
        "You are a trading signal explainer for Deriv synthetic indices.\n"
        "Given these statistics:\n"
        + "\n".join(stat_lines)
        + "\n\nExplain in exactly 2 sentences why this signal is worth acting on. "
        "Be specific about the numbers. Do not add disclaimers or risk warnings."
    )

    try:
        response = await _get_client().messages.create(
            model=MODEL,
            max_tokens=120,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text.strip()
        await redis.setex(key, CACHE_TTL, text)
        return text
    except Exception as e:
        logger.warning(f"Claude explain failed: {e}")
        return _fallback(signal_data)
