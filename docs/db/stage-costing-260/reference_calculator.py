# Reference calculator for the #260 stage-costing contract (weighted average), revision 2. Python standard library only; connects to nothing.
# It is the source of every number in docs/db/STAGE_COSTING_260_CONTRACT.md: build_contract.py renders the tables from it, so no example
# value is typed by hand. It is a specification aid, not the engine: the engine is SQL (DB-first) and must reproduce these results.
#
# Revision 2 (Codex review of #330):
#   * exact arithmetic (fractions.Fraction, amounts in integer cents); rounding by largest remainder over outputs and components, with a fixed
#     tie order; never a negative amount or component, never a cent in an output that has no units; EU = 0 with a positive cost is rejected;
#   * transfer records: units and cost of each move bound to the organization, the order, both stages and the source calculation version;
#     partial moves and moves in a later period draw from completed-output layers, oldest first; a layer is never drawn twice;
#   * calculation versions with an input fingerprint that holds the source calculation versions; a recalculated source makes its dependants
#     stale, and a stale calculation cannot be approved or posted;
#   * compute_204() is exactly Migration 204 §4 (labor_hours, machine_hours, recorded_labor_cost); the run/setup extension is a separate,
#     proposed compute_205_proposed() and is never presented as a 204 input.
# legacy_v1_stage() is the revision-1 algorithm, kept only to reproduce the counterexamples it fails on.
import random
from fractions import Fraction as F
from math import floor

ZERO = F(0)


class StageCostError(Exception):
    pass


def cents(x):
    """'12.34' | int | Fraction(currency units) -> integer cents; refuses sub-cent inputs."""
    v = F(x) * 100
    if v.denominator != 1:
        raise ValueError(f"amount has sub-cent precision: {x}")
    return int(v)


def round_half_up(x):
    """Fraction (cents) -> int cents, half away from zero (inputs here are >= 0): PostgreSQL round()."""
    return floor(x + F(1, 2))


def largest_remainder(total, exact):
    """Split integer `total` into integers that follow the exact Fractions `exact` (which sum to `total`): floor each, then one more unit to
    the largest fractional parts, ties to the earlier position. Only positions with a positive fractional part can receive a unit, so a
    position whose exact value is 0 stays 0, and none is negative."""
    assert sum(exact, ZERO) == total and all(e >= 0 for e in exact), (total, exact)
    base = [floor(e) for e in exact]
    rest = total - sum(base)
    order = sorted(range(len(exact)), key=lambda i: (-(exact[i] - base[i]), i))
    for i in order[:rest]:
        assert exact[i] - base[i] > 0
        base[i] += 1
    return base


def matrix_round(row_totals, col_totals):
    """Integer matrix with the given row and column totals, rows in order: each row except the last follows the remaining column amounts
    (largest remainder); the last row takes what remains. All cells >= 0; a zero row is all zeros."""
    assert sum(row_totals) == sum(col_totals)
    rem = list(col_totals)
    out = []
    for i, r in enumerate(row_totals):
        if i == len(row_totals) - 1:
            row = list(rem)
        elif r == 0:
            row = [0] * len(rem)
        else:
            s = sum(rem)
            row = largest_remainder(r, [F(r * c, s) for c in rem])
        rem = [a - b for a, b in zip(rem, row)]
        assert all(c >= 0 for c in row) and all(c >= 0 for c in rem)
        out.append(row)
    return out


# ---------------------------------------------------------------- Migration 204 §4, exactly (current capability)
def compute_204(version, wc, labor_hours, machine_hours, recorded_labor_cost=None):
    """Inputs exactly as 204: labor_hours, machine_hours, recorded_labor_cost. A pool's driver is the hours of its basis; 204 has no
    per-pool driver and no activity filter. Returns cents."""
    rule = version.get("wc_rules", {}).get(wc, {})
    if version["labor_cost_source"] == "work_center_rate":
        if labor_hours is None:
            raise StageCostError("COST_POLICY_DRIVER_MISSING: labor_hours")
        labor = round_half_up(F(labor_hours) * cents(rule.get("labor_rate", version["default_labor_rate"])))
    else:
        if recorded_labor_cost is None:
            raise StageCostError("COST_POLICY_DRIVER_MISSING: recorded_labor_cost")
        labor = cents(recorded_labor_cost)
    pools = {}
    for p in version["pools"]:
        assert set(p) <= {"code", "basis", "rate"}, "a 204 pool has code, basis and rate only"
        pr = rule.get("pools", {}).get(p["code"], {})
        if pr.get("applies", True) is False:
            continue
        driver = {"labor_hours": labor_hours, "machine_hours": machine_hours}[p["basis"]]
        if driver is None:
            raise StageCostError(f"COST_POLICY_DRIVER_MISSING: {p['basis']}")
        pools[p["code"]] = round_half_up(F(driver) * cents(pr.get("rate", p["rate"])))
    return {"labor": labor, "pools": pools, "total": labor + sum(pools.values())}


