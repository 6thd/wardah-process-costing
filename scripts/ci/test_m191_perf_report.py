#!/usr/bin/env python3
"""Regression tests for the M191 performance reporter's per-call Lock attribution.

Each case writes a synthetic workload directory in the exact on-disk format the
harness produces (measured.worker*.log markers + locks.tsv sampler rows) and
runs it through parse_worker_windows()/parse_lock_samples(), the functions the
reporter itself uses.
"""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import m191_perf_report as report  # noqa: E402

INTERVAL = 0.02
T0 = 1_790_000_000_000_000  # microseconds


def marker(kind: str, pid: int, stmt_us: int, clock_us: int) -> str:
    return f"M191_PERF_MEASURE_{kind}|{clock_us / 1e6:.6f}|{pid}|{stmt_us}|{clock_us}"


class Fixture:
    def __init__(self, root: Path) -> None:
        self.dir = root
        self.workers: dict[int, tuple[int, int, int, list[float]]] = {}
        self.rows: list[str] = ["M191_PERF_SAMPLER_READY"]

    def worker(self, n: int, pid: int, start_us: int, end_us: int, latencies=(5.0,)):
        self.workers[n] = (pid, start_us, end_us, list(latencies))
        return self

    def tick(self, *times: int):
        self.rows += [f"T\t{t}" for t in times]
        return self

    def lock(self, sample_us, pid, query_start, event="tuple", blockers="", app=None,
             wait_type="Lock"):
        app = app or "m191perf-post191-core_hot_multiwarehouse-w"
        self.rows.append(
            f"L\t{sample_us}\t{app}\t{pid}\t{query_start}\t{wait_type}\t{event}\t{blockers}"
        )
        return self

    def raw(self, line: str):
        self.rows.append(line)
        return self

    def write(self) -> Path:
        for n, (pid, start_us, end_us, lat) in self.workers.items():
            lines = [marker("START", pid, start_us, start_us + 50)]
            lines += [f"Time: {x:.3f} ms" for x in lat]
            lines.append(marker("END", pid, end_us, end_us + 50))
            (self.dir / f"measured.worker{n}.log").write_text("\n".join(lines) + "\n")
        (self.dir / "locks.tsv").write_text("\n".join(self.rows) + "\n")
        return self.dir

    def parse(self, max_latency_ms: float | None = 500.0) -> dict:
        self.write()
        windows = report.parse_worker_windows(self.dir)
        bound = None if max_latency_ms is None else {w.pid: max_latency_ms for w in windows}
        return report.parse_lock_samples(self.dir / "locks.tsv", INTERVAL, windows, bound)


def ms(n: float) -> int:
    return int(n * 1000)


