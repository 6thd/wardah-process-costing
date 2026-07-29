#!/usr/bin/env python3
"""اختبارات أداة تحديث وثائق الـBaseline.

الحالة السالبة هي الأهم هنا: العيب الأصلي لم يكن خطأً صاخبًا بل **كتابة صامتة**
تركت README تصف لقطة بأرقام لقطة أخرى. فالاختبارات تثبت الفشل بقدر ما تثبت
النجاح.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("update_baseline_docs.py")

COUNTS_LINE_OLD = "المحتوى المتحقق بعد إعادة البناء: 125 جدول · 164 دالة · 333 policy"
COUNTS_LINE_NEW = "المحتوى المتحقق بعد إعادة البناء: 131 جدول · 201 دالة · 316 policy"

README_TEMPLATE = """# Baseline

| الملف | تاريخ التوليد | migration_cutoff | الحجم |
|---|---|---|---|
| `000_schema_baseline_20260717.sql` | 2026-07-17 | 121 | 611 KB / 13,521 سطر |

{counts_line}

## البيانات المرجعية الحالية

| الملف | migration_cutoff | الجداول | الصفوف |
|---|---|---|---|
| `001_system_reference_data_20260717.sql` | 121 | 5 | 200 |

نص لاحق لا يُمس.
"""

REFERENCE_HEADER = """-- migration_cutoff: 148
-- table: modules rows=10 sha={z}
-- table: permissions rows=166 sha={z}
-- table: uom_categories rows=6 sha={z}
-- table: uoms rows=17 sha={z}
-- table: uom_aliases rows=59 sha={z}
BEGIN;
COMMIT;
""".format(z="0" * 32)

CLAUDE_TEMPLATE = """# Manifest

<!-- DATABASE_STATE_START -->
حالة قديمة تُستبدل بالكامل.
<!-- DATABASE_STATE_END -->

