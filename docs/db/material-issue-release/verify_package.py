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
if len(package['migrations']) != len(files):
    raise SystemExit('FROZEN_MIGRATION_PACKAGE_DRIFT')
for migration, (proposed, source) in zip(package['migrations'], files):
    if proposed != source or hashlib.sha256(proposed).hexdigest() != migration['sha256']:
        raise SystemExit('FROZEN_MIGRATION_PACKAGE_DRIFT')
if package['state'] != 'proposal_not_allocated_or_applied' or package['requires_order'] != list(range(190, 197)):
    raise SystemExit('MIGRATION_ORDER_OR_ALLOCATION_CLAIM_INVALID')
print('MATERIAL_ISSUE_FROZEN_MIGRATION_BYTES_PASS')
