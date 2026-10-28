# Reference calculator for the #260 stage-costing contract (weighted average). Python standard library only; connects to nothing.
# It is the source of every number in docs/db/STAGE_COSTING_260_CONTRACT.md: build_contract.py renders the tables from it, so no example
# value is typed by hand. It is a specification aid, not the engine: the engine is SQL (DB-first) and must reproduce these results.
#
#   compute_204()  the policy computation of Migration 204 §4, as written there (labor and each pool rounded to 2 places).
#   drivers()      measured hours -> the labor-hours and machine-hours drivers, by the per-company run/setup option (§3 of the contract).
#   stage_wa()     one stage, one period, weighted average: equivalent units, cost per EU, transferred-out, normal and abnormal spoilage,
#                  ending WIP; rounding at the cost-category group, components split by share with the residual on the last one.
#   examples()     the worked examples E1..E6, each with its invariant checks asserted.
from decimal import ROUND_HALF_UP, Decimal, getcontext

getcontext().prec = 34
D = Decimal
ZERO = D(0)
CENT = D("0.01")


def q2(x):
    """PostgreSQL round(numeric, 2): half away from zero (all amounts here are >= 0)."""
    return D(x).quantize(CENT, rounding=ROUND_HALF_UP)


# ---------------------------------------------------------------- Migration 204 §4
def compute_204(version, wc, labor_hours, machine_hours, recorded_labor_cost=None):
    rule = version.get("wc_rules", {}).get(wc, {})
    if version["labor_cost_source"] == "work_center_rate":
        if labor_hours is None:
            raise ValueError("COST_POLICY_DRIVER_MISSING: labor_hours")
        rate = rule.get("labor_rate", version["default_labor_rate"])
        labor = q2(D(labor_hours) * D(rate))
    else:
        if recorded_labor_cost is None:
            raise ValueError("COST_POLICY_DRIVER_MISSING: recorded_labor_cost")
        labor = q2(recorded_labor_cost)
    pools = {}
    for p in version["pools"]:
        pr = rule.get("pools", {}).get(p["code"], {})
        if pr.get("applies", True) is False:
            continue
        driver = {"labor_hours": labor_hours, "machine_hours": machine_hours}[p["basis"]] if "driver" not in p else p["driver"]
        if driver is None:
            raise ValueError(f"COST_POLICY_DRIVER_MISSING: {p['basis']}")
        pools[p["code"]] = q2(D(driver) * D(pr.get("rate", p["rate"])))
    return {"labor": labor, "pools": pools, "total": labor + sum(pools.values(), ZERO)}


# ---------------------------------------------------------------- per-company run/setup option (proposed policy fields, contract §3)
def drivers(entries, labor_hours_basis, machine_hours_basis):
    """entries: [(resource 'labor'|'machine', activity 'run'|'setup', hours)]. Each approved entry counts once per basis at most."""
    def total(resource, basis):
        acts = {"run_only": {"run"}, "run_plus_setup": {"run", "setup"}}[basis]
        return sum((D(h) for r, a, h in entries if r == resource and a in acts), ZERO)
    return total("labor", labor_hours_basis), total("machine", machine_hours_basis)


def setup_only_hours(entries, resource):
    return sum((D(h) for r, a, h in entries if r == resource and a == "setup"), ZERO)