بقية المانيفست.
"""


class UpdateBaselineDocsTests(unittest.TestCase):
    def setUp(self) -> None:
        # enterContext هو اصطلاح unittest منذ 3.11 لمدير سياق يمتد من setUp إلى
        # نهاية الاختبار — حيث لا يصلح `with` لأن النطاق ينتهي قبل بدء الاختبار.
        # يعادل TemporaryDirectory() + addCleanup(cleanup) في سطر واحد.
        #
        # الكتم موضعي ولازم: consider-using-with يعلّم الاستدعاء المُخصِّص نفسه
        # ولا يرى أن enterContext تتكفل بالإغلاق، فيبقى يطلق حتى مع الاصطلاح
        # الصحيح.
        # pylint: disable-next=consider-using-with
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))

        self.baseline = self.root / "000_schema_baseline_20260727_125744.sql"
        self.baseline.write_text("SELECT 1;\n" * 40, encoding="utf-8")

        self.reference = self.root / "001_system_reference_data_20260727_125744.sql"
        self.reference.write_text(REFERENCE_HEADER, encoding="utf-8")

        self.counts = self.root / "rebuild-counts.json"
        self.write_counts({"tables": 131, "functions": 201, "policies": 316})

        self.readme = self.root / "README.md"
        self.readme.write_text(
            README_TEMPLATE.format(counts_line=COUNTS_LINE_OLD), encoding="utf-8"
        )

        self.claude = self.root / "CLAUDE.md"
        self.claude.write_text(CLAUDE_TEMPLATE, encoding="utf-8")

    def write_counts(self, payload) -> None:
        if isinstance(payload, str):
            self.counts.write_text(payload, encoding="utf-8")
        else:
            self.counts.write_text(json.dumps(payload), encoding="utf-8")

    def break_fixture(self, label: str) -> None:
        """أفسد مُعطى الاختبار الموصوف بـ`label`.

        دالة لا جدول دوال: الحلقة المستدعية تعيد `setUp()` قبل كل حالة، فتتغير
        مسارات الملفات. أي مرجع يُربط وقت البناء — `self.counts.unlink` مثلًا —
        يظل معلقًا بمجلد مؤقت سابق فيفسد الحالة الخطأ ويمر الاختبار كذبًا.
        الاستدعاء هنا يحلّ الاسم وقت النداء، بعد `setUp()`.
        """
        if label == "counts-missing":
            self.counts.unlink()
        elif label == "counts-invalid-json":
            self.write_counts("{not json")
        elif label == "counts-missing-key":
            self.write_counts({"tables": 1})
        elif label == "counts-not-int":
            self.write_counts(
                {"tables": 131, "functions": 201, "policies": "316"}
            )
        elif label == "readme-counts-line-missing":
            self.readme.write_text(
                README_TEMPLATE.format(counts_line="لا سطر قياسات"),
                encoding="utf-8",
            )
        elif label == "claude-markers-missing":
            self.claude.write_text("بلا علامات.\n", encoding="utf-8")
        else:
            raise AssertionError(f"حالة إفساد غير معروفة: {label}")

    def run_script(self) -> subprocess.CompletedProcess:
        return subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--baseline", str(self.baseline),
                "--reference", str(self.reference),
                "--counts", str(self.counts),
                "--cutoff", "148",
                "--live-name", "148_uom_purchase_receipt_snapshots",
                "--repo-max", "148",
                "--readme", str(self.readme),
                "--claude", str(self.claude),
                "--generated-date", "2026-07-27",
            ],
            capture_output=True,
            text=True,
            check=False,
        )

    # ---------- الحالة الموجبة ----------

    def test_updates_counts_and_baseline_row(self) -> None:
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

        readme = self.readme.read_text(encoding="utf-8")
        self.assertIn(COUNTS_LINE_NEW, readme)
        self.assertNotIn(COUNTS_LINE_OLD, readme)

        # صف الجدول يتحدث في النقلة نفسها — وهذا هو العيب الأصلي:
        # الصف كان يتحدث وحده بينما يبقى سطر القياسات قديمًا.
        self.assertIn("`000_schema_baseline_20260727_125744.sql`", readme)
        self.assertIn("| 2026-07-27 | 148 |", readme)
        self.assertNotIn("`000_schema_baseline_20260717.sql`", readme)

        self.assertIn("نص لاحق لا يُمس.", readme)

    def test_updates_claude_state_block(self) -> None:
        self.assertEqual(self.run_script().returncode, 0)
        claude = self.claude.read_text(encoding="utf-8")
        self.assertIn("cutoff 148", claude)
        self.assertIn("148_uom_purchase_receipt_snapshots", claude)
        self.assertNotIn("حالة قديمة تُستبدل بالكامل.", claude)
        self.assertIn("بقية المانيفست.", claude)

    # ---------- الحالات السالبة ----------

    def test_fails_when_counts_line_missing(self) -> None:
        self.readme.write_text(
            README_TEMPLATE.format(counts_line="لا سطر قياسات هنا"), encoding="utf-8"
        )
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertIn("سطر محتوى واحد بالضبط", result.stdout)

    def test_fails_when_counts_line_duplicated(self) -> None:
        self.readme.write_text(
            README_TEMPLATE.format(
                counts_line=f"{COUNTS_LINE_OLD}\n\n{COUNTS_LINE_OLD}"
            ),
            encoding="utf-8",
        )
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertIn("سطر محتوى واحد بالضبط", result.stdout)

    def test_fails_when_counts_file_missing(self) -> None:
        self.counts.unlink()
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertIn("غير موجود", result.stdout)

    def test_fails_on_invalid_json(self) -> None:
        self.write_counts("{not json")
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertIn("ليس JSON صالحًا", result.stdout)

    def test_fails_on_missing_key(self) -> None:
        self.write_counts({"tables": 131, "functions": 201})
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertIn("policies", result.stdout)

    def test_fails_on_non_integer_value(self) -> None:
        for bad in ("316", 316.5, None, True):
            with self.subTest(bad=bad):
                self.write_counts(
                    {"tables": 131, "functions": 201, "policies": bad}
                )
                result = self.run_script()
                self.assertEqual(result.returncode, 1, f"قُبلت قيمة {bad!r}")
                self.assertIn("ليست عددًا صحيحًا", result.stdout)

    def test_fails_when_baseline_row_missing(self) -> None:
        self.readme.write_text(
            f"# Baseline\n\nبلا جدول.\n\n{COUNTS_LINE_OLD}\n", encoding="utf-8"
        )
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertIn("current-baseline table row", result.stdout)
        self.assertIn("found 0", result.stdout)

    def test_fails_when_baseline_row_duplicated(self) -> None:
        """صفّا لقطة في README يعنيان وصفين متنافسين للحالة الحية.

        `subn(count=1)` كان يستبدل الأول ويعيد count == 1، فيمر التكرار صامتًا
        تاركًا صفًا ثانيًا يصف لقطة أخرى في مرجع حاكم.
        """
        readme = README_TEMPLATE.format(counts_line=COUNTS_LINE_OLD).replace(
            "| `000_schema_baseline_20260717.sql` | 2026-07-17 | 121 "
            "| 611 KB / 13,521 سطر |",
            "| `000_schema_baseline_20260717.sql` | 2026-07-17 | 121 "
            "| 611 KB / 13,521 سطر |\n"
            "| `000_schema_baseline_20260101.sql` | 2026-01-01 | 99 "
            "| 400 KB / 9,000 سطر |",
        )
        self.readme.write_text(readme, encoding="utf-8")
        readme_before = self.readme.read_text(encoding="utf-8")
        claude_before = self.claude.read_text(encoding="utf-8")

        result = self.run_script()

        self.assertEqual(result.returncode, 1)
        self.assertIn("current-baseline table row", result.stdout)
        self.assertIn("found 2", result.stdout)
        self.assertEqual(self.readme.read_text(encoding="utf-8"), readme_before)
        self.assertEqual(self.claude.read_text(encoding="utf-8"), claude_before)

    def test_does_not_write_readme_when_counts_invalid(self) -> None:
        """JSON تالف يجب ألا يترك README محدّثة جزئيًا."""
        self.write_counts("{not json")
        before = self.readme.read_text(encoding="utf-8")
        self.assertEqual(self.run_script().returncode, 1)
        self.assertEqual(self.readme.read_text(encoding="utf-8"), before)

    def test_claude_markers_duplicated_fails(self) -> None:
        self.claude.write_text(
            CLAUDE_TEMPLATE + CLAUDE_TEMPLATE, encoding="utf-8"
        )
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertIn("markers are missing or duplicated", result.stdout)

    # ---------- ذرّية الكتابة عبر الوثيقتين ----------

    def test_invalid_claude_does_not_modify_readme(self) -> None:
        """CLAUDE.md تالفة يجب ألا تترك README مكتوبة.

        هذا هو المسار الذي كان مفتوحًا: README تُكتب أولًا، ثم تُفحص علامات
        CLAUDE.md وتفشل — فتبقى وثيقة واحدة محدّثة والعملية فاشلة.
        """
        self.claude.write_text("بلا علامات إطلاقًا.\n", encoding="utf-8")
        readme_before = self.readme.read_text(encoding="utf-8")

        result = self.run_script()

        self.assertEqual(result.returncode, 1)
        self.assertIn("markers are missing or duplicated", result.stdout)
        self.assertEqual(
            self.readme.read_text(encoding="utf-8"),
            readme_before,
            "README تغيّرت رغم فشل الشوط على CLAUDE.md",
        )

    def test_no_document_is_written_on_any_validation_failure(self) -> None:
        """تعميم: أي فشل تحقق يترك الوثيقتين كما كانتا."""
        readme_ok = self.readme.read_text(encoding="utf-8")
        claude_ok = self.claude.read_text(encoding="utf-8")

        for label in (
            "counts-missing",
            "counts-invalid-json",
            "counts-missing-key",
            "counts-not-int",
            "readme-counts-line-missing",
            "claude-markers-missing",
        ):
            with self.subTest(case=label):
                self.setUp()
                self.break_fixture(label)
                readme_before = self.readme.read_text(encoding="utf-8")
                claude_before = self.claude.read_text(encoding="utf-8")

                self.assertEqual(self.run_script().returncode, 1)

                self.assertEqual(
                    self.readme.read_text(encoding="utf-8"),
                    readme_before,
                    f"README كُتبت رغم فشل {label}",
                )
                self.assertEqual(
                    self.claude.read_text(encoding="utf-8"),
                    claude_before,
                    f"CLAUDE.md كُتبت رغم فشل {label}",
                )

        # سلامة الحالة الموجبة بعد كل ما سبق.
        self.setUp()
        self.assertEqual(self.readme.read_text(encoding="utf-8"), readme_ok)
        self.assertEqual(self.claude.read_text(encoding="utf-8"), claude_ok)
        self.assertEqual(self.run_script().returncode, 0)

    # ---------- صفّ اللقطة المرجعية ----------
    #
    # الطبقتان تتلازمان بالعقد. وكان هذا المحدِّث يعرف صفّ الـ000 وحده، فيترك
    # README تسمّي لقطة مرجعية قديمة بعد كل توليد — والحوكمة تفحص صفّ الـ000
    # وحده كذلك، فلا بوابة تكشف الكذب. المشغّل الذي يتبع README كان يُوجَّه إلى
    # زوج غير مقترن بينما العقد يشترط تطابق الطابع.

    def test_updates_reference_row(self) -> None:
        self.assertEqual(self.run_script().returncode, 0)
        readme = self.readme.read_text(encoding="utf-8")
        self.assertIn(
            "| `001_system_reference_data_20260727_125744.sql` | 148 | 5 | 258 |", readme
        )
        self.assertNotIn("001_system_reference_data_20260717.sql", readme)

    def test_reference_counts_come_from_the_snapshot_not_arguments(self) -> None:
        # العدد المكتوب يُشتق من ترويسة الملف الذي يصفه، فلا يمكن لصفٍّ أن يسمّي
        # لقطةً ويحمل عدد لقطةٍ أخرى.
        self.reference.write_text(
            "-- table: modules rows=3 sha=" + "0" * 32 + "\n"
            "-- table: permissions rows=4 sha=" + "0" * 32 + "\n",
            encoding="utf-8",
        )
        self.assertEqual(self.run_script().returncode, 0)
        self.assertIn(
            "| `001_system_reference_data_20260727_125744.sql` | 148 | 2 | 7 |",
            self.readme.read_text(encoding="utf-8"),
        )

    def test_fails_when_reference_row_missing(self) -> None:
        text = self.readme.read_text(encoding="utf-8").replace(
            "| `001_system_reference_data_20260717.sql` | 121 | 5 | 200 |", ""
        )
        self.readme.write_text(text, encoding="utf-8")
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertIn("صفّ لقطة مرجعية واحد بالضبط", result.stdout)

    def test_fails_when_reference_row_duplicated(self) -> None:
        row = "| `001_system_reference_data_20260717.sql` | 121 | 5 | 200 |"
        text = self.readme.read_text(encoding="utf-8").replace(row, row + "\n" + row)
        self.readme.write_text(text, encoding="utf-8")
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertIn("صفّ لقطة مرجعية واحد بالضبط", result.stdout)

    def test_fails_when_snapshot_header_carries_no_tables(self) -> None:
        self.reference.write_text("-- migration_cutoff: 148\nBEGIN;\n", encoding="utf-8")
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertIn("لا بصمات جداول", result.stdout)

    def test_reference_failure_leaves_both_documents_untouched(self) -> None:
        # الفصل بين التحضير والكتابة يشمل هذا الصفّ أيضًا: فشل متأخر في README
        # يجب ألا يترك CLAUDE.md مكتوبة وحدها.
        readme_before = self.readme.read_text(encoding="utf-8")
        claude_before = self.claude.read_text(encoding="utf-8")
        self.reference.write_text("-- migration_cutoff: 148\n", encoding="utf-8")
        self.assertEqual(self.run_script().returncode, 1)
        self.assertEqual(self.readme.read_text(encoding="utf-8"), readme_before)
        self.assertEqual(self.claude.read_text(encoding="utf-8"), claude_before)


if __name__ == "__main__":
    unittest.main()