# ---------------------------------------------------------------- proposed extension (205): run/setup basis and setup-only pools
def compute_205_proposed(version, wc, hours, recorded_labor_cost=None):
    """PROPOSED, not in 204. hours = {'labor': {'run', 'setup'}, 'machine': {'run', 'setup'}} (approved hours by activity).
    version adds labor_hours_basis / machine_hours_basis ∈ {run_only, run_plus_setup} and, per pool, activity ∈ {all, setup_only}.
    A version without the basis fields (created before 205) is refused: it is never read as run_only or run_plus_setup by default."""
    for f in ("labor_hours_basis", "machine_hours_basis"):
        if version.get(f) not in ("run_only", "run_plus_setup"):
            raise StageCostError("COST_POLICY_HOURS_BASIS_UNDEFINED")
    rule = version.get("wc_rules", {}).get(wc, {})

    def basis_hours(resource, basis):
        h = hours[resource]
        return F(h["run"]) + (F(h["setup"]) if basis == "run_plus_setup" else 0)
    lh = basis_hours("labor", version["labor_hours_basis"])
    mh = basis_hours("machine", version["machine_hours_basis"])
    if version["labor_cost_source"] == "work_center_rate":
        labor = round_half_up(lh * cents(rule.get("labor_rate", version["default_labor_rate"])))
    else:
        labor = cents(recorded_labor_cost)
    pools = {}
    for p in version["pools"]:
        pr = rule.get("pools", {}).get(p["code"], {})
        if pr.get("applies", True) is False:
            continue
        resource = {"labor_hours": "labor", "machine_hours": "machine"}[p["basis"]]
        if p.get("activity", "all") == "setup_only":
            if version[f"{resource}_hours_basis"] == "run_plus_setup":
                raise StageCostError("COST_POLICY_SETUP_DOUBLE_COUNT")
            driver = F(hours[resource]["setup"])
        else:
            driver = lh if resource == "labor" else mh
        pools[p["code"]] = round_half_up(driver * cents(pr.get("rate", p["rate"])))
    return {"labor": labor, "pools": pools, "total": labor + sum(pools.values()), "labor_hours": lh, "machine_hours": mh}


# ---------------------------------------------------------------- one stage, one period, weighted average (revision 2)
GROUP_ORDER = ("transferred_in", "material", "conversion")
OUTPUTS = ("to", "abnormal", "ewip")          # tie order for a remaining cent; ewip last


def component_order(names):
    return [c for c in ("transferred_in", "material", "labor") if c in names] + sorted(set(names) - {"transferred_in", "material", "labor"})


def stage_wa(s):
    """s: units {bwip, received, completed, ewip, spoiled}; normal_rate; inspection_pct;
          groups {group: {bwip: {component: amount}, added: {component: amount}, ewip_pct, spoil_pct}}  (amounts in currency units)"""
    u = {k: F(v) for k, v in s["units"].items()}
    if any(v < 0 for v in u.values()):
        raise StageCostError("STAGE_COST_UNITS_INVALID")
    if u["bwip"] + u["received"] != u["completed"] + u["ewip"] + u["spoiled"]:
        raise StageCostError("STAGE_COST_UNITS_UNBALANCED")
    insp = F(s["inspection_pct"])
    ewip_passed = u["ewip"] if u["ewip"] > 0 and F(s["groups"]["conversion"]["ewip_pct"]) >= insp else ZERO
    passing = u["completed"] + ewip_passed
    normal = min(u["spoiled"], F(s["normal_rate"]) * passing)
    abnormal = u["spoiled"] - normal
    out = {"units": {**u, "normal": normal, "abnormal": abnormal, "passing": passing, "ewip_passed": ewip_passed}, "groups": {}}
    for g in GROUP_ORDER:
        if g not in s["groups"]:
            continue
        spec = s["groups"][g]
        comps = component_order(set(spec.get("bwip", {})) | set(spec.get("added", {})))
        comp_c = [cents(spec.get("bwip", {}).get(c, 0)) + cents(spec.get("added", {}).get(c, 0)) for c in comps]
        C = sum(comp_c)
        e, sp = F(spec["ewip_pct"]) / 100, F(spec["spoil_pct"]) / 100
        eu = u["completed"] + u["spoiled"] * sp + u["ewip"] * e
        if eu == 0:
            if C > 0:
                raise StageCostError(f"STAGE_COST_EU_ZERO: {g}")
            exact = {"to": ZERO, "abnormal": ZERO, "ewip": ZERO}
            n_exact = ZERO
        else:
            unit = F(C) / eu
            n_exact = normal * sp * unit
            exact = {"to": u["completed"] * unit + (n_exact * u["completed"] / passing if passing else 0),
                     "abnormal": abnormal * sp * unit,
                     "ewip": u["ewip"] * e * unit + (n_exact * ewip_passed / passing if passing else 0)}
        assert sum(exact.values(), ZERO) == C
        totals = dict(zip(OUTPUTS, largest_remainder(C, [exact[o] for o in OUTPUTS])))
        cells = matrix_round([totals[o] for o in OUTPUTS], comp_c)
        split = {o: dict(zip(comps, row)) for o, row in zip(OUTPUTS, cells)}
        out["groups"][g] = {"components": comps, "total": C, "eu": eu, "unit": (F(C) / eu if eu else ZERO), "exact": exact,
                            "normal_display": round_half_up(n_exact), **totals, "split": split}
    for o in OUTPUTS:
        out[o] = sum(v[o] for v in out["groups"].values())
    out["accounted"] = sum(v["total"] for v in out["groups"].values())
    assert out["to"] + out["abnormal"] + out["ewip"] == out["accounted"]
    out["layer"] = {"units": u["completed"], "components": {c: a for g in out["groups"].values() for c, a in g["split"]["to"].items()}}
    return out


