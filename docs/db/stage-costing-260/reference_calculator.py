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
# Revision 4 (owner approved group A, 2026-10-28; additive, closes gap G1 of the design annex): compute_205() and validate_205_version()
#   implement the approved overhead design for Migration 205 (activity and budgets on each pool, direct labor on all approved direct hours,
#   one budget in one pool, setup budgets loaded exactly once or by a scoped acknowledgement, legacy 204 versions resolved by a separate
#   record that never edits the version). Every revision-3 function is unchanged; compute_205_proposed() stays as the superseded design.
#   Revision 4b (Codex review of e66b1136): duplicate pool codes, non-positive rates, negative or non-numeric hours and amounts are refused;
#   only the hours the computation uses are required; an account alone and the same account with a cost center cannot both be budgets.
#   Revision 4c (owner decisions 205-Q3 and 205-Q4, 2026-10-29): a budget needs a GL account (the cost center stays optional; none = the
#   account-wide scope); a selected budget that no pool loads is refused unless the company policy allows a controlled exception, recorded with
#   the version (budgets, reason, treatment, approver), shown with its amounts and never absorbed. The exception relaxes nothing else.
#   Revision 4d (Codex review of the Migration 205 implementation, 2026-10-29): a 205 rate has the precision 204 stores and accepts
#   (numeric(18,6): positive, at most six decimal places as PostgreSQL scale() counts them, at most 999999999) and is used exactly; an
#   amount is the exact product rounded half up to the cent, as 204's round(hours * rate, 2). r4c turned the rate into cents first and so
#   failed (ValueError) on a rate 204 accepts, such as 1.123456. A recorded labor cost with a fraction of a cent is refused with
#   COST_POLICY_RECORDED_COST_INVALID (r4c raised ValueError), as the SQL does: no input ends in an error that is not a policy code.
#   Revision 4e (CI of the Migration 205 pull request, 2026-10-31): validate_205_version and compute_205 are the statements of r4d in the same
#   order, grouped into private helpers for readability; no behaviour changes (the parity cases recorded on r4d and r4e are byte-identical).
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


# ---------------------------------------------------------------- 205 (revision 4): approved overhead design, group A
ACTIVITIES = {"run": ("run",), "setup": ("setup",), "both": ("run", "setup")}
POOL_205_KEYS = {"code", "basis", "rate", "activity", "budgets"}
UNALLOCATED_POLICIES = ("block", "controlled_exception")
UNALLOCATED_EXCEPTION_KEYS = {"policy", "budgets", "reason", "treatment", "approved_by"}


def number_205(x, code, positive):
    """an input amount as an exact Fraction; not a number, negative, or (positive=True) zero is refused with the given code"""
    try:
        n = F(str(x))
    except (TypeError, ValueError, ZeroDivisionError):
        raise StageCostError(f"{code}: {x!r}") from None
    if n < 0 or (positive and n == 0):
        raise StageCostError(f"{code}: {x!r}")
    return n


RATE_MAX_205 = 999999999


def rate_205(x):
    """a rate as 204 stores and accepts it (numeric(18,6), C_MAX_RATE of 204), as an exact Fraction: positive, at most six decimal places
    (trailing zeros count, as PostgreSQL scale() counts them), at most RATE_MAX_205; anything else is COST_POLICY_RATE_INVALID"""
    from decimal import Decimal, InvalidOperation
    n = number_205(x, "COST_POLICY_RATE_INVALID", True)
    try:
        exponent = Decimal(str(x)).as_tuple().exponent
    except InvalidOperation:
        raise StageCostError(f"COST_POLICY_RATE_INVALID: {x!r}") from None
    if not isinstance(exponent, int) or exponent < -6 or n > RATE_MAX_205:
        raise StageCostError(f"COST_POLICY_RATE_INVALID: {x!r}")
    return n


