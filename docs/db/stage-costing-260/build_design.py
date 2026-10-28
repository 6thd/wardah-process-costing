# Renders docs/db/MANUFACTURING_SETTINGS_260_DESIGN.md from DESIGN.template.md. The examples (direct vs late-recorded path, spoilage rule
# conflict, mixed issuing) are computed here; costs go through the accepted reference calculator r3 (imported, never modified). Offline.
#   python -I -B -X utf8 build_design.py
import hashlib
import sys
from fractions import Fraction as F
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import reference_calculator as rc  # noqa: E402

OUT = HERE.parent / "MANUFACTURING_SETTINGS_260_DESIGN.md"


def m(c):
    c = int(c)
    return f"{'-' if c < 0 else ''}{abs(c) // 100:,}.{abs(c) % 100:02d}"


def q(x, places=3):
    """exact quantity -> text with `places` decimals (display only)"""
    v = F(x)
    s = f"{float(v):,.{places}f}"
    return s


# ---------------------------------------------------------------- DX0: approved overhead design (R2): activity per pool; direct labor apart
HOURS = {"labor": {"run": F(18), "setup": F(2)}, "machine": {"run": F(15), "setup": F(3, 2)}}


class DesignRefused(Exception):
    pass


def overhead_by_activity(pools, setup_in_run_rates=False):
    """Design helper, not compute_205: each pool = (code, basis, activity ∈ run|setup|both, rate). Every pool line is computed by calling the
    accepted compute_204 with that pool alone and the hours its activity selects. Direct labor = all approved direct hours (run + setup) at the
    labor rate, whatever the pools. Refusals: setup in two pools of the same basis (double count); setup in no pool and no explicit
    acknowledgement that setup overhead is inside the run rates (unset: setup cost could be dropped)."""
    res = {"labor": rc.compute_204({"labor_cost_source": "work_center_rate", "default_labor_rate": "30", "pools": []}, "WC-C",
                                   HOURS["labor"]["run"] + HOURS["labor"]["setup"], 0)["labor"], "pools": {}}
    for basis in ("labor_hours", "machine_hours"):
        with_setup = [p for p in pools if p[1] == basis and p[2] in ("setup", "both")]
        if len(with_setup) > 1:
            raise DesignRefused("COST_POLICY_SETUP_DOUBLE_COUNT")
    if not any(p[2] in ("setup", "both") for p in pools) and not setup_in_run_rates:
        raise DesignRefused("COST_POLICY_SETUP_TREATMENT_UNSET")
    for code, basis, activity, rate in pools:
        resource = "labor" if basis == "labor_hours" else "machine"
        acts = {"run": ("run",), "setup": ("setup",), "both": ("run", "setup")}[activity]
        h = sum((HOURS[resource][a] for a in acts), F(0))
        one = {"labor_cost_source": "work_center_rate", "default_labor_rate": "30", "pools": [{"code": code, "basis": basis, "rate": rate}]}
        res["pools"][code] = rc.compute_204(one, "WC-C", h if basis == "labor_hours" else 0, h if basis == "machine_hours" else 0)["pools"][code]
    res["total"] = res["labor"] + sum(res["pools"].values())
    return res


