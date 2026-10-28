# Renders docs/db/MANUFACTURING_SETTINGS_260_DESIGN.md from DESIGN.template.md, revision 2 of the annex. The examples are computed here and
# each carries design controls (assertions) for the new rules only; costs go through the accepted reference calculator r3, imported and never
# modified (its hash is checked). Offline; no engine, no database.
#   python -I -B -X utf8 build_design.py
import hashlib
import sys
from fractions import Fraction as F
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import reference_calculator as rc  # noqa: E402

OUT = HERE.parent / "MANUFACTURING_SETTINGS_260_DESIGN.md"
R3_SHA = "f8042b161723613cff121d45129fedd76ac003304e293dbac354ae4210ac6777"
R3_SNAPSHOT = HERE / "history" / "reference_calculator_r3_38a91bdf.py.txt"
CONTROLS = []


def control(cid, text, ok):
    CONTROLS.append((cid, text, bool(ok)))
    assert ok, f"design control failed: {cid} {text}"


def m(c):
    c = int(c)
    return f"{'-' if c < 0 else ''}{abs(c) // 100:,}.{abs(c) % 100:02d}"


def q(x, places=2):
    return f"{float(F(x)):,.{places}f}"


class DesignRefused(Exception):
    pass


# ---------------------------------------------------------------- DX0: overhead pools, double counting judged by cost source (budget)
HOURS = {"labor": {"run": F(18), "setup": F(2)}, "machine": {"run": F(15), "setup": F(3, 2)}}
ACTS = {"run": ("run",), "setup": ("setup",), "both": ("run", "setup")}


def overhead_design(pools, budgets, ack):
    """Design helper, not compute_205. pools: [(code, basis, activity, rate, [budget ids])]; budgets: {id: {'setup': bool}} (the cost sources the
    rates are built from); ack: {pool code: [setup budget ids its run rate covers]}.
    Rules: a budget is allocated by one pool at most, whatever the basis (else the same cost is loaded twice); every setup budget is allocated
    exactly once, by a pool whose hours include setup, or inside a run-hours pool that names it in an explicit, scoped acknowledgement; a setup
    budget allocated nowhere is unset (it would be dropped); an acknowledgement must name a setup budget of that same pool. Pools that share
    a basis and hours but carry different budgets are independent costs and are accepted. Direct labor = all approved direct hours (run + setup)
    at the labor rate, apart from every pool. Each pool line is the accepted compute_204 called with that pool alone."""
    seen = {}
    for code, _b, _a, _r, bids in pools:
        for bid in bids:
            if bid in seen:
                raise DesignRefused("COST_POLICY_BUDGET_DOUBLE_ALLOCATION")
            seen[bid] = code
    for pcode, bids in ack.items():
        pool = next(p for p in pools if p[0] == pcode)
        for bid in bids:
            if bid not in pool[4] or not budgets[bid]["setup"] or pool[2] != "run":
                raise DesignRefused("COST_POLICY_SETUP_ACK_INVALID")
    for bid, b in budgets.items():
        if not b["setup"]:
            continue
        if bid not in seen:
            raise DesignRefused("COST_POLICY_SETUP_TREATMENT_UNSET")
        pool = next(p for p in pools if p[0] == seen[bid])
        if pool[2] == "run" and bid not in ack.get(pool[0], []):
            raise DesignRefused("COST_POLICY_SETUP_TREATMENT_UNSET")
    labor = rc.compute_204({"labor_cost_source": "work_center_rate", "default_labor_rate": "30", "pools": []}, "WC-C",
                           HOURS["labor"]["run"] + HOURS["labor"]["setup"], 0)["labor"]
    lines = {}
    for code, basis, activity, rate, _bids in pools:
        resource = "labor" if basis == "labor_hours" else "machine"
        h = sum((HOURS[resource][a] for a in ACTS[activity]), F(0))
        one = {"labor_cost_source": "work_center_rate", "default_labor_rate": "30", "pools": [{"code": code, "basis": basis, "rate": rate}]}
        lines[code] = rc.compute_204(one, "WC-C", h if resource == "labor" else 0, h if resource == "machine" else 0)["pools"][code]
    return {"labor": labor, "pools": lines, "total": labor + sum(lines.values())}


