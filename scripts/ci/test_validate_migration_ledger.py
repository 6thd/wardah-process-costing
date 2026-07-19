#!/usr/bin/env python3

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("validate_migration_ledger.py")


class MigrationLedgerValidatorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.migrations = self.root / "migrations"
        self.migrations.mkdir()
        for name in (
            "101_first.sql",
            "102_second.sql",
            "121_fail_closed_tenant_isolation.sql",
            "127_latest.sql",
        ):
            (self.migrations / name).write_text("SELECT 1;\n", encoding="utf-8")

        self.exceptions = self.root / "exceptions.json"
        self.exceptions.write_text(
            json.dumps(
                {
                    "allowed_duplicate_names": {
                        "101_first": ["1001", "1002"],
                        "102_second": ["2001", "2002"],
                    },
                    "version_name_aliases": {
                        "3001": {
                            "live_name": "fail_closed_tenant_isolation",
                            "canonical_file": "121_fail_closed_tenant_isolation.sql",
                            "reason": "historical",
                        }
                    },
                }
            ),
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def run_validator(self, ledger: list[dict[str, str]]) -> subprocess.CompletedProcess[str]:
        ledger_file = self.root / "ledger.json"
        ledger_file.write_text(json.dumps({"migrations": ledger}), encoding="utf-8")
        return subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--migrations-dir",
                str(self.migrations),
                "--exceptions",
                str(self.exceptions),
                "--minimum-number",
                "101",
                "--ledger-json",
                str(ledger_file),
            ],
            text=True,
            capture_output=True,
            check=False,
        )

    def canonical_ledger(self) -> list[dict[str, str]]:
        return [
            {"version": "1001", "name": "101_first"},
            {"version": "1002", "name": "101_first"},
            {"version": "2001", "name": "102_second"},
            {"version": "2002", "name": "102_second"},
            {"version": "3001", "name": "fail_closed_tenant_isolation"},
            {"version": "4001", "name": "127_latest"},
        ]

    def test_accepts_exact_historical_duplicates_and_alias(self) -> None:
        result = self.run_validator(self.canonical_ledger())
        self.assertEqual(result.returncode, 0, result.stderr)
        summary = json.loads(result.stdout)
        self.assertEqual(summary["live_cutoff"], 127)
        self.assertEqual(summary["live_file"], "127_latest.sql")
        self.assertEqual(summary["repository_ahead_by"], 0)

    def test_rejects_new_duplicate_name(self) -> None:
        ledger = self.canonical_ledger()
        ledger.insert(-1, {"version": "3500", "name": "121_fail_closed_tenant_isolation"})
        result = self.run_validator(ledger)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unexpected duplicates", result.stderr)

    def test_rejects_unknown_live_name(self) -> None:
        ledger = self.canonical_ledger()
        ledger[-1] = {"version": "4001", "name": "127_wrong_name"}
        result = self.run_validator(ledger)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no exact repository file", result.stderr)

    def test_rejects_noncanonical_new_filename(self) -> None:
        (self.migrations / "128-BadName.sql").write_text("SELECT 1;\n", encoding="utf-8")
        result = self.run_validator(self.canonical_ledger())
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Non-canonical migration filename", result.stderr)

    def test_rejects_stale_exception_contract(self) -> None:
        ledger = [record for record in self.canonical_ledger() if record["version"] != "1002"]
        result = self.run_validator(ledger)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("stale duplicate exceptions", result.stderr)


if __name__ == "__main__":
    unittest.main()
