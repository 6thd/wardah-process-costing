# Controls for compute_205 / validate_205_version (calculator revision 4, Migration 205 plan; owner approved group A on 2026-10-28).
# Runs against any calculator file given on the command line, so the same controls can be shown failing on r3 (which has no compute_205) and
# passing on r4. A second argument (the r3 snapshot) adds the check that every revision-3 definition is byte-identical in the file under test.
# Standard library only; connects to nothing.
#   python -I -B -X utf8 controls_205.py <calculator> [history/reference_calculator_r3_38a91bdf.py.txt]
import ast
import copy
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from focused_controls import load  # noqa: E402

R4_NAMES = {"ACTIVITIES", "POOL_205_KEYS", "validate_205_version", "is_205_version", "compute_205"}
BUDGETS = {"ELECTRICITY": {"gl_account": "GL-5101", "cost_center": "CC-PROD", "setup": False},
           "DEPRECIATION": {"gl_account": "GL-5201", "cost_center": "CC-PROD", "setup": False},
           "SUPERVISION": {"gl_account": "GL-5301", "cost_center": "CC-PROD", "setup": False},
           "SETUP_CREW": {"gl_account": "GL-5401", "cost_center": "CC-SETUP", "setup": True}}
HOURS = {"labor": {"run": "18", "setup": "2"}, "machine": {"run": "15", "setup": "1.5"}}


def v205(pools, acks=None, budgets=None, **extra):
    base = {"labor_cost_source": "work_center_rate", "default_labor_rate": "30", "pools": pools, "budgets": budgets or BUDGETS,
            "setup_acks": acks or {}}
    base.update(extra)
    return base


def pool(code, basis, activity, rate, budgets):
    return {"code": code, "basis": basis, "rate": rate, "activity": activity, "budgets": budgets}


def top_level_sources(path):
    src = Path(path).read_text(encoding="utf-8")
    out = {}
    for node in ast.parse(src).body:
        names = [node.name] if isinstance(node, (ast.FunctionDef, ast.ClassDef)) else \
            [t.id for t in getattr(node, "targets", []) if isinstance(t, ast.Name)]
        for n in names:
            out[n] = ast.get_source_segment(src, node)
    return out