def ewip_components(st, group):
    return {c: F(a, 100) for c, a in st["groups"][group]["split"]["ewip"].items()}


# ---------------------------------------------------------------- transfer records (revision 2)
def transfer_from_layers(layers, moves):
    """layers: [{'calc': (stage, period, version), 'units', 'components': {c: cents}}] oldest first (completed output not yet moved).
       moves:  [{'id', 'units', 'to_stage', 'received_period'}] in movement order.
    Each move draws from the oldest layer with units left; a move spanning two layers gives two cost lines. For a line taking t of the
    n units left in a layer, each component = round_half_up(left_c × t / n); the line that empties a layer takes exactly what is left.
    Returns the cost lines and the layers left (held completed output, not WIP)."""
    left = [{"calc": l["calc"], "units": F(l["units"]), "components": dict(l["components"])} for l in layers]
    lines = []
    for mv in moves:
        need = F(mv["units"])
        for l in left:
            if need == 0:
                break
            if l["units"] == 0:
                continue
            t = min(need, l["units"])
            if t == l["units"]:
                comps = dict(l["components"])
            else:
                comps = {c: round_half_up(F(a) * t / l["units"]) for c, a in l["components"].items()}
            for c in comps:
                l["components"][c] -= comps[c]
                assert comps[c] >= 0 and l["components"][c] >= 0
            l["units"] -= t
            need -= t
            lines.append({"move": mv["id"], "source": l["calc"], "units": t, "to_stage": mv["to_stage"], "received_period": mv["received_period"],
                          "components": comps, "total": sum(comps.values())})
        if need > 0:
            raise StageCostError("STAGE_COST_TRANSFER_EXCEEDS_COMPLETED")
    return lines, left


def ti_from_lines(lines):
    """the transferred-in group of a receiving calculation: one component per source cost component, summed over its consumed lines"""
    tot = {}
    for ln in lines:
        for c, a in ln["components"].items():
            tot[c] = tot.get(c, 0) + a
    return {c: F(a, 100) for c, a in tot.items()}


# ---------------------------------------------------------------- calculation versions and staleness (revision 2)
class Ledger:
    """Calculation versions keyed by (stage, period). A version's fingerprint lists its sources: the previous period of the same stage
    (beginning WIP) and the transfer lines it consumed (their source calculation versions). A new version of a calculation makes every
    calculation whose fingerprint holds an earlier version of it stale, transitively. Stale calculations cannot be approved or posted;
    a calculation with a posted dependant cannot be recalculated."""

    def __init__(self):
        self.calcs = {}

    def record(self, key, sources, result):
        prev = self.calcs.get(key)
        if prev and prev["state"] == "posted":
            raise StageCostError("STAGE_COST_ALREADY_POSTED")
        ver = (prev["version"] + 1) if prev else 1
        if prev:
            for k, c in self.calcs.items():
                if (key, prev["version"]) in c["sources"] and c["state"] == "posted":
                    raise StageCostError("STAGE_COST_DOWNSTREAM_POSTED")
        self.calcs[key] = {"version": ver, "sources": set(sources), "state": "calculated", "result": result}
        if prev:
            self._stale((key, prev["version"]))
        return ver

    def _stale(self, src):
        for k, c in self.calcs.items():
            if src in c["sources"] and c["state"] != "stale":
                c["state"] = "stale"
                self._stale((k, c["version"]))

    def approve(self, key):
        c = self.calcs[key]
        if c["state"] == "stale":
            raise StageCostError("STAGE_COST_DEPENDENCY_STALE")
        c["state"] = "approved"