def dx0():
    cases = [("أ", "`LABOR_OH` و`MACHINE_OH` على التشغيل؛ إقرار بأن أوفرهيد الإعداد داخل معدلاتهما",
              [("LABOR_OH", "labor_hours", "run", "12"), ("MACHINE_OH", "machine_hours", "run", "40")], True),
             ("ب", "`LABOR_OH` و`MACHINE_OH` على التشغيل والإعداد",
              [("LABOR_OH", "labor_hours", "both", "12"), ("MACHINE_OH", "machine_hours", "both", "40")], False),
             ("ج", "`LABOR_OH` على الاثنين؛ `MACHINE_OH` على التشغيل؛ `SETUP_OH` على إعداد الماكينة (60)",
              [("LABOR_OH", "labor_hours", "both", "12"), ("MACHINE_OH", "machine_hours", "run", "40"), ("SETUP_OH", "machine_hours", "setup", "60")], False),
             ("د", "`MACHINE_OH` على الاثنين + `SETUP_OH` على إعداد الماكينة",
              [("LABOR_OH", "labor_hours", "run", "12"), ("MACHINE_OH", "machine_hours", "both", "40"), ("SETUP_OH", "machine_hours", "setup", "60")], False),
             ("هـ", "المجمعات على التشغيل فقط بلا إقرار", [("LABOR_OH", "labor_hours", "run", "12"), ("MACHINE_OH", "machine_hours", "run", "40")], False)]
    out = []
    for key, desc, pools, ack in cases:
        try:
            out.append((key, desc, overhead_by_activity(pools, ack), None))
        except DesignRefused as exc:
            out.append((key, desc, None, str(exc)))
    assert [c[3] for c in out] == [None, None, None, "COST_POLICY_SETUP_DOUBLE_COUNT", "COST_POLICY_SETUP_TREATMENT_UNSET"]
    assert all(c[2]["labor"] == 60000 for c in out[:3])
    return out


# ---------------------------------------------------------------- DX1: direct path vs late-recorded path (pin day)
def dx1():
    v1 = {"labor_cost_source": "work_center_rate", "default_labor_rate": "30", "pools": [{"code": "MACHINE_OH", "basis": "machine_hours", "rate": "40"}]}
    v2 = {"labor_cost_source": "work_center_rate", "default_labor_rate": "30", "pools": [{"code": "MACHINE_OH", "basis": "machine_hours", "rate": "45"}]}
    hours = 100
    c1 = rc.compute_204(v1, "WC-X", 0, hours)["pools"]["MACHINE_OH"]
    c2 = rc.compute_204(v2, "WC-X", 0, hours)["pools"]["MACHINE_OH"]
    return {"v1": c1, "v2": c2, "diff": c2 - c1, "hours": hours}


# ---------------------------------------------------------------- DX2: spoilage rule conflict, most specific wins, never summed
LEVELS = ("bom_stage", "bom_version", "item", "item_category", "company")
RULES = [   # (level, key, normal rate %, inspection point %); denominator: good units that passed inspection (the only one the r3 calculator has)
    ("company", "ORG", 3, 100),
    ("item_category", "CAT-FILM", 4, 100),
    ("item", "ITEM-X", 5, 100),
    ("bom_version", "ITEM-X/BOM-3", 6, 100),
    ("bom_stage", "ITEM-X/BOM-3/STAGE-2", 2, 100),
]


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
    wrong = {"rate": summed, "normal": st["units"]["normal"], "abnormal": st["units"]["abnormal"], "to": st["to"], "abn_cost": st["abnormal"]}
    assert rows[0]["rate"] == 2 and wrong["rate"] == 20
    return {"rows": rows, "wrong": wrong}


# ---------------------------------------------------------------- DX3: mixed issuing (manual + backflush remainder), correction, over-issue
def dx3():
    bom_qty = F(5, 100)          # kg of film per unit (BOM line quantity)
    planned_loss = F(2, 100)     # bom_lines.scrap_factor: planned material loss (planning), not production spoilage
    per_unit = bom_qty * (1 + planned_loss)
    good, spoiled = 900, 60
    processed = good + spoiled   # material is consumed by spoiled units too (proposed backflush base)
    expected = per_unit * processed
    manual = F(30)
    backflush = max(expected - manual, F(0))
    good2 = 880
    expected2 = per_unit * (good2 + spoiled)
    reverse = expected - expected2
    manual_over = F(50)
    over = manual_over - expected
    assert backflush + manual == expected and reverse > 0 and over > 0
    return {"per_unit": per_unit, "processed": processed, "expected": expected, "manual": manual, "backflush": backflush,
            "processed2": good2 + spoiled, "expected2": expected2, "reverse": reverse, "manual_over": manual_over, "over": over,
            "bom_qty": bom_qty, "planned_loss": planned_loss}