def run(rc, calc_path, r3_path=None):
    results = []

    def control(cid, text, fn):
        try:
            ok, detail = fn()
        except Exception as exc:          # a missing function or a wrong error is a failed control, not a crash
            ok, detail = False, f"{type(exc).__name__}: {exc}"
        results.append((cid, text, ok, detail))

    def refused(fn, code):
        try:
            fn()
        except rc.StageCostError as exc:
            return str(exc).startswith(code), str(exc)
        return False, "not refused"

    # ---------------------------------------------------------------- DX0 of the design annex through compute_205
    cases = {
        "a": v205([pool("POWER_OH", "machine_hours", "both", "15", ["ELECTRICITY"]), pool("DEPR_OH", "machine_hours", "both", "25", ["DEPRECIATION"]),
                   pool("LABOR_OH", "labor_hours", "both", "12", ["SUPERVISION"]), pool("SETUP_OH", "machine_hours", "setup", "60", ["SETUP_CREW"])]),
        "b": v205([pool("MACHINE_OH", "machine_hours", "run", "46", ["ELECTRICITY", "DEPRECIATION", "SETUP_CREW"]),
                   pool("LABOR_OH", "labor_hours", "run", "12", ["SUPERVISION"])], {"MACHINE_OH": ["SETUP_CREW"]}),
        "c": v205([pool("DEPR_OH", "machine_hours", "both", "25", ["DEPRECIATION"]), pool("LABOR_OH", "labor_hours", "both", "12", ["SUPERVISION", "DEPRECIATION"]),
                   pool("POWER_OH", "machine_hours", "both", "15", ["ELECTRICITY"]), pool("SETUP_OH", "machine_hours", "setup", "60", ["SETUP_CREW"])]),
        "d": v205([pool("MACHINE_OH", "machine_hours", "run", "46", ["ELECTRICITY", "DEPRECIATION", "SETUP_CREW"]),
                   pool("SETUP_OH", "machine_hours", "setup", "60", ["SETUP_CREW"]), pool("LABOR_OH", "labor_hours", "run", "12", ["SUPERVISION"])],
                  {"MACHINE_OH": ["SETUP_CREW"]}),
        "e": v205([pool("MACHINE_OH", "machine_hours", "run", "40", ["ELECTRICITY", "DEPRECIATION"]), pool("LABOR_OH", "labor_hours", "run", "12", ["SUPERVISION"])]),
        "f": v205([pool("MACHINE_OH", "machine_hours", "run", "40", ["ELECTRICITY", "DEPRECIATION"]), pool("LABOR_OH", "labor_hours", "run", "12", ["SUPERVISION"]),
                   pool("SETUP_OH", "machine_hours", "setup", "60", ["SETUP_CREW"])], {"MACHINE_OH": ["SETUP_CREW"]}),
    }

    def x1():
        import build_design as bd                     # the annex's DX0, built from compute_204 one pool at a time
        design = {k: (err or res["total"]) for k, (_key, _d, res, err) in zip("abcdef", bd.dx0())}
        got = {}
        for k, v in cases.items():
            try:
                got[k] = rc.compute_205(v, "WC-C", HOURS)["total"]
            except rc.StageCostError as exc:
                got[k] = str(exc)
        return got == design, f"compute_205 {got} | annex DX0 {design}"
    control("X1", "DX0 (أ–و) through compute_205 equals the design annex: two totals and four refusal codes", x1)

    def x2():
        ok = all(rc.compute_205(cases[k], "WC-C", HOURS)["labor"] == 60000 for k in "ab")
        return ok, "direct labor 600.00 = (18 + 2) h x 30 in both accepted cases"
    control("X2", "direct labor is charged on run + setup hours whatever the pools", x2)

    # ---------------------------------------------------------------- version-level refusals
    def x3():
        b = dict(BUDGETS, POWER_DUP={"gl_account": "GL-5101", "cost_center": "CC-PROD", "setup": False})
        return refused(lambda: rc.validate_205_version(v205([pool("P1", "machine_hours", "both", "15", ["ELECTRICITY"]),
                                                              pool("P2", "machine_hours", "both", "15", ["POWER_DUP"])], budgets=b)),
                       "COST_POLICY_BUDGET_DUPLICATE_SOURCE")
    control("X3", "the same GL account + cost center under two budget codes is refused", x3)

    def x4():
        checks = [
            (v205([{"code": "P", "basis": "machine_hours", "rate": "10", "budgets": ["ELECTRICITY"]}]), "COST_POLICY_POOL_ACTIVITY_UNSET"),
            (v205([pool("P", "machine_hours", "both", "10", [])]), "COST_POLICY_POOL_WITHOUT_BUDGET"),
            (v205([pool("P", "machine_hours", "both", "10", ["NOPE"])]), "COST_POLICY_BUDGET_UNKNOWN"),
            (v205([pool("P", "machine_hours", "both", "10", ["ELECTRICITY", "DEPRECIATION", "SETUP_CREW"])]), "COST_POLICY_BUDGET_UNALLOCATED"),
            (v205([pool("P", "machine_hours", "setup", "10", ["SETUP_CREW"]), pool("L", "labor_hours", "both", "12",
                   ["ELECTRICITY", "DEPRECIATION", "SUPERVISION"])], {"P": ["SETUP_CREW"]}), "COST_POLICY_SETUP_ACK_INVALID"),
        ]
        out = [refused(lambda v=v: rc.validate_205_version(v), code) for v, code in checks]
        return all(o[0] for o in out), "; ".join(o[1] for o in out)
    control("X4", "activity unset, pool without budget, unknown budget, unallocated budget, ack on a non-run pool: each refused", x4)

    def x5():
        v = cases["a"]
        ok1, d1 = refused(lambda: rc.compute_205(v, "WC-C", {"labor": {"run": 18, "setup": None}, "machine": {"run": 15, "setup": 1}}),
                          "COST_POLICY_DRIVER_MISSING")
        zero = rc.compute_205(v, "WC-C", {"labor": {"run": 0, "setup": 0}, "machine": {"run": 0, "setup": 0}})
        return ok1 and zero["total"] == 0, f"{d1}; measured zero total={zero['total']}"
    control("X5", "an unmeasured (None) hour is refused; a measured zero is accepted", x5)

    # ---------------------------------------------------------------- legacy 204 versions: resolution beside the version, never in it
    legacy = copy.deepcopy(rc.POLICY_V1)
    before = json.dumps(legacy, sort_keys=True)
    resolution = {"pools": {"LABOR_OH": {"activity": "both", "budgets": ["SUPERVISION"]},
                            "MACHINE_OH": {"activity": "run", "budgets": ["ELECTRICITY", "DEPRECIATION", "SETUP_CREW"]}},
                  "budgets": BUDGETS, "setup_acks": {"MACHINE_OH": ["SETUP_CREW"]}}

    def x6():
        return refused(lambda: rc.compute_205(legacy, "WC-A", HOURS), "COST_POLICY_LEGACY_UNRESOLVED")
    control("X6", "a 204 version without a resolution is refused, never read with a default", x6)

    def x7():
        got = rc.compute_205(legacy, "WC-A", HOURS, legacy_resolution=resolution)
        same = rc.compute_205(v205([pool("LABOR_OH", "labor_hours", "both", "12", ["SUPERVISION"]),
                                    pool("MACHINE_OH", "machine_hours", "run", "40", ["ELECTRICITY", "DEPRECIATION", "SETUP_CREW"])],
                                   {"MACHINE_OH": ["SETUP_CREW"]}, wc_rules=rc.POLICY_V1["wc_rules"]), "WC-A", HOURS)
        unchanged = json.dumps(legacy, sort_keys=True) == before
        return got == same and unchanged, f"resolved {got} = equivalent 205 {same}; version unchanged={unchanged}"
    control("X7", "a resolved 204 version computes as the equivalent 205 version, and the version object is unchanged", x7)

    def x8():
        ok1, d1 = refused(lambda: rc.compute_205(cases["a"], "WC-C", HOURS, legacy_resolution=resolution), "COST_POLICY_LEGACY_NOT_APPLICABLE")
        bad = {**resolution, "pools": {"LABOR_OH": resolution["pools"]["LABOR_OH"]}}
        ok2, d2 = refused(lambda: rc.compute_205(legacy, "WC-A", HOURS, legacy_resolution=bad), "COST_POLICY_LEGACY_POOLS_MISMATCH")
        return ok1 and ok2, f"{d1}; {d2}"
    control("X8", "a resolution on a 205 version, or one that does not cover exactly the version's pools, is refused", x8)

    # ---------------------------------------------------------------- equivalence with the accepted compute_204 (randomised, fixed seed)
    def x9(n=2000, seed=205):
        rnd = random.Random(seed)  # nosec B311 - reproducible test data, not security
        bad = 0
        for _ in range(n):
            h = {r: {a: rnd.choice(["0", f"{rnd.randint(1, 4000) / 100:.2f}"]) for a in ("run", "setup")} for r in ("labor", "machine")}
            src = rnd.choice(["work_center_rate", "recorded_entry_rate"])
            rec = f"{rnd.randint(0, 99999) / 100:.2f}"
            pools = [pool(f"P{i}", rnd.choice(["labor_hours", "machine_hours"]), rnd.choice(["run", "setup", "both"]),
                          f"{rnd.randint(1, 9999) / 100:.2f}", [f"B{i}"]) for i in range(rnd.randint(1, 4))]
            budgets = {f"B{i}": {"gl_account": f"GL{i}", "cost_center": None, "setup": False} for i in range(len(pools))}
            wc_rules = {"WC": {"labor_rate": "41.5", "pools": {"P0": {"rate": "7.25"}, "P1": {"applies": False}}}}
            v = {"labor_cost_source": src, "default_labor_rate": "30", "pools": pools, "budgets": budgets, "wc_rules": wc_rules}
            for wc in ("WC", "OTHER"):
                got = rc.compute_205(v, wc, h, rec)
                lh = rc.F(str(h["labor"]["run"])) + rc.F(str(h["labor"]["setup"]))
                v204 = {"labor_cost_source": src, "default_labor_rate": "30", "pools": [], "wc_rules": wc_rules}
                if got["labor"] != rc.compute_204(v204, wc, lh, 0, rec)["labor"]:
                    bad += 1
                for p in pools:
                    r = "labor" if p["basis"] == "labor_hours" else "machine"
                    hh = sum((rc.F(str(h[r][a])) for a in rc.ACTIVITIES[p["activity"]]), rc.ZERO)
                    one = {**v204, "pools": [{"code": p["code"], "basis": p["basis"], "rate": p["rate"]}]}
                    ref = rc.compute_204(one, wc, hh if r == "labor" else 0, hh if r == "machine" else 0, rec)["pools"]
                    if got["pools"].get(p["code"]) != ref.get(p["code"]):
                        bad += 1
        return bad == 0, f"{n} random versions x 2 work centers: {bad} differences from compute_204 per line"
    control("X9", "labor and every pool line equal compute_204 called with the hours the activity selects (wc rates and applies included)", x9)

    # ---------------------------------------------------------------- revision 3 kept byte-identical
    if r3_path:
        def x10():
            old, new = top_level_sources(r3_path), top_level_sources(calc_path)
            changed = sorted(n for n in old if new.get(n) != old[n])
            added = set(new) - set(old)
            return not changed and added == R4_NAMES, f"r3 definitions changed: {changed or 'none'}; added: {sorted(added)}"
        control("X10", "every revision-3 definition is byte-identical; r4 adds only the 205 names", x10)
    return results


if __name__ == "__main__":
    calc = sys.argv[1]
    res = run(load(calc), calc, sys.argv[2] if len(sys.argv) > 2 else None)
    for cid, text, ok, detail in res:
        print(f"{'PASS' if ok else 'FAIL'}\t{cid}\t{text}\t{detail}")
    npass = sum(1 for r in res if r[2])
    print(f"CONTROLS_205 pass={npass} fail={len(res) - npass} of {len(res)}")
    sys.exit(0 if npass == len(res) else 1)
