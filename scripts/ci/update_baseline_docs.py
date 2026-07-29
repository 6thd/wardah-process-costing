#!/usr/bin/env python3
"""تحديث وثائق الـBaseline من مخرجات توليد فعلية.

كان هذا المنطق heredoc داخل `generate-baseline.yml`. فيه عيب متكرر: يستبدل صف
جدول اللقطة في README ويترك سطر المحتوى تحته حاملًا أرقام اللقطة السابقة. فبعد
توليد cutoff 148 بقيت README تصف اللقطة الجديدة بإحصاءات Baseline 121:

    المحتوى: 125 جدول · 216 PK/UNIQUE · ... · 164 دالة · ... · 333 policy

بينما إعادة البناء أعطت 131 جدولًا و201 دالة و316 policy. الأرقام موجودة أصلًا
في `baseline-diagnostics/rebuild-counts.json` — لكن خطوة الوثائق لم تكن تقرأها.

الآن تقرأها، وتفشل بدل الكتابة الصامتة عند أي انحراف. واستُخرج المنطق إلى سكربت
قابل للاختبار لأن العيب من النوع الذي لا يظهر إلا بعد توليد حقيقي على Production.

القياسات المكتوبة هي الثلاثة التي يقيسها حارس إعادة البناء فقط. لا تُشتق أرقام
أخرى — PK/UNIQUE أو FK أو الفهارس أو views أو triggers — فوجودها في وثيقة مرجعية
بلا قياس هو أصل العيب لا علاجه.
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

BASELINE_ROW_RE = re.compile(r"\| `000_schema_baseline_[^`]+\.sql` \|[^\n]+\|")

# صفّ الطبقة الثانية. غيابه من هذا المحدِّث كان يترك README تسمّي لقطة مرجعية
# قديمة بعد كل توليد: الحوكمة تفحص صفّ الـ000 وحده، فلا بوابة تكشف الكذب.
REFERENCE_ROW_RE = re.compile(r"\| `001_system_reference_data_[^`]+\.sql` \|[^\n]+\|")

# ترويسة اللقطة: `-- table: modules rows=10 sha=<md5>`
REFERENCE_TABLE_RE = re.compile(
    r"^--\s+table:\s+[a-z_]+\s+rows=(\d+)\s+sha=[0-9a-f]{32}\s*$", re.MULTILINE
)

COUNTS_RE = re.compile(
    r"^المحتوى المتحقق بعد إعادة البناء: \d+ جدول · \d+ دالة · \d+ policy$",
    re.MULTILINE,
)

COUNT_KEYS = ("tables", "functions", "policies")

CLAUDE_START = "<!-- DATABASE_STATE_START -->"
CLAUDE_END = "<!-- DATABASE_STATE_END -->"


class DocUpdateError(RuntimeError):
    """فشل موصوف بدل كتابة صامتة."""


def load_counts(path: Path) -> dict[str, int]:
    """اقرأ القياسات وتحقق منها قبل أي كتابة."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise DocUpdateError(f"ملف القياسات غير موجود: {path}") from None
    except json.JSONDecodeError as exc:
        raise DocUpdateError(f"ملف القياسات ليس JSON صالحًا: {path} — {exc}") from None

    if not isinstance(raw, dict):
        raise DocUpdateError(f"ملف القياسات ليس كائن JSON: {path}")

    counts: dict[str, int] = {}
    for key in COUNT_KEYS:
        if key not in raw:
            raise DocUpdateError(f"مفتاح مفقود في ملف القياسات: {key}")
        value = raw[key]
        # bool هو subclass من int في بايثون؛ استبعده صراحة.
        if isinstance(value, bool) or not isinstance(value, int):
            raise DocUpdateError(
                f"قيمة {key} ليست عددًا صحيحًا: {value!r}"
            )
        if value < 0:
            raise DocUpdateError(f"قيمة {key} سالبة: {value}")
        counts[key] = value
    return counts


def render_readme(
    readme: Path,
    baseline: Path,
    reference: Path,
    cutoff: str,
    counts: dict[str, int],
    generated_date: str,
) -> str:
    """أعد نص README الجديد دون كتابته.

    الفصل بين التحضير والكتابة مقصود: الكتابة هنا كانت تسبق فحص علامات
    CLAUDE.md، فعلامات مفقودة أو مكررة كانت تترك README محدّثة وحدها.
    """
    text = readme.read_text(encoding="utf-8")

    size_kb = baseline.stat().st_size // 1024
    lines = sum(1 for _ in baseline.open(encoding="utf-8"))
    row = (
        f"| `{baseline.name}` | {generated_date} | {cutoff} "
        f"| {size_kb} KB / {lines:,} سطر |"
    )

    # كان هذا `subn(..., count=1)`: يستبدل الصف الأول ويعيد count == 1 حتى مع
    # وجود صفين، فرسالة "exactly one" كانت أوسع مما يفحصه فعلًا. العدّ أولًا
    # يجعل الرسالة والفحص متطابقين — وREADME مرجع حاكم، فصف لقطة مكرر فيه
    # يعني وصفين متنافسين للحالة الحية.
    rows = BASELINE_ROW_RE.findall(text)
    if len(rows) != 1:
        raise DocUpdateError(
            "Expected exactly one current-baseline table row in README, "
            f"found {len(rows)}"
        )
    text = BASELINE_ROW_RE.sub(lambda _: row, text, count=1)

    matches = COUNTS_RE.findall(text)
    if len(matches) != 1:
        raise DocUpdateError(
            f"يُتوقع سطر محتوى واحد بالضبط في README، وُجد {len(matches)}"
        )

    counts_line = (
        f"المحتوى المتحقق بعد إعادة البناء: {counts['tables']} جدول · "
        f"{counts['functions']} دالة · {counts['policies']} policy"
    )
    text = COUNTS_RE.sub(lambda _: counts_line, text, count=1)

    return _render_reference_row(text, reference, cutoff)


