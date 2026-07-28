#!/usr/bin/env python3
"""تصدير البيانات المرجعية النظامية والتحقق منها وفق manifest مراجَع.

الخلفية في `sql/baseline/system_reference_manifest.yml`: الـBaseline يُولَّد
بـ`pg_dump --schema-only` فلا يحمل صفًا، وحين يطوي الـcutoff migration بذرت
بيانات مرجعية تضيع بذرتها بصمت. هذه الأداة تولّد الطبقة الثانية وتحرسها.

أمران:

  export  يقرأ الـmanifest، يتحقق أن أعمدة كل جدول في القاعدة تطابق العقد
          حرفيًا، ثم يُصدر ملف INSERT مرتبًا حسب الاعتماد بالمفاتيح الأجنبية،
          ويضمّن في ترويسته عدد صفوف كل جدول وبصمة محتواه.

  verify  يعيد حساب العدد والبصمة من قاعدة معطاة ويقارنهما بالعقد: الحد الأدنى
          من الـmanifest دائمًا، وبصمة اللقطة إن مُرِّر ملفها. ويرفض تسرب أي صف
          org-scoped.

التنفيذ يمر عبر psql لا عبر مشغّل بايثون: quote_nullable في PostgreSQL يقتبس
كل نوع اقتباسًا صحيحًا، فلا يُعاد بناء منطق الاقتباس في بايثون حيث يُخطئ.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import yaml

# فاصل الحقول داخل تمثيل الصف عند حساب البصمة. Unit Separator لأنه لا يظهر في
# بيانات مرجعية نصية، فلا يلتبس محتوى حقل بحدّ بين حقلين — ومن ثم لا يمكن
# لصفّين مختلفين أن يعطيا التمثيل نفسه بإزاحة المحتوى عبر الفاصل.
FIELD_SEP = r"\x1f"

# فاصل السجلات عند قراءة بيانات INSERT المولَّدة. حدود الأسطر لا تصلح إطارًا:
# أي قيمة نصية مسموحة — وصف وحدة أو صلاحية — قد تحمل سطرًا داخليًا، فيطبع psql
# بيان INSERT الواحد على أسطر عدة، ويتحول صف واحد إلى عدة «بيانات» عند التقسيم
# بـsplitlines. النتيجة كانت فشل التصدير على بيانات مرجعية سليمة تمامًا برسالة
# عن عدد لا يطابق، لا عن السبب الحقيقي.
# Record Separator يُمرَّر إلى psql بـ-R فيفصل السجلات صراحةً بدل الاعتماد على
# سطر جديد قد يكون جزءًا من القيمة نفسها.
RECORD_SEP = "\x1e"

# أسماء الجداول والأعمدة تُركَّب في نص SQL مباشرة، إذ لا يقبل PostgreSQL معاملًا
# مربوطًا مكان معرّف. فتُقيَّد صيغتها هنا: المعرّف يصير آمنًا بالبناء لا بالثقة
# في أن الـmanifest مراجَع. (حقل predicate يبقى شرط WHERE حرًا بحكم وظيفته،
# وهو جزء من العقد المراجَع لا مدخل خارجي.)
IDENTIFIER_RE = re.compile(r"^[a-z_][a-z0-9_]*$")

HEADER_TABLE_RE = re.compile(
    r"^--\s+table:\s+(?P<name>[a-z_]+)\s+rows=(?P<rows>\d+)\s+sha=(?P<sha>[0-9a-f]{32})\s*$"
)


class ContractError(RuntimeError):
    """خرق للعقد: يُفشل التصدير أو التحقق ولا يُلتف عليه."""


@dataclass(frozen=True)
class TableSpec:
    name: str
    predicate: str
    reason: str
    order_by: tuple[str, ...]
    conflict_target: tuple[str, ...]
    columns: tuple[str, ...]
    hash_exclude: frozenset[str]
    min_count: int

    @property
    def hash_columns(self) -> tuple[str, ...]:
        return tuple(c for c in self.columns if c not in self.hash_exclude)


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ContractError(message)


def load_manifest(path: Path) -> list[TableSpec]:
    """يقرأ الـmanifest ويتحقق من اتساقه الداخلي قبل لمس أي قاعدة."""
    with path.open(encoding="utf-8") as handle:
        data = yaml.safe_load(handle)

    _require(isinstance(data, dict), f"manifest ليس خريطة: {path}")
    _require(data.get("version") == 1, f"إصدار manifest غير مدعوم: {data.get('version')}")

    raw_tables = data.get("tables")
    _require(
        isinstance(raw_tables, list) and raw_tables,
        "manifest بلا جداول — لقطة مرجعية فارغة لا معنى لها",
    )

    specs: list[TableSpec] = []
    seen: set[str] = set()
    for entry in raw_tables:
        name = entry.get("name")
        _require(isinstance(name, str) and name, "جدول بلا اسم في الـmanifest")
        _require(
            bool(IDENTIFIER_RE.match(name)),
            f"اسم جدول غير قانوني في الـmanifest: {name!r} — يُتوقع [a-z_][a-z0-9_]*",
        )
        _require(name not in seen, f"جدول مكرر في الـmanifest: {name}")
        seen.add(name)

        columns = tuple(entry.get("columns") or ())
        invalid = [c for c in columns if not (isinstance(c, str) and IDENTIFIER_RE.match(c))]
        _require(
            not invalid,
            f"{name}: أسماء أعمدة غير قانونية: {invalid} — يُتوقع [a-z_][a-z0-9_]*",
        )
        order_by = tuple(entry.get("order_by") or ())
        conflict_target = tuple(entry.get("conflict_target") or ())
        hash_exclude = frozenset(entry.get("hash_exclude") or ())

        _require(bool(columns), f"{name}: قائمة الأعمدة فارغة")
        _require(len(set(columns)) == len(columns), f"{name}: عمود مكرر في العقد")
        _require(bool(order_by), f"{name}: بلا order_by — البصمة تحتاج ترتيبًا ثابتًا")
        _require(bool(conflict_target), f"{name}: بلا conflict_target")

        for label, cols in (
            ("order_by", order_by),
            ("conflict_target", conflict_target),
            ("hash_exclude", tuple(sorted(hash_exclude))),
        ):
            unknown = [c for c in cols if c not in columns]
            _require(not unknown, f"{name}: {label} يشير إلى أعمدة خارج العقد: {unknown}")

        min_count = entry.get("min_count")
        _require(
            isinstance(min_count, int) and min_count > 0,
            f"{name}: min_count يجب أن يكون عددًا موجبًا",
        )

        spec = TableSpec(
            name=name,
            predicate=str(entry.get("predicate") or "TRUE"),
            reason=str(entry.get("reason") or ""),
            order_by=order_by,
            conflict_target=conflict_target,
            columns=columns,
            hash_exclude=hash_exclude,
            min_count=min_count,
        )
        _require(
            bool(spec.hash_columns),
            f"{name}: hash_exclude ابتلع كل الأعمدة — لا تبقى بصمة تُحسب",
        )
        specs.append(spec)

    return specs


def psql(
    sql: str,
    *,
    dsn: str | None,
    database: str | None = None,
    record_sep: str | None = None,
) -> str:
    """ينفّذ استعلامًا ويعيد الخرج الخام. يفشل عند أول خطأ.

    `record_sep` يضبط فاصل السجلات في الخرج غير المحاذى، فتُقرأ نتائج متعددة
    الأسطر بلا لبس. يُترك فارغًا للاستعلامات ذات القيمة الواحدة.
    """
    cmd = ["psql", "-v", "ON_ERROR_STOP=1", "-tA", "--no-psqlrc"]
    if record_sep is not None:
        cmd.extend(["-R", record_sep])
    if dsn:
        cmd.append(dsn)
    elif database:
        cmd.extend(["-d", database])
    cmd.extend(["-c", sql])

    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise ContractError(
            f"فشل psql (رمز {result.returncode}):\n{result.stderr.strip()}"
        )
    return result.stdout


def _quoted_row_expr(columns: tuple[str, ...], sep: str) -> str:
    """تمثيل صف نصي عبر quote_nullable لكل عمود، بفاصل صريح."""
    parts = ", ".join(f"quote_nullable({col})" for col in columns)
    return f"concat_ws(E'{sep}', {parts})"


def assert_columns_match(spec: TableSpec, *, dsn: str | None, database: str | None) -> None:
    """يرفض أي انحراف بين أعمدة القاعدة وأعمدة العقد.

    عمود جديد يحمل بيانات مرجعية يجب ألا يسقط من اللقطة بصمت، وعمود محذوف يجب
    ألا يمر بوصفه لا شيء. الاتجاهان يفشلان هنا.
    """
    sql = f"""
        SELECT string_agg(column_name, ',' ORDER BY ordinal_position)
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = {sql_literal(spec.name)}
          AND is_generated = 'NEVER'
    """
    actual_raw = psql(sql, dsn=dsn, database=database).strip()
    _require(bool(actual_raw), f"{spec.name}: الجدول غير موجود في القاعدة")

    actual = tuple(actual_raw.split(","))
    expected = spec.columns
    if actual != expected:
        missing = [c for c in actual if c not in expected]
        extra = [c for c in expected if c not in actual]
        detail = []
        if missing:
            detail.append(f"في القاعدة وغائبة عن العقد: {missing}")
        if extra:
            detail.append(f"في العقد وغائبة عن القاعدة: {extra}")
        if not detail:
            detail.append(f"ترتيب مختلف: قاعدة={actual} عقد={expected}")
        raise ContractError(f"{spec.name}: أعمدة الجدول تخالف الـmanifest — " + "؛ ".join(detail))


def sql_literal(value: str) -> str:
    """اقتباس سلسلة لإدراجها في SQL نبنيه نحن (أسماء جداول من الـmanifest)."""
    escaped = value.replace("'", "''")
    return f"'{escaped}'"


def table_fingerprint(
    spec: TableSpec, *, dsn: str | None, database: str | None
) -> tuple[int, str]:
    """يعيد (عدد الصفوف، بصمة المحتوى) لجدول وفق حدود العقد."""
    row_expr = _quoted_row_expr(spec.hash_columns, FIELD_SEP)
    order_expr = _quoted_row_expr(spec.order_by, FIELD_SEP)

    sql = f"""
        SELECT count(*)::text || ' ' ||
               COALESCE(md5(string_agg(r, E'\\n' ORDER BY k)), 'd41d8cd98f00b204e9800998ecf8427e')
        FROM (
            SELECT {row_expr} AS r, {order_expr} AS k
            FROM public.{spec.name}
            WHERE {spec.predicate}
        ) s
    """
    out = psql(sql, dsn=dsn, database=database).strip()
    _require(bool(out), f"{spec.name}: تعذر حساب البصمة")
    count_text, sha = out.split(" ", 1)
    return int(count_text), sha.strip()


def leaked_org_rows(spec: TableSpec, *, dsn: str | None, database: str | None) -> int:
    """يعدّ الصفوف org-scoped في جدول يقيّده العقد بـ`org_id IS NULL`.

    يعيد -1 إذا كان الجدول بلا عمود org_id أصلًا (لا مجال للتسرب).
    """
    if "org_id" not in spec.columns:
        return -1
    sql = f"SELECT count(*) FROM public.{spec.name} WHERE org_id IS NOT NULL"
    return int(psql(sql, dsn=dsn, database=database).strip() or "0")


def export_table(spec: TableSpec, *, dsn: str | None, database: str | None) -> list[str]:
    """يولّد بيانات INSERT لجدول واحد، مرتبة ترتيبًا ثابتًا."""
    cols_sql = ", ".join(spec.columns)
    values_expr = ", ".join(f"quote_nullable({col})" for col in spec.columns)
    conflict_sql = ", ".join(spec.conflict_target)
    order_sql = ", ".join(spec.order_by)

    sql = f"""
        SELECT format(
                 'INSERT INTO public.%s (%s) VALUES (%s) ON CONFLICT (%s) DO NOTHING;',
                 {sql_literal(spec.name)},
                 {sql_literal(cols_sql)},
                 concat_ws(', ', {values_expr}),
                 {sql_literal(conflict_sql)}
               )
        FROM public.{spec.name}
        WHERE {spec.predicate}
        ORDER BY {order_sql}
    """
    out = psql(sql, dsn=dsn, database=database, record_sep=RECORD_SEP)
    statements = [chunk.strip() for chunk in out.split(RECORD_SEP) if chunk.strip()]

    # فحص بنيوي لا عدَدي. لو حمل حقل فاصلَ السجلات نفسه لانقسم بيانٌ في منتصفه،
    # وعدّ مطابق بالمصادفة كان سيمرّ. اشتراط أن يبدأ كل بيان وينتهي كما وُلِّد
    # يجعل أي خطأ في التأطير يظهر عند موضعه بدل أن يظهر عددًا لا يطابق.
    for index, statement in enumerate(statements, start=1):
        if not statement.startswith(f"INSERT INTO public.{spec.name} ") or not statement.endswith(";"):
            raise ContractError(
                f"{spec.name}: البيان رقم {index} غير مؤطَّر كما وُلِّد — يُرجَّح أن "
                f"قيمة تحمل فاصل السجلات (U+001E). البداية: {statement[:80]!r}"
            )

    return statements


def cmd_export(args: argparse.Namespace) -> int:
    specs = load_manifest(Path(args.manifest))
    dsn, database = args.dsn, args.database

    sections: list[str] = []
    header_rows: list[str] = []

    for spec in specs:
        assert_columns_match(spec, dsn=dsn, database=database)

        leaked = leaked_org_rows(spec, dsn=dsn, database=database)
        count, sha = table_fingerprint(spec, dsn=dsn, database=database)

        if count < spec.min_count:
            raise ContractError(
                f"{spec.name}: {count} صف في المصدر دون الحد الأدنى {spec.min_count} — "
                "لا تُولَّد لقطة ناقصة"
            )

        statements = export_table(spec, dsn=dsn, database=database)
        _require(
            len(statements) == count,
            f"{spec.name}: عدد البيانات المولَّدة {len(statements)} يخالف العدّ {count}",
        )

        header_rows.append(f"-- table: {spec.name} rows={count} sha={sha}")

        leak_note = "" if leaked <= 0 else f" (مستبعَد: {leaked} صف org-scoped)"
        sections.append(
            "\n".join(
                [
                    "-- " + "-" * 66,
                    f"-- {spec.name} — {spec.reason}",
                    f"-- predicate: {spec.predicate}{leak_note}",
                    f"-- rows: {count} · sha: {sha}",
                    "-- " + "-" * 66,
                    *statements,
                    "",
                ]
            )
        )

    body = "\n".join(
        [
            f"-- migration_cutoff: {args.cutoff}",
            "-- system_reference_manifest: version 1",
            "-- " + "=" * 66,
            "-- System Reference Data — الطبقة الثانية من الـBaseline",
            f"-- Generated: {args.generated_at}",
            "-- Source: Production، عبر sql/baseline/system_reference_manifest.yml",
            "-- Generated by: .github/workflows/generate-baseline.yml",
            "--",
            "-- يُطبَّق بعد 000_schema_baseline_*.sql مباشرة ودائمًا بهذا الترتيب.",
            "-- ترتيب الجداول أدناه هو ترتيب الاعتماد بالمفاتيح الأجنبية.",
            "--",
            "-- بصمات المحتوى (تُعاد مطابقتها في CI بعد إعادة البناء):",
            *header_rows,
            "-- " + "=" * 66,
            "",
            "BEGIN;",
            "",
            *sections,
            "COMMIT;",
            "",
        ]
    )

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(body, encoding="utf-8")

    total = sum(int(line.split("rows=")[1].split(" ")[0]) for line in header_rows)
    print(f"✅ لقطة مرجعية: {out_path} — {len(specs)} جدول، {total} صف")
    for line in header_rows:
        print("   " + line.removeprefix("-- "))
    return 0


def parse_snapshot_header(path: Path) -> dict[str, tuple[int, str]]:
    """يستخرج (عدد، بصمة) لكل جدول من ترويسة ملف اللقطة."""
    expected: dict[str, tuple[int, str]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.startswith("--"):
            break
        match = HEADER_TABLE_RE.match(line)
        if match:
            expected[match.group("name")] = (int(match.group("rows")), match.group("sha"))
    _require(bool(expected), f"لا بصمات جداول في ترويسة اللقطة: {path}")
    return expected


def cmd_verify(args: argparse.Namespace) -> int:
    specs = load_manifest(Path(args.manifest))
    dsn, database = args.dsn, args.database

    expected: dict[str, tuple[int, str]] = {}
    if args.snapshot:
        expected = parse_snapshot_header(Path(args.snapshot))
        unknown = sorted(set(expected) - {s.name for s in specs})
        _require(not unknown, f"اللقطة تحمل جداول خارج الـmanifest: {unknown}")

    failures: list[str] = []
    report: dict[str, dict[str, object]] = {}

    for spec in specs:
        assert_columns_match(spec, dsn=dsn, database=database)
        count, sha = table_fingerprint(spec, dsn=dsn, database=database)
        leaked = leaked_org_rows(spec, dsn=dsn, database=database)
        report[spec.name] = {"rows": count, "sha": sha, "leaked_org_rows": max(leaked, 0)}

        if count < spec.min_count:
            failures.append(
                f"{spec.name}: {count} صف دون الحد الأدنى {spec.min_count}"
            )

        # الحد الأدنى يكشف الفراغ والانخفاض، لا التبديل. البصمة تكشف حذف صف
        # وإضافة آخر مكانه، وتغيّر كود وحدة، وتبديل مرادف — بعدد ثابت.
        if spec.name in expected:
            want_rows, want_sha = expected[spec.name]
            if count != want_rows:
                failures.append(
                    f"{spec.name}: {count} صف بينما اللقطة تُوثّق {want_rows}"
                )
            if sha != want_sha:
                failures.append(
                    f"{spec.name}: بصمة المحتوى {sha} تخالف لقطة {want_sha}"
                )
        elif args.snapshot:
            failures.append(f"{spec.name}: غائب عن ترويسة اللقطة")

        # فحص التسرب يخص القاعدة المُعاد بناؤها وحدها. Production يحمل وحدات
        # مؤسسات مخصصة بشكل مشروع — هي ميزة migration 140 لا عطل — فتشغيله
        # هناك بلا هذا الشرط كان سيفشل فشلًا كاذبًا عند أول وحدة يُنشئها مستأجر.
        if args.expect_no_org_rows and leaked > 0:
            failures.append(
                f"{spec.name}: {leaked} صف org-scoped في قاعدة يفترض أن تحمل "
                "بيانات نظامية فقط — اللقطة سحبت ما يتجاوز حدود العقد"
            )

    if args.report:
        Path(args.report).parent.mkdir(parents=True, exist_ok=True)
        Path(args.report).write_text(
            json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

    for name, values in sorted(report.items()):
        print(f"   {name}: rows={values['rows']} sha={values['sha']}")

    if failures:
        print("❌ فشل التحقق من البيانات المرجعية:", file=sys.stderr)
        for failure in failures:
            print(f"   - {failure}", file=sys.stderr)
        return 1

    total = sum(int(v["rows"]) for v in report.values())
    scope = "مطابقة اللقطة" if args.snapshot else "الحدود الدنيا"
    print(f"✅ البيانات المرجعية سليمة ({scope}): {len(report)} جدول، {total} صف")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest",
        default="sql/baseline/system_reference_manifest.yml",
        help="مسار عقد البيانات المرجعية",
    )
    parser.add_argument("--dsn", default=os.environ.get("REFERENCE_DB_URL") or None)
    parser.add_argument("--database", default=None, help="اسم قاعدة محلية بدل DSN")

    sub = parser.add_subparsers(dest="command", required=True)

    export = sub.add_parser("export", help="توليد ملف اللقطة المرجعية")
    export.add_argument("--output", required=True)
    export.add_argument("--cutoff", required=True)
    export.add_argument("--generated-at", required=True)
    export.set_defaults(func=cmd_export)

    verify = sub.add_parser("verify", help="التحقق من قاعدة مقابل العقد واللقطة")
    verify.add_argument("--snapshot", default=None, help="ملف اللقطة لمطابقة البصمات")
    verify.add_argument("--report", default=None, help="مسار تقرير JSON")
    verify.add_argument(
        "--expect-no-org-rows",
        action="store_true",
        help=(
            "يرفض أي صف org-scoped. للقاعدة المُعاد بناؤها من اللقطة فقط — "
            "Production يحمل وحدات مؤسسات مشروعة"
        ),
    )
    verify.set_defaults(func=cmd_verify)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if not args.dsn and not args.database:
        print(
            "❌ لا وجهة قاعدة: مرّر --dsn أو --database أو اضبط REFERENCE_DB_URL",
            file=sys.stderr,
        )
        return 2
    try:
        return int(args.func(args))
    except ContractError as error:
        print(f"❌ {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
