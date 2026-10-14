"""Verify the B2-only byte transform against the immutable pre-B2 Git source."""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
SOURCE = 'd022ba3484d1737c693bab9e2724fab396499a72'
MANIFEST = 'docs/db/m195-203-runner-transactions/SOURCE_TRANSFORM.json'


def verify(root=ROOT):
    data = json.loads((root / MANIFEST).read_text())
    if (data['source_commit'] != SOURCE or data['hosted_verified'] is not False
            or data['production_authorized'] is not False):
        raise ValueError('B2_PROVENANCE_OR_AUTHORIZATION_DRIFT')
    files = [next((ROOT / 'sql/migrations').glob(f'{n}_*.sql')).relative_to(ROOT).as_posix()
             for n in range(195, 204)]
    if [entry['path'] for entry in data['migrations']] != files:
        raise ValueError('B2_FILE_SET_DRIFT')
    for entry in data['migrations']:
        old = subprocess.check_output(
            ['git', '--no-optional-locks', 'show', SOURCE + ':' + entry['path']],
            cwd=ROOT, timeout=30)
        if old.count(b'\nBEGIN;\n') != 1 or old.count(b'\nCOMMIT;\n') != 1:
            raise ValueError('B2_ORIGINAL_TRANSACTION_SHAPE_DRIFT')
        expected = old.replace(b'\nBEGIN;\n', b'\n', 1).replace(b'\nCOMMIT;\n', b'\n', 1)
        current = (root / entry['path']).read_bytes()
        if current != expected:
            raise ValueError('B2_NON_TRANSACTION_BYTE_DRIFT: ' + entry['path'])
        for key, value in [('old_sha256', hashlib.sha256(old).hexdigest()),
                           ('sha256', hashlib.sha256(current).hexdigest()),
                           ('old_bytes', len(old)), ('bytes', len(current))]:
            if entry[key] != value:
                raise ValueError('B2_MANIFEST_DRIFT: ' + key)
    for name, key in [('tests/fixtures/qc-material-199/SOURCE_LOCK.json', 'database_sources'),
                      ('docs/db/qc-privileged-pause-199/SOURCE_LOCK.json', 'sources')]:
        lock = json.loads((root / name).read_text())
        # This gate owns the B2 delta, not unrelated historical source pins.
        required = [*files[:5], 'scripts/ci/fresh-db/run_chain.sh']
        for path in required:
            if hashlib.sha256((root / path).read_bytes()).hexdigest() != lock[key][path]:
                raise ValueError('B2_ACTIVE_SOURCE_LOCK_DRIFT: ' + path)
    return len(files)


if __name__ == '__main__':
    print(f'B2_SOURCE_TRANSFORM_PASS files={verify()} hosted_verified=false production_authorized=false')
