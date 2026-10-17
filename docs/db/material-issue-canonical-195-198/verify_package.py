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
    '195_material_issue_scope.sql': 'a059271918c5d42fc3edf11f4ff1b0f99a3ae00882c4b673baa467dd10428102',
    '196_material_issue_maintenance.sql': '88578735da82ebb1c9082b79be7621259ccd2584cdd7943abc467ec9533eed33',
    '197_material_issue_stale_version.sql': 'f1536d9b2a339bc79b1e687118c0a10d9c650f7feb10d84e5ce405f8b90b7f2d',
    '198_material_issue_parent_version.sql': '2e0fe396acdbb0a490b8b0b28366d81101926319a7b43a40f51c5e785f716723',
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
    if harness is not None:
        original = (harness / source).read_bytes()
        if original.count(b'\nBEGIN;\n') != 1 or original.count(b'\nCOMMIT;\n') != 1:
            raise ValueError('CANONICAL_REVIEWED_TRANSACTION_SHAPE_DRIFT')
        expected = original.replace(b'\nBEGIN;\n', b'\n', 1).replace(b'\nCOMMIT;\n', b'\n', 1)
        if body != expected:
            raise ValueError('CANONICAL_REVIEWED_SOURCE_DRIFT')


def _git_read(harness, query):
    # Fixed system executable and allowlisted argv; the resolved directory is
    # passed as cwd, never command text. Disable optional writes and fsmonitor.
    directory = harness.resolve(strict=True)
    if query == 'head':
        return subprocess.check_output(
            ['/usr/bin/git', '--no-optional-locks', '-c', 'core.fsmonitor=false', 'rev-parse', 'HEAD'],  # nosec B603
            cwd=directory, shell=False, text=True, timeout=30).strip()
    if query == 'tree':
        return subprocess.check_output(
            ['/usr/bin/git', '--no-optional-locks', '-c', 'core.fsmonitor=false', 'rev-parse', 'HEAD^{tree}'],  # nosec B603
            cwd=directory, shell=False, text=True, timeout=30).strip()
    if query == 'tracked_status':
        return subprocess.check_output(
            ['/usr/bin/git', '--no-optional-locks', '-c', 'core.fsmonitor=false',  # nosec B603
             'status', '--porcelain', '--untracked-files=no'],
            cwd=directory, shell=False, text=True, timeout=30).strip()
    raise KeyError(query)


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
