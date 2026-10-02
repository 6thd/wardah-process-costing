"""Prove M199's role-template body, then retain the M198 catalog checks."""
import copy
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'docs/db/material-issue-parent-version-198'))
from verify_readback import check

ROLE = 'public.create_role_from_template(uuid,uuid,character varying,uuid)'
QC_MD5 = '5cb026fc706caef1914dbf9a1aa5236b'
PRIOR_MD5 = 'a1f1a85e06a0fe82c2501d3cedd238f0'


def verify(snapshot):
    rows = [r for r in snapshot['functions'] if r['signature'] == ROLE]
    if len(rows) != 1 or rows[0]['prosrc_md5'] != QC_MD5:
        return ['QC_ROLE_TEMPLATE_INSTALLED_BODY_DRIFT']
    normalized = copy.deepcopy(snapshot)
    for row in normalized['functions']:
        if row['signature'] == ROLE:
            row['prosrc_md5'] = PRIOR_MD5
    return check(normalized, 'postgres')


def controls(snapshot):
    # Mutate the real installed readback, including fields never normalized.
    for name, signature, field, value in [
        ('body', ROLE, 'prosrc_md5', '0' * 32),
        ('role_acl', ROLE, 'acl', []),
        ('owner', ROLE, 'owner', 'anon'),
        ('settings', ROLE, 'config', ['search_path=public']),
    ]:
        mutant = copy.deepcopy(snapshot)
        row = next(r for r in mutant['functions'] if r['signature'] == signature)
        row[field] = value
        if not verify(mutant):
            raise SystemExit(f'QC_M198_READBACK_FALSE_GREEN: {name}')
        print(f'QC_M198_READBACK_REFUSED case={name}')
    print('QC_M198_READBACK_CONTROLS_PASS controls=4')


if __name__ == '__main__':
    snapshot = json.load(sys.stdin)
    errors = verify(snapshot)
    if errors:
        raise SystemExit('\n'.join(errors))
    controls(snapshot)
    print('QC_M198_CATALOG_READBACK_PASS functions=22 role_template=M199')