def dx0():
    B = {"ELECTRICITY": {"setup": False}, "DEPRECIATION": {"setup": False}, "SUPERVISION": {"setup": False}, "SETUP_CREW": {"setup": True}}
    cases = [
        ("أ", "قبول: `POWER_OH` (كهرباء، 15) و`DEPR_OH` (إهلاك، 25) على ساعات الماكينة نفسها (تشغيل + إعداد)؛ `LABOR_OH` (إشراف) و`SETUP_OH` (فريق الإعداد) مستقلان",
         [("POWER_OH", "machine_hours", "both", "15", ["ELECTRICITY"]), ("DEPR_OH", "machine_hours", "both", "25", ["DEPRECIATION"]),
          ("LABOR_OH", "labor_hours", "both", "12", ["SUPERVISION"]), ("SETUP_OH", "machine_hours", "setup", "60", ["SETUP_CREW"])], B, {}),
        ("ب", "قبول: فريق الإعداد داخل معدل `MACHINE_OH` على التشغيل، بإقرار محدد بموازنة `SETUP_CREW` وحدها",
         [("MACHINE_OH", "machine_hours", "run", "46", ["ELECTRICITY", "DEPRECIATION", "SETUP_CREW"]),
          ("LABOR_OH", "labor_hours", "run", "12", ["SUPERVISION"])], B, {"MACHINE_OH": ["SETUP_CREW"]}),
        ("ج", "رفض: موازنة الإهلاك في مجمعين بأساسين مختلفين (ماكينة وعمالة)",
         [("DEPR_OH", "machine_hours", "both", "25", ["DEPRECIATION"]), ("LABOR_OH", "labor_hours", "both", "12", ["SUPERVISION", "DEPRECIATION"]),
          ("POWER_OH", "machine_hours", "both", "15", ["ELECTRICITY"]), ("SETUP_OH", "machine_hours", "setup", "60", ["SETUP_CREW"])], B, {}),
        ("د", "رفض: فريق الإعداد في `SETUP_OH` وفي إقرار `MACHINE_OH` معًا",
         [("MACHINE_OH", "machine_hours", "run", "46", ["ELECTRICITY", "DEPRECIATION", "SETUP_CREW"]),
          ("SETUP_OH", "machine_hours", "setup", "60", ["SETUP_CREW"]), ("LABOR_OH", "labor_hours", "run", "12", ["SUPERVISION"])],
         B, {"MACHINE_OH": ["SETUP_CREW"]}),
        ("هـ", "غير مضبوط: موازنة فريق الإعداد لا يحمّلها أي مجمع ولا إقرار",
         [("MACHINE_OH", "machine_hours", "run", "40", ["ELECTRICITY", "DEPRECIATION"]), ("LABOR_OH", "labor_hours", "run", "12", ["SUPERVISION"])],
         B, {}),
        ("و", "رفض: إقرار في `MACHINE_OH` يسمي موازنة فريق الإعداد وهي ليست من موازناته",
         [("MACHINE_OH", "machine_hours", "run", "40", ["ELECTRICITY", "DEPRECIATION"]), ("LABOR_OH", "labor_hours", "run", "12", ["SUPERVISION"]),
          ("SETUP_OH", "machine_hours", "setup", "60", ["SETUP_CREW"])], B, {"MACHINE_OH": ["SETUP_CREW"]}),
    ]
    out = []
    for key, desc, pools, budgets, ack in cases:
        try:
            out.append((key, desc, overhead_design(pools, budgets, ack), None))
        except DesignRefused as exc:
            out.append((key, desc, None, str(exc)))
    got = {c[0]: c[3] for c in out}
    control("O1", "مجمعان مستقلان (كهرباء وإهلاك) على ساعات الماكينة نفسها يُقبلان", got["أ"] is None)
    control("O2", "الإقرار المحدد بموازنة مسماة في مجمع التشغيل يُقبل", got["ب"] is None)
    control("O3", "الموازنة نفسها في مجمعين يُرفض حتى مع اختلاف الأساس", got["ج"] == "COST_POLICY_BUDGET_DOUBLE_ALLOCATION")
    control("O4", "تكلفة الإعداد في مجمع إعداد وفي إقرار مجمع آخر يُرفض", got["د"] == "COST_POLICY_BUDGET_DOUBLE_ALLOCATION")
    control("O5", "موازنة إعداد لا يحمّلها شيء = غير مضبوط", got["هـ"] == "COST_POLICY_SETUP_TREATMENT_UNSET")
    control("O6", "إقرار لا يسمي موازنة في المجمع نفسه يُرفض", got["و"] == "COST_POLICY_SETUP_ACK_INVALID")
    control("O7", "العمالة المباشرة على كل الساعات المباشرة في الحالات المقبولة", all(c[2]["labor"] == 60000 for c in out if c[2]))
    return out