def render():
    t = {}
    rows = ["| الحالة | المجمعات وأنشطتها | العمالة المباشرة | المجمعات | الإجمالي |", "|---|---|---|---|---|"]
    for key, desc, res, err in dx0():
        if err:
            rows.append(f"| ({key}) | {desc} | — | — | **رفض `{err}`** |")
        else:
            rows.append(f"| ({key}) | {desc} | {m(res['labor'])} | " + "، ".join(f"`{k}` {m(v)}" for k, v in res["pools"].items())
                        + f" | **{m(res['total'])}** |")
    t["DX0"] = "\n".join(rows)
    d1 = dx1()
    t["DX1_V1"], t["DX1_V2"], t["DX1_DIFF"], t["DX1_H"] = m(d1["v1"]), m(d1["v2"]), m(d1["diff"]), str(d1["hours"])
    d2 = dx2()
    lvl_ar = {"bom_stage": "مرحلة داخل BOM", "bom_version": "إصدار BOM", "item": "الصنف", "item_category": "فئة الصنف", "company": "الشركة"}
    rows = ["| السياق | القاعدة المطبقة (المستوى) | النسبة | طبيعي | غير طبيعي | تكلفة الجيد | مصروف غير طبيعي |", "|---|---|---|---|---|---|---|"]
    for r in d2["rows"]:
        rows.append(f"| {r['label']} | {lvl_ar[r['level']]} | {r['rate']}% | {q(r['normal'], 0)} | {q(r['abnormal'], 0)} | {m(r['to'])} | {m(r['abn_cost'])} |")
    w = d2["wrong"]
    rows.append(f"| **خطأ: جمع النسب** للسياق الأول | كل المستويات | {w['rate']}% | {q(w['normal'], 0)} | {q(w['abnormal'], 0)} | {m(w['to'])} | {m(w['abn_cost'])} |")
    t["DX2"] = "\n".join(rows)
    rule_rows = ["| المستوى | المفتاح | النسبة | نقطة الفحص |", "|---|---|---|---|"]
    for r in RULES:
        rule_rows.append(f"| {lvl_ar[r[0]]} | `{r[1]}` | {r[2]}% | {r[3]}% |")
    t["DX2_RULES"] = "\n".join(rule_rows)
    d3 = dx3()
    t["DX3_BOMQ"], t["DX3_LOSS"], t["DX3_PU"] = q(d3["bom_qty"], 3), q(d3["planned_loss"] * 100, 0), q(d3["per_unit"], 3)
    t["DX3_PROC"], t["DX3_EXP"], t["DX3_MAN"], t["DX3_BF"] = str(d3["processed"]), q(d3["expected"], 2), q(d3["manual"], 2), q(d3["backflush"], 2)
    t["DX3_PROC2"], t["DX3_EXP2"], t["DX3_REV"] = str(d3["processed2"]), q(d3["expected2"], 2), q(d3["reverse"], 2)
    t["DX3_MANOVER"], t["DX3_OVER"] = q(d3["manual_over"], 2), q(d3["over"], 2)
    tpl = (HERE / "DESIGN.template.md").read_text(encoding="utf-8")
    for k, v in t.items():
        tok = "{{" + k + "}}"
        if tpl.count(tok) < 1:
            raise SystemExit(f"token {tok} unused")
        tpl = tpl.replace(tok, v)
    if "{{" in tpl:
        raise SystemExit("unfilled token")
    calc = hashlib.sha256((HERE / "reference_calculator.py").read_bytes()).hexdigest()
    assert calc == "f8042b161723613cff121d45129fedd76ac003304e293dbac354ae4210ac6777", "the accepted r3 calculator changed"
    tpl = tpl.replace("@@CALC_SHA@@", calc)
    OUT.write_text(tpl, encoding="utf-8", newline="\n")
    print("DESIGN_RENDERED", OUT.name, hashlib.sha256(OUT.read_bytes()).hexdigest(), "calculator", calc)
    return t


if __name__ == "__main__":
    for k, v in render().items():
        if not k.startswith("DX2"):
            print(k, v)
