"""Canonical artifact and release-state failure controls; no database access."""
import copy
import json
from pathlib import Path
import shutil
import tempfile
import unittest

from verify_package import EXPECTED, FOLDER, ROOT, verify


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


if __name__ == '__main__':
    unittest.main()
