"""Mutations must remove the exact reviewed delegation credit, not broaden it."""
from pathlib import Path
import shutil
import tempfile
import unittest

import check_definer_guards as scanner

ROOT = Path(__file__).resolve().parents[2]


class ReviewedDelegationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='wardah-delegation-controls-')
        self.addCleanup(self.directory.cleanup)
        self.folder = Path(self.directory.name)
        for name in scanner.REVIEWED_MATERIAL_ISSUE_FILES:
            shutil.copyfile(ROOT / 'sql/migrations' / name, self.folder / name)

    def errors(self, name='196_material_issue_maintenance.sql'):
        return scanner.check_file(self.folder / name)

    def test_exact_package_passes_all_four_files(self):
        for name in scanner.REVIEWED_MATERIAL_ISSUE_FILES:
            self.assertEqual(self.errors(name), [], name)

    def test_each_dependency_drift_removes_credit(self):
        for name in scanner.REVIEWED_MATERIAL_ISSUE_FILES:
            path = self.folder / name
            original = path.read_bytes()
            path.write_bytes(original + b'\n-- changed artifact\n')
            self.assertTrue(self.errors(), name)
            path.write_bytes(original)

    def test_each_missing_dependency_removes_credit(self):
        for name in scanner.REVIEWED_MATERIAL_ISSUE_FILES:
            path = self.folder / name
            original = path.read_bytes()
            path.unlink()
            target = ('197_material_issue_stale_version.sql'
                      if name.startswith('196_') else '196_material_issue_maintenance.sql')
            self.assertTrue(self.errors(target), name)
            path.write_bytes(original)

    def test_guard_removal_and_public_regrant_are_refused(self):
        path = self.folder / '196_material_issue_maintenance.sql'
        original = path.read_text()
        for mutant in (
            original.replace('PERFORM wardah_internal.assert_issue_maintenance_permission', 'PERFORM wardah_internal.not_an_assertion'),
            original + '\nGRANT EXECUTE ON FUNCTION public.rpc_manage_material_issue_setup(uuid,uuid,jsonb,uuid) TO PUBLIC;\n',
        ):
            path.write_text(mutant)
            self.assertTrue(self.errors())
        path.write_text(original)

    def test_new_filename_does_not_inherit_review(self):
        target = self.folder / '199_unreviewed_replacement.sql'
        shutil.copyfile(self.folder / '196_material_issue_maintenance.sql', target)
        self.assertTrue(scanner.check_file(target))

    def test_unreviewed_overload_is_refused(self):
        path = self.folder / '196_material_issue_maintenance.sql'
        path.write_text(path.read_text() + '''
CREATE FUNCTION public.rpc_manage_material_issue_setup(uuid,uuid,jsonb,text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN PERFORM wardah_internal.assert_issue_maintenance_permission($1,'anything'); END $$;
''')
        errors = self.errors()
        self.assertTrue(any('uuid,uuid,jsonb,text' in error for error in errors))


if __name__ == '__main__':
    unittest.main()
