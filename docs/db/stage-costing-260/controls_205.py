# Controls for compute_205 / validate_205_version (calculator revision 4, Migration 205 plan; owner approved group A on 2026-10-28).
# Runs against any calculator file given on the command line, so the same controls can be shown failing on r3 (which has no compute_205) and
# passing on r4. A second argument (the r3 snapshot) adds the check that every revision-3 definition is byte-identical in the file under test.
# X15-X19 (owner decisions 205-Q3 and 205-Q4, 2026-10-29), run on r4b and on r4c. X16, X17 and X19 fail on r4b by behaviour (r4b refuses a
# valid exception, gives BUDGET_UNALLOCATED for an invalid one, and accepts or crashes on a budget without an account); X15 fails on r4b only by
# absence (approve_205_check, the company policy at approval, is new); X18 guards that the exception relaxes no other rule (on r4b it fails
# only because r4b refuses every exception).
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

R4_NAMES = {"ACTIVITIES", "POOL_205_KEYS", "number_205", "validate_205_version", "is_205_version", "compute_205",
            "UNALLOCATED_POLICIES", "UNALLOCATED_EXCEPTION_KEYS", "check_unallocated_exception_205", "unallocated_205", "approve_205_check"}
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
        except Exception as exc:          # refused, but not with a policy code
            return False, f"{type(exc).__name__}: {exc}"
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

    # ---------------------------------------------------------------- Codex review of r4 at e66b1136: three cases found, and the NULL cost center
    def x11():
        b = {"B1": {"gl_account": "GL-1", "cost_center": None, "setup": False}, "B2": {"gl_account": "GL-2", "cost_center": None, "setup": False}}
        v = v205([pool("OH", "machine_hours", "both", "10", ["B1"]), pool("OH", "machine_hours", "both", "20", ["B2"])], budgets=b)
        ok1, d1 = refused(lambda: rc.validate_205_version(v), "COST_POLICY_POOL_CODE_DUPLICATE")
        ok2, d2 = refused(lambda: rc.compute_205(v, "WC-C", HOURS), "COST_POLICY_POOL_CODE_DUPLICATE")
        return ok1 and ok2, f"validate: {d1}; compute: {d2}"
    control("X11", "two pools with the same code are refused before any amount is computed (no line overwrites another)", x11)

    def x12():
        good = cases["a"]
        neg_rate = v205([pool("P", "machine_hours", "both", "-5", ["ELECTRICITY"]), pool("Q", "machine_hours", "both", "1",
                         ["DEPRECIATION", "SUPERVISION", "SETUP_CREW"])])
        zero_rate = v205([pool("P", "machine_hours", "both", "0", ["ELECTRICITY"]), pool("Q", "machine_hours", "both", "1",
                          ["DEPRECIATION", "SUPERVISION", "SETUP_CREW"])])
        bad_wc = {**good, "wc_rules": {"WC-C": {"pools": {"POWER_OH": {"rate": "-1"}}}}}
        bad_labor = {**good, "default_labor_rate": "-30"}
        rec = {**good, "labor_cost_source": "recorded_entry_rate"}
        checks = [
            (lambda: rc.compute_205(good, "WC-C", {"labor": {"run": "18", "setup": "2"}, "machine": {"run": "-1", "setup": "0"}}), "COST_POLICY_HOURS_INVALID"),
            (lambda: rc.compute_205(good, "WC-C", {"labor": {"run": "abc", "setup": "2"}, "machine": {"run": "1", "setup": "0"}}), "COST_POLICY_HOURS_INVALID"),
            (lambda: rc.validate_205_version(neg_rate), "COST_POLICY_RATE_INVALID"),
            (lambda: rc.validate_205_version(zero_rate), "COST_POLICY_RATE_INVALID"),
            (lambda: rc.compute_205(bad_wc, "WC-C", HOURS), "COST_POLICY_RATE_INVALID"),
            (lambda: rc.compute_205(bad_labor, "WC-C", HOURS), "COST_POLICY_RATE_INVALID"),
            (lambda: rc.compute_205(rec, "WC-C", HOURS, "-0.01"), "COST_POLICY_RECORDED_COST_INVALID"),
        ]
        out = [refused(fn, code) for fn, code in checks]
        return all(o[0] for o in out), "; ".join(o[1] for o in out)
    control("X12", "negative or non-numeric hours, non-positive rates (pool, work-center rule, labor) and a negative recorded amount are refused", x12)

    def x13():
        labor_only = v205([pool("LABOR_OH", "labor_hours", "both", "12", ["ELECTRICITY", "DEPRECIATION", "SUPERVISION", "SETUP_CREW"])])
        no_machine = {"labor": {"run": "18", "setup": "2"}, "machine": {"run": None, "setup": None}}
        r1 = rc.compute_205(labor_only, "WC-C", no_machine)
        run_only = v205([pool("MACHINE_OH", "machine_hours", "run", "40", ["ELECTRICITY", "DEPRECIATION", "SETUP_CREW"]),
                         pool("LABOR_OH", "labor_hours", "both", "12", ["SUPERVISION"])], {"MACHINE_OH": ["SETUP_CREW"]})
        r2 = rc.compute_205(run_only, "WC-C", {"labor": {"run": "18", "setup": "2"}, "machine": {"run": "15", "setup": None}})
        excluded = {**cases["a"], "wc_rules": {"WC-X": {"pools": {"POWER_OH": {"applies": False}, "DEPR_OH": {"applies": False},
                                                                   "SETUP_OH": {"applies": False}}}}}
        r3 = rc.compute_205(excluded, "WC-X", no_machine)
        rec = v205([pool("MACHINE_OH", "machine_hours", "both", "40", ["ELECTRICITY", "DEPRECIATION", "SUPERVISION", "SETUP_CREW"])],
                   labor_cost_source="recorded_entry_rate")
        r4 = rc.compute_205(rec, "WC-C", {"labor": {"run": None, "setup": None}, "machine": {"run": "15", "setup": "1.5"}}, "512.40")
        ok_needed, d_needed = refused(lambda: rc.compute_205(run_only, "WC-C", {"labor": {"run": "18", "setup": "2"},
                                                                                "machine": {"run": None, "setup": "1"}}),
                                      "COST_POLICY_DRIVER_MISSING: machine.run")
        ok = r1["total"] == 60000 + 24000 and r2["pools"]["MACHINE_OH"] == 60000 and set(r3["pools"]) == {"LABOR_OH"} and r4["labor"] == 51240
        return ok and ok_needed, (f"labor-only {r1['total']}; run-only machine pool {r2['pools']}; excluded pools at WC-X {r3['pools']}; "
                                  f"recorded labor {r4['labor']}; a needed hour still refused: {d_needed}")
    control("X13", "only the hours the computation uses are required (pool activity, pools excluded at the work center, labor source)", x13)

    def x14():
        dup_null = {"B1": {"gl_account": "GL-1", "cost_center": None, "setup": False}, "B2": {"gl_account": "GL-1", "cost_center": None, "setup": False}}
        overlap = {"B1": {"gl_account": "GL-1", "cost_center": None, "setup": False}, "B2": {"gl_account": "GL-1", "cost_center": "CC-1", "setup": False}}
        split = {"B1": {"gl_account": "GL-1", "cost_center": "CC-1", "setup": False}, "B2": {"gl_account": "GL-1", "cost_center": "CC-2", "setup": False}}

        def two(b):
            return v205([pool("P1", "machine_hours", "both", "10", ["B1"]), pool("P2", "machine_hours", "both", "20", ["B2"])], budgets=b)
        ok1, d1 = refused(lambda: rc.validate_205_version(two(dup_null)), "COST_POLICY_BUDGET_DUPLICATE_SOURCE")
        ok2, d2 = refused(lambda: rc.validate_205_version(two(overlap)), "COST_POLICY_BUDGET_SOURCE_OVERLAP")
        rc.validate_205_version(two(split))
        return ok1 and ok2, f"same account, no cost center, twice: {d1}; account alone and account + center: {d2}; two different centers: accepted"
    control("X14", "with an optional cost center: the same account twice without a center, or alone and with a center, is refused", x14)

    # ---------------------------------------------------------------- owner decisions 205-Q4 (company policy for unallocated budgets) and 205-Q3
    amounts = {"ELECTRICITY": "9000", "DEPRECIATION": "15000", "SUPERVISION": "4800.50", "SETUP_CREW": "3600"}
    budgets_amt = {c: {**b, "amount": amounts[c]} for c, b in BUDGETS.items()}
    loaded = [pool("MACHINE_OH", "machine_hours", "run", "40", ["ELECTRICITY", "DEPRECIATION", "SETUP_CREW"])]
    exception = {"policy": "controlled_exception", "budgets": ["SUPERVISION"], "reason": "supervision kept as a period cost this quarter",
                 "treatment": "reported as unabsorbed overhead of the period; not charged to orders", "approved_by": "user-approver-1"}

    def q4(exc=exception, budgets=budgets_amt, pools=loaded, acks=None):
        v = v205(pools, acks if acks is not None else {"MACHINE_OH": ["SETUP_CREW"]}, budgets=budgets)
        if exc is not None:
            v["unallocated_exception"] = exc
        return v

    def x15():
        checks = [
            (lambda: rc.approve_205_check(q4(exc=None)), "COST_POLICY_BUDGET_UNALLOCATED"),
            (lambda: rc.approve_205_check(q4(exc=None), "controlled_exception"), "COST_POLICY_BUDGET_UNALLOCATED"),
            (lambda: rc.approve_205_check(q4()), "COST_POLICY_UNALLOCATED_EXCEPTION_NOT_ALLOWED"),
            (lambda: rc.approve_205_check(q4(), "block"), "COST_POLICY_UNALLOCATED_EXCEPTION_NOT_ALLOWED"),
            (lambda: rc.approve_205_check(q4(), "allow"), "COST_POLICY_UNALLOCATED_POLICY_INVALID"),
        ]
        out = [refused(fn, code) for fn, code in checks]
        full = rc.approve_205_check(cases["b"])
        return all(o[0] for o in out) and full == {"unallocated": {}, "exception": False}, \
            "; ".join(o[1] for o in out) + f"; fully allocated version under the default: {full}"
    control("X15", "default policy blocks: an unallocated budget is refused at approval, an exception is refused under 'block', an unknown policy is refused", x15)

    def x16():
        v = q4()
        got = rc.compute_205(v, "WC-C", HOURS)
        shown = rc.approve_205_check(v, "controlled_exception")
        without = v205(loaded, {"MACHINE_OH": ["SETUP_CREW"]}, budgets={c: b for c, b in budgets_amt.items() if c != "SUPERVISION"})
        ref = rc.compute_205(without, "WC-C", HOURS)
        ok = shown == {"unallocated": {"SUPERVISION": 480050}, "exception": True} and got == ref and "SUPERVISION" not in str(got["pools"])
        return ok, (f"approval shows {shown}; compute with the exception {got} = compute without that budget {ref} (not absorbed); "
                    "compute_205 does not read the company policy, so a later change to 'block' does not reopen the approved version")
    control("X16", "a controlled exception is accepted only under that policy, shows the unloaded budget and its amount, and absorbs nothing of it", x16)

    def x17():
        def e(**kw):
            return {**exception, **kw}
        no_amount = {**budgets_amt, "SUPERVISION": {k: x for k, x in budgets_amt["SUPERVISION"].items() if k != "amount"}}
        neg_amount = {**budgets_amt, "SUPERVISION": {**budgets_amt["SUPERVISION"], "amount": "-1"}}
        sub_cent = {**budgets_amt, "SUPERVISION": {**budgets_amt["SUPERVISION"], "amount": "1.001"}}
        two_unloaded = [pool("MACHINE_OH", "machine_hours", "run", "40", ["ELECTRICITY", "SETUP_CREW"])]
        checks = [
            (q4(exc=e(reason="")), "COST_POLICY_UNALLOCATED_EXCEPTION_INVALID: reason"),
            (q4(exc=e(treatment="  ")), "COST_POLICY_UNALLOCATED_EXCEPTION_INVALID: treatment"),
            (q4(exc=e(approved_by=None)), "COST_POLICY_UNALLOCATED_EXCEPTION_INVALID: approved_by"),
            (q4(exc={k: x for k, x in exception.items() if k != "reason"}), "COST_POLICY_UNALLOCATED_EXCEPTION_INVALID: fields"),
            (q4(exc=e(note="x")), "COST_POLICY_UNALLOCATED_EXCEPTION_INVALID: fields"),
            (q4(exc=e(policy="block")), "COST_POLICY_UNALLOCATED_EXCEPTION_INVALID: policy"),
            (q4(exc=e(budgets=["SUPERVISION", "ELECTRICITY"])), "COST_POLICY_UNALLOCATED_EXCEPTION_INVALID: budgets"),
            (q4(exc=e(budgets=["SUPERVISION", "SUPERVISION"])), "COST_POLICY_UNALLOCATED_EXCEPTION_INVALID: budgets"),
            (q4(exc=e(budgets=[])), "COST_POLICY_BUDGET_UNALLOCATED"),
            (q4(pools=two_unloaded), "COST_POLICY_BUDGET_UNALLOCATED"),
            (q4(budgets=no_amount), "COST_POLICY_UNALLOCATED_EXCEPTION_INVALID: amount"),
            (q4(budgets=neg_amount), "COST_POLICY_UNALLOCATED_EXCEPTION_INVALID: amount"),
            (q4(budgets=sub_cent), "COST_POLICY_UNALLOCATED_EXCEPTION_INVALID: amount"),
        ]
        out = [refused(lambda v=v: rc.validate_205_version(v), code) for v, code in checks]
        return all(o[0] for o in out), "; ".join(o[1] for o in out)
    control("X17", "an exception without reason, treatment or approver, with other fields, naming a loaded or a repeated budget, or missing an unloaded one or its amount, is refused", x17)

    def x18():
        dup = {**budgets_amt, "POWER_DUP": {"gl_account": "GL-5101", "cost_center": "CC-PROD", "setup": False, "amount": "1"}}
        over = {**budgets_amt, "GL_WIDE": {"gl_account": "GL-5101", "cost_center": None, "setup": False, "amount": "1"}}
        dup_pool = [pool("MACHINE_OH", "machine_hours", "run", "40", ["ELECTRICITY", "DEPRECIATION", "SETUP_CREW"]),
                    pool("MACHINE_OH", "machine_hours", "run", "40", ["POWER_DUP"])]
        double = [pool("MACHINE_OH", "machine_hours", "run", "40", ["ELECTRICITY", "DEPRECIATION", "SETUP_CREW"]),
                  pool("LABOR_OH", "labor_hours", "run", "12", ["ELECTRICITY"])]
        bad_rate = [pool("MACHINE_OH", "machine_hours", "run", "0", ["ELECTRICITY", "DEPRECIATION", "SETUP_CREW"])]
        checks = [
            (q4(budgets=dup, exc={**exception, "budgets": ["SUPERVISION", "POWER_DUP"]}), "COST_POLICY_BUDGET_DUPLICATE_SOURCE"),
            (q4(budgets=over, exc={**exception, "budgets": ["SUPERVISION", "GL_WIDE"]}), "COST_POLICY_BUDGET_SOURCE_OVERLAP"),
            (q4(budgets={**budgets_amt, "POWER_DUP": {"gl_account": "GL-9", "cost_center": None, "setup": False, "amount": "1"}}, pools=dup_pool),
             "COST_POLICY_POOL_CODE_DUPLICATE"),
            (q4(pools=double), "COST_POLICY_BUDGET_DOUBLE_ALLOCATION"),
            (q4(pools=bad_rate), "COST_POLICY_RATE_INVALID"),
            (q4(acks={}), "COST_POLICY_SETUP_TREATMENT_UNSET"),
        ]
        out = [refused(lambda v=v: rc.validate_205_version(v), code) for v, code in checks]
        ok_h, d_h = refused(lambda: rc.compute_205(q4(), "WC-C", {"labor": {"run": "18", "setup": "2"}, "machine": {"run": "-1", "setup": "0"}}),
                            "COST_POLICY_HOURS_INVALID")
        return all(o[0] for o in out) and ok_h, "; ".join(o[1] for o in out) + f"; {d_h}"
    control("X18", "with a valid exception, duplicate source, overlap, duplicate pool code, double allocation, invalid rate, unacknowledged setup and a negative hour are still refused", x18)

    def x19():
        def one(b):
            return v205([pool("P1", "machine_hours", "both", "10", ["B1"])], budgets={"B1": b})
        checks = [({"gl_account": None, "cost_center": "CC-1", "setup": False}, "COST_POLICY_BUDGET_ACCOUNT_REQUIRED"),
                  ({"cost_center": "CC-1", "setup": False}, "COST_POLICY_BUDGET_ACCOUNT_REQUIRED"),
                  ({"gl_account": "", "cost_center": None, "setup": False}, "COST_POLICY_BUDGET_ACCOUNT_REQUIRED")]
        out = [refused(lambda b=b: rc.validate_205_version(one(b)), code) for b, code in checks]
        rc.validate_205_version(one({"gl_account": "GL-1", "cost_center": None, "setup": False}))
        return all(o[0] for o in out), "; ".join(o[1] for o in out) + "; account without a center (account-wide scope): accepted"
    control("X19", "a budget without a GL account is refused; an account without a cost center is the account-wide scope and is accepted", x19)

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
