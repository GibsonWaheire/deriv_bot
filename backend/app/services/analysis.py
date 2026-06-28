"""
Analysis engine — Markov transition matrix, statistical scoring, signal extraction.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


@dataclass
class Signal:
    symbol: str
    name: str
    strategy: str           # digit_match | even_odd | rise_fall | over_under
    contract_type: str      # DIGITMATCH | DIGITEVEN | CALL | DIGITOVER …
    barrier: str            # digit string, or "" for even/odd/rise/fall
    duration: int           # ticks
    confidence: float       # 0–1
    edge: float             # confidence − 0.5
    grade: Literal["A", "B"]
    explanation: str = ""
    meta: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Core statistical functions
# ---------------------------------------------------------------------------

def build_transition_matrix(digits: list[int]) -> list[list[float]]:
    """
    10×10 Markov transition matrix.
    matrix[i][j] = P(next digit = j | current digit = i)
    Rows sum to 1.0; uniform prior for rows with no data.
    """
    counts = [[0] * 10 for _ in range(10)]
    for i in range(len(digits) - 1):
        counts[digits[i]][digits[i + 1]] += 1
    matrix = []
    for row in counts:
        total = sum(row)
        if total == 0:
            matrix.append([0.1] * 10)
        else:
            matrix.append([c / total for c in row])
    return matrix


def _gap_score(digits: list[int], target: int) -> float:
    """Normalised ticks-since-last-appearance (0–1). 1 = very overdue."""
    for i, d in enumerate(reversed(digits)):
        if d == target:
            return min(i / 50.0, 1.0)
    return 1.0


def _current_streak(seq: list, classify) -> int:
    """Length of current same-class streak at the end of seq."""
    if not seq:
        return 0
    cls = classify(seq[-1])
    streak = 0
    for v in reversed(seq):
        if classify(v) == cls:
            streak += 1
        else:
            break
    return streak


# ---------------------------------------------------------------------------
# Per-strategy scoring
# ---------------------------------------------------------------------------

def score_digit_match(
    digits: list[int], matrix: list[list[float]]
) -> list[dict]:
    """
    Score each digit 0–9 for DIGITMATCH.
    composite = 0.5 * markov_prob + 0.3 * freq_deficit_normalised + 0.2 * gap_score
    Returns list sorted by composite desc.
    """
    n = len(digits)
    freq = [digits.count(d) / n for d in range(10)] if n else [0.1] * 10
    last = digits[-1] if digits else 0
    results = []
    for d in range(10):
        markov = matrix[last][d]
        deficit = max(0.1 - freq[d], 0.0)
        gap = _gap_score(digits, d)
        composite = 0.5 * markov + 0.3 * (deficit * 10) + 0.2 * gap
        results.append({
            "digit": d,
            "markov_prob": round(markov, 4),
            "frequency": round(freq[d], 4),
            "freq_deficit": round(deficit, 4),
            "gap_score": round(gap, 4),
            "composite": round(composite, 4),
        })
    results.sort(key=lambda x: x["composite"], reverse=True)
    return results


def score_even_odd(digits: list[int]) -> dict:
    """Score DIGITEVEN / DIGITODD."""
    if not digits:
        return {"pEven": 0.5, "pOdd": 0.5, "streak": 0}
    n = len(digits)
    p_even = sum(1 for d in digits if d % 2 == 0) / n
    streak = _current_streak(digits, lambda d: d % 2)
    return {
        "pEven": round(p_even, 4),
        "pOdd": round(1 - p_even, 4),
        "streak": streak,
    }


def score_rise_fall(prices: list[float]) -> dict:
    """Score CALL / PUT based on directional momentum."""
    if len(prices) < 2:
        return {"pRise": 0.5, "pFall": 0.5, "streak": 0, "reversal_prob": 0.5}
    diffs = [prices[i + 1] - prices[i] for i in range(len(prices) - 1)]
    n = len(diffs)
    p_rise = sum(1 for d in diffs if d > 0) / n
    streak = _current_streak(diffs, lambda d: 1 if d > 0 else 0)
    # Long streak → mean reversion signal
    reversal_prob = min(0.5 + streak * 0.05, 0.85)
    return {
        "pRise": round(p_rise, 4),
        "pFall": round(1 - p_rise, 4),
        "streak": streak,
        "reversal_prob": round(reversal_prob, 4),
    }


def score_over_under(digits: list[int]) -> dict:
    """
    DIGITOVER / DIGITUNDER for thresholds 1–8.
    Returns best_threshold (highest edge from 50%) and probs dict.
    """
    if not digits:
        return {"best_threshold": 4, "probs": {t: 0.5 for t in range(1, 9)}}
    n = len(digits)
    probs = {t: round(sum(1 for d in digits if d > t) / n, 4) for t in range(1, 9)}
    best_t = max(probs, key=lambda t: abs(probs[t] - 0.5))
    return {"best_threshold": best_t, "probs": probs}


def detect_volatility_regime(prices: list[float], window: int = 50) -> str:
    """Low / medium / high based on mean absolute return of recent prices."""
    sample = prices[-window:] if len(prices) >= window else prices
    if len(sample) < 2:
        return "medium"
    returns = [
        abs(sample[i + 1] - sample[i]) / sample[i]
        for i in range(len(sample) - 1)
        if sample[i] != 0
    ]
    if not returns:
        return "medium"
    avg = sum(returns) / len(returns)
    if avg < 0.0003:
        return "low"
    if avg < 0.001:
        return "medium"
    return "high"


def recommend_duration(volatility_regime: str) -> int:
    """Tick duration: 5 ticks in low vol, 2 in medium, 1 in high."""
    return {"low": 5, "medium": 2, "high": 1}[volatility_regime]


# ---------------------------------------------------------------------------
# Signal extraction
# ---------------------------------------------------------------------------

def _grade(confidence: float) -> str | None:
    if confidence >= 0.65:
        return "A"
    if confidence >= 0.55:
        return "B"
    return None


def _symbol_name(symbol: str) -> str:
    names = {
        "1HZ100V": "Volatility 100 (1s)",
        "1HZ10V":  "Volatility 10 (1s)",
        "1HZ25V":  "Volatility 25 (1s)",
        "1HZ50V":  "Volatility 50 (1s)",
        "1HZ75V":  "Volatility 75 (1s)",
        "R_100":   "Volatility 100",
        "R_10":    "Volatility 10",
        "R_25":    "Volatility 25",
        "R_50":    "Volatility 50",
        "R_75":    "Volatility 75",
    }
    return names.get(symbol, symbol)


def extract_signals(
    symbol: str, digits: list[int], prices: list[float]
) -> list[Signal]:
    """
    Run all strategies and return Grade A/B signals sorted by confidence desc.
    Filters anything below 55% confidence.
    """
    if len(digits) < 20:
        return []

    regime = detect_volatility_regime(prices if prices else [float(d) for d in digits])
    duration = recommend_duration(regime)
    matrix = build_transition_matrix(digits)
    name = _symbol_name(symbol)
    signals: list[Signal] = []

    # --- DIGITMATCH ---
    scores = score_digit_match(digits, matrix)
    best = scores[0]
    # Map composite (roughly 0–1) to a confidence that can reach grade thresholds
    confidence = min(0.50 + best["composite"] * 1.5, 0.95)
    grade = _grade(confidence)
    if grade:
        d = best["digit"]
        signals.append(Signal(
            symbol=symbol, name=name,
            strategy="digit_match", contract_type="DIGITMATCH",
            barrier=str(d), duration=duration,
            confidence=round(confidence, 4),
            edge=round(confidence - 0.5, 4),
            grade=grade,
            meta={
                "digit": d,
                "markov_prob": best["markov_prob"],
                "frequency": best["frequency"],
                "freq_deficit": best["freq_deficit"],
                "gap_score": best["gap_score"],
                "last_digit": digits[-1],
                "top_digits": [s["digit"] for s in scores[:3]],
                "regime": regime,
            },
        ))

    # --- EVEN / ODD ---
    eo = score_even_odd(digits)
    streak = eo["streak"]
    for side, base_prob in [("even", eo["pEven"]), ("odd", eo["pOdd"])]:
        # Boost confidence when on a long streak (mean reversion)
        adj = base_prob + (0.1 if streak >= 5 else 0.0)
        adj = min(adj, 0.95)
        grade = _grade(adj)
        if grade:
            signals.append(Signal(
                symbol=symbol, name=name,
                strategy="even_odd",
                contract_type="DIGITEVEN" if side == "even" else "DIGITODD",
                barrier="", duration=duration,
                confidence=round(adj, 4),
                edge=round(adj - 0.5, 4),
                grade=grade,
                meta={"side": side, "base_prob": base_prob, "streak": streak},
            ))
            break  # take the stronger side only

    # --- RISE / FALL ---
    rf_prices = prices[-200:] if len(prices) >= 200 else prices
    rf = score_rise_fall(rf_prices)
    streak = rf["streak"]
    # Use reversal signal on long streaks, else raw probability
    if streak >= 5:
        confidence = rf["reversal_prob"]
        direction = "fall" if rf["pRise"] > 0.5 else "rise"
    else:
        if rf["pRise"] >= rf["pFall"]:
            confidence, direction = rf["pRise"], "rise"
        else:
            confidence, direction = rf["pFall"], "fall"
    grade = _grade(confidence)
    if grade:
        signals.append(Signal(
            symbol=symbol, name=name,
            strategy="rise_fall",
            contract_type="CALL" if direction == "rise" else "PUT",
            barrier="", duration=duration,
            confidence=round(confidence, 4),
            edge=round(confidence - 0.5, 4),
            grade=grade,
            meta={
                "direction": direction,
                "pRise": rf["pRise"],
                "pFall": rf["pFall"],
                "streak": streak,
                "reversal_prob": rf["reversal_prob"],
            },
        ))

    # --- OVER / UNDER ---
    ou = score_over_under(digits)
    t = ou["best_threshold"]
    p_over = ou["probs"][t]
    p_under = 1.0 - p_over
    if p_over >= p_under:
        confidence, ct = p_over, "DIGITOVER"
    else:
        confidence, ct = p_under, "DIGITUNDER"
    grade = _grade(confidence)
    if grade:
        signals.append(Signal(
            symbol=symbol, name=name,
            strategy="over_under", contract_type=ct,
            barrier=str(t), duration=duration,
            confidence=round(confidence, 4),
            edge=round(confidence - 0.5, 4),
            grade=grade,
            meta={"threshold": t, "p_over": p_over, "p_under": p_under},
        ))

    signals.sort(key=lambda s: s.confidence, reverse=True)
    return signals
