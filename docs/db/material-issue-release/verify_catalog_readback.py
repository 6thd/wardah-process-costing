"""Offline comparison of an operator-exported catalog; never connects to a DB."""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PACKAGE = ROOT / 'docs/db/material-issue-release/MIGRATION_PACKAGE.json'
SOURCES = (
    ROOT / 'sql/migrations/192_material_consumption_retry_and_policy.sql',
    ROOT / 'sql/migrations/193_posted_material_history_delete_guard.sql',
    ROOT / 'sql/migrations/194_stage_wip_posted_cost_boundary.sql',
    ROOT / 'docs/db/material-issue-release/migrations/195_material_issue_scope.sql',
    ROOT / 'docs/db/material-issue-release/migrations/196_material_issue_maintenance.sql',
    ROOT / 'docs/db/material-issue-release/migrations/197_material_issue_stale_version.sql',
)
FUNCTION = re.compile(
    r'CREATE (?:OR REPLACE )?FUNCTION\s+(?P<name>\w+\.\w+)\s*\((?P<args>.*?)\)\s*'
    r'RETURNS.*?\bAS\s+(?P<tag>\$\w*\$)(?P<body>.*?)(?P=tag)\s*;', re.S | re.I)


def source_fingerprints():
    """Last reviewed definition wins; never learn expectations from the target."""
    result = {}
    for path in SOURCES:
        for match in FUNCTION.finditer(path.read_text()):
            args = [re.sub(r'\s+DEFAULT\s+.*', '', arg.strip(), flags=re.I).split(' ', 1)[1]
                    for arg in match['args'].split(',') if arg.strip()]
            signature = match['name'] + '(' + ','.join(args) + ')'
            result[signature] = {
                'source_path': str(path.relative_to(ROOT)),
                'prosrc_md5': hashlib.md5(match['body'].encode()).hexdigest(),
            }
    return result


def verify_sources(package):
    expected = package['catalog_readback']['functions']
    fingerprints = source_fingerprints()
    if len({entry['signature'] for entry in expected}) != len(expected):
        raise ValueError('DUPLICATE_CATALOG_EXPECTATION')
    if set(fingerprints) != {entry['signature'] for entry in expected}:
        raise ValueError('CATALOG_SOURCE_COVERAGE_DRIFT')
    for entry in expected:
        if any(entry[key] != value for key, value in fingerprints[entry['signature']].items()):
            raise ValueError('CATALOG_SOURCE_FINGERPRINT_DRIFT: ' + entry['signature'])


def normalized_acl(acl, owner):
    return sorted((
        owner if entry['grantee'] == '$migration_owner' else entry['grantee'],
        owner if entry['grantor'] == '$migration_owner' else entry['grantor'],
        entry['privilege'], entry['grantable'],
    ) for entry in acl)


def compare(package, snapshot, owner):
    verify_sources(package)
    errors = []
    if snapshot.get('format_version') != 1 or snapshot.get('transaction_read_only') != 'on':
        errors.append('READ_ONLY_SNAPSHOT_REQUIRED')
    if not 170000 <= snapshot.get('server_version_num', 0) < 180000:
        errors.append('PG17_PROFILE_REQUIRED')
    expected = {entry['signature']: entry for entry in package['catalog_readback']['functions']}
    rows = snapshot.get('functions', [])
    actual = {row['signature']: row for row in rows}
    if len(actual) != len(rows):
        errors.append('DUPLICATE_CATALOG_ROW')
    for signature in sorted(set(expected) - set(actual)):
        errors.append('FUNCTION_MISSING: ' + signature)
    for signature in sorted(set(actual) - set(expected)):
        errors.append('UNEXPECTED_OVERLOAD_OR_FUNCTION: ' + signature)
    for signature in sorted(set(actual) & set(expected)):
        want, got = expected[signature], actual[signature]
        for key in ('prosrc_md5', 'language', 'kind', 'security_definer', 'execute'):
            if got.get(key) != want[key]:
                errors.append(key.upper() + '_MISMATCH: ' + signature)
        if got.get('owner') != owner:
            errors.append('OWNER_MISMATCH: ' + signature)
        if sorted(got.get('config', [])) != sorted(want['config']):
            errors.append('CONFIG_MISMATCH: ' + signature)
        if normalized_acl(got.get('acl', []), owner) != normalized_acl(want['acl'], owner):
            errors.append('ACL_MISMATCH: ' + signature)
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expected-owner', required=True, help='Independently approved migration owner, never auto-detected')
    args = parser.parse_args()
    try:
        if not args.expected_owner.strip() or args.expected_owner == '$migration_owner':
            raise ValueError('EXPLICIT_OWNER_REQUIRED')
        package = json.loads(PACKAGE.read_text())
        snapshot = json.load(sys.stdin)
        errors = compare(package, snapshot, args.expected_owner)
    except (ValueError, KeyError, TypeError, AttributeError) as error:
        print('CATALOG_READBACK_INVALID: ' + str(error), file=sys.stderr)
        return 2
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        return 1
    print('MATERIAL_ISSUE_CATALOG_READBACK_PASS functions=' + str(len(snapshot['functions'])))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