# ---------------------------------------------------------------- one stage, one period, weighted average
def stage_wa(s):
    """s: dict with
         units:  bwip, received (started or transferred in), completed (good, transferred out), ewip, spoiled
         groups: ordered {group: {"bwip": {component: cost}, "added": {component: cost}, "ewip_pct": %, "spoil_pct": %}}
                 group ∈ transferred_in | material | conversion
         normal_rate: allowed normal spoilage as a fraction of good units that passed inspection; inspection_pct: conversion % of the point
    """
    u = {k: D(v) for k, v in s["units"].items()}
    assert u["bwip"] + u["received"] == u["completed"] + u["ewip"] + u["spoiled"], "physical units do not balance"
    insp = D(s["inspection_pct"])
    ewip_conv_pct = D(s["groups"]["conversion"]["ewip_pct"])
    ewip_passed = u["ewip"] if ewip_conv_pct >= insp and u["ewip"] > 0 else ZERO
    passing_good = u["completed"] + ewip_passed
    allowed = (D(s["normal_rate"]) * passing_good).quantize(D("0.000001"))
    normal = min(u["spoiled"], allowed)
    abnormal = u["spoiled"] - normal
    out = {"units": {**u, "normal": normal, "abnormal": abnormal, "passing_good": passing_good, "ewip_passed": ewip_passed}, "groups": {}}
    for g, spec in s["groups"].items():
        names = set(spec.get("bwip", {})) | set(spec.get("added", {}))
        comps = [c for c in ("transferred_in", "material", "labor") if c in names] + sorted(names - {"transferred_in", "material", "labor"})
        bw = {c: D(spec.get("bwip", {}).get(c, 0)) for c in comps}
        ad = {c: D(spec.get("added", {}).get(c, 0)) for c in comps}
        total = sum(bw.values(), ZERO) + sum(ad.values(), ZERO)
        e = D(spec["ewip_pct"]) / 100
        sp = D(spec["spoil_pct"]) / 100
        eu = u["completed"] + u["spoiled"] * sp + u["ewip"] * e
        cpu = total / eu if eu else ZERO
        to = q2(u["completed"] * cpu)
        nrm = q2(normal * sp * cpu)
        abn = q2(abnormal * sp * cpu)
        ew = total - to - nrm - abn                      # residual: the group balances to the cent
        # normal spoilage follows the good units that passed inspection
        nrm_to = q2(nrm * u["completed"] / passing_good) if passing_good else ZERO
        nrm_ew = nrm - nrm_to
        amounts = {"to": to + nrm_to, "ewip": ew + nrm_ew, "abnormal": abn}
        # components split by their share of the group total, residual on the last component
        split = {}
        for key, amt in amounts.items():
            rem, part = amt, {}
            for i, c in enumerate(comps):
                if i == len(comps) - 1:
                    part[c] = rem
                else:
                    share = q2(amt * (bw[c] + ad[c]) / total) if total else ZERO
                    part[c] = share
                    rem -= share
            split[key] = part
        out["groups"][g] = {"components": comps, "bwip": bw, "added": ad, "total": total, "eu": eu, "cpu": cpu,
                            "to_before_normal": to, "normal": nrm, "normal_to": nrm_to, "normal_ewip": nrm_ew, **amounts, "split": split}
        assert amounts["to"] + amounts["ewip"] + amounts["abnormal"] == total, g
    out["to"] = sum((v["to"] for v in out["groups"].values()), ZERO)
    out["ewip"] = sum((v["ewip"] for v in out["groups"].values()), ZERO)
    out["abnormal"] = sum((v["abnormal"] for v in out["groups"].values()), ZERO)
    out["accounted"] = sum((v["total"] for v in out["groups"].values()), ZERO)
    assert out["to"] + out["ewip"] + out["abnormal"] == out["accounted"]
    return out


# ---------------------------------------------------------------- worked examples
POLICY_V1 = {   # the acceptance policy of Migration 204 §4 (version 1)
    "labor_cost_source": "work_center_rate", "default_labor_rate": "30",
    "pools": [{"code": "LABOR_OH", "basis": "labor_hours", "rate": "12"}, {"code": "MACHINE_OH", "basis": "machine_hours", "rate": "40"}],
    "wc_rules": {"WC-A": {"labor_rate": "35", "pools": {"MACHINE_OH": {"rate": "55"}}}, "WC-B": {"pools": {"LABOR_OH": {"applies": False}}}},
}


def conv(c204):
    return {"labor": c204["labor"], **c204["pools"]}