# ---------------------------------------------------------------- revision 1, kept only for the counterexamples
def legacy_v1_stage(s):
    """Revision 1 of stage_wa (#330 at d7f895b4), line for line, for the counterexamples only."""
    from decimal import ROUND_HALF_UP, Decimal, localcontext
    with localcontext() as ctx:
        ctx.prec = 34
        D = lambda x: Decimal(x.numerator) / Decimal(x.denominator) if isinstance(x, F) else Decimal(str(x))   # noqa: E731
        Z = Decimal(0)
        q2 = lambda x: Decimal(x).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)   # noqa: E731
        u = {k: D(v) for k, v in s["units"].items()}
        assert u["bwip"] + u["received"] == u["completed"] + u["ewip"] + u["spoiled"]
        insp = D(s["inspection_pct"])
        ewip_conv_pct = D(s["groups"]["conversion"]["ewip_pct"]) if "conversion" in s["groups"] else Z
        ewip_passed = u["ewip"] if ewip_conv_pct >= insp and u["ewip"] > 0 else Z
        passing_good = u["completed"] + ewip_passed
        allowed = (D(s["normal_rate"]) * passing_good).quantize(Decimal("0.000001"))
        normal = min(u["spoiled"], allowed)
        abnormal = u["spoiled"] - normal
        out = {"groups": {}}
        for g, spec in s["groups"].items():
            names = set(spec.get("bwip", {})) | set(spec.get("added", {}))
            comps = [c for c in ("transferred_in", "material", "labor") if c in names] + sorted(names - {"transferred_in", "material", "labor"})
            bw = {c: D(spec.get("bwip", {}).get(c, 0)) for c in comps}
            ad = {c: D(spec.get("added", {}).get(c, 0)) for c in comps}
            total = sum(bw.values(), Z) + sum(ad.values(), Z)
            e = D(spec["ewip_pct"]) / 100
            sp = D(spec["spoil_pct"]) / 100
            eu = u["completed"] + u["spoiled"] * sp + u["ewip"] * e
            cpu = total / eu if eu else Z
            to = q2(u["completed"] * cpu)
            nrm = q2(normal * sp * cpu)
            abn = q2(abnormal * sp * cpu)
            ew = total - to - nrm - abn
            nrm_to = q2(nrm * u["completed"] / passing_good) if passing_good else Z
            nrm_ew = nrm - nrm_to
            amounts = {"to": to + nrm_to, "ewip": ew + nrm_ew, "abnormal": abn}
            split = {}
            for key, amt in amounts.items():
                rem, part = amt, {}
                for i, c in enumerate(comps):
                    if i == len(comps) - 1:
                        part[c] = rem
                    else:
                        share = q2(amt * (bw[c] + ad[c]) / total) if total else Z
                        part[c] = share
                        rem -= share
                split[key] = part
            out["groups"][g] = {"total": total, **amounts, "split": split, "split_to": split["to"]}
        return out


COUNTEREXAMPLES = {
    # CX1: no WIP; one good and one abnormal unit both round up: revision 1 leaves -0.01 in WIP that has no units
    "CX1": {"units": {"bwip": 0, "received": 2, "completed": 1, "ewip": 0, "spoiled": 1}, "normal_rate": 0, "inspection_pct": 100,
            "groups": {"conversion": {"added": {"labor": "10.01"}, "ewip_pct": 0, "spoil_pct": 100}}},
    # CX2: the split of 0.01 over two equal components rounds both up: revision 1 gives -0.01 to the last (zero-cost) component
    "CX2": {"units": {"bwip": 0, "received": 2000, "completed": 1, "ewip": 1999, "spoiled": 0}, "normal_rate": 0, "inspection_pct": 100,
            "groups": {"conversion": {"added": {"labor": "5.00", "LABOR_OH": "5.00", "ZZ_IDLE": "0.00"}, "ewip_pct": 50, "spoil_pct": 100}}},
    # CX3: cost without equivalent units: revision 1 divides by nothing and leaves the cost in WIP
    "CX3": {"units": {"bwip": 0, "received": 0, "completed": 0, "ewip": 0, "spoiled": 0}, "normal_rate": 0, "inspection_pct": 100,
            "groups": {"material": {"added": {"material": "250.00"}, "ewip_pct": 100, "spoil_pct": 100}}},
}


