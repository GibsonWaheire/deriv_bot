"""
Analysis engine — edge-only signal extraction.

Tier "safe"      — DIGITOVER 2 / DIGITUNDER 7: only when rolling-window
                   observed rate beats theoretical by ≥4% (not always-on).
Tier "medium"    — DIGITDIFF (always), DIGITEVEN/ODD, mid-range OVER/UNDER
                   (when rolling window shows ≥4% edge).
Tier "precision" — DIGITMATCH: strict Markov composite + row sample count.

All signals require a detected edge. Trading without edge = negative EV.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

MIN_EVEN_ODD_EDGE        = 0.05  # minimum deviation from 50% to signal EVEN/ODD
MIN_DIGITMATCH_COMPOSITE = 0.40  # composite must exceed this for a precision signal
MIN_DIGITMATCH_ROW_SAMPLES = 50  # min ticks from last digit row to trust Markov
MIN_STREAK_REVERSAL      = 4     # streak length for even/odd reversal bonus
MIN_OVER_UNDER_EDGE      = 0.04  # minimum observed deviation from theoretical to fire
MIN_DIGITDIFF_MARKOV     = 0.05  # chosen digit's Markov prob must be ≤ this (genuine bias away from it)
ROLLING_WINDOW           = 100   # ticks used for EVEN/ODD and OVER/UNDER (short = catches local momentum)
# Safe barriers — only traded when rolling-window observed rate beats theoretical
SAFE_BARRIERS = [
    ("DIGITOVER",  2, 0.70),   # theoretical 70% — only fire when observed ≥ 74%
    ("DIGITUNDER", 7, 0.70),   # theoretical 70% — only fire when observed ≥ 74%
]
# Mid-range barriers: theoretical win rate 40-60%, higher payouts
MID_BARRIERS = [3, 4, 5, 6]   # OVER: 60/50/40/30%  UNDER: 30/40/50/60%


@dataclass
class Signal:
    symbol: str
    name: str
    strategy: str            # digit_match | digit_diff | even_odd | safe
    contract_type: str       # DIGITMATCH | DIGITDIFF | DIGITEVEN | DIGITOVER …
    barrier: str             # digit string, or ""
    duration: int            # ticks
    confidence: float        # 0–1
    edge: float              # confidence − 0.5
    grade: Literal["A", "B"]
    tier: Literal["safe", "medium", "precision"] = "medium"
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


def score_digit_differs(digits: list[int], matrix: list[list[float]]) -> dict:
    """
    Pick the digit with the LOWEST Markov-predicted probability.
    DIGITDIFF on that digit wins when any other digit appears (~90-95% win rate).
    Win probability capped at 0.95 to avoid overconfidence on sparse data.
    """
    last = digits[-1] if digits else 0
    row = matrix[last]
    min_digit = min(range(10), key=lambda d: row[d])
    win_prob = min(round(1.0 - row[min_digit], 4), 0.95)
    return {
        "digit": min_digit,
        "markov_prob": round(row[min_digit], 4),
        "win_probability": win_prob,
    }


def score_over_under(digits: list[int], thresholds: list[int] | None = None) -> dict | None:
    """
    For each threshold, compute observed vs theoretical win rate.
    Only returns a result when the deviation is ≥ MIN_OVER_UNDER_EDGE.

    Theoretical:
      DIGITOVER t: P(d > t) = (9 − t) / 10
      DIGITUNDER t: P(d < t) = t / 10   (note: strict less-than)

    thresholds: which barriers to scan (default 1-8).
      Pass MID_BARRIERS to find mid-range signals with higher payouts.
    """
    if not digits:
        return None
    n = len(digits)
    best: dict | None = None
    best_edge = 0.0

    for t in (thresholds if thresholds is not None else range(1, 9)):
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
        "1HZ10V":  "Volatility 10 (1s)",
        "1HZ25V":  "Volatility 25 (1s)",
        "1HZ50V":  "Volatility 50 (1s)",
        "1HZ75V":  "Volatility 75 (1s)",
        "1HZ100V": "Volatility 100 (1s)",
        "R_10":    "Volatility 10",
        "R_25":    "Volatility 25",
        "R_50":    "Volatility 50",
        "R_75":    "Volatility 75",
        "R_100":   "Volatility 100",
        "JD10":    "Jump 10",
        "JD25":    "Jump 25",
        "JD50":    "Jump 50",
        "JD75":    "Jump 75",
        "JD100":   "Jump 100",
    }.get(symbol, symbol)


def extract_signals(
    symbol: str, digits: list[int], prices: list[float]
) -> list[Signal]:
    """
    Three-tier signal extraction.
    Returns signals sorted by tier priority then confidence.
    """
    if len(digits) < 20:
        return []

    regime = detect_volatility_regime(prices if prices else [float(d) for d in digits])
    duration = recommend_duration(regime)
    matrix = build_transition_matrix(digits)   # full history → reliable Markov matrix
    recent = digits[-ROLLING_WINDOW:]          # short window → catches local momentum
    name = _symbol_name(symbol)
    signals: list[Signal] = []

    # ── TIER: safe ────────────────────────────────────────────────────────────
    # DIGITOVER 2 / DIGITUNDER 7 — only when rolling window shows ≥4% edge
    # over theoretical. Trading them blindly is negative EV (Deriv house edge).
    for ct, barrier, theoretical in SAFE_BARRIERS:
        n_recent = len(recent)
        if ct == "DIGITOVER":
            observed = sum(1 for d in recent if d > barrier) / n_recent
        else:
            observed = sum(1 for d in recent if d < barrier) / n_recent
        edge = observed - theoretical
        if edge >= MIN_OVER_UNDER_EDGE:
            confidence = round(min(observed, 0.92), 4)
            signals.append(Signal(
                symbol=symbol, name=name,
                strategy="safe", contract_type=ct,
                barrier=str(barrier), duration=1,
                confidence=confidence,
                edge=round(edge, 4),
                grade="A",
                tier="safe",
                meta={"theoretical": theoretical, "observed": observed, "edge": edge, "window": ROLLING_WINDOW},
            ))

    # ── TIER: medium ──────────────────────────────────────────────────────────
    # Dynamic OVER/UNDER — uses last 100 ticks so local momentum shows up.
    # Full 1000-tick window smooths out to near-theoretical, masking real deviations.
    ou = score_over_under(recent, thresholds=MID_BARRIERS)
    if ou:
        ou_conf = min(ou["observed"], 0.90)
        ou_grade = _grade(ou_conf)
        if ou_grade:
            signals.append(Signal(
                symbol=symbol, name=name,
                strategy="over_under", contract_type=ou["contract_type"],
                barrier=str(ou["threshold"]), duration=1,
                confidence=round(ou_conf, 4),
                edge=round(ou["edge"], 4),
                grade=ou_grade,
                tier="medium",
                meta={**ou, "window": ROLLING_WINDOW},
            ))

    # DIGITDIFF — only when Markov matrix is genuinely skewed away from chosen digit.
    # Flat row (~10% each) = no real edge; need ≤5% to confirm the matrix is biased.
    dd = score_digit_differs(digits, matrix)
    if dd["markov_prob"] <= MIN_DIGITDIFF_MARKOV:
        signals.append(Signal(
            symbol=symbol, name=name,
            strategy="digit_diff", contract_type="DIGITDIFF",
            barrier=str(dd["digit"]), duration=duration,
            confidence=dd["win_probability"],
            edge=round(dd["win_probability"] - 0.5, 4),
            grade="A",
            tier="medium",
            meta=dd,
        ))

    # DIGITEVEN / DIGITODD — uses last 100 ticks for same reason as OVER/UNDER.
    # 1000-tick even/odd rate is always ~50%; local streaks only visible in short window.
    eo = score_even_odd(recent)
    if eo["edge"] >= MIN_EVEN_ODD_EDGE:
        confidence = min(0.50 + eo["edge"], 0.92)
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
                tier="medium",
                meta={"side": eo["side"], "observed": eo["observed"], "streak": eo["streak"], "window": ROLLING_WINDOW},
            ))

    # ── TIER: precision ───────────────────────────────────────────────────────
    # DIGITMATCH — all three factors (Markov, gap, deficit) must align strongly.
    # Composite threshold raised to 0.40 so this fires selectively, not every cycle.
    # Also require the transition row to have ≥50 observed samples (reliable matrix).
    scores = score_digit_match(digits, matrix)
    best = scores[0]
    last = digits[-1] if digits else 0
    row_samples = sum(1 for i in range(len(digits) - 1) if digits[i] == last)

    if best["composite"] >= MIN_DIGITMATCH_COMPOSITE and row_samples >= MIN_DIGITMATCH_ROW_SAMPLES:
        # Grade based on composite strength (not confidence, which reflects ~10% base rate).
        # composite ≥ 0.55 → all three factors strongly aligned → Grade A
        # composite 0.40-0.55 → solid signal but weaker alignment → Grade B
        grade = "A" if best["composite"] >= 0.55 else "B"
        # Confidence = honest Markov+frequency blend, capped at 0.35
        markov_conf = best["markov_prob"]
        freq_conf   = best["frequency"] + best["freq_deficit"]
        confidence  = round(min(0.5 * markov_conf + 0.5 * freq_conf, 0.35), 4)
        d = best["digit"]
        signals.append(Signal(
            symbol=symbol, name=name,
            strategy="digit_match", contract_type="DIGITMATCH",
            barrier=str(d), duration=duration,
            confidence=round(confidence, 4),
            edge=round(confidence - 0.10, 4),  # edge vs 10% base rate
            grade=grade,
            tier="precision",
                meta={
                    "digit": d,
                    "markov_prob": best["markov_prob"],
                    "frequency": best["frequency"],
                    "freq_deficit": best["freq_deficit"],
                    "gap_score": best["gap_score"],
                    "composite": best["composite"],
                    "row_samples": row_samples,
                    "last_digit": digits[-1],
                    "regime": regime,
                },
            ))

    # Sort: safe first, then medium, then precision; within tier by confidence desc
    tier_order = {"safe": 0, "medium": 1, "precision": 2}
    signals.sort(key=lambda s: (tier_order[s.tier], -s.confidence))
    return signals
