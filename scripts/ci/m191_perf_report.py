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
        previous = None
        for ts in times:
            if previous is None or ts - previous <= max_gap:
                episode += 1
            else:
                worst_ms = max(worst_ms, episode * interval_s * 1000.0)
                episode = 1
            previous = ts
        worst_ms = max(worst_ms, episode * interval_s * 1000.0)
    return aggregate_ms, worst_ms, count


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
    latencies: list[float] = []
    for log in sorted(workload_dir.glob("measured.worker*.log")):
        text = log.read_text(encoding="utf-8", errors="replace")
        latencies.extend(float(m.group(1)) for m in TIME_RE.finditer(text))

    expected = int(meta["operations"])
    if len(latencies) != expected:
        raise SystemExit(
            f"{meta['label']}/{workload}: expected {expected} timed calls, "
            f"found {len(latencies)}"
        )

    interval = float(meta["sample_interval_seconds"])
    agg_lock, worst_lock, sample_count = parse_lock_samples(
        workload_dir / "locks.tsv", interval
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
        "lock_wait_sample_count": sample_count,
        "lock_wait_aggregate_estimate_ms": agg_lock,
        "lock_wait_worst_episode_estimate_ms": worst_lock,
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
        "lock_wait_worst_episode_estimate_ms": max(
            item["lock_wait_worst_episode_estimate_ms"] for item in summaries
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
                "pg_stat_activity Lock-wait sampling; core_hot_multiwarehouse "
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
        "Lock-wait values are sampling estimates. core_hot_multiwarehouse is "
        "the product-row/product-projection proxy: workers share one product "
        "but use separate bins.",
        "",
        "| Workload | Pre ops/s | Post ops/s | Delta ops/s | Pre p95 ms | "
        "Post p95 ms | Delta p95 | Pre p99 ms | Post p99 ms | "
        "Pre lock ms/100 ops | Post lock ms/100 ops | Post worst episode ms |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]

    for name in sorted(pre_agg):
        before = pre_agg[name]
        after = post_agg[name]
        lines.append(
            f"| {name} | {before['ops_per_second']:.2f} | "
            f"{after['ops_per_second']:.2f} | "
            f"{pct(after['ops_per_second'], before['ops_per_second'])} | "
            f"{before['p95_ms']:.3f} | {after['p95_ms']:.3f} | "
            f"{pct(after['p95_ms'], before['p95_ms'])} | "
            f"{before['p99_ms']:.3f} | {after['p99_ms']:.3f} | "
            f"{before['lock_wait_estimate_ms_per_100_ops']:.1f} | "
            f"{after['lock_wait_estimate_ms_per_100_ops']:.1f} | "
            f"{after['lock_wait_worst_episode_estimate_ms']:.1f} |"
        )

    lines += [
        "",
        "## Repeat-to-repeat noise envelope",
        "",
        "| Workload | Pre ops/s range | Post ops/s range | "
        "Pre p95 range ms | Post p95 range ms |",
        "|---|---:|---:|---:|---:|",
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
