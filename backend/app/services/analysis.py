"""
Analysis engine — signal extraction based on statistical EDGE, not raw probability.

Key principle: confidence reflects deviation from the theoretical baseline.
- DIGITMATCH base = 10%  → signal only when Markov + gap + deficit shows true excess
- EVEN/ODD base = 50%   → signal only when observed rate OR streak reversal creates edge
- RISE/FALL             → signal only on streak reversal (direction alone is noise)
- OVER/UNDER            → signal only when observed rate exceeds theoretical by ≥ 10 pp
  e.g. OVER 2 theoretical = 70%, so we need observed > 80% to signal
  This eliminates "always high" artefacts like UNDER 8 (80% theoretical).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

MIN_OVER_UNDER_EDGE = 0.10  # minimum deviation from theoretical to signal OVER/UNDER
MIN_EVEN_ODD_EDGE  = 0.05  # minimum deviation from 50% to signal EVEN/ODD
MIN_STREAK_REVERSAL = 6    # streak length to trigger reversal signal


@dataclass
class Signal:
    symbol: str
    name: str
    strategy: str            # digit_match | even_odd | rise_fall | over_under
    contract_type: str       # DIGITMATCH | DIGITEVEN | CALL | DIGITOVER …
    barrier: str             # digit string, or ""
    duration: int            # ticks
    confidence: float        # 0–1 (deviation-based, not raw probability)
    edge: float              # confidence − 0.5
    grade: Literal["A", "B"]
    explanation: str = ""
    meta: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Core statistics
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
        matrix.append([c / total for c in row] if total else [0.1] * 10)
    return matrix


def _gap_score(digits: list[int], target: int) -> float:
    """Ticks since target last appeared, normalised 0–1 (1 = very overdue)."""
    for i, d in enumerate(reversed(digits)):
        if d == target:
            return min(i / 50.0, 1.0)
    return 1.0


def _streak_length(seq: list, classify) -> int:
    """Length of current run of same class at tail of seq."""
    if not seq:
        return 0
    cls = classify(seq[-1])
    count = 0
    for v in reversed(seq):
        if classify(v) == cls:
            count += 1
        else:
            break
    return count


# ---------------------------------------------------------------------------
# Strategy scorers — all return EDGE (deviation from baseline)
# ---------------------------------------------------------------------------

def score_digit_match(digits: list[int], matrix: list[list[float]]) -> list[dict]:
    """
    Score each digit 0–9 for DIGITMATCH.
    composite = 0.5×markov_prob + 0.3×freq_deficit_norm + 0.2×gap_score
    All three components reward digits that are statistically overdue / predicted.
    Sorted by composite desc.
    """
    n = len(digits)
    freq = [digits.count(d) / n for d in range(10)] if n else [0.1] * 10
    last = digits[-1] if digits else 0
    results = []
    for d in range(10):
        markov = matrix[last][d]
        deficit = max(0.1 - freq[d], 0.0)    # positive when digit is underrepresented
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
    """
    Edge = |observed_rate − 0.5|.
    Streak reversal adds additional edge when current run is long.
    """
    if not digits:
        return {"edge": 0.0, "side": "even", "observed": 0.5, "streak": 0}
    n = len(digits)
    observed_even = sum(1 for d in digits if d % 2 == 0) / n
    observed_odd  = 1.0 - observed_even
    streak = _streak_length(digits, lambda d: d % 2)

    # Favour the side with higher observed rate
    if observed_even >= observed_odd:
        side, observed = "even", observed_even
    else:
        side, observed = "odd", observed_odd

    base_edge = observed - 0.5

    # Streak reversal: long run of one class → predict the other
    reversal_bonus = max((streak - MIN_STREAK_REVERSAL) * 0.02, 0.0) if streak >= MIN_STREAK_REVERSAL else 0.0
    if reversal_bonus > 0:
        # Flip to the opposite side
        side = "odd" if side == "even" else "even"
        observed = 1.0 - observed

    edge = base_edge + reversal_bonus
    return {
        "edge": round(edge, 4),
        "side": side,
        "observed": round(observed, 4),
        "streak": streak,
    }


def score_rise_fall(prices: list[float]) -> dict | None:
    """
    Only signals on streak reversal (raw direction is noise).
    Returns None when no actionable reversal is detected.
    """
    if len(prices) < 10:
        return None
    diffs = [prices[i + 1] - prices[i] for i in range(len(prices) - 1)]
    streak = _streak_length(diffs, lambda d: 1 if d > 0 else 0)
    if streak < MIN_STREAK_REVERSAL:
        return None

    # Predict reversal of current direction
    current_up = diffs[-1] > 0
    direction = "fall" if current_up else "rise"
    edge = min((streak - MIN_STREAK_REVERSAL) * 0.025, 0.30)
    return {
        "direction": direction,
        "streak": streak,
        "edge": round(edge, 4),
    }


def score_over_under(digits: list[int]) -> dict | None:
    """
    For each threshold 1–8, compute observed vs theoretical win rate.
    Only returns a result when the deviation is ≥ MIN_OVER_UNDER_EDGE.

    Theoretical:
      DIGITOVER t: P(d > t) = (9 − t) / 10
      DIGITUNDER t: P(d < t) = t / 10   (note: strict less-than)

    This eliminates 'always-high' signals like UNDER 8 (theoretical 80%)
    unless the last 1000 ticks show > 90%.
    """
    if not digits:
        return None
    n = len(digits)
    best: dict | None = None
    best_edge = 0.0

    for t in range(1, 9):
        # DIGITOVER t
        theo_over = (9 - t) / 10
        obs_over  = sum(1 for d in digits if d > t) / n
        over_edge = obs_over - theo_over

        # DIGITUNDER t  (wins when d < t, i.e. d ≤ t−1)
        theo_under = t / 10
        obs_under  = sum(1 for d in digits if d < t) / n
        under_edge = obs_under - theo_under

        for side, edge, contract_type, obs, theo in [
            ("over",  over_edge,  "DIGITOVER",  obs_over,  theo_over),
            ("under", under_edge, "DIGITUNDER", obs_under, theo_under),
        ]:
            if edge > best_edge:
                best_edge = edge
                best = {
                    "threshold": t,
                    "side": side,
                    "contract_type": contract_type,
                    "edge": round(edge, 4),
                    "observed": round(obs, 4),
                    "theoretical": round(theo, 4),
                }

    if best and best_edge >= MIN_OVER_UNDER_EDGE:
        return best
    return None


def detect_volatility_regime(prices: list[float], window: int = 50) -> str:
    """Low / medium / high based on mean absolute return of recent ticks."""
    sample = prices[-window:] if len(prices) >= window else prices
    if len(sample) < 2:
        return "medium"
    returns = [abs(sample[i+1] - sample[i]) / sample[i] for i in range(len(sample)-1) if sample[i]]
    if not returns:
        return "medium"
    avg = sum(returns) / len(returns)
    if avg < 0.0003:
        return "low"
    if avg < 0.001:
        return "medium"
    return "high"


def recommend_duration(volatility_regime: str) -> int:
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
    return {
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
    }.get(symbol, symbol)


def extract_signals(
    symbol: str, digits: list[int], prices: list[float]
) -> list[Signal]:
    """
    Run all strategies and return Grade A/B signals sorted by confidence desc.
    All confidences are deviation-based — not raw win probability.
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
    # composite ∈ [0, ~0.6]; map to confidence around [0.50, 0.95]
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
                "regime": regime,
            },
        ))

    # --- EVEN / ODD ---
    eo = score_even_odd(digits)
    if eo["edge"] >= MIN_EVEN_ODD_EDGE:
        confidence = min(0.50 + eo["edge"], 0.95)
        grade = _grade(confidence)
        if grade:
            ct = "DIGITEVEN" if eo["side"] == "even" else "DIGITODD"
            signals.append(Signal(
                symbol=symbol, name=name,
                strategy="even_odd", contract_type=ct,
                barrier="", duration=duration,
                confidence=round(confidence, 4),
                edge=round(eo["edge"], 4),
                grade=grade,
                meta={
                    "side": eo["side"],
                    "observed": eo["observed"],
                    "streak": eo["streak"],
                },
            ))

    # --- RISE / FALL ---
    rf_prices = prices[-200:] if len(prices) >= 200 else prices
    rf = score_rise_fall(rf_prices)
    if rf:
        confidence = min(0.50 + rf["edge"], 0.95)
        grade = _grade(confidence)
        if grade:
            ct = "CALL" if rf["direction"] == "rise" else "PUT"
            signals.append(Signal(
                symbol=symbol, name=name,
                strategy="rise_fall", contract_type=ct,
                barrier="", duration=duration,
                confidence=round(confidence, 4),
                edge=round(rf["edge"], 4),
                grade=grade,
                meta={
                    "direction": rf["direction"],
                    "streak": rf["streak"],
                },
            ))

    # --- OVER / UNDER ---
    ou = score_over_under(digits)
    if ou:
        confidence = min(0.50 + ou["edge"], 0.95)
        grade = _grade(confidence)
        if grade:
            signals.append(Signal(
                symbol=symbol, name=name,
                strategy="over_under", contract_type=ou["contract_type"],
                barrier=str(ou["threshold"]), duration=duration,
                confidence=round(confidence, 4),
                edge=round(ou["edge"], 4),
                grade=grade,
                meta={
                    "threshold": ou["threshold"],
                    "observed": ou["observed"],
                    "theoretical": ou["theoretical"],
                },
            ))

    signals.sort(key=lambda s: s.confidence, reverse=True)
    return signals