def _check_rates_205(v):
    """every rate of the version: the labor default when labor is priced at a rate, each pool, each work-center override"""
    if v["labor_cost_source"] == "work_center_rate":
        rate_205(v["default_labor_rate"])
    for p in v["pools"]:
        rate_205(p["rate"])
    for rule in v.get("wc_rules", {}).values():
        if "labor_rate" in rule:
            rate_205(rule["labor_rate"])
        for pr in rule.get("pools", {}).values():
            if "rate" in pr:
                rate_205(pr["rate"])


def _check_budget_sources_205(budgets):
    """a budget needs an account; one code per (account, center); an account alone and the same account with a center cannot both be budgets"""
    sources = {}
    for code, b in budgets.items():
        if not b.get("gl_account"):
            raise StageCostError(f"COST_POLICY_BUDGET_ACCOUNT_REQUIRED: {code}")
        key = (b["gl_account"], b.get("cost_center"))
        if key in sources:
            raise StageCostError("COST_POLICY_BUDGET_DUPLICATE_SOURCE")
        sources[key] = code
    for gl, cc in sources:
        if cc is None and any(g == gl and c is not None for g, c in sources):
            raise StageCostError("COST_POLICY_BUDGET_SOURCE_OVERLAP")


def _budget_owners_205(pools, budgets):
    """{budget code: the pool that loads it}, with each pool's own rules: an activity, at least one budget, known budgets, one budget in one pool"""
    owner = {}
    for p in pools:
        if not set(p) <= POOL_205_KEYS or p.get("activity") not in ACTIVITIES:
            raise StageCostError("COST_POLICY_POOL_ACTIVITY_UNSET")
        if not p.get("budgets"):
            raise StageCostError("COST_POLICY_POOL_WITHOUT_BUDGET")
        for b in p["budgets"]:
            if b not in budgets:
                raise StageCostError("COST_POLICY_BUDGET_UNKNOWN")
            if b in owner:
                raise StageCostError("COST_POLICY_BUDGET_DOUBLE_ALLOCATION")
            owner[b] = p
    return owner


def _check_setup_acks_205(pools, budgets, acks):
    """a scoped acknowledgement names a setup budget of a run pool"""
    for pool_code, ack_codes in acks.items():
        pool = next((p for p in pools if p["code"] == pool_code), None)
        for b in ack_codes:
            if pool is None or pool["activity"] != "run" or b not in pool["budgets"] or not budgets[b]["setup"]:
                raise StageCostError("COST_POLICY_SETUP_ACK_INVALID")


def _check_budget_treatment_205(budgets, owner, acks, exc):
    """every budget is loaded or excepted; a setup budget in a run pool needs its acknowledgement"""
    excepted = set(exc.get("budgets") or []) if isinstance(exc, dict) else set()
    for code, b in budgets.items():
        if code not in owner:
            if code in excepted:
                continue
            raise StageCostError("COST_POLICY_SETUP_TREATMENT_UNSET" if b["setup"] else "COST_POLICY_BUDGET_UNALLOCATED")
        if b["setup"] and owner[code]["activity"] == "run" and code not in acks.get(owner[code]["code"], []):
            raise StageCostError("COST_POLICY_SETUP_TREATMENT_UNSET")


def validate_205_version(v):
    """Version-level rules of 205, checked when a draft is approved and again by compute_205. v as compute_204's version, plus:
    pools[i]['activity'] in run|setup|both and pools[i]['budgets'] (budget codes); v['budgets'] = {code: {'gl_account', 'cost_center' (or None),
    'setup'}}, the budgets this version selects for loading (not every budget of the ledger); v['setup_acks'] = {pool code: [setup budget codes
    that pool's run rate covers]}; v['unallocated_exception'] (optional) = the controlled exception recorded at approval (205-Q4). Refusal codes
    are the ones the design annex §3 and the 205 plan name."""
    budgets, acks = v["budgets"], v.get("setup_acks", {})
    codes = [p["code"] for p in v["pools"]]
    if len(codes) != len(set(codes)):
        raise StageCostError("COST_POLICY_POOL_CODE_DUPLICATE")
    _check_rates_205(v)
    _check_budget_sources_205(budgets)
    owner = _budget_owners_205(v["pools"], budgets)
    _check_setup_acks_205(v["pools"], budgets, acks)
    exc = v.get("unallocated_exception")
    _check_budget_treatment_205(budgets, owner, acks, exc)
    if exc is not None:
        check_unallocated_exception_205(exc, budgets, owner)


