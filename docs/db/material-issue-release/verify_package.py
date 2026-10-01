"""Validate frozen migration bytes and a gap-free proposed post-189 order."""
import hashlib
import json
from pathlib import Path

package = json.loads(Path('docs/db/material-issue-release/MIGRATION_PACKAGE.json').read_text())
# Literal paths: no file path is constructed from the manifest or environment.
files = [
    (Path('docs/db/material-issue-release/migrations/195_material_issue_scope.sql').read_bytes(),
     Path('docs/db/material-issue-229/195_material_issue_scope_candidate.sql').read_bytes()),
    (Path('docs/db/material-issue-release/migrations/196_material_issue_maintenance.sql').read_bytes(),
     Path('docs/db/material-issue-maintenance-170-154/candidate.sql').read_bytes()),
]
if len(package['migrations']) != len(files) + 1:
    raise SystemExit('FROZEN_MIGRATION_PACKAGE_DRIFT')
for migration, (proposed, source) in zip(package['migrations'], files):
    if proposed != source or hashlib.sha256(proposed).hexdigest() != migration['sha256']:
        raise SystemExit('FROZEN_MIGRATION_PACKAGE_DRIFT')
if package['state'] != 'proposal_not_allocated_or_applied' or package['requires_order'] != list(range(190, 198)):
    raise SystemExit('MIGRATION_ORDER_OR_ALLOCATION_CLAIM_INVALID')
print('MATERIAL_ISSUE_FROZEN_MIGRATION_BYTES_PASS')

# Compatibility replacement is derived only from the frozen function, not a new contract.
source = files[1][1].decode()
start = source.index('CREATE FUNCTION public.rpc_manage_material_issue_setup(')
end = source.index('END $$;', start) + len('END $$;')
original = source[start:end]
old = "ERRCODE='40001',MESSAGE='ISSUE_SETUP_STALE_VERSION'"
if original.count(old) != 3:
    raise SystemExit('STALE_CODE_SOURCE_DRIFT')
expected = original.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1).replace(old, "ERRCODE='P0001',MESSAGE='ISSUE_SETUP_STALE_VERSION'")
compat = Path('docs/db/material-issue-release/migrations/197_material_issue_stale_version.sql').read_text()
start = compat.index('CREATE OR REPLACE FUNCTION public.rpc_manage_material_issue_setup(')
end = compat.index('END $$;', start) + len('END $$;')
if compat[start:end] != expected or hashlib.sha256(compat.encode()).hexdigest() != package['migrations'][2]['sha256']:
    raise SystemExit('STALE_CODE_COMPATIBILITY_DRIFT')
print('MATERIAL_ISSUE_STALE_SQLSTATE_ONLY_DELTA_PASS')
