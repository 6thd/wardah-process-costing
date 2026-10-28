# Renders docs/db/STAGE_COSTING_260_CONTRACT.md from CONTRACT.template.md and the reference calculator. Every {{...}} token is a table
# generated from reference_calculator.examples(); no example number is typed by hand. Connects to nothing.
#   python -I -B -X utf8 build_contract.py
import hashlib
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import reference_calculator as rc  # noqa: E402

OUT = HERE.parent / "STAGE_COSTING_260_CONTRACT.md"
GROUP_AR = {"transferred_in": "المنقول", "material": "المواد", "conversion": "التحويل (عمالة + أوفرهيد)"}


def m(x):
    return f"{x:,.2f}"


def n(x):
    x = rc.D(x)
    return f"{x:,.0f}" if x == x.to_integral_value() else f"{x.normalize():,}"


def cpu(x):
    return f"{x:,.4f}"


def stage_table(s):
    u = s["units"]
    lines = [f"وحدات: بداية {n(u['bwip'])} + مستلمة {n(u['received'])} = تامة منقولة {n(u['completed'])} + WIP نهاية {n(u['ewip'])}"
             + (f" + تالفة {n(u['spoiled'])} (طبيعي {n(u['normal'])}، غير طبيعي {n(u['abnormal'])})" if u["spoiled"] else ""), "",
             "| الفئة | تكلفة للمحاسبة | وحدات مكافئة | تكلفة الوحدة المكافئة | المنقول للخارج | تالف طبيعي (ضمنه) | تالف غير طبيعي | WIP نهاية |",
             "|---|---|---|---|---|---|---|---|"]
    for g, v in s["groups"].items():
        lines.append(f"| {GROUP_AR[g]} | {m(v['total'])} | {n(v['eu'])} | {cpu(v['cpu'])} | {m(v['to'])} | {m(v['normal'])} | {m(v['abnormal'])} | {m(v['ewip'])} |")
    lines.append(f"| **الإجمالي** | **{m(s['accounted'])}** | | | **{m(s['to'])}** | | **{m(s['abnormal'])}** | **{m(s['ewip'])}** |")
    conv = s["groups"].get("conversion")
    if conv and len(conv["components"]) > 1:
        parts = "، ".join(f"`{c}` {m(conv['split']['to'][c])}" for c in conv["components"])
        lines += ["", f"تفصيل التحويل في المنقول للخارج: {parts}."]
    return "\n".join(lines)


def policy_line(c):
    pools = "، ".join(f"`{k}` {m(v)}" for k, v in c["pools"].items())
    return f"عمالة {m(c['labor'])}؛ {pools}؛ الإجمالي **{m(c['total'])}**"


def render():
    ex = rc.examples()
    t = {}
    e0 = ex["E0"]
    t["E0"] = "\n".join(["| المركز | العمالة | `LABOR_OH` | `MACHINE_OH` | الإجمالي |", "|---|---|---|---|---|"]
                        + [f"| {wc} | {m(c['labor'])} | {m(c['pools']['LABOR_OH']) if 'LABOR_OH' in c['pools'] else 'مستبعد'} | {m(c['pools']['MACHINE_OH'])} | {m(c['total'])} |"
                           for wc, c in e0["v1"].items()]
                        + [f"| WC-C، الإصدار 2 (`recorded_entry_rate`) | {m(e0['v2']['labor'])} | {m(e0['v2']['pools']['LABOR_OH'])} | {m(e0['v2']['pools']['MACHINE_OH'])} | {m(e0['v2']['total'])} |"])
    t["E1"] = stage_table(ex["E1"])
    t["E2_POLICY"] = policy_line(ex["E2"]["policy"])
    t["E2"] = stage_table(ex["E2"]["stage"])
    s1, s2 = ex["E1"], ex["E2"]["stage"]
    t["E2_CHECK"] = (f"Σ المضاف في المرحلتين = {m(ex['E2']['added_all'])} = الإنتاج التام {m(s2['to'])} + WIP المرحلة 1 {m(s1['ewip'])} + WIP المرحلة 2 "
                     f"{m(s2['ewip'])} + غير طبيعي 0.00 ✓ (منقول المرحلة 1 {m(s1['to'])} يظهر مرة واحدة: داخل المرحلة 2 لا في جمع المراحل).")
    t["E3_POLICY"] = policy_line(ex["E3"]["policy"])
    t["E3"] = stage_table(ex["E3"]["stage"])
    t["E4A"] = stage_table(ex["E4a"])
    t["E4B"] = stage_table(ex["E4b"])
    o = ex["E5"]["options"]
    rows = ["| الخيار | ساعات العمالة | ساعات الماكينة | العمالة | `LABOR_OH` | `MACHINE_OH` | `SETUP_OH` | الإجمالي |", "|---|---|---|---|---|---|---|---|"]
    lbl = {"a": "(أ) تشغيل فقط للأساسين", "b": "(ب) تشغيل + إعداد للأساسين", "c": "(ج) عمالة تشغيل + إعداد؛ ماكينة تشغيل فقط + مجمع إعداد على ساعات إعداد الماكينة (60)"}
    for k in ("a", "b", "c"):
        c = o[k]["c204"]
        rows.append(f"| {lbl[k]} | {n(o[k]['labor_hours'])} | {n(o[k]['machine_hours'])} | {m(c['labor'])} | {m(c['pools']['LABOR_OH'])} | "
                    f"{m(c['pools']['MACHINE_OH'])} | {m(c['pools']['SETUP_OH']) if 'SETUP_OH' in c['pools'] else '—'} | **{m(c['total'])}** |")
    t["E5"] = "\n".join(rows)
    e6 = ex["E6"]
    t["E6"] = "\n".join([
        "| | الحساب 1 (10 ساعات) | الحساب 2 (11 ساعة) | الفرق المدقق |", "|---|---|---|---|",
        f"| تحويل مضاف (سياسة WC-A) | {m(ex['E2']['policy']['total'])} | {m(e6['policy']['total'])} | {m(e6['delta_added'])} |",
        f"| المنقول للخارج (الإنتاج التام) | {m(s2['to'])} | {m(e6['stage']['to'])} | {m(e6['delta_to'])} |",
        f"| WIP نهاية المرحلة 2 | {m(s2['ewip'])} | {m(e6['stage']['ewip'])} | {m(e6['delta_ewip'])} |"])
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