def check_unallocated_exception_205(exc, budgets, owner):
    """The controlled exception of 205-Q4, as recorded with the approved version: it names exactly the selected budgets no pool loads, each with
    its amount, and records a reason, a treatment and the approver. It never covers a loaded budget and relaxes no other rule."""
    bad = "COST_POLICY_UNALLOCATED_EXCEPTION_INVALID"
    if not isinstance(exc, dict) or set(exc) != UNALLOCATED_EXCEPTION_KEYS:
        raise StageCostError(f"{bad}: fields")
    if exc["policy"] != "controlled_exception":
        raise StageCostError(f"{bad}: policy")
    listed = list(exc["budgets"] or [])
    if not listed or len(listed) != len(set(listed)) or set(listed) != {c for c in budgets if c not in owner}:
        raise StageCostError(f"{bad}: budgets")
    for k in ("reason", "treatment", "approved_by"):
        if not isinstance(exc[k], str) or not exc[k].strip():
            raise StageCostError(f"{bad}: {k}")
    for c in listed:
        if budgets[c].get("amount") is None or (number_205(budgets[c]["amount"], f"{bad}: amount {c}", False) * 100).denominator != 1:
            raise StageCostError(f"{bad}: amount {c}")


def unallocated_205(v):
    """{budget code: amount in cents} of the selected budgets no pool loads: shown at approval and in the preview, never absorbed."""
    owned = {b for p in v["pools"] for b in p["budgets"]}
    return {c: cents(b["amount"]) for c, b in v["budgets"].items() if c not in owned}


def approve_205_check(v, company_policy="block"):
    """Approval-time rule of 205-Q4: company_policy is the company's setting when the version is approved ('block' by default). A version that
    carries an exception is refused under 'block'; then every version rule applies. Returns what the approval screen shows: the unloaded
    budgets and their amounts. A later change of the company policy does not reopen an approved version (compute_205 does not read it)."""
    if company_policy not in UNALLOCATED_POLICIES:
        raise StageCostError(f"COST_POLICY_UNALLOCATED_POLICY_INVALID: {company_policy!r}")
    if v.get("unallocated_exception") is not None and company_policy != "controlled_exception":
        raise StageCostError("COST_POLICY_UNALLOCATED_EXCEPTION_NOT_ALLOWED")
    validate_205_version(v)
    return {"unallocated": unallocated_205(v), "exception": v.get("unallocated_exception") is not None}


def is_205_version(v):
    return "budgets" in v and all("activity" in p for p in v["pools"])


def _version_with_resolution_205(version, legacy_resolution):
    """a 205 version as it is; a version created under 204 with its legacy resolution merged into a copy (the version itself never changes)"""
    if is_205_version(version):
        if legacy_resolution is not None:
            raise StageCostError("COST_POLICY_LEGACY_NOT_APPLICABLE")
        return version
    if legacy_resolution is None:
        raise StageCostError("COST_POLICY_LEGACY_UNRESOLVED")
    res = legacy_resolution
    codes = [p["code"] for p in version["pools"]]
    if len(codes) != len(set(codes)):
        raise StageCostError("COST_POLICY_POOL_CODE_DUPLICATE")
    if set(codes) != set(res["pools"]):
        raise StageCostError("COST_POLICY_LEGACY_POOLS_MISMATCH")
    v = {**version, "pools": [{**p, "activity": res["pools"][p["code"]]["activity"], "budgets": list(res["pools"][p["code"]]["budgets"])}
                              for p in version["pools"]],
         "budgets": res["budgets"], "setup_acks": res.get("setup_acks", {})}
    if "unallocated_exception" in res:
        v["unallocated_exception"] = res["unallocated_exception"]
    return v


