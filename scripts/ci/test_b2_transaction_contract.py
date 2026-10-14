"""Offline negative controls: exact transform and actual chain runner argv/exit."""
import json
import os
from pathlib import Path
import shutil
# Execute the fixed repository runner against a disposable fake psql only.
import subprocess  # nosec B404
import tempfile
import unittest
from unittest.mock import patch

from check_b2_transaction_contract import ROOT, MANIFEST, require_program, verify


class B2Controls(unittest.TestCase):
    def test_program_lookup_missing_rejects_before_execution(self):
        for name in ('git', 'bash'):
            with patch('check_b2_transaction_contract.shutil.which', return_value=None):
                with self.assertRaisesRegex(RuntimeError, 'B2_REQUIRED_PROGRAM_MISSING: ' + name):
                    require_program(name)

    def test_program_lookup_uses_resolved_available_path(self):
        with tempfile.TemporaryDirectory() as directory:
            executable = Path(directory) / 'program with spaces'
            executable.touch()
            with patch('check_b2_transaction_contract.shutil.which', return_value=str(executable)):
                self.assertEqual(require_program('git'), str(executable.resolve()))

    def test_program_names_are_allowlisted(self):
        with self.assertRaisesRegex(ValueError, 'B2_PROGRAM_NOT_ALLOWLISTED'):
            require_program('other')

    def test_transform_and_body_mutations(self):
        self.assertEqual(verify(), 9)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            entries = json.loads((ROOT / MANIFEST).read_text())['migrations']
            lock_names = ['tests/fixtures/qc-material-199/SOURCE_LOCK.json',
                          'docs/db/qc-privileged-pause-199/SOURCE_LOCK.json']
            extra = set()
            for name, key in zip(lock_names, ['database_sources', 'sources']):
                extra.update(json.loads((ROOT / name).read_text())[key])
            for name in [MANIFEST, *lock_names, *extra, *(e['path'] for e in entries)]:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / name, target)
            for entry in entries:
                path = root / entry['path']
                original = path.read_bytes()
                for mutation in [b'BEGIN;\n' + original, original + b'COMMIT;\n',
                                 original.replace(b'SET LOCAL', b'SET      ', 1)
                                 if b'SET LOCAL' in original else original + b'-- drift\n']:
                    path.write_bytes(mutation)
                    with self.assertRaisesRegex(ValueError, 'B2_NON_TRANSACTION_BYTE_DRIFT'):
                        verify(root)
                path.write_bytes(original)

    def run_chain(self, rc):
        bash = require_program('bash')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'psql').write_text('#!/bin/bash\nprintf "%s\\n" "$*" >> "$ARGV_LOG"\nexit "$FAKE_RC"\n')
            (root / 'psql').chmod(0o755)
            names = ['194_legacy.sql'] + [f'{n}_candidate.sql' for n in range(195, 204)]
            for name in names:
                (root / name).write_text('SELECT 1;\n')
            (root / 'order').write_text('\n'.join(names) + '\n')
            env = dict(os.environ, PATH=str(root) + os.pathsep + os.environ['PATH'],
                       ARGV_LOG=str(root / 'argv'), FAKE_RC=str(rc), REPORT=str(root / 'report'))
            result = subprocess.run([bash, str(ROOT / 'scripts/ci/fresh-db/run_chain.sh'),  # nosec B603
                                     str(root), str(root / 'order')], env=env,
                                    capture_output=True, text=True, shell=False, timeout=30)
            return result, (root / 'argv').read_text().splitlines(), (root / 'report').read_text()

    def test_chain_wraps_only_b2_and_disables_psqlrc(self):
        result, calls, report = self.run_chain(0)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(len(calls), 10)
        self.assertNotIn('--single-transaction', calls[0])
        for call in calls[1:]:
            self.assertIn('--single-transaction', call)
            self.assertIn('ON_ERROR_STOP=1', call)
            self.assertTrue(call.startswith('-X '))
        self.assertEqual(report.count('PASS '), 10)

    def test_nonzero_exit_without_error_text_is_not_a_pass(self):
        result, _, report = self.run_chain(7)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(report.count('PSQL_EXIT_7'), 10)
        self.assertNotIn('PASS ', report)


if __name__ == '__main__':
    unittest.main()
