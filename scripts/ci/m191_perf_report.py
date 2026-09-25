#!/usr/bin/env python3
"""Summarize M191 before/after performance evidence without inventing an SLO."""
from __future__ import annotations
import argparse
import json
import math
import re
from pathlib import Path

TIME_RE = re.compile(r"Time:\s*([0-9]+(?:\.[0-9]+)?)\s*ms")

def read_meta(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            out[k] = v
    return out

def percentile(values: list[float], p: float) -> float:
    xs = sorted(values)
    if not xs:
        raise ValueError("empty latency set")
    return xs[max(0, min(len(xs)-1, math.ceil(p*len(xs))-1))]

def parse_lock_samples(path: Path, interval_s: float) -> tuple[float, float, int]:
    samples: dict[tuple[str, str], list[float]] = {}
    count = 0
    if path.exists():
        for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
            parts = raw.split("\t")
            if len(parts) < 4:
                continue
            try:
                ts = float(parts[0])
            except ValueError:
                continue
            samples.setdefault((parts[1], parts[2]), []).append(ts)
            count += 1
    aggregate_ms = count * interval_s * 1000.0
    worst_ms = 0.0
    max_gap = interval_s * 2.5
    for times in samples.values():
        times.sort()
        episode = 0
        prev = None
        for ts in times:
            if prev is None or ts - prev <= max_gap:
                episode += 1
            else:
                worst_ms = max(worst_ms, episode * interval_s * 1000.0)
                episode = 1
            prev = ts
        worst_ms = max(worst_ms, episode * interval_s * 1000.0)
    return aggregate_ms, worst_ms, count

def collect(label_dir: Path) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for meta_path in sorted(label_dir.glob("*/meta.env")):
        d = meta_path.parent
        meta = read_meta(meta_path)
        workload = meta["workload"]
        latencies: list[float] = []
        for log in sorted(d.glob("measured.worker*.log")):
            text = log.read_text(encoding="utf-8", errors="replace")
            latencies.extend(float(m.group(1)) for m in TIME_RE.finditer(text))
        expected = int(meta["operations"])
        if len(latencies) != expected:
            raise SystemExit(
                f"{meta['label']}/{workload}: expected {expected} timed calls, found {len(latencies)}"
            )
        interval = float(meta["sample_interval_seconds"])
        agg_lock, worst_lock, sample_count = parse_lock_samples(d / "locks.tsv", interval)
        wall = float(meta["wall_seconds"])
        result[workload] = {
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
            "sample_interval_seconds": interval,
            "lock_wait_sample_count": sample_count,
            "lock_wait_aggregate_estimate_ms": agg_lock,
            "lock_wait_worst_episode_estimate_ms": worst_lock,
        }
    return result

def delta(after: float, before: float) -> str:
    if before == 0:
        return "n/a"
    return f"{((after-before)/before*100):+.1f}%"

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("root", type=Path)
    ap.add_argument("--markdown", type=Path, required=True)
    ap.add_argument("--json", type=Path, required=True)
    args = ap.parse_args()
    pre = collect(args.root / "pre191")
    post = collect(args.root / "post191")
    if set(pre) != set(post):
        raise SystemExit(f"workload mismatch pre={sorted(pre)} post={sorted(post)}")

    payload = {
        "method": {
            "threshold_policy": "No arbitrary SLO threshold; quantify and review material regression before Production.",
            "lock_wait_method": "pg_stat_activity Lock-wait sampling; hot-multiwarehouse is the product-row/product-projection proxy because workers share no bin.",
            "same_environment": "pre191 and post191 run sequentially in the same GitHub Actions job and PostgreSQL 17 service.",
        },
        "pre191": pre,
        "post191": post,
    }
    args.json.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")

    lines = [
        "# M191 pre-Production performance characterization",
        "",
        "**Decision semantics:** characterization only; no arbitrary performance pass/fail threshold is invented.",
        "Harness correctness failures (deadlock, timeout, failed RPC, invariant mismatch) fail the job.",
        "",
        "Pre-191 and post-191 use the same runner, PostgreSQL 17 service, fixture shape, concurrency, iterations and warm-up.",
        "",
        "Lock-wait values are sampling estimates from pg_stat_activity at the recorded interval. "
        "core_hot_multiwarehouse is the product-row/product-projection proxy: workers share one product but use separate bins.",
        "",
        "| Workload | Pre ops/s | Post ops/s | Delta ops/s | Pre p50 ms | Post p50 ms | Pre p95 ms | Post p95 ms | Delta p95 | Pre p99 ms | Post p99 ms | Pre lock est ms | Post lock est ms | Post worst episode est ms |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for name in sorted(pre):
        a, b = pre[name], post[name]
        lines.append(
            f"| {name} | {a['ops_per_second']:.2f} | {b['ops_per_second']:.2f} | "
            f"{delta(b['ops_per_second'],a['ops_per_second'])} | "
            f"{a['p50_ms']:.3f} | {b['p50_ms']:.3f} | "
            f"{a['p95_ms']:.3f} | {b['p95_ms']:.3f} | "
            f"{delta(b['p95_ms'],a['p95_ms'])} | "
            f"{a['p99_ms']:.3f} | {b['p99_ms']:.3f} | "
            f"{a['lock_wait_aggregate_estimate_ms']:.1f} | "
            f"{b['lock_wait_aggregate_estimate_ms']:.1f} | "
            f"{b['lock_wait_worst_episode_estimate_ms']:.1f} |"
        )

    sample = next(iter(pre.values()))
    lines += [
        "",
        "## Fixture / run parameters",
        "",
        f"- concurrency: **{sample['concurrency']}** persistent psql workers",
        f"- measured iterations per worker: **{sample['iterations_per_worker']}**",
        f"- excluded warm-up iterations per worker: **{sample['warmup_per_worker']}**",
        f"- lock sampling interval: **{sample['sample_interval_seconds']:.3f}s**",
        "",
        "## Required owner review",
        "",
        "Review any material throughput/latency regression before Production and explain it. "
        "Do not weaken M191's correctness lock contract to improve these numbers without a separate reviewed design.",
        "",
        "This report does not authorize Production or Staging mutation.",
    ]
    md = "\n".join(lines) + "\n"
    args.markdown.write_text(md, encoding="utf-8")
    print(md)
    print("M191_PERF_CHARACTERIZATION_COMPLETE")

if __name__ == "__main__":
    main()