# ---------------------------------------------------------------- DX1: dates kept apart (entered, executed, policy/BOM determination, posting)
def dx1():
    v1 = {"labor_cost_source": "work_center_rate", "default_labor_rate": "30", "pools": [{"code": "MACHINE_OH", "basis": "machine_hours", "rate": "40"}]}
    v2 = {"labor_cost_source": "work_center_rate", "default_labor_rate": "30", "pools": [{"code": "MACHINE_OH", "basis": "machine_hours", "rate": "45"}]}
    versions = [("2026-11-01", 1, v1), ("2026-12-01", 2, v2)]

    def in_force(day):
        cands = [v for v in versions if v[0] <= day]
        return cands[-1] if cands else None
    closed_on = {"2026-10": "2026-11-05", "2026-11": "2026-12-03"}     # period -> day it was closed; never reopened here

    def is_closed(period, at):
        return period in closed_on and closed_on[period] <= at

    def first_open(at, frm):
        y, mo = int(frm[:4]), int(frm[5:7])
        while is_closed(f"{y:04d}-{mo:02d}", at):
            y, mo = (y + 1, 1) if mo == 12 else (y, mo + 1)
        return f"{y:04d}-{mo:02d}"
    hours = 100
    cases = []
    for label, entered, ex_from, ex_to, path in (("مباشر", "2026-11-28", "2026-11-28", "2026-11-30", "direct"),
                                                  ("لاحق، قاعدة 204 الحالية", "2026-12-05", "2026-11-28", "2026-11-30", "current"),
                                                  ("لاحق، المسار التاريخي المقترح", "2026-12-05", "2026-11-28", "2026-11-30", "historical"),
                                                  ("لاحق، قبل أول إصدار", "2026-12-05", "2026-10-20", "2026-10-22", "historical")):
        determination = entered if path == "current" else ex_from
        v = in_force(determination)
        cost = rc.compute_204(v[2], "WC-X", 0, hours)["pools"]["MACHINE_OH"] if v else None
        cases.append({"label": label, "entered": entered, "executed": f"{ex_from} → {ex_to}", "exec_closed": is_closed(ex_from[:7], entered),
                      "determination": determination, "version": v[1] if v else None, "cost": cost,
                      "posting": first_open(entered, ex_from[:7]) if v else "—"})
    control("T1", "تاريخ التنفيذ في فترة مغلقة لا يمنع اختيار السياسة التاريخية", cases[2]["exec_closed"] and cases[2]["version"] == 1)
    control("T2", "الترحيل في أول فترة مفتوحة عند الإدخال دون إعادة فتح الفترة القديمة",
            cases[2]["posting"] == "2026-12" and not is_closed("2026-12", cases[2]["entered"]) and cases[0]["posting"] == "2026-11")
    control("T3", "قاعدة 204 الحالية تختار إصدار يوم الإدخال (لا تتغير ضمنيًا)", cases[1]["version"] == 2)
    control("T4", "غياب إصدار صالح في تاريخ التحديد يبقى رفضًا", cases[3]["version"] is None)
    return cases


