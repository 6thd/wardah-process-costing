#!/usr/bin/env python3
"""Pool balanced repeated M191 before/after performance characterization."""
from __future__ import annotations

import argparse
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path

TIME_RE = re.compile(r"Time:\s*([0-9]+(?:\.[0-9]+)?)\s*ms")


def read_meta(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            out[key] = value
    return out


def percentile(values: list[float], p: float) -> float:
    xs = sorted(values)
    if not xs:
        raise ValueError("empty latency set")
    idx = max(0, min(len(xs) - 1, math.ceil(p * len(xs)) - 1))
    return xs[idx]


SAMPLER_FORMAT = "v2_tick_and_call_identity"
MARKER_RE = re.compile(
    r"^M191_PERF_MEASURE_(START|END)\|([0-9]+(?:\.[0-9]+)?)\|([0-9]+)\|([0-9]+)\|([0-9]+)$"
)


class EvidenceError(SystemExit):
    """Benchmark evidence is incomplete or inconsistent; fail closed."""


@dataclass(frozen=True)
class WorkerWindow:
    """One persistent measured worker session, identified by backend PID.

    stmt_us values are the marker statements' statement_timestamp(), which is
    what pg_stat_activity.query_start reports for them. Every measured RPC on
    that backend has START.stmt_us < query_start < END.stmt_us, and the two
    marker statements themselves fall outside the open interval.
    """

    worker: str
    pid: int
    start_stmt_us: int
    start_clock_us: int
    end_stmt_us: int
    end_clock_us: int


def parse_worker_windows(workload_dir: Path) -> list[WorkerWindow]:
    windows: list[WorkerWindow] = []
    for log in sorted(workload_dir.glob("measured.worker*.log")):
        found: dict[str, tuple[int, int, int]] = {}
        for raw in log.read_text(encoding="utf-8", errors="replace").splitlines():
            match = MARKER_RE.match(raw.strip())
            if not match:
                if raw.startswith("M191_PERF_MEASURE_"):
                    raise EvidenceError(f"{log}: malformed measurement marker {raw!r}")
                continue
            kind = match.group(1)
            if kind in found:
                raise EvidenceError(f"{log}: duplicate {kind} marker")
            found[kind] = (int(match.group(3)), int(match.group(4)), int(match.group(5)))
        if set(found) != {"START", "END"}:
            raise EvidenceError(f"{log}: missing call-identity measurement markers")
        (spid, s_stmt, s_clock), (epid, e_stmt, e_clock) = found["START"], found["END"]
        if spid != epid:
            raise EvidenceError(f"{log}: START pid {spid} != END pid {epid}")
        if not (s_stmt <= s_clock < e_stmt <= e_clock):
            raise EvidenceError(f"{log}: inconsistent measurement window")
        windows.append(
            WorkerWindow(log.name, spid, s_stmt, s_clock, e_stmt, e_clock)
        )
    pids = [w.pid for w in windows]
    if not windows or len(set(pids)) != len(pids):
        raise EvidenceError(f"{workload_dir}: worker backend PIDs missing or not distinct")
    return windows


def parse_lock_samples(
    path: Path,
    interval_s: float,
    windows: list[WorkerWindow],
    worker_max_latency_ms: dict[int, float] | None = None,
) -> dict:
    """Attribute sampled Lock waits to individual measured RPC calls.

    Call identity is (backend pid, query_start). pid alone would merge
    sequential calls on one persistent worker; application_name is not used
    for identity because it may be identical or truncated (NAMEDATALEN).
    Estimator: every Lock sample of a call contributes one nominal sampling
    interval, exactly as the aggregate does, so per-call and aggregate
    estimates are additive and consistent.
    """
    if not path.exists():
        raise EvidenceError(f"{path}: Lock sampler evidence missing")
    interval_us = interval_s * 1_000_000
    by_pid = {w.pid: w for w in windows}
    ticks: list[int] = []
    ready = 0
    per_call: dict[tuple[int, int], int] = {}
    per_pid_samples: dict[int, list[int]] = {}
    wait_events: dict[str, int] = {}
    call_span_us: dict[tuple[int, int], int] = {}
    excluded = 0
    for lineno, raw in enumerate(
        path.read_text(encoding="utf-8", errors="replace").splitlines(), 1
    ):
        if not raw.strip():
            continue
        if raw == "M191_PERF_SAMPLER_READY":
            ready += 1
            continue
        parts = raw.split("\t")
        try:
            if parts[0] == "T" and len(parts) == 2:
                ticks.append(int(parts[1]))
                continue
            if parts[0] != "L" or len(parts) != 8:
                raise ValueError("unrecognized sampler row")
            sample_us, pid, query_start = int(parts[1]), int(parts[3]), int(parts[4])
        except (ValueError, IndexError) as exc:
            raise EvidenceError(
                f"{path}:{lineno}: malformed Lock sample / missing call identity "
                f"({exc}): {raw!r}"
            ) from None
        if parts[5] != "Lock":
            raise EvidenceError(f"{path}:{lineno}: non-Lock wait sampled: {raw!r}")
        window = by_pid.get(pid)
        if window is None:
            raise EvidenceError(
                f"{path}:{lineno}: Lock sample from backend {pid} that is not a "
                "measured worker"
            )
        if sample_us < query_start:
            raise EvidenceError(f"{path}:{lineno}: sample precedes its statement start")
        if not (window.start_stmt_us < query_start < window.end_stmt_us):
            # warm-up, sampler start-up or marker/control SQL: never measured
            excluded += 1
            continue
        key = (pid, query_start)
        per_call[key] = per_call.get(key, 0) + 1
        call_span_us[key] = max(call_span_us.get(key, 0), sample_us - query_start)
        per_pid_samples.setdefault(pid, []).append(sample_us)
        wait_events[parts[6] or "?"] = wait_events.get(parts[6] or "?", 0) + 1

    if ready != 1:
        raise EvidenceError(f"{path}: expected one sampler readiness marker, got {ready}")
    first_start = min(w.start_clock_us for w in windows)
    last_end = max(w.end_clock_us for w in windows)
    if not ticks or min(ticks) > first_start or max(ticks) < last_end:
        raise EvidenceError(
            f"{path}: sampler ticks do not cover the measured window "
            f"[{first_start}, {last_end}]"
        )
    in_window = sorted(t for t in ticks if first_start <= t <= last_end)
    gaps = [b - a for a, b in zip(in_window, in_window[1:])]

    if worker_max_latency_ms is not None:
        for (pid, _), span in call_span_us.items():
            bound_us = (worker_max_latency_ms[pid] * 1000.0) + interval_us
            if span > bound_us:
                raise EvidenceError(
                    f"{path}: attributed call on backend {pid} spans {span} us, "
                    f"longer than any measured call on that worker; identity merged calls"
                )

    count = sum(per_call.values())
    worst_samples = max(per_call.values(), default=0)
    streak = 0
    max_gap = interval_us * 2.5
    for times in per_pid_samples.values():
        times.sort()
        run = 0
        previous = None
        for ts in times:
            run = run + 1 if previous is not None and ts - previous <= max_gap else 1
            streak = max(streak, run)
            previous = ts
    return {
        "sample_count": count,
        "aggregate_ms": count * interval_s * 1000.0,
        "calls_with_lock_samples": len(per_call),
        "worst_call_samples": worst_samples,
        "worst_call_estimate_ms": worst_samples * interval_s * 1000.0,
        "worst_call_observed_span_ms": max(call_span_us.values(), default=0) / 1000.0,
        "longest_streak_ms": streak * interval_s * 1000.0,
        "excluded_outside_window_samples": excluded,
        "wait_events": dict(sorted(wait_events.items())),
        "sampler_ticks_in_window": len(in_window),
        "sampler_tick_interval_mean_ms": (
            sum(gaps) / len(gaps) / 1000.0 if gaps else 0.0
        ),
        "sampler_tick_interval_max_ms": max(gaps, default=0) / 1000.0,
    }


@dataclass
class Leaf:
    summary: dict
    latencies: list[float]


def collect_leaf(workload_dir: Path) -> Leaf:
    meta = read_meta(workload_dir / "meta.env")
    fixture_path = workload_dir / "fixture_size.env"
    if not fixture_path.exists():
        raise SystemExit(f"missing fixture size evidence: {fixture_path}")
    fixture = {key: int(value) for key, value in read_meta(fixture_path).items()}
    workload = meta["workload"]
    if meta.get("worker_session_model") != "persistent_same_psql_warmup_then_measure":
        raise SystemExit(
            f"{meta.get('label','?')}/{workload}: invalid worker session model "
            f"{meta.get('worker_session_model')!r}"
        )
    if meta.get("measurement_boundary") != "server_clock_same_session_after_warmup_barrier":
        raise SystemExit(
            f"{meta.get('label','?')}/{workload}: invalid measurement boundary "
            f"{meta.get('measurement_boundary')!r}"
        )
    start_spread_ms = float(meta["worker_start_spread_ms"])
    if start_spread_ms < 0:
        raise SystemExit(
            f"{meta.get('label','?')}/{workload}: negative worker start spread"
        )
    if meta.get("lock_sampler_format") != SAMPLER_FORMAT:
        raise SystemExit(
            f"{meta.get('label','?')}/{workload}: Lock sampler evidence lacks "
            f"per-call identity (format {meta.get('lock_sampler_format')!r})"
        )
    windows = parse_worker_windows(workload_dir)
    latencies: list[float] = []
    worker_max: dict[int, float] = {}
    for window in windows:
        text = (workload_dir / window.worker).read_text(
            encoding="utf-8", errors="replace"
        )
        worker_lat = [float(m.group(1)) for m in TIME_RE.finditer(text)]
        worker_max[window.pid] = max(worker_lat, default=0.0)
        latencies.extend(worker_lat)

    expected = int(meta["operations"])
    if len(latencies) != expected:
        raise SystemExit(
            f"{meta['label']}/{workload}: expected {expected} timed calls, "
            f"found {len(latencies)}"
        )

    interval = float(meta["sample_interval_seconds"])
    locks = parse_lock_samples(
        workload_dir / "locks.tsv", interval, windows, worker_max
    )
    wall = float(meta["wall_seconds"])
    summary = {
        "label": meta["label"],
        "workload": workload,
        "concurrency": int(meta["concurrency"]),
        "iterations_per_worker": int(meta["iterations_per_worker"]),
        "warmup_per_worker": int(meta["warmup_per_worker"]),
        "operations": expected,
        "wall_seconds": wall,
        "ops_per_second": expected / wall if wall else 0.0,
        "p50_ms": percentile(latencies, 0.50),
        "p95_ms": percentile(latencies, 0.95),
        "p99_ms": percentile(latencies, 0.99),
        "max_ms": max(latencies),
        "lock_scope": meta["lock_scope"],
        "worker_session_model": meta["worker_session_model"],
        "measurement_boundary": meta["measurement_boundary"],
        "worker_start_spread_ms": start_spread_ms,
        "sample_interval_seconds": interval,
        "lock_wait_sample_count": locks["sample_count"],
        "lock_wait_aggregate_estimate_ms": locks["aggregate_ms"],
        "lock_wait_calls_with_samples": locks["calls_with_lock_samples"],
        "lock_wait_worst_call_samples": locks["worst_call_samples"],
        "lock_wait_worst_call_estimate_ms": locks["worst_call_estimate_ms"],
        "lock_wait_worst_call_observed_span_ms": locks["worst_call_observed_span_ms"],
        "lock_wait_longest_same_backend_streak_ms": locks["longest_streak_ms"],
        "lock_wait_excluded_outside_window_samples": locks["excluded_outside_window_samples"],
        "lock_wait_events": locks["wait_events"],
        "sampler_ticks_in_window": locks["sampler_ticks_in_window"],
        "sampler_tick_interval_mean_ms": locks["sampler_tick_interval_mean_ms"],
        "sampler_tick_interval_max_ms": locks["sampler_tick_interval_max_ms"],
        "lock_sampler_format": meta["lock_sampler_format"],
        "fixture": fixture,
    }
    return Leaf(summary=summary, latencies=latencies)


def collect_state(state_dir: Path) -> dict[str, Leaf]:
    result: dict[str, Leaf] = {}
    for meta_path in sorted(state_dir.glob("*/meta.env")):
        leaf = collect_leaf(meta_path.parent)
        result[leaf.summary["workload"]] = leaf
    if not result:
        raise SystemExit(f"no workload results found under {state_dir}")
    return result


def discover_repetitions(root: Path) -> list[Path]:
    reps = sorted(
        (p for p in root.glob("r[0-9]*") if p.is_dir()),
        key=lambda p: int(p.name[1:]),
    )
    if reps:
        return reps
    if (root / "pre191").is_dir() and (root / "post191").is_dir():
        return [root]
    raise SystemExit(f"no repetition directories found under {root}")


def aggregate(repetitions: list[dict[str, Leaf]], workload: str) -> dict:
    leaves = [rep[workload] for rep in repetitions]
    latencies = [value for leaf in leaves for value in leaf.latencies]
    summaries = [leaf.summary for leaf in leaves]
    total_ops = sum(item["operations"] for item in summaries)
    total_wall = sum(item["wall_seconds"] for item in summaries)
    total_lock = sum(
        item["lock_wait_aggregate_estimate_ms"] for item in summaries
    )
    run_ops = [item["ops_per_second"] for item in summaries]
    run_p50 = [item["p50_ms"] for item in summaries]
    run_p95 = [item["p95_ms"] for item in summaries]
    fixture = summaries[0]["fixture"]
    session_model = summaries[0]["worker_session_model"]
    measurement_boundary = summaries[0]["measurement_boundary"]
    if any(item["worker_session_model"] != session_model for item in summaries[1:]):
        raise SystemExit(f"{workload}: worker session model drift across repetitions")
    if any(item["measurement_boundary"] != measurement_boundary for item in summaries[1:]):
        raise SystemExit(f"{workload}: measurement boundary drift across repetitions")
    if any(item["fixture"] != fixture for item in summaries[1:]):
        raise SystemExit(f"{workload}: fixture cardinality drift across repetitions")

    return {
        "workload": workload,
        "repetitions": len(summaries),
        "operations": total_ops,
        "wall_seconds_total": total_wall,
        "ops_per_second": total_ops / total_wall if total_wall else 0.0,
        "ops_per_second_min": min(run_ops),
        "ops_per_second_max": max(run_ops),
        "p50_ms": percentile(latencies, 0.50),
        "p50_ms_min_by_run": min(run_p50),
        "p50_ms_max_by_run": max(run_p50),
        "p95_ms": percentile(latencies, 0.95),
        "p95_ms_min_by_run": min(run_p95),
        "p95_ms_max_by_run": max(run_p95),
        "p99_ms": percentile(latencies, 0.99),
        "max_ms": max(latencies),
        "lock_scope": summaries[0]["lock_scope"],
        "worker_session_model": session_model,
        "measurement_boundary": measurement_boundary,
        "worker_start_spread_ms_max": max(
            item["worker_start_spread_ms"] for item in summaries
        ),
        "sample_interval_seconds": summaries[0]["sample_interval_seconds"],
        "lock_wait_sample_count_total": sum(
            item["lock_wait_sample_count"] for item in summaries
        ),
        "lock_wait_aggregate_estimate_ms_total": total_lock,
        "lock_wait_estimate_ms_per_100_ops": (
            total_lock / total_ops * 100.0 if total_ops else 0.0
        ),
        "lock_wait_calls_with_samples_total": sum(
            item["lock_wait_calls_with_samples"] for item in summaries
        ),
        "lock_wait_worst_call_samples": max(
            item["lock_wait_worst_call_samples"] for item in summaries
        ),
        "lock_wait_worst_call_estimate_ms": max(
            item["lock_wait_worst_call_estimate_ms"] for item in summaries
        ),
        "lock_wait_worst_call_observed_span_ms": max(
            item["lock_wait_worst_call_observed_span_ms"] for item in summaries
        ),
        "lock_wait_longest_same_backend_streak_ms": max(
            item["lock_wait_longest_same_backend_streak_ms"] for item in summaries
        ),
        "lock_wait_excluded_outside_window_samples_total": sum(
            item["lock_wait_excluded_outside_window_samples"] for item in summaries
        ),
        "lock_wait_events": {
            event: sum(item["lock_wait_events"].get(event, 0) for item in summaries)
            for event in sorted(
                {event for item in summaries for event in item["lock_wait_events"]}
            )
        },
        "sampler_ticks_in_window_total": sum(
            item["sampler_ticks_in_window"] for item in summaries
        ),
        "sampler_tick_interval_mean_ms_max_by_run": max(
            item["sampler_tick_interval_mean_ms"] for item in summaries
        ),
        "sampler_tick_interval_max_ms": max(
            item["sampler_tick_interval_max_ms"] for item in summaries
        ),
        "fixture": fixture,
    }


def pct(after: float, before: float) -> str:
    if before == 0:
        return "n/a"
    return f"{((after - before) / before * 100):+.1f}%"


def known_red_observations(rep_paths: list[Path]) -> tuple[int, list[str]]:
    observed = 0
    details: list[str] = []
    for rep in rep_paths:
        path = (
            rep
            / "pre191"
            / "core_hot_multiwarehouse"
            / "pre191_known_red_projection_gap.txt"
        )
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8", errors="replace").strip()
        match = re.search(r"projection_gap=([-+0-9.]+)", text)
        gap = float(match.group(1)) if match else 0.0
        details.append(f"{rep.name}: {text}")
        if abs(gap) > 1e-9:
            observed += 1
    return observed, details


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("--markdown", type=Path, required=True)
    parser.add_argument("--json", type=Path, required=True)
    args = parser.parse_args()

    rep_paths = discover_repetitions(args.root)
    pre_reps: list[dict[str, Leaf]] = []
    post_reps: list[dict[str, Leaf]] = []
    per_rep: dict[str, dict] = {}
    expected: set[str] | None = None

    for rep_path in rep_paths:
        base = rep_path if rep_path != args.root else args.root
        pre = collect_state(base / "pre191")
        post = collect_state(base / "post191")
        if set(pre) != set(post):
            raise SystemExit(
                f"{rep_path.name}: workload mismatch "
                f"pre={sorted(pre)} post={sorted(post)}"
            )
        if expected is None:
            expected = set(pre)
        elif set(pre) != expected:
            raise SystemExit(
                f"{rep_path.name}: workload set drift "
                f"expected={sorted(expected)} got={sorted(pre)}"
            )
        pre_reps.append(pre)
        post_reps.append(post)
        per_rep[rep_path.name] = {
            "pre191": {name: leaf.summary for name, leaf in pre.items()},
            "post191": {name: leaf.summary for name, leaf in post.items()},
        }

    if expected is None:
        raise SystemExit("no workload set discovered")
    pre_agg = {name: aggregate(pre_reps, name) for name in sorted(expected)}
    post_agg = {name: aggregate(post_reps, name) for name in sorted(expected)}
    for name in sorted(expected):
        if pre_agg[name]["fixture"] != post_agg[name]["fixture"]:
            raise SystemExit(
                f"{name}: pre/post fixture cardinalities differ: "
                f"{pre_agg[name]['fixture']} != {post_agg[name]['fixture']}"
            )
    red_count, red_details = known_red_observations(rep_paths)

    payload = {
        "method": {
            "repetitions": len(rep_paths),
            "order": "balanced: odd pre191->post191; even post191->pre191",
            "threshold_policy": (
                "No arbitrary SLO threshold; quantify and review material "
                "regression before Production."
            ),
            "lock_wait_method": (
                "pg_stat_activity Lock-wait sampling of measured worker backends; "
                "per-call identity (pid, query_start) bounded by each worker's "
                "START/END marker statements; estimator = samples x nominal "
                "interval for aggregate and per call; core_hot_multiwarehouse "
                "is the product-row/product-projection proxy because workers "
                "share no bin."
            ),
            "same_environment": (
                "one GitHub Actions job/PostgreSQL 17 service; every repetition "
                "uses a fresh DB pair."
            ),
        },
        "aggregate": {"pre191": pre_agg, "post191": post_agg},
        "repetition_results": per_rep,
        "known_pre191_red": {
            "nonzero_projection_gap_repetitions": red_count,
            "details": red_details,
        },
    }
    args.json.write_text(
        json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8"
    )

    first_workload = sorted(expected)[0]
    first_leaf = pre_reps[0][first_workload].summary
    pooled_ops = pre_agg[first_workload]["operations"]
    lines = [
        "# M191 pre-Production performance characterization",
        "",
        "**Decision semantics:** characterization only; no arbitrary performance "
        "pass/fail threshold is invented.",
        "Harness correctness failures (deadlock, timeout, failed RPC, unexpected "
        "invariant mismatch) fail the job.",
        "",
        f"- repetitions: **{len(rep_paths)}**",
        "- order: **balanced** (odd pre->post, even post->pre)",
        "- each repetition uses a **fresh pre/post database pair**",
        f"- concurrency: **{first_leaf['concurrency']}** persistent psql workers",
        f"- measured iterations per worker/repetition: "
        f"**{first_leaf['iterations_per_worker']}**",
        f"- excluded warm-up per worker/repetition: "
        f"**{first_leaf['warmup_per_worker']}**",
        "- worker session model: **same persistent psql connection for warm-up and measurement**",
        "- throughput boundary: **server-side start/end markers after the warm-up barrier**",
        f"- pooled measured operations per workload/state: **{pooled_ops}**",
        f"- lock sampling interval: **{first_leaf['sample_interval_seconds']:.3f}s**",
        "",
        "## Throughput and latency",
        "",
        "| Workload | Pre ops/s | Post ops/s | Delta ops/s | Pre p50 ms | "
        "Post p50 ms | Delta p50 | Pre p95 ms | Post p95 ms | Delta p95 | "
        "Pre p99 ms | Post p99 ms | Pre max ms | Post max ms |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for name in sorted(pre_agg):
        before = pre_agg[name]
        after = post_agg[name]
        lines.append(
            f"| {name} | {before['ops_per_second']:.2f} | "
            f"{after['ops_per_second']:.2f} | "
            f"{pct(after['ops_per_second'], before['ops_per_second'])} | "
            f"{before['p50_ms']:.3f} | {after['p50_ms']:.3f} | "
            f"{pct(after['p50_ms'], before['p50_ms'])} | "
            f"{before['p95_ms']:.3f} | {after['p95_ms']:.3f} | "
            f"{pct(after['p95_ms'], before['p95_ms'])} | "
            f"{before['p99_ms']:.3f} | {after['p99_ms']:.3f} | "
            f"{before['max_ms']:.3f} | {after['max_ms']:.3f} |"
        )

    interval_ms = first_leaf["sample_interval_seconds"] * 1000.0
    lines += [
        "",
        "## Sampled Lock wait: aggregate and worst observed call",
        "",
        "All Lock values are **sampling estimates** from pg_stat_activity "
        "(`wait_event_type='Lock'`) of the measured worker backends only. "
        f"Estimator: each Lock sample counts one nominal {interval_ms:.0f} ms "
        "interval, for the aggregate and per call alike.",
        "",
        "- **Per-call identity** is `(backend pid, query_start)`. Samples of one "
        "measured RPC call accumulate across wait events and blockers; sequential "
        "calls on the same persistent backend never merge; application_name is "
        "not used for identity. Samples whose query_start falls outside a worker's "
        "measured START/END marker statements are excluded.",
        "- **Worst observed per-call sampled Lock-wait estimate** = most Lock "
        f"samples attributed to one measured call x {interval_ms:.0f} ms. It is "
        "quantized: one sample means the call was observed Lock-waiting at one "
        "instant, not that it waited a full interval. A call's true lock wait "
        "cannot exceed its own measured latency, so the state's **max statement "
        "latency** is the hard upper bound for any single call.",
        "- **Longest same-backend sampled Lock-wait streak** groups consecutive "
        "samples of one backend and may span multiple calls, wait episodes and "
        "blockers. It is NOT the duration of one lock wait or one call.",
        "",
        "| Workload | Pre Lock ms/100 ops | Post Lock ms/100 ops | "
        "Pre calls w/ Lock samples | Post calls w/ Lock samples | "
        "Pre worst per-call estimate ms (samples) | "
        "Post worst per-call estimate ms (samples) | "
        "Pre max statement latency ms | Post max statement latency ms | "
        "Pre longest streak ms | Post longest streak ms |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for name in sorted(pre_agg):
        before = pre_agg[name]
        after = post_agg[name]
        lines.append(
            f"| {name} | "
            f"{before['lock_wait_estimate_ms_per_100_ops']:.1f} | "
            f"{after['lock_wait_estimate_ms_per_100_ops']:.1f} | "
            f"{before['lock_wait_calls_with_samples_total']} | "
            f"{after['lock_wait_calls_with_samples_total']} | "
            f"{before['lock_wait_worst_call_estimate_ms']:.1f} "
            f"({before['lock_wait_worst_call_samples']}) | "
            f"{after['lock_wait_worst_call_estimate_ms']:.1f} "
            f"({after['lock_wait_worst_call_samples']}) | "
            f"{before['max_ms']:.3f} | {after['max_ms']:.3f} | "
            f"{before['lock_wait_longest_same_backend_streak_ms']:.1f} | "
            f"{after['lock_wait_longest_same_backend_streak_ms']:.1f} |"
        )

    lines += [
        "",
        "### Lock wait-event mix and sampler coverage",
        "",
        "The sampler records generic `Lock` waits; it does not identify the "
        "locked relation. `tuple`/`transactionid` are row-lock waits. In "
        "core_hot_multiwarehouse the workers share one product row and no bin, "
        "which is why it is the product-row serialization proxy.",
        "",
        "| Workload | State | Lock wait events (samples) | Excluded out-of-window samples | "
        "Sampler ticks in window | Max mean tick interval ms | Max tick gap ms |",
        "|---|---|---|---:|---:|---:|---:|",
    ]
    for name in sorted(pre_agg):
        for state, agg in (("pre191", pre_agg[name]), ("post191", post_agg[name])):
            events = ", ".join(
                f"{event}={count}" for event, count in agg["lock_wait_events"].items()
            ) or "none"
            lines.append(
                f"| {name} | {state} | {events} | "
                f"{agg['lock_wait_excluded_outside_window_samples_total']} | "
                f"{agg['sampler_ticks_in_window_total']} | "
                f"{agg['sampler_tick_interval_mean_ms_max_by_run']:.2f} | "
                f"{agg['sampler_tick_interval_max_ms']:.2f} |"
            )

    lines += [
        "",
        "## Repeat-to-repeat noise envelope",
        "",
        "| Workload | Pre ops/s range | Post ops/s range | "
        "Pre p50 range ms | Post p50 range ms | "
        "Pre p95 range ms | Post p95 range ms |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for name in sorted(pre_agg):
        before = pre_agg[name]
        after = post_agg[name]
        lines.append(
            f"| {name} | "
            f"{before['ops_per_second_min']:.2f}-"
            f"{before['ops_per_second_max']:.2f} | "
            f"{after['ops_per_second_min']:.2f}-"
            f"{after['ops_per_second_max']:.2f} | "
            f"{before['p50_ms_min_by_run']:.3f}-"
            f"{before['p50_ms_max_by_run']:.3f} | "
            f"{after['p50_ms_min_by_run']:.3f}-"
            f"{after['p50_ms_max_by_run']:.3f} | "
            f"{before['p95_ms_min_by_run']:.3f}-"
            f"{before['p95_ms_max_by_run']:.3f} | "
            f"{after['p95_ms_min_by_run']:.3f}-"
            f"{after['p95_ms_max_by_run']:.3f} |"
        )

    lines += [
        "",
        "## Fixture cardinalities at workload start",
        "",
        "| Workload | Org products | Org bins | Target products | Target bins | Org reservations | Target reservations | Org SLE rows | Target SLE rows |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for name in sorted(pre_agg):
        fixture = pre_agg[name]["fixture"]
        lines.append(
            f"| {name} | {fixture['org_products']} | {fixture['org_bins']} | "
            f"{fixture['target_products']} | {fixture['target_bins']} | "
            f"{fixture['org_reservations']} | {fixture['target_reservations']} | "
            f"{fixture['org_sle_rows']} | {fixture['target_sle_rows']} |"
        )

    lines += [
        "",
        "## Known pre-191 RED observation",
        "",
        f"The hot-multiwarehouse baseline showed a non-zero product-projection "
        f"gap in **{red_count}/{len(rep_paths)}** repetitions. This is "
        "observational corroboration only; the deterministic RED suite remains "
        "the proof of the pre-191 defect.",
        "",
        "## Required owner review",
        "",
        "Any material throughput/latency regression must be explained before "
        "Production. Do not weaken M191's correctness lock contract to improve "
        "these numbers without a separate reviewed design.",
        "",
        "This report does not authorize Production or Staging mutation.",
    ]

    markdown = "\n".join(lines) + "\n"
    args.markdown.write_text(markdown, encoding="utf-8")
    print(markdown)
    print("M191_PERF_CHARACTERIZATION_COMPLETE")


if __name__ == "__main__":
    main()
