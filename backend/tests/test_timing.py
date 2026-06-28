"""Tests for the timing engine (3G)."""
import time
import pytest
from app.services.timing import (
    compute_entry_window,
    estimate_tick_interval,
    should_fire_now,
    timing_info,
)

SAFETY = 80  # matches SAFETY_BUFFER_MS in timing.py


class TestEstimateTickInterval:
    def test_single_sample_fallback(self):
        assert estimate_tick_interval([1000.0]) == 1000.0

    def test_empty_fallback(self):
        assert estimate_tick_interval([]) == 1000.0

    def test_correct_average(self):
        times = [0.0, 1.0, 2.0, 3.0]  # 1s gaps
        result = estimate_tick_interval(times)
        assert abs(result - 1000.0) < 1.0

    def test_irregular_intervals(self):
        times = [0.0, 0.9, 2.1]  # gaps: 0.9s, 1.2s → avg 1.05s
        result = estimate_tick_interval(times)
        assert abs(result - 1050.0) < 1.0


class TestComputeEntryWindow:
    def test_normal_case(self):
        window = compute_entry_window(tick_interval_ms=1000, rtt_ms=50)
        assert window == 1000 - 50 - SAFETY

    def test_floor_at_zero(self):
        # rtt larger than interval → no safe window
        window = compute_entry_window(tick_interval_ms=100, rtt_ms=200)
        assert window == 0.0

    def test_exact_boundary(self):
        window = compute_entry_window(tick_interval_ms=1000, rtt_ms=920)
        assert window == 0.0


class TestShouldFireNow:
    def test_fires_when_just_after_tick(self):
        last_tick = time.time() - 0.010  # 10ms ago
        fire, _ = should_fire_now(last_tick, rtt_ms=50, tick_interval_ms=1000)
        # entry_window = 1000-50-80=870ms; elapsed=10ms → should fire
        assert fire is True

    def test_does_not_fire_when_too_late(self):
        last_tick = time.time() - 0.950  # 950ms ago, window=870ms → expired
        fire, _ = should_fire_now(last_tick, rtt_ms=50, tick_interval_ms=1000)
        assert fire is False

    def test_ms_until_next_non_negative(self):
        last_tick = time.time()
        _, ms_until = should_fire_now(last_tick, rtt_ms=50, tick_interval_ms=1000)
        assert ms_until >= 0.0

    def test_entry_window_positive_when_rtt_small(self):
        window = compute_entry_window(tick_interval_ms=1000, rtt_ms=42)
        assert window > 0


class TestTimingInfo:
    def test_keys_present(self):
        info = timing_info(time.time(), rtt_ms=42, tick_interval_ms=1000)
        assert set(info.keys()) == {
            "rtt_ms", "tick_interval_ms", "entry_window_ms", "next_tick_in_ms"
        }

    def test_entry_window_matches_formula(self):
        info = timing_info(time.time(), rtt_ms=42, tick_interval_ms=1000)
        assert abs(info["entry_window_ms"] - (1000 - 42 - SAFETY)) < 1.0

    def test_values_non_negative(self):
        info = timing_info(time.time(), rtt_ms=42, tick_interval_ms=1000)
        for v in info.values():
            assert v >= 0.0