# ---------------------------------------------------------------- DX3: cumulative backflush against net prior consumption
def dx3():
    """Scope: (organization, order, stage, pinned component line of the BOM snapshot). Quantities in the component's base unit.
    expected_cumulative = per-unit quantity of the pinned line x cumulative processed units of the approved production record versions.
    net_consumed = Σ all posted manual and backflush issues in the scope - Σ posted returns and reversals linked to them. A record version
    never removes a movement from the ledger; its effect is removed only by a reversal movement, so nothing is deducted twice.
    A record approval adds backflush = max(expected_cumulative - net_consumed, 0) linked to that record version; a surplus is shown for
    classification, never settled silently. A correction reverses only the backflush linked to the old record version."""
    per_unit = F(5, 100)
    moves = []          # (id, kind, qty, link)  kind: manual | return | backflush | reverse; link: record version, or the movement it undoes
    records = {}        # record id -> current (version, processed units)
    requests = {}       # idempotency key -> (inputs, recorded result)
    log = []

    def net():
        manual = sum(mv[2] for mv in moves if mv[1] == "manual") - sum(mv[2] for mv in moves if mv[1] == "return")
        bf = sum(mv[2] for mv in moves if mv[1] == "backflush") - sum(mv[2] for mv in moves if mv[1] == "reverse")
        return manual + bf

    def expected():
        return per_unit * sum(units for _v, units in records.values())

    def entry(label, before, add, rev=F(0)):
        exp, after = expected(), net()
        log.append({"event": label, "expected": exp, "net_before": before, "reversed": rev, "backflush": add, "diff": after - exp,
                    "surplus": max(after - exp, F(0)), "shortage": max(exp - after, F(0))})

    def approve(key, rid, units, label):
        inputs = (rid, units)
        if key in requests:
            if requests[key][0] != inputs:
                raise DesignRefused("BACKFLUSH_IDEMPOTENCY_CONFLICT")
            return requests[key][1]
        prev = records.get(rid)
        rev = F(0)
        if prev:
            for mv in list(moves):
                if mv[1] == "backflush" and mv[3] == (rid, prev[0]):
                    moves.append((f"RV-{mv[0]}", "reverse", mv[2], mv[0]))
                    rev += mv[2]
        ver = prev[0] + 1 if prev else 1
        records[rid] = (ver, units)
        before = net() + rev
        add = max(expected() - net(), F(0))
        if add:
            moves.append((f"BF-{rid}v{ver}", "backflush", add, (rid, ver)))
        entry(label, before, add, rev)
        requests[key] = (inputs, add)
        return add

    def manual(mid, kind, qty, label, link=None):
        before = net()
        moves.append((mid, kind, F(qty), link))
        entry(label, before, F(0))

    manual("M1", "manual", 30, "صرف يدوي M1: 30 (قبل أي سجل)")
    approve("K1", "R1", 800, "اعتماد سجل R1: 800 وحدة")
    approve("K2", "R2", 200, "اعتماد سجل R2: +200 (المتوقع التراكمي 50)")
    replay = approve("K2", "R2", 200, "—")
    try:
        approve("K2", "R2", 250, "—")
        conflict = None
    except DesignRefused as exc:
        conflict = str(exc)
    approve("K3", "R2", 100, "تصحيح R2 إلى 100 (الإصدار 2)")
    manual("M2", "manual", 8, "صرف يدوي زائد M2: 8")
    manual("RT1", "return", 5, "قرار: إرجاع 5 من M2 إلى المخزن", "M2")
    approve("K4", "R3", 100, "اعتماد سجل R3: +100")
    mandatory = log[2]
    control("B1", "المتوقع التراكمي 50 والمصروف يدويًا 30 والـBackflush السابق 10 → إضافة 10 فقط",
            mandatory["expected"] == 50 and mandatory["net_before"] == 40 and mandatory["reversed"] == 0 and mandatory["backflush"] == 10)
    control("B2", "التصحيح يعكس الـBackflush المرتبط بالإصدار القديم وحده، ولا يعكس الصرف اليدوي",
            [mv[3] for mv in moves if mv[1] == "reverse"] == ["BF-R2v1"])
    bf_links = [mv[3] for mv in moves if mv[1] == "backflush"]
    undone = [mv[3] for mv in moves if mv[1] in ("reverse", "return")]
    control("B3", "كل Backflush مرتبط بإصدار سجل واحد، وكل عكس أو إرجاع يخص حركة واحدة مرة واحدة",
            len(bf_links) == len(set(bf_links)) and len(undone) == len(set(undone)))
    control("B4", "المفتاح نفسه بالمدخلات نفسها يعيد النتيجة المسجلة دون حركة؛ بمدخلات مختلفة يُرفض",
            replay == 10 and conflict == "BACKFLUSH_IDEMPOTENCY_CONFLICT" and sum(1 for b in bf_links if b[0] == "R2") == 2)
    control("B5", "الزيادة تُعرض للتصنيف ولا تُسوّى صامتة؛ لا Backflush سالب؛ الإرجاع قرار صريح",
            log[4]["surplus"] == 8 and log[4]["backflush"] == 0 and all(e["backflush"] >= 0 for e in log))
    control("B6", "الكمية محفوظة: صافي الاستهلاك = المتوقع التراكمي بعد آخر سجل",
            net() == expected() == 50 and log[-1]["backflush"] == 2)
    return {"per_unit": per_unit, "log": log, "moves": moves, "replay": replay, "conflict": conflict}


