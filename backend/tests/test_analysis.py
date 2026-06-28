"""Tests for the analysis engine (3G)."""
import pytest
from app.services.analysis import (
    build_transition_matrix,
    extract_signals,
    score_digit_match,
    score_even_odd,
    score_over_under,
    score_rise_fall,
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
    def test_sorted_by_confidence_desc(self):
        signals = extract_signals("1HZ100V", DIGITS_100, PRICES_100)
        for i in range(len(signals) - 1):
            assert signals[i].confidence >= signals[i + 1].confidence

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
        signals = extract_signals("1HZ100V", DIGITS_100, PRICES_100)
        for s in signals:
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
        matrix = build_transition_matrix(DIGITS_100)
        scores = score_digit_match(DIGITS_100, matrix)
        assert len(scores) == 10

    def test_sorted_desc(self):
        matrix = build_transition_matrix(DIGITS_100)
        scores = score_digit_match(DIGITS_100, matrix)
        for i in range(len(scores) - 1):
            assert scores[i]["composite"] >= scores[i + 1]["composite"]

    def test_digits_in_range(self):
        matrix = build_transition_matrix(DIGITS_100)
        scores = score_digit_match(DIGITS_100, matrix)
        assert {s["digit"] for s in scores} == set(range(10))


class TestScoreEvenOdd:
    def test_probs_sum_to_one(self):
        result = score_even_odd(DIGITS_100)
        assert abs(result["pEven"] + result["pOdd"] - 1.0) < 0.0001

    def test_empty_returns_half(self):
        result = score_even_odd([])
        assert result["pEven"] == 0.5
        assert result["pOdd"] == 0.5

    def test_streak_non_negative(self):
        result = score_even_odd(DIGITS_100)
        assert result["streak"] >= 0


class TestScoreOverUnder:
    def test_threshold_in_range(self):
        result = score_over_under(DIGITS_100)
        assert 1 <= result["best_threshold"] <= 8

    def test_probs_keys(self):
        result = score_over_under(DIGITS_100)
        assert set(result["probs"].keys()) == set(range(1, 9))

    def test_probs_valid(self):
        result = score_over_under(DIGITS_100)
        for p in result["probs"].values():
            assert 0.0 <= p <= 1.0


class TestScoreRiseFall:
    def test_probs_sum_to_one(self):
        result = score_rise_fall(PRICES_100)
        assert abs(result["pRise"] + result["pFall"] - 1.0) < 0.0001

    def test_reversal_prob_bounded(self):
        result = score_rise_fall(PRICES_100)
        assert 0.0 <= result["reversal_prob"] <= 1.0

    def test_too_short_returns_half(self):
        result = score_rise_fall([1.0])
        assert result["pRise"] == 0.5
