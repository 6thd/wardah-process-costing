"""Canonical artifact and release-state failure controls; no database access."""
import copy
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from verify_package import EXPECTED, FOLDER, ROOT, _git_read, _verify_harness, verify


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='wardah-canonical-controls-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / 'sql/migrations').mkdir(parents=True)
        for name in EXPECTED:
            shutil.copyfile(ROOT / 'sql/migrations' / name, self.root / 'sql/migrations' / name)
        self.profile = json.loads((FOLDER / 'CANONICAL_PACKAGE.json').read_text())

    def test_exact_package(self):
        self.assertFalse(verify(self.root, self.profile)['release_ready'])

    def test_each_canonical_byte_change_is_refused(self):
        for name in EXPECTED:
            path = self.root / 'sql/migrations' / name
            original = path.read_bytes()
            path.write_bytes(original + b'\n-- changed\n')
            with self.assertRaisesRegex(ValueError, 'CANONICAL_SQL_BYTES_DRIFT'):
                verify(self.root, self.profile)
            path.write_bytes(original)

    def test_profile_or_application_name_cannot_hide_drift(self):
        for key, value in [('sha256', '0' * 64), ('application_name', 'wrong'), ('source_path', '../wrong')]:
            profile = copy.deepcopy(self.profile)
            profile['migrations'][0][key] = value
            with self.assertRaisesRegex(ValueError, 'CANONICAL_PROFILE_DRIFT'):
                verify(self.root, profile)

    def test_order_release_or_target_claim_is_refused(self):
        for key, value in [('apply_order', list(range(191, 199))), ('release_ready', True),
                           ('target_application_verified', True), ('independent_signoff_pending', False)]:
            profile = copy.deepcopy(self.profile)
            profile[key] = value
            with self.assertRaisesRegex(ValueError, 'CANONICAL_STATE_OR_ORDER_DRIFT'):
                verify(self.root, profile)

    def test_harness_revision_is_pinned(self):
        profile = copy.deepcopy(self.profile)
        profile['harness']['commit'] = '0' * 40
        with self.assertRaisesRegex(ValueError, 'CANONICAL_HARNESS_REVISION_DRIFT'):
            verify(self.root, profile)

    def test_git_queries_are_fixed_and_paths_are_not_command_text(self):
        directory = self.root / "harness with spaces;$(touch sentinel)"
        directory.mkdir()
        queries = {'head': ['rev-parse', 'HEAD'], 'tree': ['rev-parse', 'HEAD^{tree}'],
                   'tracked_status': ['status', '--porcelain', '--untracked-files=no']}
        with patch('verify_package.subprocess.check_output', return_value='value\n') as run:
            for query, arguments in queries.items():
                self.assertEqual(_git_read(directory, query), 'value')
                run.assert_called_with(
                    ['/usr/bin/git', '--no-optional-locks', '-c', 'core.fsmonitor=false', *arguments],
                    cwd=directory.resolve(), shell=False, text=True, timeout=30)
            run.reset_mock()
            with self.assertRaises(KeyError):
                _git_read(directory, 'checkout')
            run.assert_not_called()

    def test_checkout_and_tracked_drift_remain_refused(self):
        from verify_package import HARNESS, HARNESS_TREE
        for answers, diagnostic in [(['wrong'], 'CHECKOUT'),
                                     ([HARNESS, 'wrong'], 'CHECKOUT'),
                                     ([HARNESS, HARNESS_TREE, ' M changed'], 'TRACKED')]:
            with patch('verify_package._git_read', side_effect=answers):
                with self.assertRaisesRegex(ValueError, 'CANONICAL_HARNESS_' + diagnostic + '_DRIFT'):
                    _verify_harness(self.root)


if __name__ == '__main__':
    unittest.main()