# ---------------------------------------------------------------- DX4: BOM snapshot pinned to the order across partial records
def dx4():
    def per_unit(qty, scrap_pct):
        return F(qty) * (1 + F(scrap_pct) / 100)      # explode_bom (138/141): quantity x (1 + scrap_factor/100); yield_percentage unused
    v3 = per_unit("0.05", 2)
    v4 = per_unit("0.06", 2)
    r1, r2 = 400, 600
    snap = v3 * (r1 + r2)
    reselect_each = v3 * r1 + v4 * r2
    reselect_all = v4 * (r1 + r2)
    control("S1", "الأمر يحتفظ بلقطة BOM-3 عبر سجلين جزئيين يتخللهما اعتماد BOM-4", snap == v3 * 1000 and snap != reselect_each)
    control("S2", "الفاقد المخطط يدخل كمية الوحدة مرة واحدة (scrap_factor بالمئة، دون yield)", v3 == F(51, 1000))
    return {"v3": v3, "v4": v4, "r1": r1, "r2": r2, "after_r1": v3 * r1, "snap": snap, "reselect_each": reselect_each, "reselect_all": reselect_all}


# ---------------------------------------------------------------- DX2: spoilage rule conflict (unchanged rules; most specific wins, never summed)
LEVELS = ("bom_stage", "bom_version", "item", "item_category", "company")
RULES = [("company", "ORG", 3, 100), ("item_category", "CAT-FILM", 4, 100), ("item", "ITEM-X", 5, 100),
         ("bom_version", "ITEM-X/BOM-3", 6, 100), ("bom_stage", "ITEM-X/BOM-3/STAGE-2", 2, 100)]


def resolve(ctx):
    keys = {"company": "ORG", "item_category": ctx["category"], "item": ctx["item"], "bom_version": f"{ctx['item']}/{ctx['bom']}",
            "bom_stage": f"{ctx['item']}/{ctx['bom']}/{ctx['stage']}"}
    for lvl in LEVELS:
        for r in RULES:
            if r[0] == lvl and r[1] == keys[lvl]:
                return r
    return None