def _measured_hours_205(v, applying, hours):
    """{(resource, activity): exact hours} for the hours the computation uses, and only those"""
    needed = set()
    if v["labor_cost_source"] == "work_center_rate":
        needed |= {("labor", "run"), ("labor", "setup")}
    for p in applying:
        resource = {"labor_hours": "labor", "machine_hours": "machine"}[p["basis"]]
        needed |= {(resource, a) for a in ACTIVITIES[p["activity"]]}
    h = {}
    for r, a in sorted(needed):
        x = hours.get(r, {}).get(a)
        if x is None:
            raise StageCostError(f"COST_POLICY_DRIVER_MISSING: {r}.{a}")
        h[(r, a)] = number_205(x, f"COST_POLICY_HOURS_INVALID: {r}.{a}", False)
    return h


def _labor_cents_205(v, rule, h, recorded_labor_cost):
    """direct labor in cents: all approved direct hours at the rate, or the recorded amount"""
    if v["labor_cost_source"] == "work_center_rate":
        return round_half_up((h[("labor", "run")] + h[("labor", "setup")]) * rate_205(rule.get("labor_rate", v["default_labor_rate"])) * 100)
    if recorded_labor_cost is None:
        raise StageCostError("COST_POLICY_DRIVER_MISSING: recorded_labor_cost")
    rec = number_205(recorded_labor_cost, "COST_POLICY_RECORDED_COST_INVALID", False)
    if (rec * 100).denominator != 1:
        raise StageCostError(f"COST_POLICY_RECORDED_COST_INVALID: {recorded_labor_cost!r}")
    return int(rec * 100)


def compute_205(version, wc, hours, recorded_labor_cost=None, legacy_resolution=None):
    """205 absorption for one (order, stage, work center, period). hours = {'labor': {'run', 'setup'}, 'machine': {'run', 'setup'}}: approved
    hours by activity. Only the hours the computation uses are required: labor run and setup when labor is priced at a rate, and, for every pool
    that applies at this work center, the hours of its basis for the activities it covers. A required hour that is None is not measured and
    raises; 0 is a measured zero; a negative or non-numeric hour is refused (a correction goes through its audited path, never a negative
    hour). Direct labor = all approved direct hours (run + setup) at the policy rate, or the recorded amount, whatever the pools. Work-center
    rules (rate, applies) are read exactly as compute_204 reads them. A version created under 204 (no activity, no budgets) is refused unless a
    legacy resolution supplies those fields; the resolution is a separate record and the version itself is never changed. Returns cents."""
    v = _version_with_resolution_205(version, legacy_resolution)
    validate_205_version(v)
    rule = v.get("wc_rules", {}).get(wc, {})
    applying = [p for p in v["pools"] if rule.get("pools", {}).get(p["code"], {}).get("applies", True) is not False]
    h = _measured_hours_205(v, applying, hours)
    labor = _labor_cents_205(v, rule, h, recorded_labor_cost)
    pools = {}
    for p in applying:
        pr = rule.get("pools", {}).get(p["code"], {})
        resource = {"labor_hours": "labor", "machine_hours": "machine"}[p["basis"]]
        driver = sum((h[(resource, a)] for a in ACTIVITIES[p["activity"]]), ZERO)
        pools[p["code"]] = round_half_up(driver * rate_205(pr.get("rate", p["rate"])) * 100)
    return {"labor": labor, "pools": pools, "total": labor + sum(pools.values())}


# ---------------------------------------------------------------- one stage, one period, weighted average (revision 2)
GROUP_ORDER = ("transferred_in", "material", "conversion")
OUTPUTS = ("to", "abnormal", "ewip")          # tie order for a remaining cent; ewip last


