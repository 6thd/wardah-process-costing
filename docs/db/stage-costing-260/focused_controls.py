# Focused controls for the #260 reference calculator: completed-output layers and calculation dependencies (Codex review of r2 at 0b66a36c).
# Runs against any calculator file given on the command line, so the same controls can be shown failing on r2 and passing on r3.
# Standard library only; connects to nothing.
#   python -I -B -X utf8 focused_controls.py <path to reference_calculator.py>
import importlib.machinery
import importlib.util
import sys


def load(path, name="calc_under_test"):
    """loads a calculator from a .py file or from a stored snapshot (.py.txt, kept out of the linters' reach)"""
    loader = importlib.machinery.SourceFileLoader(name, str(path))
    spec = importlib.util.spec_from_loader(name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


def run(rc):
    ex = rc.examples()
    e2 = ex["E2"]["stage"]
    results = []

    def control(cid, text, fn):
        try:
            ok, detail = fn()
        except Exception as exc:          # a missing method or a wrong error is a failed control, not a crash
            ok, detail = False, f"{type(exc).__name__}: {exc}"
        results.append((cid, text, ok, detail))

    # ---------------------------------------------------------------- layers
    def l1():
        s = sum(e2["layer"]["components"].values())
        return s == e2["to"], f"layer Σ {s / 100:,.2f} vs completed {e2['to'] / 100:,.2f}"
    control("L1", "Σ components of the stage-2 completed layer = its completed amount", l1)

    def l2():
        lines, _ = rc.transfer_from_layers([{"calc": (2, 1, 1), "units": 700, "components": e2["layer"]["components"]}],
                                           [{"id": "T", "units": 700, "to_stage": 3, "received_period": 1}])
        t = sum(ln["total"] for ln in lines)
        return t == e2["to"] == 1304565, f"full move of 700 carries {t / 100:,.2f} (expected 13,045.65)"
    control("L2", "a full move of E2's output to stage 3 carries 13,045.65", l2)

    def l3():
        lines, left = rc.transfer_from_layers([{"calc": (2, 1, 1), "units": 700, "components": e2["layer"]["components"]}],
                                              [{"id": "a", "units": 400, "to_stage": 3, "received_period": 1},
                                               {"id": "b", "units": 300, "to_stage": 3, "received_period": 2}])
        t = sum(ln["total"] for ln in lines)
        per_key = all(sum(ln["components"][k] for ln in lines) == a for k, a in e2["layer"]["components"].items())
        neg = any(a < 0 for ln in lines for a in ln["components"].values())
        return t == e2["to"] and per_key and not neg, f"partial 400 + 300 carry {t / 100:,.2f}; per component kept={per_key}; negative={neg}"
    control("L3", "partial moves (400 then 300) from the composite layer keep every component and the total", l3)

    def l4():
        keys = list(e2["layer"]["components"])
        tuples = all(isinstance(k, tuple) and len(k) == 3 for k in keys)
        if not tuples:
            return False, f"layer keys without origin: {keys}"
        s1 = sum(a for k, a in e2["layer"]["components"].items() if k[0] == 1)
        ti_to = e2["groups"]["transferred_in"]["to"]
        return s1 == ti_to and len(keys) == 7, f"{len(keys)} keys; Σ stage-1 origin {s1 / 100:,.2f} = transferred-in in completed {ti_to / 100:,.2f}"
    control("L4", "layer keys keep (origin stage, category, component); stage-1 origin = transferred-in share", l4)

    # ---------------------------------------------------------------- dependencies
    def chain():
        led = rc.Ledger()
        led.record((1, 1), [], None)
        led.approve((1, 1))
        led.record((2, 1), [((1, 1), 1)], None)
        led.approve((2, 1))
        led.record((3, 1), [((2, 1), 1)], None)
        led.approve((3, 1))
        return led

    def snap(led):
        return {k: (c["version"], c["state"]) for k, c in led.calcs.items()}

    def expect_error(fn, code):
        try:
            fn()
            return False, "accepted"
        except rc.StageCostError as exc:
            return str(exc) == code, str(exc)

    def d1():
        led = chain()
        led.calcs[(3, 1)]["state"] = "posted"           # an indirect dependant of S1 is posted (S2 between them is only approved)
        before = snap(led)
        ok, got = expect_error(lambda: led.record((1, 1), [], None), "STAGE_COST_DOWNSTREAM_POSTED")
        same = snap(led) == before
        return ok and same, f"recalculating S1: {got}; states unchanged={same}"
    control("D1", "an indirect posted dependant blocks recalculating the source, and no state changes", d1)

    def d2():
        led = chain()
        led.record((1, 1), [], None)                    # S1 v2
        led.approve((1, 1))
        ok, got = expect_error(lambda: led.record((2, 1), [((1, 1), 1)], None), "STAGE_COST_SOURCE_SUPERSEDED")
        return ok, f"re-recording S2 on S1 v1 after S1 v2: {got}"
    control("D2", "a dependant cannot be re-recorded on a superseded source version", d2)

    def d3():
        led = rc.Ledger()
        led.record((1, 1), [], None)                    # calculated, not approved
        ok, got = expect_error(lambda: led.record((2, 1), [((1, 1), 1)], None), "STAGE_COST_SOURCE_NOT_APPROVED")
        return ok, f"recording S2 on a calculated S1: {got}"
    control("D3", "a calculation cannot be recorded on a source that is not approved", d3)

    def d4():
        led = chain()
        led.record((1, 1), [], None)                    # S2 and S3 become stale
        ok, got = expect_error(lambda: led.record((3, 1), [((2, 1), 1)], None), "STAGE_COST_DEPENDENCY_STALE")
        return ok, f"recording S3 on stale S2: {got}"
    control("D4", "a calculation cannot be recorded on a stale source", d4)

    def d5():
        led = rc.Ledger()
        led.record((1, 1), [], None)
        try:
            led.record((2, 1), [((1, 1), 1)], None)
            led.approve((2, 1))
        except rc.StageCostError:
            pass
        st = led.calcs.get((2, 1), {}).get("state")
        return st != "approved", f"S2 state while S1 is only calculated: {st}"
    control("D5", "a dependant never reaches approved while its source is only calculated", d5)

    def d6():
        led = chain()
        ok, got = expect_error(lambda: led.post((2, 1)), "STAGE_COST_SOURCE_NOT_POSTED")
        return ok, f"posting S2 before S1: {got}"
    control("D6", "posting requires every source posted first", d6)

    def d7():
        led = chain()
        led.record((1, 1), [], None)                    # S2, S3 stale
        ok1, got1 = expect_error(lambda: led.approve((3, 1)), "STAGE_COST_DEPENDENCY_STALE")
        states = snap(led)
        transitive = states[(2, 1)][1] == "stale" and states[(3, 1)][1] == "stale"
        return ok1 and transitive, f"approve stale S3: {got1}; S2 and S3 stale={transitive}"
    control("D7", "recalculating S1 makes S2 and S3 stale transitively; a stale calculation cannot be approved", d7)

    def d8():
        led = chain()
        led.calcs[(1, 1)]["state"] = "posted"
        ok, got = expect_error(lambda: led.record((1, 1), [], None), "STAGE_COST_ALREADY_POSTED")
        return ok, f"recalculating a posted calculation: {got}"
    control("D8", "a posted calculation cannot be recalculated (regression)", d8)
    return results


if __name__ == "__main__":
    res = run(load(sys.argv[1]))
    for cid, text, ok, detail in res:
        print(f"{'PASS' if ok else 'FAIL'}\t{cid}\t{text}\t{detail}")
    npass = sum(1 for r in res if r[2])
    print(f"FOCUSED_CONTROLS pass={npass} fail={len(res) - npass} of {len(res)}")
    sys.exit(0 if npass == len(res) else 1)