def counterexamples():
    res = {}
    for k, s in COUNTEREXAMPLES.items():
        legacy = legacy_v1_stage(s)
        try:
            v2 = stage_wa(s)
            v2_out = {"to": v2["to"], "abnormal": v2["abnormal"], "ewip": v2["ewip"],
                      "split_to": next(iter(v2["groups"].values()))["split"]["to"]}
            v2_err = None
        except StageCostError as ex:
            v2_out, v2_err = None, str(ex)
        res[k] = {"legacy": legacy, "v2": v2_out, "v2_error": v2_err}
    from decimal import Decimal
    lg = res["CX1"]["legacy"]["groups"]["conversion"]
    assert lg["ewip"] < 0 and res["CX1"]["v2"]["ewip"] == 0
    assert min(res["CX2"]["legacy"]["groups"]["conversion"]["split_to"].values()) < 0 and min(res["CX2"]["v2"]["split_to"].values()) >= 0
    assert res["CX3"]["legacy"]["groups"]["material"]["ewip"] == Decimal("250.00") and res["CX3"]["v2_error"] == "STAGE_COST_EU_ZERO: material"
    return res


def property_checks(n=5000, seed=260):
    """Seeded random stages: revision 2 must keep every output and component >= 0, put no cent in an output without units, keep group and
    component totals, and stay within one cent of each exact output; revision 1 is counted on the same cases."""
    rng = random.Random(seed)
    stats = {"cases": 0, "v2_violations": 0, "legacy_negative": 0, "legacy_cent_without_units": 0, "eu_zero_rejected": 0}
    for _ in range(n):
        received = rng.randint(0, 50)
        bwip = rng.randint(0, 10)
        tot = received + bwip
        completed = rng.randint(0, tot)
        spoiled = rng.randint(0, tot - completed)
        ewip = tot - completed - spoiled
        ncomp = rng.randint(1, 4)
        names = ["labor", "LABOR_OH", "MACHINE_OH", "ZZ_OH"][:ncomp]
        added = {c: f"{rng.choice([0, rng.randint(0, 3), rng.randint(0, 100000)]) / 100:.2f}" for c in names}
        s = {"units": {"bwip": bwip, "received": received, "completed": completed, "ewip": ewip, "spoiled": spoiled},
             "normal_rate": F(rng.randint(0, 10), 100), "inspection_pct": rng.choice([0, 40, 100]),
             "groups": {"conversion": {"added": added, "ewip_pct": rng.randint(0, 100), "spoil_pct": rng.choice([0, 40, 100])}}}
        stats["cases"] += 1
        try:
            r = stage_wa(s)
        except StageCostError:
            stats["eu_zero_rejected"] += 1
            continue
        g = r["groups"]["conversion"]
        ok = all(g[o] >= 0 for o in OUTPUTS) and all(a >= 0 for o in OUTPUTS for a in g["split"][o].values())
        ok &= sum(g[o] for o in OUTPUTS) == g["total"]
        ok &= all(abs(g[o] - g["exact"][o]) < 1 for o in OUTPUTS)
        ok &= all(g[o] == 0 for o in OUTPUTS if g["exact"][o] == 0)
        ok &= all(sum(g["split"][o][c] for o in OUTPUTS) == cents(added.get(c, 0)) for c in g["components"])
        stats["v2_violations"] += 0 if ok else 1
        lg = legacy_v1_stage(s)["groups"]["conversion"]
        if lg["ewip"] < 0 or min(lg["split_to"].values()) < 0:
            stats["legacy_negative"] += 1
        if ewip == 0 and lg["ewip"] != 0:
            stats["legacy_cent_without_units"] += 1
    assert stats["v2_violations"] == 0, stats
    return stats


def transfer_property_checks(n=3000, seed=2601):
    rng = random.Random(seed)
    bad = 0
    for _ in range(n):
        layers = [{"calc": (1, p, 1), "units": rng.randint(1, 40), "components": {"material": rng.randint(0, 99999), "labor": rng.randint(0, 9999)}}
                  for p in range(rng.randint(1, 3))]
        total_units = sum(l["units"] for l in layers)
        moves, left_u, i = [], total_units, 0
        while left_u > 0 and rng.random() < 0.8:
            t = rng.randint(1, left_u)
            moves.append({"id": f"M{i}", "units": t, "to_stage": 2, "received_period": 1})
            left_u -= t
            i += 1
        lines, left = transfer_from_layers(layers, moves)
        for c in ("material", "labor"):
            if sum(ln["components"][c] for ln in lines) + sum(l["components"][c] for l in left) != sum(l["components"][c] for l in layers):
                bad += 1
        if any(a < 0 for ln in lines for a in ln["components"].values()) or any(a < 0 for l in left for a in l["components"].values()):
            bad += 1
        if any(l["units"] == 0 and any(l["components"].values()) for l in left):
            bad += 1
    assert bad == 0
    return {"cases": n, "violations": bad}


