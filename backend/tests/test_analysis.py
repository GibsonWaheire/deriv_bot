"""Tests for the analysis engine (3G)."""
import pytest
from app.services.analysis import (
    build_transition_matrix,
    extract_signals,
    score_digit_match,
    score_even_odd,
    score_over_under,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

DIGITS_100 = [3, 7, 2, 5, 3, 8, 1, 3, 4, 3, 9, 0, 3, 6, 2, 3, 7, 3, 1, 5,
              3, 8, 0, 3, 4, 3, 7, 2, 3, 9, 1, 3, 5, 3, 8, 3, 0, 4, 3, 7,
              5, 3, 8, 3, 1, 0, 3, 7, 3, 4, 2, 3, 9, 6, 3, 2, 7, 3, 5, 8,
              3, 1, 3, 0, 4, 3, 7, 2, 3, 9, 3, 5, 8, 1, 3, 0, 3, 4, 7, 3,
              2, 5, 3, 8, 3, 1, 0, 3, 7, 4, 3, 9, 3, 5, 8, 1, 3, 0, 4, 3]

PRICES_100 = [5000.0 + i * 0.01 + (i % 7) * 0.1 for i in range(100)]


# ---------------------------------------------------------------------------
# Transition matrix
# ---------------------------------------------------------------------------

class TestTransitionMatrix:
    def test_shape(self):
        matrix = build_transition_matrix(DIGITS_100)
        assert len(matrix) == 10
        assert all(len(row) == 10 for row in matrix)

    def test_rows_sum_to_one(self):
        matrix = build_transition_matrix(DIGITS_100)
        for i, row in enumerate(matrix):
            total = sum(row)
            assert abs(total - 1.0) < 0.001, f"Row {i} sums to {total}"

    def test_empty_row_uniform(self):
        # digit 9 never appears in this short sequence → uniform prior
        matrix = build_transition_matrix([0, 1, 2, 3, 4, 5, 6, 7, 8])
        assert matrix[9] == [0.1] * 10

    def test_empty_digits_all_uniform(self):
        matrix = build_transition_matrix([])
        for row in matrix:
            assert row == [0.1] * 10


# ---------------------------------------------------------------------------
# Signal sorting and grading
# ---------------------------------------------------------------------------

class TestExtractSignals:
    def test_sorted_by_tier_then_confidence(self):
        """Signals are sorted: safe first, then medium, then precision.
        Within each tier, higher confidence comes first."""
        tier_order = {"safe": 0, "medium": 1, "precision": 2}
        signals = extract_signals("1HZ100V", DIGITS_100, PRICES_100)
        for i in range(len(signals) - 1):
            a, b = signals[i], signals[i + 1]
            ta, tb = tier_order[a.tier], tier_order[b.tier]
            assert ta <= tb, f"Tier order wrong: {a.tier} before {b.tier}"
            if ta == tb:
                assert a.confidence >= b.confidence

    def test_grade_a_threshold(self):
        signals = extract_signals("1HZ100V", DIGITS_100, PRICES_100)
        for s in signals:
            if s.grade == "A":
                assert s.confidence >= 0.65, f"Grade A signal has confidence {s.confidence}"

    def test_grade_b_threshold(self):
        signals = extract_signals("1HZ100V", DIGITS_100, PRICES_100)
        for s in signals:
            if s.grade == "B":
                assert 0.55 <= s.confidence < 0.65, (
                    f"Grade B signal has confidence {s.confidence}"
                )

    def test_no_signals_below_55(self):
        # DIGITMATCH precision signals have honest low confidence (~10-35% base rate)
        signals = extract_signals("1HZ100V", DIGITS_100, PRICES_100)
        for s in signals:
            if s.tier != "precision":
                assert s.confidence >= 0.55

    def test_too_few_digits_returns_empty(self):
        signals = extract_signals("1HZ100V", DIGITS_100[:10], PRICES_100[:10])
        assert signals == []

    def test_symbol_name_populated(self):
        signals = extract_signals("1HZ100V", DIGITS_100, PRICES_100)
        for s in signals:
            assert s.name == "Volatility 100 (1s)"


# ---------------------------------------------------------------------------
# Individual scorers
# ---------------------------------------------------------------------------

class TestScoreDigitMatch:
    def test_returns_10_entries(self):
        scores = score_digit_match(DIGITS_100)
        assert len(scores) == 10

    def test_sorted_desc(self):
        scores = score_digit_match(DIGITS_100)
        for i in range(len(scores) - 1):
            assert scores[i]["composite"] >= scores[i + 1]["composite"]

    def test_digits_in_range(self):
        scores = score_digit_match(DIGITS_100)
        assert {s["digit"] for s in scores} == set(range(10))

    def test_no_markov_prob_key(self):
        scores = score_digit_match(DIGITS_100)
        assert "markov_prob" not in scores[0]  # Markov removed


class TestScoreEvenOdd:
    def test_returns_edge_and_side(self):
        result = score_even_odd(DIGITS_100)
        assert "edge" in result
        assert "side" in result
        assert result["side"] in ("even", "odd")

    def test_edge_non_negative(self):
        result = score_even_odd(DIGITS_100)
        assert result["edge"] >= 0.0

    def test_empty_returns_zero_edge(self):
        result = score_even_odd([])
        assert result["edge"] == 0.0

    def test_streak_non_negative(self):
        result = score_even_odd(DIGITS_100)
        assert result["streak"] >= 0

    def test_observed_bounded(self):
        result = score_even_odd(DIGITS_100)
        assert 0.0 <= result["observed"] <= 1.0


class TestScoreOverUnder:
    def test_returns_none_or_dict(self):
        result = score_over_under(DIGITS_100)
        assert result is None or isinstance(result, dict)

    def test_threshold_in_range_when_present(self):
        # Use a biased sequence to guarantee a result
        biased = [9] * 80 + [0] * 20  # digit 9 appears 80% — OVER 8 theoretical=10%, edge=70%
        result = score_over_under(biased)
        assert result is not None
        assert 1 <= result["threshold"] <= 8

    def test_edge_exceeds_minimum(self):
        biased = [9] * 80 + [0] * 20
        result = score_over_under(biased)
        assert result is not None
        assert result["edge"] >= 0.10

    def test_no_signal_on_uniform(self):
        # Perfectly uniform distribution → no deviation → no signal
        uniform = list(range(10)) * 10  # 10 of each digit
        result = score_over_under(uniform)
        assert result is None


