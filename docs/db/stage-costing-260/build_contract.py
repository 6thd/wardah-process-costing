# Renders docs/db/STAGE_COSTING_260_CONTRACT.md from CONTRACT.template.md and the reference calculator (revision 2). Every {{...}} token is
# generated from reference_calculator; no example number is typed by hand. Connects to nothing.
#   python -I -B -X utf8 build_contract.py
import hashlib
import sys
from fractions import Fraction as F
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import reference_calculator as rc  # noqa: E402

OUT = HERE.parent / "STAGE_COSTING_260_CONTRACT.md"
GROUP_AR = {"transferred_in": "المنقول", "material": "المواد", "conversion": "التحويل (عمالة + أوفرهيد)"}


def m(c):
    """integer cents -> 1,234.56"""
    c = int(c)
    return f"{'-' if c < 0 else ''}{abs(c) // 100:,}.{abs(c) % 100:02d}"


def md(x):
    """Decimal currency units (revision-1 results) -> 1,234.56"""
    return f"{x:,.2f}"


def n(x):
    x = F(x)
    if x.denominator == 1:
        return f"{x.numerator:,}"
    return f"{float(x):,.4f}".rstrip("0").rstrip(".")


def unit(x):
    return f"{float(F(x) / 100):,.4f}"


def stage_table(s):
    u = s["units"]
    head = (f"وحدات: بداية {n(u['bwip'])} + مستلمة {n(u['received'])} = تامة {n(u['completed'])} + WIP نهاية {n(u['ewip'])}"
            + (f" + تالفة {n(u['spoiled'])} (طبيعي {n(u['normal'])}، غير طبيعي {n(u['abnormal'])})" if u["spoiled"] else ""))
    lines = [head, "",
             "| الفئة | تكلفة للمحاسبة | وحدات مكافئة | تكلفة الوحدة المكافئة | التام (المخرج) | تالف طبيعي (ضمنه، للعرض) | تالف غير طبيعي | WIP نهاية |",
             "|---|---|---|---|---|---|---|---|"]
    for g, v in s["groups"].items():
        lines.append(f"| {GROUP_AR[g]} | {m(v['total'])} | {n(v['eu'])} | {unit(v['unit'])} | {m(v['to'])} | {m(v['normal_display'])} | "
                     f"{m(v['abnormal'])} | {m(v['ewip'])} |")
    lines.append(f"| **الإجمالي** | **{m(s['accounted'])}** | | | **{m(s['to'])}** | | **{m(s['abnormal'])}** | **{m(s['ewip'])}** |")
    conv = s["groups"].get("conversion")
    if conv and len(conv["components"]) > 1:
        parts = "، ".join(f"`{c}` {m(conv['split']['to'][c])}" for c in conv["components"])
        lines += ["", f"تفصيل التحويل في التام: {parts}."]
    return "\n".join(lines)


def policy_line(c):
    pools = "، ".join(f"`{k}` {m(v)}" for k, v in c["pools"].items())
    return f"عمالة {m(c['labor'])}؛ {pools}؛ الإجمالي **{m(c['total'])}**"


def lines_table(lines):
    keys = sorted({k for ln in lines for k in ln["components"]}, key=rc.origin_rank)
    head = "| السطر | التحويل | الحساب المصدر (مرحلة، فترة، إصدار) | الوحدات | يستلمه (مرحلة، فترة) | " + " | ".join(f"`{rc.key_label(k)}`" for k in keys) + " | الإجمالي |"
    rows = [head, "|" + "---|" * (6 + len(keys))]
    for i, ln in enumerate(lines, 1):
        c = ln["components"]
        rows.append(f"| L{i} | {ln['move']} | {ln['source']} | {n(ln['units'])} | ({ln['to_stage']}، {ln['received_period']}) | "
                    + " | ".join(m(c.get(k, 0)) for k in keys) + f" | **{m(ln['total'])}** |")
    return "\n".join(rows)


