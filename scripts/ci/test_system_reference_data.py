#!/usr/bin/env python3
"""اختبارات عقد البيانات المرجعية النظامية.

تغطي المنطق الخالص: تحميل الـmanifest والتحقق من اتساقه، وقراءة ترويسة اللقطة،
وبناء تعبيرات التمثيل. أما التصدير والتحقق فيلمسان قاعدة حقيقية، ويُغطَّيان في
مسار Fresh DB داخل ci-cd.yml وفي إعادة البناء داخل generate-baseline.yml.
"""

from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("system_reference_data.py")
REPO_MANIFEST = (
    Path(__file__).resolve().parents[2] / "sql" / "baseline" / "system_reference_manifest.yml"
)

_spec = importlib.util.spec_from_file_location("system_reference_data", SCRIPT)
assert _spec and _spec.loader
srd = importlib.util.module_from_spec(_spec)
# التسجيل يسبق التنفيذ: @dataclass يستبطن الوحدة عبر sys.modules أثناء تحليل
# التعليقات التوضيحية، فتحميلها دون تسجيل يفشل بـAttributeError مضلّل.
sys.modules[_spec.name] = srd
_spec.loader.exec_module(srd)


BASE_TABLE = """
version: 1
tables:
  - name: widgets
    predicate: "org_id IS NULL"
    reason: "اختبار"
    order_by: [code]
    conflict_target: [id]
    columns: [id, code, label, created_at, org_id]
    hash_exclude: [created_at]
    min_count: 3
"""


class ManifestLoadingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def write(self, text: str) -> Path:
        path = self.root / "manifest.yml"
        path.write_text(text, encoding="utf-8")
        return path

    def test_valid_manifest_loads_with_order_preserved(self) -> None:
        specs = srd.load_manifest(self.write(BASE_TABLE))
        self.assertEqual([s.name for s in specs], ["widgets"])
        self.assertEqual(specs[0].predicate, "org_id IS NULL")
        self.assertEqual(specs[0].min_count, 3)

    def test_hash_columns_drop_only_excluded(self) -> None:
        spec = srd.load_manifest(self.write(BASE_TABLE))[0]
        self.assertEqual(spec.hash_columns, ("id", "code", "label", "org_id"))

    def test_unsupported_version_is_rejected(self) -> None:
        with self.assertRaises(srd.ContractError):
            srd.load_manifest(self.write(BASE_TABLE.replace("version: 1", "version: 2")))

    def test_empty_table_list_is_rejected(self) -> None:
        with self.assertRaises(srd.ContractError):
            srd.load_manifest(self.write("version: 1\ntables: []\n"))

    def test_duplicate_table_is_rejected(self) -> None:
        with self.assertRaises(srd.ContractError) as ctx:
            srd.load_manifest(self.write(BASE_TABLE + BASE_TABLE.split("tables:")[1]))
        self.assertIn("مكرر", str(ctx.exception))

    def test_order_by_outside_columns_is_rejected(self) -> None:
        # مفتاح ترتيب خارج العقد يجعل البصمة تُحسب على ترتيب غير مُصدَّر، فتختلف
        # بين قاعدتين تحملان البيانات نفسها.
        broken = BASE_TABLE.replace("order_by: [code]", "order_by: [missing_col]")
        with self.assertRaises(srd.ContractError) as ctx:
            srd.load_manifest(self.write(broken))
        self.assertIn("order_by", str(ctx.exception))

    def test_conflict_target_outside_columns_is_rejected(self) -> None:
        broken = BASE_TABLE.replace("conflict_target: [id]", "conflict_target: [nope]")
        with self.assertRaises(srd.ContractError):
            srd.load_manifest(self.write(broken))

    def test_hash_exclude_swallowing_every_column_is_rejected(self) -> None:
        # لو استُثنيت كل الأعمدة لبقيت البصمة ثابتة مهما تغيّر المحتوى — بوابة
        # تمر دائمًا، وهي أسوأ من غياب البوابة لأنها تُطمئن كذبًا.
        broken = BASE_TABLE.replace(
            "hash_exclude: [created_at]",
            "hash_exclude: [id, code, label, created_at, org_id]",
        )
        with self.assertRaises(srd.ContractError) as ctx:
            srd.load_manifest(self.write(broken))
        self.assertIn("بصمة", str(ctx.exception))

    def test_missing_order_by_is_rejected(self) -> None:
        broken = BASE_TABLE.replace("    order_by: [code]\n", "")
        with self.assertRaises(srd.ContractError):
            srd.load_manifest(self.write(broken))

    def test_non_positive_min_count_is_rejected(self) -> None:
        with self.assertRaises(srd.ContractError):
            srd.load_manifest(self.write(BASE_TABLE.replace("min_count: 3", "min_count: 0")))

    def test_duplicate_column_is_rejected(self) -> None:
        broken = BASE_TABLE.replace(
            "columns: [id, code, label, created_at, org_id]",
            "columns: [id, code, code, created_at, org_id]",
        )
        with self.assertRaises(srd.ContractError):
            srd.load_manifest(self.write(broken))


class SnapshotHeaderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "001_snapshot.sql"

    def test_header_rows_and_hashes_are_parsed(self) -> None:
        self.path.write_text(
            "-- migration_cutoff: 148\n"
            "-- table: modules rows=10 sha=671df78c5852b497b59f750212100693\n"
            "-- table: permissions rows=166 sha=2ff15b083f1a734649f05e0691e5460b\n"
            "BEGIN;\n"
            "-- table: ignored rows=1 sha=00000000000000000000000000000000\n",
            encoding="utf-8",
        )
        parsed = srd.parse_snapshot_header(self.path)
        self.assertEqual(parsed["modules"], (10, "671df78c5852b497b59f750212100693"))
        self.assertEqual(parsed["permissions"], (166, "2ff15b083f1a734649f05e0691e5460b"))
        # ما بعد أول سطر غير تعليقي ليس ترويسة: بيان INSERT يحمل نصًا شبيهًا
        # لا يجوز أن يُقرأ عقدًا.
        self.assertNotIn("ignored", parsed)

    def test_snapshot_without_table_lines_is_rejected(self) -> None:
        self.path.write_text("-- migration_cutoff: 148\nBEGIN;\n", encoding="utf-8")
        with self.assertRaises(srd.ContractError):
            srd.parse_snapshot_header(self.path)

    def test_malformed_sha_is_not_accepted(self) -> None:
        self.path.write_text("-- table: modules rows=10 sha=zzzz\n", encoding="utf-8")
        with self.assertRaises(srd.ContractError):
            srd.parse_snapshot_header(self.path)


class ExpressionTests(unittest.TestCase):
    def test_row_expression_quotes_every_column(self) -> None:
        expr = srd._quoted_row_expr(("a", "b"), srd.FIELD_SEP)
        self.assertIn("quote_nullable(a)", expr)
        self.assertIn("quote_nullable(b)", expr)
        self.assertIn(srd.FIELD_SEP, expr)

    def test_sql_literal_escapes_quotes(self) -> None:
        self.assertEqual(srd.sql_literal("it's"), "'it''s'")


class RepositoryManifestTests(unittest.TestCase):
    """الـmanifest المُلتزَم نفسه يجب أن يبقى صالحًا ومغطيًا للجداول الخمسة."""

    def test_repo_manifest_is_valid(self) -> None:
        specs = srd.load_manifest(REPO_MANIFEST)
        self.assertEqual(
            [s.name for s in specs],
            ["modules", "permissions", "uom_categories", "uoms", "uom_aliases"],
            "ترتيب الجداول هو ترتيب الاعتماد بالمفاتيح الأجنبية — لا يُعاد ترتيبه",
        )

    def test_tenant_scoped_tables_are_restricted_to_system_rows(self) -> None:
        # uoms وuom_aliases تحملان صفوف مؤسسات مخصصة في Production. غياب هذا
        # القيد يسحبها إلى لقطة عامة تُطبَّق على كل قاعدة جديدة.
        specs = {s.name: s for s in srd.load_manifest(REPO_MANIFEST)}
        for name in ("uoms", "uom_aliases"):
            self.assertIn("org_id IS NULL", specs[name].predicate, f"{name} بلا قيد نظامي")

    def test_dependency_order_places_parents_first(self) -> None:
        order = [s.name for s in srd.load_manifest(REPO_MANIFEST)]
        for parent, child in (
            ("modules", "permissions"),
            ("uom_categories", "uoms"),
            ("uoms", "uom_aliases"),
        ):
            self.assertLess(
                order.index(parent), order.index(child),
                f"{parent} يجب أن يسبق {child} وإلا فشل التطبيق على قاعدة نظيفة",
            )

    def test_timestamps_are_excluded_from_fingerprints(self) -> None:
        # `ON CONFLICT DO UPDATE SET updated_at=now()` في migration 130 يحرّك
        # الزمن بلا تغيّر دلالي؛ إدخاله في البصمة يولّد إنذارات انحراف كاذبة.
        for spec in srd.load_manifest(REPO_MANIFEST):
            for column in ("created_at", "updated_at"):
                if column in spec.columns:
                    self.assertIn(column, spec.hash_exclude, f"{spec.name}.{column}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
