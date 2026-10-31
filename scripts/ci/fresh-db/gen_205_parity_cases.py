#!/usr/bin/env python3
# Parity cases for Migration 205: every call the calculator controls X1-X20 (controls_205.py) make to the 205 functions of the
# reference calculator r4e, recorded with the calculator's own outcome, so the SQL functions can be run on exactly those inputs.
# Nothing is typed by hand: the controls run against a recording proxy of the calculator; each call to validate_205_version,
# compute_205, approve_205_check or unallocated_205 is captured with its arguments and its result or refusal. The controls must
# still pass through the proxy, and the calculator must be r4e (sha256 pinned), or nothing is written. A call that ends in anything
# but a policy refusal (StageCostError) is not left out: it stops the generation (PARITY_205_NON_POLICY_EXCEPTION), so every
# input the controls exercise is in the evidence.
# Output: one JSON object per line, {id, fn, args, expect}, in the shape the SQL side reads (budgets and setup_acks of a version
# as ordered arrays, because the calculator iterates its dicts in insertion order).
#   python3 -I -B -X utf8 scripts/ci/fresh-db/gen_205_parity_cases.py <out.jsonl>
import copy
import hashlib
import json
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CALC_DIR = ROOT / "docs/db/stage-costing-260"
CALC = CALC_DIR / "reference_calculator.py"
R4E_SHA256 = "72ef102672a17378785b09091f1f837330cc10ce529259cc5978fd707627e342"
sys.path.insert(0, str(CALC_DIR))
import controls_205  # noqa: E402
from focused_controls import load  # noqa: E402

RECORDED = ("validate_205_version", "compute_205", "approve_205_check", "unallocated_205")


def plain(x):
    """JSON-safe copy; refuses any value the SQL side could not receive as the calculator did (a Fraction, a tuple key...)"""
    if x is None or isinstance(x, (bool, int, str)):
        return x
    if isinstance(x, list):
        return [plain(e) for e in x]
    if isinstance(x, dict):
        if not all(isinstance(k, str) for k in x):
            raise TypeError(f"non-string key in {x!r}")
        return {k: plain(v) for k, v in x.items()}
    raise TypeError(f"unsupported value {x!r}")


def version_json(v):
    out = {k: plain(x) for k, x in v.items() if k not in ("budgets", "setup_acks")}
    if "budgets" in v:
        out["budgets"] = [{"code": c, **plain(b)} for c, b in v["budgets"].items()]
    if "setup_acks" in v:
        out["setup_acks"] = [{"pool": p, "budgets": plain(list(cs))} for p, cs in v["setup_acks"].items()]
    return out


def resolution_json(r):
    out = {"pools": plain(r["pools"]), "budgets": [{"code": c, **plain(b)} for c, b in r["budgets"].items()],
           "setup_acks": [{"pool": p, "budgets": plain(list(cs))} for p, cs in r.get("setup_acks", {}).items()]}
    if "unallocated_exception" in r:
        out["unallocated_exception"] = plain(r["unallocated_exception"])
    return out


def main(out_path):
    if hashlib.sha256(CALC.read_bytes()).hexdigest() != R4E_SHA256:
        sys.exit("PARITY_205_CALCULATOR_NOT_R4E")
    rc = load(CALC)
    calls = []

    def recorder(name, fn):
        def wrapped(*args, **kw):
            snap = (copy.deepcopy(args), copy.deepcopy(kw))
            try:
                res = fn(*args, **kw)
                calls.append((name, snap, {"ok": copy.deepcopy(res)}))
                return res
            except rc.StageCostError as exc:
                calls.append((name, snap, {"error": str(exc)}))
                raise
            except Exception as exc:          # not a policy refusal: recorded, and it stops the generation below
                calls.append((name, snap, {"python_exception": type(exc).__name__}))
                raise
        return wrapped

    proxy = types.SimpleNamespace(**{k: getattr(rc, k) for k in dir(rc) if not k.startswith("__")})
    for name in RECORDED:
        setattr(proxy, name, recorder(name, getattr(rc, name)))
    results = controls_205.run(proxy, str(CALC))
    other = [(i, name, outcome["python_exception"]) for i, (name, _snap, outcome) in enumerate(calls, 1) if "python_exception" in outcome]
    if other:
        sys.exit(f"PARITY_205_NON_POLICY_EXCEPTION: {other[:10]} (of {len(other)})")
    failed = [r[0] for r in results if not r[2]]
    if failed or len(results) != 19:          # X1-X9, X11-X20 (X10 needs the r3 snapshot and checks Python sources only)
        sys.exit(f"PARITY_205_CONTROLS_DID_NOT_PASS_THROUGH_PROXY: failed={failed} n={len(results)}")

    lines = []
    for i, (name, (args, kw), outcome) in enumerate(calls, 1):
        if name == "compute_205":
            a = list(args) + [None] * (5 - len(args))
            v, wc, hours, rec, legacy = a[:5]
            rec = kw.get("recorded_labor_cost", rec)
            legacy = kw.get("legacy_resolution", legacy)
            sql_args = {"v": version_json(v), "wc": wc, "hours": plain(hours), "recorded": plain(rec),
                        "legacy": resolution_json(legacy) if legacy is not None else None}
        elif name == "approve_205_check":
            policy = args[1] if len(args) > 1 else kw.get("company_policy", "block")
            sql_args = {"v": version_json(args[0]), "policy": plain(policy)}
        else:
            sql_args = {"v": version_json(args[0])}
        expect = outcome if "error" in outcome else {"ok": plain(outcome["ok"])}
        lines.append(json.dumps({"id": i, "fn": name, "args": sql_args, "expect": expect}, sort_keys=True, ensure_ascii=False))
    Path(out_path).write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    by_fn = {}
    for ln in lines:
        d = json.loads(ln)
        key = (d["fn"], "error" if "error" in d["expect"] else "ok")
        by_fn[key] = by_fn.get(key, 0) + 1
    print(f"PARITY_205_CASES {len(lines)} non_policy_exceptions=0 controls_pass={len(results)}/{len(results)} "
          + " ".join(f"{f}:{k}={n}" for (f, k), n in sorted(by_fn.items())))


if __name__ == "__main__":
    main(sys.argv[1])
