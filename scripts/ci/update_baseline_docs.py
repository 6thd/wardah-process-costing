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


def update_readme(
    readme: Path,
    baseline: Path,
    cutoff: str,
    counts: dict[str, int],
    generated_date: str,
) -> None:
    text = readme.read_text(encoding="utf-8")

    size_kb = baseline.stat().st_size // 1024
    lines = sum(1 for _ in baseline.open(encoding="utf-8"))
    row = (
        f"| `{baseline.name}` | {generated_date} | {cutoff} "
        f"| {size_kb} KB / {lines:,} سطر |"
    )

    # الحارس القائم على صف الجدول يبقى كما هو.
    text, count = BASELINE_ROW_RE.subn(row, text, count=1)
    if count != 1:
        raise DocUpdateError(
            "Expected exactly one current-baseline table row in README"
        )

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

    readme.write_text(text, encoding="utf-8")


def update_claude(
    claude: Path,
    baseline: Path,
    cutoff: str,
    live_name: str,
    repo_max: str,
    generated_date: str,
) -> None:
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
    claude.write_text(text, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", required=True, type=Path)
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
        # القياسات تُقرأ وتُتحقق قبل لمس أي ملف، فلا تُترك README محدّثة
        # جزئيًا عند JSON تالف.
        counts = load_counts(args.counts)
        update_readme(
            args.readme, args.baseline, args.cutoff, counts, args.generated_date
        )
        update_claude(
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

    print(
        f"✅ وثائق الـBaseline محدّثة: {counts['tables']} جدول · "
        f"{counts['functions']} دالة · {counts['policies']} policy"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