# ---------------------------------------------------------------- worked examples
POLICY_V1 = {   # the acceptance policy of Migration 204 §4 (version 1)
    "labor_cost_source": "work_center_rate", "default_labor_rate": "30",
    "pools": [{"code": "LABOR_OH", "basis": "labor_hours", "rate": "12"}, {"code": "MACHINE_OH", "basis": "machine_hours", "rate": "40"}],
    "wc_rules": {"WC-A": {"labor_rate": "35", "pools": {"MACHINE_OH": {"rate": "55"}}}, "WC-B": {"pools": {"LABOR_OH": {"applies": False}}}},
}


def conv(c204):
    return {"labor": F(c204["labor"], 100), **{k: F(v, 100) for k, v in c204["pools"].items()}}


def stage1_p1(extra_machine_oh="0"):
    return stage_wa({"units": {"bwip": 0, "received": 1000, "completed": 800, "ewip": 200, "spoiled": 0}, "normal_rate": 0, "inspection_pct": 100,
                     "groups": {"material": {"added": {"material": "10000"}, "ewip_pct": 100, "spoil_pct": 100},
                                "conversion": {"added": {"labor": "2000", "MACHINE_OH": F(3000) + F(extra_machine_oh)}, "ewip_pct": 50, "spoil_pct": 100}}})


def stage2(ti_components, units, material, c204, ewip_pct, bwip=None):
    g = {"transferred_in": {"added": ti_components, "ewip_pct": 100, "spoil_pct": 100},
         "material": {"added": {"material": material}, "ewip_pct": 0, "spoil_pct": 100},
         "conversion": {"added": conv(c204), "ewip_pct": ewip_pct, "spoil_pct": 100}}
    if bwip:
        for grp, comps in bwip.items():
            g[grp]["bwip"] = comps
    return stage_wa({"units": units, "normal_rate": 0, "inspection_pct": 100, "groups": g})


def stage1_p2(e1):
    c3 = compute_204(POLICY_V1, "WC-C", 25, 15)
    return c3, stage_wa({"units": {"bwip": 200, "received": 600, "completed": 700, "ewip": 100, "spoiled": 0}, "normal_rate": 0, "inspection_pct": 100,
                         "groups": {"material": {"bwip": ewip_components(e1, "material"), "added": {"material": "6300"}, "ewip_pct": 100, "spoil_pct": 100},
                                    "conversion": {"bwip": ewip_components(e1, "conversion"), "added": conv(c3), "ewip_pct": 30, "spoil_pct": 100}}})