def e4_with(rate_pct, insp):
    return rc.stage_wa({"units": {"bwip": 0, "received": 1000, "completed": 900, "ewip": 40, "spoiled": 60}, "normal_rate": F(rate_pct, 100),
                        "inspection_pct": insp,
                        "groups": {"material": {"added": {"material": "9000"}, "ewip_pct": 100, "spoil_pct": 100},
                                   "conversion": {"added": {"labor": "1900", "LABOR_OH": "760", "MACHINE_OH": "1900"}, "ewip_pct": 50,
                                                  "spoil_pct": insp}}})


def dx2():
    contexts = [("ITEM-X، BOM-3، المرحلة 2", {"category": "CAT-FILM", "item": "ITEM-X", "bom": "BOM-3", "stage": "STAGE-2"}),
                ("ITEM-X، BOM-3، المرحلة 1", {"category": "CAT-FILM", "item": "ITEM-X", "bom": "BOM-3", "stage": "STAGE-1"}),
                ("ITEM-X، BOM-2، المرحلة 1", {"category": "CAT-FILM", "item": "ITEM-X", "bom": "BOM-2", "stage": "STAGE-1"}),
                ("ITEM-Y (فئة الأفلام)", {"category": "CAT-FILM", "item": "ITEM-Y", "bom": "BOM-1", "stage": "STAGE-1"}),
                ("ITEM-Z (فئة أخرى)", {"category": "CAT-BAGS", "item": "ITEM-Z", "bom": "BOM-1", "stage": "STAGE-1"})]
    rows = []
    for label, ctx in contexts:
        r = resolve(ctx)
        st = e4_with(r[2], r[3])
        rows.append({"label": label, "level": r[0], "rate": r[2], "normal": st["units"]["normal"], "abnormal": st["units"]["abnormal"],
                     "to": st["to"], "abn_cost": st["abnormal"]})
    summed = sum(r[2] for r in RULES)
    st = e4_with(summed, 100)
    control("W1", "القاعدة الأخص تُطبق كاملة ولا تُجمع النسب", rows[0]["rate"] == 2 and summed == 20)
    return {"rows": rows, "wrong": {"rate": summed, "normal": st["units"]["normal"], "abnormal": st["units"]["abnormal"], "to": st["to"],
                                    "abn_cost": st["abnormal"]}}


