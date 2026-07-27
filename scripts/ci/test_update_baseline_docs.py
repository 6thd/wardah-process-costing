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

نص لاحق لا يُمس.
"""

CLAUDE_TEMPLATE = """# Manifest

<!-- DATABASE_STATE_START -->
حالة قديمة تُستبدل بالكامل.
<!-- DATABASE_STATE_END -->

بقية المانيفست.
"""


class UpdateBaselineDocsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)

        self.baseline = self.root / "000_schema_baseline_20260727_125744.sql"
        self.baseline.write_text("SELECT 1;\n" * 40, encoding="utf-8")

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

    def run_script(self) -> subprocess.CompletedProcess:
        return subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--baseline", str(self.baseline),
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


if __name__ == "__main__":
    unittest.main()