class PerCallAttribution(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.fx = Fixture(Path(self._tmp.name))
        # two workers, measured window [T0, T0+2s]; ticks cover both ends
        self.fx.worker(1, 101, T0, T0 + ms(2000)).worker(2, 102, T0, T0 + ms(2000))
        self.fx.tick(T0 - ms(5), T0 + ms(1000), T0 + ms(2100))

    def tearDown(self) -> None:
        self._tmp.cleanup()

    # Case 1 -------------------------------------------------------------------
    def test_sequential_calls_on_one_pid_are_not_merged(self):
        a, b = T0 + ms(100), T0 + ms(170)
        for i in range(3):
            self.fx.lock(a + ms(1 + 20 * i), 101, a)
        for i in range(8):
            self.fx.lock(b + ms(1 + 20 * i), 101, b)
        r = self.fx.parse()
        self.assertEqual(r["calls_with_lock_samples"], 2)
        self.assertEqual(r["worst_call_samples"], 8)
        self.assertEqual(r["worst_call_estimate_ms"], 160.0)
        self.assertEqual(r["aggregate_ms"], 220.0)
        # The contiguous same-backend streak still spans both calls; it is a
        # different metric and must never be reported as the per-call value.
        self.assertEqual(r["longest_streak_ms"], 220.0)

    # Case 2 -------------------------------------------------------------------
    def test_one_call_accumulates_across_episodes_and_blocker_changes(self):
        q = T0 + ms(300)
        self.fx.lock(q + ms(1), 101, q, "tuple", "102")
        self.fx.lock(q + ms(21), 101, q, "transactionid", "103")
        # a gap (non-Lock instant: no row) then a second episode, same call
        self.fx.lock(q + ms(101), 101, q, "transactionid", "104")
        r = self.fx.parse()
        self.assertEqual(r["calls_with_lock_samples"], 1)
        self.assertEqual(r["worst_call_samples"], 3)
        self.assertEqual(r["worst_call_estimate_ms"], 60.0)
        self.assertEqual(r["wait_events"], {"transactionid": 2, "tuple": 1})

    # Case 3 -------------------------------------------------------------------
    def test_same_application_name_different_pids_are_independent(self):
        q = T0 + ms(400)
        same_app = "m191perf-post191-manufacturing_consumption_hot_same_warehouse-w"
        for i in range(2):
            self.fx.lock(q + ms(1 + 20 * i), 101, q, app=same_app)
        for i in range(4):
            self.fx.lock(q + ms(1 + 20 * i), 102, q, app=same_app)
        r = self.fx.parse()
        self.assertEqual(r["calls_with_lock_samples"], 2)
        self.assertEqual(r["worst_call_samples"], 4)

    # Case 4 -------------------------------------------------------------------
    def test_missing_query_start_fails_closed(self):
        self.fx.lock(T0 + ms(500), 101, "")
        with self.assertRaises(SystemExit):
            self.fx.parse()

    def test_malformed_query_start_fails_closed(self):
        self.fx.lock(T0 + ms(500), 101, "2026-09-25 10:00:00+00")
        with self.assertRaises(SystemExit):
            self.fx.parse()

    def test_legacy_row_without_call_identity_fails_closed(self):
        self.fx.raw("1790351603.304264\tm191perf-post191-x-w2\t101\ttuple\t102")
        with self.assertRaises(SystemExit):
            self.fx.parse()

    # Case 5 -------------------------------------------------------------------
    def test_fully_sampled_zero_lock_workload_is_zero_not_missing(self):
        r = self.fx.parse()
        self.assertEqual(r["aggregate_ms"], 0.0)
        self.assertEqual(r["worst_call_estimate_ms"], 0.0)
        self.assertEqual(r["worst_call_samples"], 0)
        self.assertEqual(r["sampler_ticks_in_window"], 1)

    # Window / control-SQL / population invariants -----------------------------
    def test_samples_outside_measured_window_do_not_count(self):
        warm = T0 - ms(30)  # a warm-up call started before START
        self.fx.lock(T0 + ms(1), 101, warm)
        after = T0 + ms(2000) + 10  # a statement after END's own start
        self.fx.lock(after + 5, 101, after)
        r = self.fx.parse()
        self.assertEqual(r["aggregate_ms"], 0.0)
        self.assertEqual(r["excluded_outside_window_samples"], 2)

    def test_marker_statements_are_never_measured_calls(self):
        self.fx.lock(T0 + 10, 101, T0)  # START marker's own query_start
        self.fx.lock(T0 + ms(2000) + 10, 101, T0 + ms(2000))  # END marker's
        r = self.fx.parse()
        self.assertEqual(r["calls_with_lock_samples"], 0)
        self.assertEqual(r["excluded_outside_window_samples"], 2)

    def test_non_worker_backend_fails_closed(self):
        q = T0 + ms(100)
        self.fx.lock(q + 5, 999, q)  # e.g. sampler or foreign session
        with self.assertRaises(SystemExit):
            self.fx.parse()

    def test_non_lock_wait_row_fails_closed(self):
        q = T0 + ms(100)
        self.fx.lock(q + 5, 101, q, wait_type="LWLock")
        with self.assertRaises(SystemExit):
            self.fx.parse()

    def test_sampler_not_covering_window_fails_closed(self):
        self.fx.rows = ["M191_PERF_SAMPLER_READY", f"T\t{T0 + ms(10)}"]
        with self.assertRaises(SystemExit):
            self.fx.parse()

    def test_sampler_without_readiness_marker_fails_closed(self):
        self.fx.rows = [r for r in self.fx.rows if r != "M191_PERF_SAMPLER_READY"]
        with self.assertRaises(SystemExit):
            self.fx.parse()

    def test_missing_sampler_file_fails_closed(self):
        self.fx.write()
        (self.fx.dir / "locks.tsv").unlink()
        windows = report.parse_worker_windows(self.fx.dir)
        with self.assertRaises(SystemExit):
            report.parse_lock_samples(self.fx.dir / "locks.tsv", INTERVAL, windows)

    def test_identity_spanning_longer_than_any_measured_call_fails_closed(self):
        q = T0 + ms(100)
        self.fx.lock(q + ms(1), 101, q)
        self.fx.lock(q + ms(300), 101, q)
        with self.assertRaises(SystemExit):
            self.fx.parse(max_latency_ms=10.0)

    def test_worker_pids_must_be_distinct(self):
        self.fx.worker(2, 101, T0, T0 + ms(2000))
        self.fx.write()
        with self.assertRaises(SystemExit):
            report.parse_worker_windows(self.fx.dir)

    def test_worker_without_identity_markers_fails_closed(self):
        self.fx.write()
        (self.fx.dir / "measured.worker2.log").write_text(
            "M191_PERF_MEASURE_START|1790000000.000000\nTime: 1.000 ms\n"
            "M191_PERF_MEASURE_END|1790000001.000000\n"
        )
        with self.assertRaises(SystemExit):
            report.parse_worker_windows(self.fx.dir)


class PooledPercentiles(unittest.TestCase):
    def test_p50_uses_nearest_rank(self):
        self.assertEqual(report.percentile([4.0, 1.0, 3.0, 2.0], 0.50), 2.0)
        self.assertEqual(report.percentile([1.0, 2.0, 3.0], 0.50), 2.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