def _render_reference_row(text: str, reference: Path, cutoff: str) -> str:
    """يحدّث صفّ اللقطة المرجعية من ترويسة الملف نفسه لا من وسائط مستقلة.

    الاشتقاق من الترويسة مقصود: العدد المكتوب في README يصير مشتقًا من الملف
    الذي يصفه، فلا يمكن أن يصف صفٌّ لقطةً ويحمل عدد لقطةٍ أخرى.
    """
    rows = REFERENCE_TABLE_RE.findall(reference.read_text(encoding="utf-8"))
    if not rows:
        raise DocUpdateError(f"لا بصمات جداول في ترويسة اللقطة: {reference}")

    row = f"| `{reference.name}` | {cutoff} | {len(rows)} | {sum(int(r) for r in rows)} |"

    matches = REFERENCE_ROW_RE.findall(text)
    if len(matches) != 1:
        raise DocUpdateError(
            "يُتوقع صفّ لقطة مرجعية واحد بالضبط في README، "
            f"وُجد {len(matches)}"
        )
    return REFERENCE_ROW_RE.sub(lambda _: row, text, count=1)


def render_claude(
    claude: Path,
    baseline: Path,
    cutoff: str,
    live_name: str,
    repo_max: str,
    generated_date: str,
) -> str:
    """أعد نص CLAUDE.md الجديد دون كتابته."""
    text = claude.read_text(encoding="utf-8")
    if text.count(CLAUDE_START) != 1 or text.count(CLAUDE_END) != 1:
        raise DocUpdateError(
            "CLAUDE.md database-state markers are missing or duplicated"
        )

    state = (
        f"{CLAUDE_START}\n"
        f"الحالة الحية الموثقة بعد Baseline المولد في {generated_date}:\n\n"
        f"- Baseline الحالي: `{baseline.name}`, cutoff {cutoff}.\n"
        f"- Production: مطبقة حتى {cutoff} (`{live_name}`).\n"
        f"- Repository: أعلى migration مرقمة هي {repo_max}.\n"
        "- Fresh DB: لا توجد migrations معلقة بعد cutoff عند لحظة التوليد.\n"
        "- لا تعدّ أي migration مطبقة حيًا لمجرد نجاح Fresh DB؛ سجل Production هو المرجع.\n"
        f"{CLAUDE_END}"
    )
    pattern = re.compile(
        re.escape(CLAUDE_START) + r".*?" + re.escape(CLAUDE_END), re.S
    )
    text, count = pattern.subn(lambda _: state, text, count=1)
    if count != 1:
        raise DocUpdateError("Failed to replace CLAUDE.md database-state block")
    return text


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", required=True, type=Path)
    # إلزامي لا اختياري: لو جاز إغفاله لعاد الصفّ يشيخ بصمت، وهو العيب نفسه.
    parser.add_argument("--reference", required=True, type=Path)
    parser.add_argument("--counts", required=True, type=Path)
    parser.add_argument("--cutoff", required=True)
    parser.add_argument("--live-name", required=True)
    parser.add_argument("--repo-max", required=True)
    parser.add_argument("--readme", type=Path, default=Path("sql/baseline/README.md"))
    parser.add_argument("--claude", type=Path, default=Path("CLAUDE.md"))
    parser.add_argument(
        "--generated-date",
        default=datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        help="لحقن تاريخ ثابت في الاختبارات",
    )
    args = parser.parse_args()

    try:
        # كل قراءة وتحقق وبناء نص يسبق أي كتابة، فلا يفشل الشوط بعد تعديل
        # وثيقة واحدة. القياسات التالفة، وسطر القياسات المفقود أو المكرر،
        # وصف الجدول الغائب، وعلامات CLAUDE.md المفقودة أو المكررة — كلها
        # تُكتشف والقرص لم يُمس.
        counts = load_counts(args.counts)
        new_readme = render_readme(
            args.readme,
            args.baseline,
            args.reference,
            args.cutoff,
            counts,
            args.generated_date,
        )
        new_claude = render_claude(
            args.claude,
            args.baseline,
            args.cutoff,
            args.live_name,
            args.repo_max,
            args.generated_date,
        )
    except DocUpdateError as exc:
        print(f"❌ {exc}")
        return 1

    # يبقى فشل I/O بين الكتابتين ممكنًا نظريًا؛ ما يمنعه هذا الفصل هو فشل
    # التحقق بعد كتابة جزئية، وهو المسار الواقعي الذي أوجدته الفحوص.
    args.readme.write_text(new_readme, encoding="utf-8")
    args.claude.write_text(new_claude, encoding="utf-8")

    print(
        f"✅ وثائق الـBaseline محدّثة: {counts['tables']} جدول · "
        f"{counts['functions']} دالة · {counts['policies']} policy"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