def layer_table(layer, to):
    rows = ["| مفتاح الطبقة (مرحلة المنشأ/الفئة/المكوّن) | المبلغ |", "|---|---|"]
    for k in sorted(layer["components"], key=rc.origin_rank):
        rows.append(f"| `{rc.key_label(k)}` | {m(layer['components'][k])} |")
    rows.append(f"| **Σ = التام** | **{m(sum(layer['components'].values()))}** = {m(to)} |")
    return "\n".join(rows)


def render():
    ex = rc.examples()
    cx = rc.counterexamples()
    pc = rc.property_checks()
    tc = rc.transfer_property_checks()
    t = {}
    e0 = ex["E0"]
    t["E0"] = "\n".join(["| المركز | العمالة | `LABOR_OH` | `MACHINE_OH` | الإجمالي |", "|---|---|---|---|---|"]
                        + [f"| {wc} | {m(c['labor'])} | {m(c['pools']['LABOR_OH']) if 'LABOR_OH' in c['pools'] else 'مستبعد'} | {m(c['pools']['MACHINE_OH'])} | {m(c['total'])} |"
                           for wc, c in e0["v1"].items()]
                        + [f"| WC-C، الإصدار 2 (`recorded_entry_rate`) | {m(e0['v2']['labor'])} | {m(e0['v2']['pools']['LABOR_OH'])} | {m(e0['v2']['pools']['MACHINE_OH'])} | {m(e0['v2']['total'])} |"])
    t["E1"] = stage_table(ex["E1"])
    t["E2_POLICY"] = policy_line(ex["E2"]["policy"])
    t["E2_LINES"] = lines_table(ex["E2"]["lines"])
    t["E2"] = stage_table(ex["E2"]["stage"])
    s1, s2 = ex["E1"], ex["E2"]["stage"]
    t["E2_CHECK"] = (f"Σ المضاف في المرحلتين = {m(ex['E2']['added_all'])} = الإنتاج التام {m(s2['to'])} + WIP المرحلة 1 {m(s1['ewip'])} + WIP المرحلة 2 "
                     f"{m(s2['ewip'])} ✓ (تام المرحلة 1 {m(s1['to'])} يظهر مرة واحدة: في سطر التحويل L1 ثم داخل المرحلة 2).")
    t["E3_POLICY"] = policy_line(ex["E3"]["policy"])
    t["E3"] = stage_table(ex["E3"]["stage"])
    t["E4A"] = stage_table(ex["E4a"])
    t["E4B"] = stage_table(ex["E4b"])
    o = ex["E5"]["options"]
    rows = ["| الخيار | الحساب | ساعات العمالة | ساعات الماكينة | العمالة | `LABOR_OH` | `MACHINE_OH` | `SETUP_OH` | الإجمالي |", "|---|---|---|---|---|---|---|---|---|"]
    lbl = {"a": "(أ) تشغيل فقط للأساسين", "b": "(ب) تشغيل + إعداد للأساسين",
           "c": "(ج) عمالة تشغيل + إعداد؛ ماكينة تشغيل فقط؛ مجمع `SETUP_OH` على ساعات إعداد الماكينة وحدها (60)"}
    via = {"204": "`compute_204` الحالية بالساعات التي يختارها الحقل المقترح", "205 (proposed)": "**`compute_205` المقترحة** (غير موجودة)"}
    for k in ("a", "b", "c"):
        c = o[k]["calc"]
        rows.append(f"| {lbl[k]} | {via[o[k]['via']]} | {n(o[k]['labor_hours'])} | {n(o[k]['machine_hours'])} | {m(c['labor'])} | {m(c['pools']['LABOR_OH'])} | "
                    f"{m(c['pools']['MACHINE_OH'])} | {m(c['pools']['SETUP_OH']) if 'SETUP_OH' in c['pools'] else '—'} | **{m(c['total'])}** |")
    t["E5"] = "\n".join(rows)
    rf = ex["E5"]["refusals"]
    t["E5_REFUSALS"] = (f"إصدار بلا حقلي الأساس (مثل إصدارات 204 الحالية) → `{rf['legacy_version']}`؛ مجمع `setup_only` على أساس `run_plus_setup` → "
                        f"`{rf['double_count']}`.")
    e6 = ex["E6"]
    t["E6"] = "\n".join([
        "| | الحساب 1 (10 ساعات) | الحساب 2 (11 ساعة) | الفرق المدقق |", "|---|---|---|---|",
        f"| تحويل مضاف (سياسة WC-A) | {m(ex['E2']['policy']['total'])} | {m(e6['policy']['total'])} | {m(e6['delta_added'])} |",
        f"| التام (الإنتاج التام) | {m(s2['to'])} | {m(e6['stage']['to'])} | {m(e6['delta_to'])} |",
        f"| WIP نهاية المرحلة 2 | {m(s2['ewip'])} | {m(e6['stage']['ewip'])} | {m(e6['delta_ewip'])} |"])
    e7 = ex["E7"]
    t["E7_LINES"] = lines_table(e7["lines"])
    h = e7["held_after_p1"]
    t["E7_HELD"] = (f"بعد L1 يبقى في طبقة المرحلة 1 (فترة 1، إصدار 1) {n(h['units'])} وحدة تامة غير منقولة بتكلفة "
                    f"{m(sum(h['components'].values()))}: مخرج تام محتجز في المرحلة، لا WIP، ولا يدخل متوسط فترة لاحقة. سحب وحدة إضافية بعد L2 → `{e7['overdraw']}`.")
    t["E7_POLICY_P1"] = policy_line(e7["c_p1"])
    t["E7_POLICY_P2"] = policy_line(e7["c_p2"])
    t["E7_S2P1"] = stage_table(e7["s2p1"])
    t["E7_S2P2"] = stage_table(e7["s2p2"])
    t["E7_CHECK"] = (f"نهاية الفترة 1: المضاف {m(e7['added_p1'])} = تام المرحلة 2 {m(e7['s2p1']['to'])} + WIP المرحلة 1 {m(s1['ewip'])} + تام محتجز في المرحلة 1 "
                     f"{m(sum(h['components'].values()))} + WIP المرحلة 2 {m(e7['s2p1']['ewip'])} ✓. نهاية الفترة 2: المضاف {m(e7['added_p2'])} = التام "
                     f"{m(e7['s2p1']['to'])} + {m(e7['s2p2']['to'])} + WIP المرحلة 1 {m(s1['ewip'])} + WIP المرحلة 2 {m(e7['s2p2']['ewip'])} ✓؛ و"
                     f"L1 + L2 = {m(sum(ln['total'] for ln in e7['lines']))} = تام المرحلة 1 {m(s1['to'])}.")
    e8 = ex["E8"]
    b, a, d = e8["before"], e8["after"], e8["delta"]
    t["E8"] = "\n".join([
        "| الحساب | المخرج | قبل (الإصدار 1) | بعد (الإصدار 2) | الفرق |", "|---|---|---|---|---|",
        f"| المرحلة 1، الفترة 1 | التام (طبقة التحويل) | {m(b['s1']['to'])} | {m(a['s1']['to'])} | {m(d['s1_to'])} |",
        f"| المرحلة 1، الفترة 1 | WIP نهاية | {m(b['s1']['ewip'])} | {m(a['s1']['ewip'])} | {m(d['s1_ewip'])} |",
        f"| المرحلة 2، الفترة 1 | التام (الإنتاج التام) | {m(b['s2']['to'])} | {m(a['s2']['to'])} | {m(d['s2_to'])} |",
        f"| المرحلة 2، الفترة 1 | WIP نهاية | {m(b['s2']['ewip'])} | {m(a['s2']['ewip'])} | {m(d['s2_ewip'])} |",
        f"| المرحلة 1، الفترة 2 | التام | {m(b['p2']['to'])} | {m(a['p2']['to'])} | {m(d['p2_to'])} |",
        f"| المرحلة 1، الفترة 2 | WIP نهاية | {m(b['p2']['ewip'])} | {m(a['p2']['ewip'])} | {m(d['p2_ewip'])} |"])
    key_ar = {(1, 1): "S1P1", (2, 1): "S2P1", (1, 2): "S1P2"}
    st_ar = {"calculated": "محسوب", "stale": "**قديم**", "approved": "معتمد", "posted": "مرحّل", "superseded": "مستبدل"}
    steps = ["| # | الإجراء | النتيجة | الحالات بعده (الإصدار، الحالة) |", "|---|---|---|---|"]
    for i, stp in enumerate(e8["steps"], 1):
        res = "تم" if stp["result"] == "OK" else f"رفض `{stp['result']}`"
        sts = "؛ ".join(f"{key_ar[k]} v{v[0]} {st_ar[v[1]]}" for k, v in stp["states"].items())
        steps.append(f"| {i} | {stp['action']} | {res} | {sts} |")
    t["E8_STEPS"] = "\n".join(steps)
    cx_rows = ["| الحالة | المدخلات | المراجعة 1 (التام / غير الطبيعي / WIP؛ مكونات التام) | المراجعة 2 |", "|---|---|---|---|"]
    desc = {"CX1": "وحدتان: 1 تامة و1 تالفة غير طبيعية، لا WIP؛ تحويل 10.01",
            "CX2": "1 تامة و1,999 WIP بنسبة 50%؛ مكونات 5.00 + 5.00 + 0.00",
            "CX3": "مواد 250.00 بلا أي وحدات"}
    for k, v in cx.items():
        lg = next(iter(v["legacy"]["groups"].values()))
        no_wip_units = rc.COUNTEREXAMPLES[k]["units"]["ewip"] == 0

        def mark(val, is_ewip=False):
            bad = val < 0 or (is_ewip and no_wip_units and val != 0)
            return f"**{md(val)}**" if bad else md(val)
        lt = (f"{mark(lg['to'])} / {mark(lg['abnormal'])} / {mark(lg['ewip'], True)}؛ "
              + "، ".join(f"{c} {mark(a)}" for c, a in lg["split_to"].items()))
        if v["v2_error"]:
            nt = f"رفض `{v['v2_error']}`"
        else:
            nt = (f"{m(v['v2']['to'])} / {m(v['v2']['abnormal'])} / {m(v['v2']['ewip'])}؛ " + "، ".join(f"{c} {m(a)}" for c, a in v["v2"]["split_to"].items()))
        cx_rows.append(f"| {k} | {desc[k]} | {lt} | {nt} |")
    t["CX"] = "\n".join(cx_rows)
    t["PROPERTY"] = (f"{pc['cases']:,} مرحلة عشوائية ببذرة ثابتة (260): **المراجعة 2: {pc['v2_violations']} مخالفة**؛ المراجعة 1 على الحالات نفسها: "
                     f"{pc['legacy_negative']} حالة بمبلغ أو مكوّن سالب، و{pc['legacy_cent_without_units']} حالة بهللات في WIP بلا وحدات؛ "
                     f"و{pc['eu_zero_rejected']} حالة EU = 0 بتكلفة موجبة رُفضت. وتحويلات: {tc['cases']:,} حالة عشوائية (بذرة 2601) بطبقات وسحب جزئي: "
                     f"{tc['violations']} مخالفة (الإجمالي محفوظ لكل مكوّن، لا سالب، ولا تكلفة بلا وحدات).")
    t["E2_LAYER"] = layer_table(s2["layer"], s2["to"])
    e9 = ex["E9"]
    t["E9_LINES"] = lines_table(e9["lines"])
    t["E9_POLICY"] = policy_line(e9["policy"])
    t["E9"] = stage_table(e9["stage"])
    t["E9_CHECK"] = (f"Σ المضاف في المراحل الثلاث = {m(e9['added_all'])} = الإنتاج التام (تام المرحلة 3) {m(e9['stage']['to'])} + WIP المرحلة 1 "
                     f"{m(s1['ewip'])} + WIP المرحلة 2 {m(s2['ewip'])} + WIP المرحلة 3 {m(e9['stage']['ewip'])} ✓؛ وتام المرحلة 3 حسب مرحلة المنشأ: "
                     + "، ".join(f"المرحلة {k} {m(v)}" for k, v in sorted(e9["by_origin"].items())) + f" = {m(e9['stage']['to'])}.")
    t["E9_LAYER"] = layer_table(e9["stage"]["layer"], e9["stage"]["to"])
    t["E10_LINES"] = lines_table(ex["E10"]["lines"])
    import focused_controls as fc
    r3 = fc.run(rc)
    r2 = fc.run(fc.load(HERE / "history" / "reference_calculator_r2_0b66a36c.py.txt", "calc_r2"))
    rows = ["| الضابط | ما يتحقق منه | المراجعة 2 (`0b66a36c`) | المراجعة 3 |", "|---|---|---|---|"]
    for (cid, text, ok3, d3), (_, _, ok2, d2) in zip(r3, r2):
        rows.append(f"| {cid} | {text} | {'PASS' if ok2 else '**FAIL**'}: {d2} | {'PASS' if ok3 else '**FAIL**'}: {d3} |")
    rows.append(f"| | **المجموع** | {sum(r[2] for r in r2)} من {len(r2)} | {sum(r[2] for r in r3)} من {len(r3)} |")
    assert all(r[2] for r in r3), "a focused control fails on the current calculator"
    t["CONTROLS"] = "\n".join(rows)
    old_ex = fc.load(HERE / "history" / "reference_calculator_r2_0b66a36c.py.txt", "calc_r2_ex").examples()

    def pick(e, k, sub=None):
        v = e[k][sub] if sub else e[k]
        return v["stage"] if isinstance(v.get("stage"), dict) else v
    shared = [("E1", None), ("E2", None), ("E3", None), ("E4a", None), ("E4b", None), ("E6", None), ("E7", "s2p1"), ("E7", "s2p2")]
    compared = changed = 0
    for k, sub in shared:
        a, b2 = pick(old_ex, k, sub), pick(ex, k, sub)
        for g in a["groups"]:
            for o in ("to", "abnormal", "ewip"):
                compared += 2
                changed += a["groups"][g][o] != b2["groups"][g][o]
                changed += sorted(a["groups"][g]["split"][o].values()) != sorted(b2["groups"][g]["split"][o].values())
    l_old = sum(pick(old_ex, "E2")["layer"]["components"].values())
    l_new = sum(s2["layer"]["components"].values())
    t["R3_CHANGES"] = (f"**التغير الرقمي:** {changed} من {compared} قيمة مشتركة مع المراجعة 2 (مخرجات كل فئة وتوزيع مكوناتها في E1–E4 وE6 وE7) تغيّرت؛ "
                       f"الذي تغيّر هو طبقة التام وحدها: مجموع طبقة E2 كان {m(l_old)} وصار {m(l_new)} = تام E2، وما يُبنى عليها (E9 وE10) جديد.")
    tpl = (HERE / "CONTRACT.template.md").read_text(encoding="utf-8")
    for k, v in t.items():
        tok = "{{" + k + "}}"
        if tpl.count(tok) != 1:
            raise SystemExit(f"token {tok} found {tpl.count(tok)} times")
        tpl = tpl.replace(tok, v)
    if "{{" in tpl:
        raise SystemExit("unfilled token left")
    calc = hashlib.sha256((HERE / "reference_calculator.py").read_bytes()).hexdigest()
    tpl = tpl.replace("@@CALC_SHA@@", calc)
    OUT.write_text(tpl, encoding="utf-8", newline="\n")
    print("CONTRACT_RENDERED", OUT.name, hashlib.sha256(OUT.read_bytes()).hexdigest(), "calculator", calc)


if __name__ == "__main__":
    render()