def _comp_rank(c):
    return (0 if c in ("transferred_in", "material", "labor") else 1, ("transferred_in", "material", "labor").index(c)
            if c in ("transferred_in", "material", "labor") else 0, c)


def origin_rank(key):
    """a layer key (origin stage, category, component): by stage, then category order, then component order"""
    stage, category, comp = key
    return (stage, GROUP_ORDER.index(category), _comp_rank(comp))


def component_order(names):
    if any(isinstance(n, tuple) for n in names):
        return sorted(names, key=origin_rank)          # transferred-in components: the source layer keys
    return [c for c in ("transferred_in", "material", "labor") if c in names] + sorted(set(names) - {"transferred_in", "material", "labor"})


def stage_wa(s):
    """s: stage (default 1); units {bwip, received, completed, ewip, spoiled}; normal_rate; inspection_pct;
          groups {group: {bwip: {component: amount}, added: {component: amount}, ewip_pct, spoil_pct}}  (amounts in currency units)
    Revision 3: the completed-output layer keeps the origin of every amount: (origin stage, category, component). Components of this
    stage's own groups get (this stage, group, component); transferred-in components keep the key they had in the source layer. Equal
    component names in different groups or stages are never merged or overwritten, and Σ layer components = completed amount."""
    stage = int(s.get("stage", 1))
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
    layer = {}
    for g, v in out["groups"].items():
        for c, a in v["split"]["to"].items():
            key = c if g == "transferred_in" else (stage, g, c)
            assert isinstance(key, tuple) and len(key) == 3, f"transferred-in component without its source key: {c!r}"
            assert key not in layer, f"layer key collision: {key}"
            layer[key] = a
    assert sum(layer.values()) == out["to"], "Σ layer components must equal the completed amount"
    out["stage"] = stage
    out["layer"] = {"stage": stage, "units": u["completed"], "components": layer}
    return out


def key_label(key):
    """(1, 'conversion', 'labor') -> 'S1/conversion/labor'"""
    return f"S{key[0]}/{key[1]}/{key[2]}"


def ewip_components(st, group):
    return {c: F(a, 100) for c, a in st["groups"][group]["split"]["ewip"].items()}


