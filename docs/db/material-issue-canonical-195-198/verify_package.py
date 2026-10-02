"""Check exact canonical bytes and a pinned reviewed acceptance harness offline."""
import argparse
import hashlib
import json
from pathlib import Path
# Git is used only for the fixed, read-only queries in _git_read below.
import subprocess  # nosec B404

ROOT = Path(__file__).resolve().parents[3]
FOLDER = Path(__file__).resolve().parent
BASE = '94400e1b78f7f5f1716568df96dba7cde2558d12'
HARNESS = 'd71a1657739d1660740ac931ef5f48bffbd4476f'
HARNESS_TREE = 'ed2f78616e7b3582206bf39e47dcc94539c73c9f'
EXPECTED = {
    '195_material_issue_scope.sql': 'd906c72a96468d4869d8341e1cc61c8b20383e5dd43284be0070c876c80987ca',
    '196_material_issue_maintenance.sql': 'cf61b346c56b7e18dbe5bbcc994e3494a330ffbacf9315f81863e7796e44c648',
    '197_material_issue_stale_version.sql': 'e7eb602688c2503a9d6313a0d1525d083e3909b74293805947a078d01fb2ff52',
    '198_material_issue_parent_version.sql': '2cf867dfa5c9a473f0e6e05528d0603aa8885736dd31c3210b58030b616240a5',
}


def _verify_state(profile):
    values = {'format_version': 1, 'base_main': BASE,
              'state': 'draft_canonical_allocation', 'baseline_cutoff': 189,
              'apply_order': list(range(190, 199))}
    for key, expected in values.items():
        if profile[key] != expected:
            raise ValueError('CANONICAL_STATE_OR_ORDER_DRIFT')
    flags = {'independent_signoff_pending': True,
             'target_application_verified': False, 'release_ready': False}
    for key, expected in flags.items():
        if profile[key] is not expected:
            raise ValueError('CANONICAL_STATE_OR_ORDER_DRIFT')


def _verify_file_set(profile):
    if profile['harness']['commit'] != HARNESS or profile['harness']['tree'] != HARNESS_TREE:
        raise ValueError('CANONICAL_HARNESS_REVISION_DRIFT')
    expected_paths = ['sql/migrations/' + name for name in EXPECTED]
    if [entry['path'] for entry in profile['migrations']] != expected_paths:
        raise ValueError('CANONICAL_FILE_SET_DRIFT')


def _verify_migration(root, entry, name, digest, harness):
    source = ('docs/db/material-issue-parent-version-198/candidate.sql' if name.startswith('198_')
              else 'docs/db/material-issue-release/migrations/' + name)
    values = {'sha256': digest, 'source_path': source,
              'number': int(name[:3]), 'application_name': name[:-4]}
    for key, expected in values.items():
        if entry[key] != expected:
            raise ValueError('CANONICAL_PROFILE_DRIFT')
    body = (root / entry['path']).read_bytes()
    if hashlib.sha256(body).hexdigest() != digest:
        raise ValueError('CANONICAL_SQL_BYTES_DRIFT')
    if harness is not None and body != (harness / source).read_bytes():
        raise ValueError('CANONICAL_REVIEWED_SOURCE_DRIFT')


def _git_read(harness, query):
    queries = {'head': ('rev-parse', 'HEAD'), 'tree': ('rev-parse', 'HEAD^{tree}'),
               'tracked_status': ('status', '--porcelain', '--untracked-files=no')}
    # Fixed system executable and allowlisted argv; the resolved directory is
    # passed as cwd, never command text. Disable optional writes and fsmonitor.
    argv = ['/usr/bin/git', '--no-optional-locks', '-c', 'core.fsmonitor=false', *queries[query]]
    return subprocess.check_output(  # nosec B603
        argv, cwd=harness.resolve(strict=True), shell=False, text=True, timeout=30).strip()


def _verify_harness(harness):
    if _git_read(harness, 'head') != HARNESS or _git_read(harness, 'tree') != HARNESS_TREE:
        raise ValueError('CANONICAL_HARNESS_CHECKOUT_DRIFT')
    if _git_read(harness, 'tracked_status'):
        raise ValueError('CANONICAL_HARNESS_TRACKED_DRIFT')


def verify(root=ROOT, profile=None, harness=None):
    if profile is None:
        profile = json.loads((FOLDER / 'CANONICAL_PACKAGE.json').read_text())
    _verify_state(profile)
    _verify_file_set(profile)
    for entry, (name, digest) in zip(profile['migrations'], EXPECTED.items()):
        _verify_migration(root, entry, name, digest, harness)
    if harness is not None:
        _verify_harness(harness)
    return profile


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--harness', type=Path)
    args = parser.parse_args()
    verify(harness=args.harness)
    print('CANONICAL_MATERIAL_ISSUE_BYTES_PASS files=4 release_ready=false')