def examples():
    ex = {}
    # E0: Migration 204 §4 acceptance table, reproduced (guards the transcription of compute_204)
    e0 = {wc: compute_204(POLICY_V1, wc, 10, 6) for wc in ("WC-A", "WC-B", "WC-C")}
    assert [e0[w]["total"] for w in ("WC-A", "WC-B", "WC-C")] == [80000, 54000, 66000]
    v2 = {**POLICY_V1, "labor_cost_source": "recorded_entry_rate",
          "pools": [{"code": "LABOR_OH", "basis": "labor_hours", "rate": "10"}, {"code": "MACHINE_OH", "basis": "machine_hours", "rate": "42"}]}
    e0v2 = compute_204(v2, "WC-C", 13, 6, "512.40")
    assert e0v2["total"] == 89440
    ex["E0"] = {"v1": e0, "v2": e0v2}

    # E1: issue #260 acceptance case = runbook 204 §5.3
    e1 = stage1_p1()
    assert e1["groups"]["conversion"]["eu"] == 900 and e1["to"] == 1244444 and e1["ewip"] == 255556
    ex["E1"] = e1

    # E2: stage 2 receives all 800 units through one transfer record bound to E1's calculation version
    lines2, left2 = transfer_from_layers([{"calc": (1, 1, 1), "units": 800, "components": e1["layer"]["components"]}],
                                         [{"id": "T-1", "units": 800, "to_stage": 2, "received_period": 1}])
    c2 = compute_204(POLICY_V1, "WC-A", 10, 6)
    e2 = stage2(ti_from_lines(lines2), {"bwip": 0, "received": 800, "completed": 700, "ewip": 100, "spoiled": 0}, "1400", c2, 40)
    added_all = cents(10000) + cents(2000) + cents(3000) + cents(1400) + c2["total"]
    assert e2["to"] + e1["ewip"] + e2["ewip"] == added_all
    ex["E2"] = {"policy": c2, "lines": lines2, "stage": e2, "added_all": added_all}

    # E3: stage 1, next period, beginning WIP = E1 ending WIP
    c3, e3 = stage1_p2(e1)
    ex["E3"] = {"policy": c3, "stage": e3}

    # E4: spoilage, inspection at the end (a) and at 40% (b)
    for key, insp in (("E4a", 100), ("E4b", 40)):
        ex[key] = stage_wa({"units": {"bwip": 0, "received": 1000, "completed": 900, "ewip": 40, "spoiled": 60}, "normal_rate": F(5, 100),
                            "inspection_pct": insp,
                            "groups": {"material": {"added": {"material": "9000"}, "ewip_pct": 100, "spoil_pct": 100},
                                       "conversion": {"added": {"labor": "1900", "LABOR_OH": "760", "MACHINE_OH": "1900"}, "ewip_pct": 50,
                                                      "spoil_pct": insp}}})

    # E5: run/setup. (a)/(b): compute_204 as it is, with the engine summing the hours a proposed dated field selects;
    #     (c): the proposed compute_205 with a setup-only pool. A version without the fields is refused by compute_205.
    hours = {"labor": {"run": 18, "setup": 2}, "machine": {"run": F(15), "setup": F(3, 2)}}
    e5 = {}
    for opt, lb, mb in (("a", "run_only", "run_only"), ("b", "run_plus_setup", "run_plus_setup")):
        lh = F(hours["labor"]["run"]) + (F(hours["labor"]["setup"]) if lb == "run_plus_setup" else 0)
        mh = F(hours["machine"]["run"]) + (F(hours["machine"]["setup"]) if mb == "run_plus_setup" else 0)
        e5[opt] = {"labor_hours": lh, "machine_hours": mh, "calc": compute_204(POLICY_V1, "WC-C", lh, mh), "via": "204"}
        prop = compute_205_proposed({**POLICY_V1, "labor_hours_basis": lb, "machine_hours_basis": mb}, "WC-C", hours)
        assert prop["total"] == e5[opt]["calc"]["total"]
    v205c = {**POLICY_V1, "labor_hours_basis": "run_plus_setup", "machine_hours_basis": "run_only",
             "pools": POLICY_V1["pools"] + [{"code": "SETUP_OH", "basis": "machine_hours", "rate": "60", "activity": "setup_only"}]}
    pc = compute_205_proposed(v205c, "WC-C", hours)
    e5["c"] = {"labor_hours": pc["labor_hours"], "machine_hours": pc["machine_hours"], "calc": pc, "via": "205 (proposed)",
               "setup_machine_hours": F(hours["machine"]["setup"])}
    refusals = {}
    for name, ver in (("legacy_version", POLICY_V1),
                      ("double_count", {**v205c, "machine_hours_basis": "run_plus_setup"})):
        try:
            compute_205_proposed(ver, "WC-C", hours)
            refusals[name] = None
        except StageCostError as exc:
            refusals[name] = str(exc)
    assert refusals == {"legacy_version": "COST_POLICY_HOURS_BASIS_UNDEFINED", "double_count": "COST_POLICY_SETUP_DOUBLE_COUNT"}
    ex["E5"] = {"hours": hours, "options": e5, "refusals": refusals}

    # E6: correction of stage 2 before posting (labor hours 10 -> 11)
    c6 = compute_204(POLICY_V1, "WC-A", 11, 6)
    e6 = stage2(ti_from_lines(lines2), {"bwip": 0, "received": 800, "completed": 700, "ewip": 100, "spoiled": 0}, "1400", c6, 40)
    ex["E6"] = {"policy": c6, "stage": e6, "delta_to": e6["to"] - e2["to"], "delta_ewip": e6["ewip"] - e2["ewip"],
                "delta_added": c6["total"] - c2["total"]}
    assert ex["E6"]["delta_to"] + ex["E6"]["delta_ewip"] == ex["E6"]["delta_added"]

    # E7: partial and cross-period transfer. E1's 800 completed units move as T-1 (500, received in period 1) and T-2 (300, period 2).
    lines7, left7 = transfer_from_layers([{"calc": (1, 1, 1), "units": 800, "components": e1["layer"]["components"]}],
                                         [{"id": "T-1", "units": 500, "to_stage": 2, "received_period": 1}])
    held_after_p1 = left7[0]
    lines7b, left7b = transfer_from_layers(left7, [{"id": "T-2", "units": 300, "to_stage": 2, "received_period": 2}])
    c7p1 = compute_204(POLICY_V1, "WC-A", 6, 4)
    s2p1 = stage2(ti_from_lines(lines7), {"bwip": 0, "received": 500, "completed": 450, "ewip": 50, "spoiled": 0}, "900", c7p1, 40)
    c7p2 = compute_204(POLICY_V1, "WC-A", 5, 3)
    s2p2 = stage2(ti_from_lines(lines7b), {"bwip": 50, "received": 300, "completed": 330, "ewip": 20, "spoiled": 0}, "660", c7p2, 50,
                  bwip={g: ewip_components(s2p1, g) for g in ("transferred_in", "material", "conversion")})
    added_p1 = cents(15000) + cents(900) + c7p1["total"]
    assert s2p1["to"] + e1["ewip"] + sum(held_after_p1["components"].values()) + s2p1["ewip"] == added_p1
    added_p2 = added_p1 + cents(660) + c7p2["total"]
    assert s2p1["to"] + s2p2["to"] + e1["ewip"] + s2p2["ewip"] == added_p2 and left7b[0]["units"] == 0
    assert sum(l["total"] for l in lines7 + lines7b) == e1["to"]
    try:
        transfer_from_layers(left7b, [{"id": "T-3", "units": 1, "to_stage": 2, "received_period": 2}])
        over = None
    except StageCostError as exc:
        over = str(exc)
    assert over == "STAGE_COST_TRANSFER_EXCEEDS_COMPLETED"
    ex["E7"] = {"lines": lines7 + lines7b, "held_after_p1": held_after_p1, "s2p1": s2p1, "s2p2": s2p2, "c_p1": c7p1, "c_p2": c7p2,
                "added_p1": added_p1, "added_p2": added_p2, "overdraw": over}

    # E8: correction of stage 1 period 1 (an approved machine-overhead correction of +90.00) and its effect downstream
    led = Ledger()
    led.record((1, 1), [], e1)
    led.record((2, 1), [((1, 1), 1)], e2)
    led.record((1, 2), [((1, 1), 1)], e3)
    e1b = stage1_p1("90")
    led.record((1, 1), [], e1b)
    states_after_correction = {k: (v["version"], v["state"]) for k, v in led.calcs.items()}
    try:
        led.approve((2, 1))
        stale_refusal = None
    except StageCostError as exc:
        stale_refusal = str(exc)
    lines8, _ = transfer_from_layers([{"calc": (1, 1, 2), "units": 800, "components": e1b["layer"]["components"]}],
                                     [{"id": "T-1", "units": 800, "to_stage": 2, "received_period": 1}])
    e2b = stage2(ti_from_lines(lines8), {"bwip": 0, "received": 800, "completed": 700, "ewip": 100, "spoiled": 0}, "1400", c2, 40)
    led.record((2, 1), [((1, 1), 2)], e2b)
    _, e3b = stage1_p2(e1b)
    led.record((1, 2), [((1, 1), 2)], e3b)
    led.approve((2, 1))
    led.approve((1, 2))
    d = {"s1_to": e1b["to"] - e1["to"], "s1_ewip": e1b["ewip"] - e1["ewip"], "s2_to": e2b["to"] - e2["to"], "s2_ewip": e2b["ewip"] - e2["ewip"],
         "p2_to": e3b["to"] - e3["to"], "p2_ewip": e3b["ewip"] - e3["ewip"]}
    assert d["s1_to"] + d["s1_ewip"] == 9000
    assert d["s2_to"] + d["s2_ewip"] == d["s1_to"]
    assert d["p2_to"] + d["p2_ewip"] == d["s1_ewip"]
    ex["E8"] = {"before": {"s1": e1, "s2": e2, "p2": e3}, "after": {"s1": e1b, "s2": e2b, "p2": e3b}, "delta": d,
                "states_after_correction": states_after_correction, "stale_refusal": stale_refusal,
                "final_states": {k: (v["version"], v["state"]) for k, v in led.calcs.items()}}
    assert stale_refusal == "STAGE_COST_DEPENDENCY_STALE"
    return ex


if __name__ == "__main__":
    ex = examples()
    cx = counterexamples()
    pc = property_checks()
    tc = transfer_property_checks()
    print("REFERENCE_EXAMPLES_OK", ", ".join(sorted(ex)), "| COUNTEREXAMPLES_OK", ", ".join(sorted(cx)),
          "| PROPERTY", pc, "| TRANSFERS", tc)