def examples():
    ex = {}
    # E0: Migration 204 §4 acceptance table, reproduced (guards the transcription of compute_204)
    e0 = {wc: compute_204(POLICY_V1, wc, 10, 6) for wc in ("WC-A", "WC-B", "WC-C")}
    assert [e0[w]["total"] for w in ("WC-A", "WC-B", "WC-C")] == [D("800.00"), D("540.00"), D("660.00")]
    v2 = {**POLICY_V1, "labor_cost_source": "recorded_entry_rate"}
    v2 = {**v2, "pools": [{"code": "LABOR_OH", "basis": "labor_hours", "rate": "10"}, {"code": "MACHINE_OH", "basis": "machine_hours", "rate": "42"}]}
    e0v2 = compute_204(v2, "WC-C", 13, 6, D("512.40"))
    assert e0v2["total"] == D("894.40")
    ex["E0"] = {"v1": e0, "v2": e0v2}

    # E1: issue #260 acceptance case and runbook 204 §5.3: stage 1, 1,000 started, 800 good, 200 WIP (material 100%, conversion 50%)
    e1 = stage_wa({"units": {"bwip": 0, "received": 1000, "completed": 800, "ewip": 200, "spoiled": 0}, "normal_rate": 0, "inspection_pct": 100,
                   "groups": {"material": {"added": {"material": D(10000)}, "ewip_pct": 100, "spoil_pct": 100},
                              "conversion": {"added": {"labor": D(2000), "MACHINE_OH": D(3000)}, "ewip_pct": 50, "spoil_pct": 100}}})
    assert e1["groups"]["conversion"]["eu"] == 900 and e1["to"] == D("12444.44") and e1["ewip"] == D("2555.56")
    ex["E1"] = e1

    # E2: stage 2 receives E1's 800 units; packaging added at the end (WIP 0%); conversion by the pinned policy at WC-A (10 labor h, 6 machine h)
    c2 = compute_204(POLICY_V1, "WC-A", 10, 6)
    e2 = stage_wa({"units": {"bwip": 0, "received": 800, "completed": 700, "ewip": 100, "spoiled": 0}, "normal_rate": 0, "inspection_pct": 100,
                   "groups": {"transferred_in": {"added": {"transferred_in": e1["to"]}, "ewip_pct": 100, "spoil_pct": 100},
                              "material": {"added": {"material": D(1400)}, "ewip_pct": 0, "spoil_pct": 100},
                              "conversion": {"added": conv(c2), "ewip_pct": 40, "spoil_pct": 100}}})
    added_all = D(10000) + D(2000) + D(3000) + D(1400) + c2["total"]
    assert e2["to"] + e1["ewip"] + e2["ewip"] == added_all, "Σ added = finished + Σ ending WIP (+ abnormal)"
    ex["E2"] = {"policy": c2, "stage": e2, "added_all": added_all}

    # E3: stage 1, next period: E1's ending WIP is the beginning WIP; 600 started; conversion by the pinned policy at WC-C (25 labor h, 15 machine h)
    c3 = compute_204(POLICY_V1, "WC-C", 25, 15)
    b = e1["groups"]
    e3 = stage_wa({"units": {"bwip": 200, "received": 600, "completed": 700, "ewip": 100, "spoiled": 0}, "normal_rate": 0, "inspection_pct": 100,
                   "groups": {"material": {"bwip": b["material"]["split"]["ewip"], "added": {"material": D(6300)}, "ewip_pct": 100, "spoil_pct": 100},
                              "conversion": {"bwip": b["conversion"]["split"]["ewip"], "added": conv(c3), "ewip_pct": 30, "spoil_pct": 100}}})
    ex["E3"] = {"policy": c3, "stage": e3}

    # E4: spoilage. 1,000 started; 900 good; 60 spoiled; 40 WIP at 50% conversion; normal = 5% of good units that passed inspection.
    #  E4a inspection at the end (100%): the 40 WIP have not passed it.  E4b inspection at 40%: the 40 WIP (50%) have passed it.
    for key, insp in (("E4a", 100), ("E4b", 40)):
        ex[key] = stage_wa({"units": {"bwip": 0, "received": 1000, "completed": 900, "ewip": 40, "spoiled": 60}, "normal_rate": D("0.05"),
                            "inspection_pct": insp,
                            "groups": {"material": {"added": {"material": D(9000)}, "ewip_pct": 100, "spoil_pct": 100},
                                       "conversion": {"added": {"labor": D(1900), "LABOR_OH": D(760), "MACHINE_OH": D(1900)}, "ewip_pct": 50,
                                                      "spoil_pct": insp}}})
        assert ex[key]["units"]["normal"] + ex[key]["units"]["abnormal"] == 60

    # E5: the per-company run/setup option at WC-C under version 1 (+ a proposed setup-only pool for option c)
    entries = [("labor", "run", D(18)), ("labor", "setup", D(2)), ("machine", "run", D(15)), ("machine", "setup", D("1.5"))]
    e5 = {}
    for opt, lb, mb in (("a", "run_only", "run_only"), ("b", "run_plus_setup", "run_plus_setup")):
        lh, mh = drivers(entries, lb, mb)
        e5[opt] = {"labor_hours": lh, "machine_hours": mh, "c204": compute_204(POLICY_V1, "WC-C", lh, mh)}
    lh, mh = drivers(entries, "run_plus_setup", "run_only")
    pol_c = {**POLICY_V1, "pools": POLICY_V1["pools"] + [{"code": "SETUP_OH", "basis": "machine_hours", "rate": "60",
                                                          "driver": setup_only_hours(entries, "machine")}]}
    e5["c"] = {"labor_hours": lh, "machine_hours": mh, "setup_machine_hours": setup_only_hours(entries, "machine"),
               "c204": compute_204(pol_c, "WC-C", lh, mh)}
    assert e5["a"]["c204"]["total"] < e5["b"]["c204"]["total"] < e5["c"]["c204"]["total"]
    ex["E5"] = {"entries": entries, "options": e5}

    # E6: correction before posting: E2's stage-2 labor hours approved as 11 instead of 10 -> new calculation version, audited difference
    c6 = compute_204(POLICY_V1, "WC-A", 11, 6)
    e6 = stage_wa({"units": {"bwip": 0, "received": 800, "completed": 700, "ewip": 100, "spoiled": 0}, "normal_rate": 0, "inspection_pct": 100,
                   "groups": {"transferred_in": {"added": {"transferred_in": e1["to"]}, "ewip_pct": 100, "spoil_pct": 100},
                              "material": {"added": {"material": D(1400)}, "ewip_pct": 0, "spoil_pct": 100},
                              "conversion": {"added": conv(c6), "ewip_pct": 40, "spoil_pct": 100}}})
    ex["E6"] = {"policy": c6, "stage": e6, "delta_to": e6["to"] - e2["to"], "delta_ewip": e6["ewip"] - e2["ewip"],
                "delta_added": c6["total"] - c2["total"]}
    assert ex["E6"]["delta_to"] + ex["E6"]["delta_ewip"] == ex["E6"]["delta_added"]
    return ex


if __name__ == "__main__":
    ex = examples()
    print("REFERENCE_EXAMPLES_OK", ", ".join(sorted(ex)))