def render():
    calc = hashlib.sha256((HERE / "reference_calculator.py").read_bytes()).hexdigest()
    from controls_205 import R4_NAMES, top_level_sources
    old, new = top_level_sources(R3_SNAPSHOT), top_level_sources(HERE / "reference_calculator.py")
    control("R3", "لقطة r3 بالبصمة المقبولة، وكل تعريفاتها في الحاسبة الحالية كما هي؛ r4 يضيف أسماء 205 وحدها",
            hashlib.sha256(R3_SNAPSHOT.read_bytes()).hexdigest() == R3_SHA and all(new.get(n) == old[n] for n in old)
            and set(new) - set(old) == R4_NAMES)
    t = {}
    rows = ["| الحالة | المجمعات (الأساس، النشاط، المعدل، الموازنات) | العمالة المباشرة | سطور المجمعات | الإجمالي |", "|---|---|---|---|---|"]
    for key, desc, res, err in dx0():
        if err:
            rows.append(f"| ({key}) | {desc} | — | — | **`{err}`** |")
        else:
            rows.append(f"| ({key}) | {desc} | {m(res['labor'])} | " + "، ".join(f"`{k}` {m(v)}" for k, v in res["pools"].items())
                        + f" | **{m(res['total'])}** |")
    t["DX0"] = "\n".join(rows)
    c1 = dx1()
    rows = ["| المسار | `entered_at` | التنفيذ المعتمد (فترته) | تاريخ تحديد السياسة/BOM | الإصدار | `MACHINE_OH` (100 س) | فترة الترحيل |", "|---|---|---|---|---|---|---|"]
    for c in c1:
        rows.append(f"| {c['label']} | {c['entered']} | {c['executed']} ({'مغلقة' if c['exec_closed'] else 'مفتوحة'}) | {c['determination']} | "
                    f"{c['version'] if c['version'] else '**لا إصدار: رفض**'} | {m(c['cost']) if c['cost'] is not None else '—'} | {c['posting']} |")
    t["DX1"] = "\n".join(rows)
    d2 = dx2()
    lvl_ar = {"bom_stage": "مرحلة داخل BOM", "bom_version": "إصدار BOM", "item": "الصنف", "item_category": "فئة الصنف", "company": "الشركة"}
    rows = ["| السياق | القاعدة المطبقة (المستوى) | النسبة | طبيعي | غير طبيعي | تكلفة الجيد | مصروف غير طبيعي |", "|---|---|---|---|---|---|---|"]
    for r in d2["rows"]:
        rows.append(f"| {r['label']} | {lvl_ar[r['level']]} | {r['rate']}% | {q(r['normal'], 0)} | {q(r['abnormal'], 0)} | {m(r['to'])} | {m(r['abn_cost'])} |")
    w = d2["wrong"]
    rows.append(f"| **خطأ: جمع النسب** للسياق الأول | كل المستويات | {w['rate']}% | {q(w['normal'], 0)} | {q(w['abnormal'], 0)} | {m(w['to'])} | {m(w['abn_cost'])} |")
    t["DX2"] = "\n".join(rows)
    t["DX2_RULES"] = "\n".join(["| المستوى | المفتاح | النسبة | نقطة الفحص |", "|---|---|---|---|"]
                               + [f"| {lvl_ar[r[0]]} | `{r[1]}` | {r[2]}% | {r[3]}% |" for r in RULES])
    d3 = dx3()
    rows = ["| الحدث | المتوقع التراكمي | صافي الاستهلاك قبله | عكس مرتبط | Backflush جديد | صافي − متوقع بعده |", "|---|---|---|---|---|---|"]
    for e in d3["log"]:
        rows.append(f"| {e['event']} | {q(e['expected'])} | {q(e['net_before'])} | {q(e['reversed'])} | {q(e['backflush'])} | {q(e['diff'])} |")
    t["DX3"] = "\n".join(rows)
    t["DX3_PU"] = q(d3["per_unit"], 3)
    t["DX3_REPLAY"], t["DX3_CONFLICT"] = q(d3["replay"]), d3["conflict"]
    t["DX3_MOVES"] = "، ".join(f"`{mv[0]}` {q(mv[2])}" for mv in d3["moves"])
    d4 = dx4()
    t["DX4_V3"], t["DX4_V4"] = q(d4["v3"], 4), q(d4["v4"], 4)
    t["DX4_R1"], t["DX4_R2"] = str(d4["r1"]), str(d4["r2"])
    t["DX4_AFTER1"], t["DX4_SNAP"], t["DX4_EACH"], t["DX4_ALL"] = q(d4["after_r1"]), q(d4["snap"]), q(d4["reselect_each"]), q(d4["reselect_all"])
    t["CONTROLS"] = "\n".join(["| الضابط | القاعدة | النتيجة |", "|---|---|---|"] + [f"| {c} | {txt} | {'PASS' if ok else 'FAIL'} |" for c, txt, ok in CONTROLS])
    tpl = (HERE / "DESIGN.template.md").read_text(encoding="utf-8")
    for k, v in t.items():
        tok = "{{" + k + "}}"
        if tpl.count(tok) < 1:
            raise SystemExit(f"token {tok} unused")
        tpl = tpl.replace(tok, v)
    if "{{" in tpl:
        raise SystemExit("unfilled token")
    tpl = tpl.replace("@@CALC_SHA@@", calc)
    OUT.write_text(tpl, encoding="utf-8", newline="\n")
    print("DESIGN_RENDERED", OUT.name, hashlib.sha256(OUT.read_bytes()).hexdigest(), "calculator", calc)
    print(f"DESIGN_CONTROLS pass={sum(1 for c in CONTROLS if c[2])} of {len(CONTROLS)}")
    return t


if __name__ == "__main__":
    render()
