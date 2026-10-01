"""Failure controls for readback and honest workstation inventory coverage."""
import copy
import json
import sys
import unittest
from datetime import datetime, timezone

from monitor_reconciliation import monitor
from verify_catalog_readback import PACKAGE, compare, verify_sources

INSTALLED_SNAPSHOT = None


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.package = json.loads(PACKAGE.read_text())
        self.snapshot = {'format_version': 1, 'transaction_read_only': 'on', 'server_version_num': 170011,
                         'functions': copy.deepcopy(self.package['catalog_readback']['functions'])}
        for row in self.snapshot['functions']:
            row['owner'] = 'postgres'
            for acl in row['acl']:
                for key in ('grantor', 'grantee'):
                    if acl[key] == '$migration_owner':
                        acl[key] = 'postgres'
        if INSTALLED_SNAPSHOT is not None:
            self.snapshot = copy.deepcopy(INSTALLED_SNAPSHOT)

    def test_sources_and_baseline(self):
        verify_sources(self.package)
        self.assertEqual(compare(self.package, self.snapshot, 'postgres'), [])

    def test_each_security_field_cannot_drift(self):
        mutations = {'prosrc_md5': '0' * 32, 'owner': 'anon', 'language': 'sql', 'kind': 'p',
                     'security_definer': False, 'config': ['search_path=public'], 'acl': [], 'execute': {}}
        target = next(row for row in self.snapshot['functions'] if 'rpc_manage_material_issue_setup(' in row['signature'])
        for field, value in mutations.items():
            with self.subTest(field=field):
                snapshot = copy.deepcopy(self.snapshot)
                row = next(row for row in snapshot['functions'] if row['signature'] == target['signature'])
                row[field] = value
                self.assertTrue(compare(self.package, snapshot, 'postgres'))

    def test_missing_duplicate_and_unexpected_overload(self):
        for operation in ('missing', 'duplicate', 'overload'):
            with self.subTest(operation=operation):
                snapshot = copy.deepcopy(self.snapshot)
                if operation == 'missing':
                    snapshot['functions'].pop()
                elif operation == 'duplicate':
                    snapshot['functions'].append(copy.deepcopy(snapshot['functions'][0]))
                else:
                    snapshot['functions'][0]['signature'] += '(text)'
                self.assertTrue(compare(self.package, snapshot, 'postgres'))

    def test_extra_grant_and_inherited_execution(self):
        for field in ('acl', 'execute'):
            snapshot = copy.deepcopy(self.snapshot)
            row = snapshot['functions'][0]
            if field == 'acl':
                row['acl'].append({'grantee': 'PUBLIC', 'grantor': 'postgres', 'privilege': 'EXECUTE', 'grantable': False})
            else:
                row['execute']['anon'] = True
            self.assertTrue(compare(self.package, snapshot, 'postgres'))

    def test_source_hash_wrong_or_read_only_missing(self):
        package = copy.deepcopy(self.package)
        package['catalog_readback']['functions'][0]['prosrc_md5'] = '0' * 32
        with self.assertRaises(ValueError):
            verify_sources(package)
        self.snapshot['transaction_read_only'] = 'off'
        self.assertTrue(compare(self.package, self.snapshot, 'postgres'))


class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 1, 12, tzinfo=timezone.utc)
        self.org = '00000000-0000-4000-8000-000000000001'
        self.actor = '00000000-0000-4000-8000-000000000002'
        self.event = '00000000-0000-4000-8000-000000000003'
        self.document = {
            'server': {'format_version': 1, 'owner_verified': True, 'transaction_read_only': 'on',
                       'captured_at': self.now.isoformat(), 'events': []},
            'inventory': {'expected_sources': ['station-A'], 'sources': [
                {'source_id': 'station-A', 'org_id': self.org, 'actor_id': self.actor,
                 'observed_at': self.now.isoformat(), 'read_succeeded': True, 'pending': []}]},
        }

    def add_pending(self):
        self.document['inventory']['sources'][0]['pending'].append(
            {'event_id': self.event, 'operation': 'reserve', 'first_observed_at': '2026-10-01T03:00:00Z'})

    def test_complete_empty_roster_is_not_release_approval(self):
        report, code = monitor(self.document, self.now)
        self.assertEqual(code, 0)
        self.assertFalse(report['release_ready'])
        self.assertEqual(report['coverage'], 'declared_sources_only')

    def test_server_absence_never_closes_unknown_event(self):
        self.add_pending()
        report, code = monitor(self.document, self.now)
        self.assertEqual(code, 1)
        self.assertEqual(report['pending'][0]['status'], 'server_unobserved')
        self.assertEqual(report['pending'][0]['alert'], 'over_shift')

    def test_terminal_receipt_still_needs_browser_ack(self):
        self.add_pending()
        for state in ('applied', 'closed'):
            self.document['server']['events'] = [{'org_id': self.org, 'event_id': self.event,
                'actor_id': self.actor, 'operation': 'reserve', 'state': state}]
            report, code = monitor(self.document, self.now)
            self.assertEqual(code, 1)
            self.assertIn('acknowledgement_needed', report['pending'][0]['status'])
            self.assertFalse(report['receipt_or_fence_verified'])

    def test_wrong_actor_and_foreign_org_do_not_resolve(self):
        self.add_pending()
        self.document['server']['events'] = [{'org_id': self.org, 'event_id': self.event,
            'actor_id': self.event, 'operation': 'reserve', 'state': 'closed'}]
        report, _ = monitor(self.document, self.now)
        self.assertEqual(report['pending'][0]['status'], 'identity_or_operation_mismatch')
        self.document['server']['events'][0]['org_id'] = self.event
        report, _ = monitor(self.document, self.now)
        self.assertEqual(report['pending'][0]['status'], 'server_unobserved')

    def test_missing_failed_stale_and_future_inventory_cannot_green(self):
        for case in ('missing', 'failed', 'stale', 'future'):
            document = copy.deepcopy(self.document)
            if case == 'missing':
                document['inventory']['sources'] = []
            elif case == 'failed':
                document['inventory']['sources'][0]['read_succeeded'] = False
            else:
                document['inventory']['sources'][0]['observed_at'] = (
                    '2026-10-01T10:00:00Z' if case == 'stale' else '2026-10-01T13:00:00Z')
            self.assertEqual(monitor(document, self.now)[1], 2)

    def test_unknown_age_and_duplicate_inventory(self):
        self.add_pending()
        self.document['inventory']['sources'][0]['pending'][0]['first_observed_at'] = None
        report, code = monitor(self.document, self.now)
        self.assertEqual(code, 1)
        self.assertEqual(report['pending'][0]['alert'], 'age_unknown')
        self.document['inventory']['sources'].append(copy.deepcopy(self.document['inventory']['sources'][0]))
        with self.assertRaises(ValueError):
            monitor(self.document, self.now)


if __name__ == '__main__':
    if '--installed' in sys.argv:
        sys.argv.remove('--installed')
        INSTALLED_SNAPSHOT = json.load(sys.stdin)
    unittest.main()