# ---------------------------------------------------------------- transfer records (revision 2)
def transfer_from_layers(layers, moves):
    """layers: [{'calc': (stage, period, version), 'units', 'components': {c: cents}}] oldest first (completed output not yet moved).
       moves:  [{'id', 'units', 'to_stage', 'received_period'}] in movement order.
    Each move draws from the oldest layer with units left; a move spanning two layers gives two cost lines. For a line taking t of the
    n units left in a layer, each component = round_half_up(left_c × t / n); the line that empties a layer takes exactly what is left.
    Returns the cost lines and the layers left (held completed output, not WIP)."""
    left = [{"calc": lyr["calc"], "units": F(lyr["units"]), "components": dict(lyr["components"])} for lyr in layers]
    lines = []
    for mv in moves:
        need = F(mv["units"])
        for lyr in left:
            if need == 0:
                break
            if lyr["units"] == 0:
                continue
            t = min(need, lyr["units"])
            if t == lyr["units"]:
                comps = dict(lyr["components"])
            else:
                comps = {c: round_half_up(F(a) * t / lyr["units"]) for c, a in lyr["components"].items()}
            for c in comps:
                lyr["components"][c] -= comps[c]
                assert comps[c] >= 0 and lyr["components"][c] >= 0
            lyr["units"] -= t
            need -= t
            lines.append({"move": mv["id"], "source": lyr["calc"], "units": t, "to_stage": mv["to_stage"], "received_period": mv["received_period"],
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
    """Calculation versions keyed by (stage, period); revision 3. self.calcs[key] is the current version {version, sources, state, result};
    self.history[key] keeps every version. A version's sources are (key, version) pairs: the previous period of the same stage (beginning
    WIP) and the source calculation of every transfer line it consumed. States: calculated -> approved -> posted; stale; superseded.

    record(key, sources): every source must exist, be the current version of its key, and be approved or posted (never calculated, stale or
      superseded). Recalculating an existing key: refused if the key is posted, or if any dependant of its current version, direct or
      indirect, is posted; all checks run before any state changes. Then the old version is superseded and every dependant, transitively,
      becomes stale.
    approve(key): the current version must be calculated (not stale), and every source current and approved or posted.
    post(key): the current version must be approved, and every source current and posted."""

    def __init__(self):
        self.calcs = {}
        self.history = {}

    def _check_sources(self, sources, need_posted=False):
        for skey, sver in sources:
            cur = self.calcs.get(skey)
            if cur is None:
                raise StageCostError("STAGE_COST_SOURCE_MISSING")
            if sver != cur["version"]:
                raise StageCostError("STAGE_COST_SOURCE_SUPERSEDED")
            if cur["state"] == "stale":
                raise StageCostError("STAGE_COST_DEPENDENCY_STALE")
            if need_posted and cur["state"] != "posted":
                raise StageCostError("STAGE_COST_SOURCE_NOT_POSTED")
            if cur["state"] not in ("approved", "posted"):
                raise StageCostError("STAGE_COST_SOURCE_NOT_APPROVED")

    def dependants(self, key, version):
        """current calculations that depend on (key, version), directly or indirectly"""
        found, frontier = set(), {(key, version)}
        while frontier:
            nxt = set()
            for k, c in self.calcs.items():
                if k not in found and c["sources"] & frontier:
                    found.add(k)
                    nxt.add((k, c["version"]))
            frontier = nxt
        return found

    def record(self, key, sources, result=None):
        sources = set(sources)
        self._check_sources(sources)
        prev = self.calcs.get(key)
        if prev:
            if prev["state"] == "posted":
                raise StageCostError("STAGE_COST_ALREADY_POSTED")
            deps = self.dependants(key, prev["version"])
            if any(self.calcs[d]["state"] == "posted" for d in deps):
                raise StageCostError("STAGE_COST_DOWNSTREAM_POSTED")
        ver = (prev["version"] + 1) if prev else 1
        if prev:
            prev["state"] = "superseded"
            for d in deps:
                self.calcs[d]["state"] = "stale"
        cur = {"version": ver, "sources": sources, "state": "calculated", "result": result}
        self.calcs[key] = cur
        self.history.setdefault(key, []).append(cur)
        return ver

    def approve(self, key):
        c = self.calcs[key]
        if c["state"] == "stale":
            raise StageCostError("STAGE_COST_DEPENDENCY_STALE")
        if c["state"] != "calculated":
            raise StageCostError(f"STAGE_COST_STATE_INVALID: {c['state']}")
        self._check_sources(c["sources"])
        c["state"] = "approved"

    def post(self, key):
        c = self.calcs[key]
        if c["state"] != "approved":
            raise StageCostError("STAGE_COST_DEPENDENCY_STALE" if c["state"] == "stale" else "STAGE_COST_NOT_APPROVED")
        self._check_sources(c["sources"], need_posted=True)
        c["state"] = "posted"

    def snapshot(self):
        return {k: (c["version"], c["state"]) for k, c in self.calcs.items()}


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
    rng = random.Random(seed)  # nosec B311: seeded test data for the property checks, not security
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
    rng = random.Random(seed)  # nosec B311: seeded test data for the property checks, not security
    bad = 0
    for _ in range(n):
        layers = [{"calc": (1, p, 1), "units": rng.randint(1, 40), "components": {"material": rng.randint(0, 99999), "labor": rng.randint(0, 9999)}}
                  for p in range(rng.randint(1, 3))]
        total_units = sum(lyr["units"] for lyr in layers)
        moves, left_u, i = [], total_units, 0
        while left_u > 0 and rng.random() < 0.8:
            t = rng.randint(1, left_u)
            moves.append({"id": f"M{i}", "units": t, "to_stage": 2, "received_period": 1})
            left_u -= t
            i += 1
        lines, left = transfer_from_layers(layers, moves)
        for c in ("material", "labor"):
            if sum(ln["components"][c] for ln in lines) + sum(lyr["components"][c] for lyr in left) != sum(lyr["components"][c] for lyr in layers):
                bad += 1
        if any(a < 0 for ln in lines for a in ln["components"].values()) or any(a < 0 for lyr in left for a in lyr["components"].values()):
            bad += 1
        if any(lyr["units"] == 0 and any(lyr["components"].values()) for lyr in left):
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
    return stage_wa({"stage": 2, "units": units, "normal_rate": 0, "inspection_pct": 100, "groups": g})


def stage3(ti_components, units, c204, ewip_pct):
    return stage_wa({"stage": 3, "units": units, "normal_rate": 0, "inspection_pct": 100,
                     "groups": {"transferred_in": {"added": ti_components, "ewip_pct": 100, "spoil_pct": 100},
                                "conversion": {"added": conv(c204), "ewip_pct": ewip_pct, "spoil_pct": 100}}})


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
    assert sum(lyr["total"] for lyr in lines7 + lines7b) == e1["to"]
    try:
        transfer_from_layers(left7b, [{"id": "T-3", "units": 1, "to_stage": 2, "received_period": 2}])
        over = None
    except StageCostError as exc:
        over = str(exc)
    assert over == "STAGE_COST_TRANSFER_EXCEEDS_COMPLETED"
    ex["E7"] = {"lines": lines7 + lines7b, "held_after_p1": held_after_p1, "s2p1": s2p1, "s2p2": s2p2, "c_p1": c7p1, "c_p2": c7p2,
                "added_p1": added_p1, "added_p2": added_p2, "overdraw": over}

    # E8: correction of stage 1 period 1 (an approved machine-overhead correction of +90.00) and its effect downstream.
    #     Every step goes through the ledger rules; the log keeps each action with its result and the states after it.
    led = Ledger()
    steps = []

    def act(label, fn):
        try:
            fn()
            res = "OK"
        except StageCostError as exc:
            res = str(exc)
        steps.append({"action": label, "result": res, "states": led.snapshot()})
        return res
    act("record S1P1 v1", lambda: led.record((1, 1), [], e1))
    act("approve S1P1", lambda: led.approve((1, 1)))
    act("record S2P1 v1 (source S1P1 v1)", lambda: led.record((2, 1), [((1, 1), 1)], e2))
    act("approve S2P1", lambda: led.approve((2, 1)))
    act("record S1P2 v1 (source S1P1 v1)", lambda: led.record((1, 2), [((1, 1), 1)], e3))
    act("approve S1P2", lambda: led.approve((1, 2)))
    e1b = stage1_p1("90")
    act("record S1P1 v2 (+90.00)", lambda: led.record((1, 1), [], e1b))
    r_stale = act("approve S2P1 (stale)", lambda: led.approve((2, 1)))
    lines8, _ = transfer_from_layers([{"calc": (1, 1, 2), "units": 800, "components": e1b["layer"]["components"]}],
                                     [{"id": "T-1", "units": 800, "to_stage": 2, "received_period": 1}])
    e2b = stage2(ti_from_lines(lines8), {"bwip": 0, "received": 800, "completed": 700, "ewip": 100, "spoiled": 0}, "1400", c2, 40)
    r_not_approved = act("record S2P1 (source S1P1 v2, still calculated)", lambda: led.record((2, 1), [((1, 1), 2)], e2b))
    act("approve S1P1 v2", lambda: led.approve((1, 1)))
    r_superseded = act("record S2P1 (old source S1P1 v1)", lambda: led.record((2, 1), [((1, 1), 1)], e2))
    act("record S2P1 v2 (source S1P1 v2)", lambda: led.record((2, 1), [((1, 1), 2)], e2b))
    act("approve S2P1 v2", lambda: led.approve((2, 1)))
    _, e3b = stage1_p2(e1b)
    act("record S1P2 v2 (source S1P1 v2)", lambda: led.record((1, 2), [((1, 1), 2)], e3b))
    act("approve S1P2 v2", lambda: led.approve((1, 2)))
    assert (r_stale, r_not_approved, r_superseded) == ("STAGE_COST_DEPENDENCY_STALE", "STAGE_COST_SOURCE_NOT_APPROVED", "STAGE_COST_SOURCE_SUPERSEDED")
    assert led.snapshot() == {(1, 1): (2, "approved"), (2, 1): (2, "approved"), (1, 2): (2, "approved")}
    d = {"s1_to": e1b["to"] - e1["to"], "s1_ewip": e1b["ewip"] - e1["ewip"], "s2_to": e2b["to"] - e2["to"], "s2_ewip": e2b["ewip"] - e2["ewip"],
         "p2_to": e3b["to"] - e3["to"], "p2_ewip": e3b["ewip"] - e3["ewip"]}
    assert d["s1_to"] + d["s1_ewip"] == 9000
    assert d["s2_to"] + d["s2_ewip"] == d["s1_to"]
    assert d["p2_to"] + d["p2_ewip"] == d["s1_ewip"]
    ex["E8"] = {"before": {"s1": e1, "s2": e2, "p2": e3}, "after": {"s1": e1b, "s2": e2b, "p2": e3b}, "delta": d, "steps": steps}

    # E9: three stages. Stage 3 (WC-B: 8 labor h, 5 machine h; LABOR_OH excluded there) receives all 700 completed units of E2.
    lines9, left9 = transfer_from_layers([{"calc": (2, 1, 1), "units": 700, "components": e2["layer"]["components"]}],
                                         [{"id": "T-2>3", "units": 700, "to_stage": 3, "received_period": 1}])
    assert lines9[0]["total"] == e2["to"] == 1304565 and left9[0]["units"] == 0
    c9 = compute_204(POLICY_V1, "WC-B", 8, 5)
    s3 = stage3(ti_from_lines(lines9), {"bwip": 0, "received": 700, "completed": 650, "ewip": 50, "spoiled": 0}, c9, 60)
    added9 = added_all + c9["total"]
    assert s3["to"] + e1["ewip"] + e2["ewip"] + s3["ewip"] == added9
    by_origin = {}
    for key, a in s3["layer"]["components"].items():
        by_origin[key[0]] = by_origin.get(key[0], 0) + a
    assert sum(by_origin.values()) == s3["to"]
    ex["E9"] = {"e2_layer": e2["layer"], "lines": lines9, "policy": c9, "stage": s3, "added_all": added9, "by_origin": by_origin}

    # E10: partial moves from the composite stage-2 layer (E2): 400 units, then 300
    lines10, left10 = transfer_from_layers([{"calc": (2, 1, 1), "units": 700, "components": e2["layer"]["components"]}],
                                           [{"id": "T-a", "units": 400, "to_stage": 3, "received_period": 1},
                                            {"id": "T-b", "units": 300, "to_stage": 3, "received_period": 2}])
    for key, a in e2["layer"]["components"].items():
        assert sum(ln["components"][key] for ln in lines10) == a
    assert sum(ln["total"] for ln in lines10) == e2["to"] and left10[0]["units"] == 0 and not any(left10[0]["components"].values())
    ex["E10"] = {"lines": lines10}
    return ex


if __name__ == "__main__":
    ex = examples()
    cx = counterexamples()
    pc = property_checks()
    tc = transfer_property_checks()
    print("REFERENCE_EXAMPLES_OK", ", ".join(sorted(ex)), "| COUNTEREXAMPLES_OK", ", ".join(sorted(cx)),
          "| PROPERTY", pc, "| TRANSFERS", tc)
