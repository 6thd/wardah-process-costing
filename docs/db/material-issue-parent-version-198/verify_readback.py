"""M198 overlay on the frozen 22-function source-pinned readback profile."""
import argparse
import copy
import json
import sys
from derivation import ROOT, SIGNATURE
from verify_candidate import verify
sys.path.insert(0,str(ROOT / 'docs/db/material-issue-release'))
from verify_catalog_readback import compare

def check(snapshot,owner):
    manifest=verify()
    package=json.loads((ROOT / 'docs/db/material-issue-release/MIGRATION_PACKAGE.json').read_text())
    rows=[r for r in snapshot['functions'] if r['signature']==SIGNATURE]
    if len(rows)!=1 or rows[0]['prosrc_md5']!=manifest['after_prosrc_md5']:
        return ['M198_INSTALLED_BODY_DRIFT']
    # Prove the reviewed new body first; map only that proved hash to the frozen
    # baseline for its existing owner/ACL/settings/signature/other-function checks.
    normalized=copy.deepcopy(snapshot)
    for row in normalized['functions']:
        if row['signature']==SIGNATURE:
            row['prosrc_md5']=manifest['before_prosrc_md5']
    return compare(package,normalized,owner)

if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--expected-owner',required=True)
    args=parser.parse_args()
    if not args.expected_owner.strip() or args.expected_owner=='$migration_owner':
        raise SystemExit('EXPLICIT_OWNER_REQUIRED')
    errors=check(json.load(sys.stdin),args.expected_owner)
    if errors:
        raise SystemExit('\n'.join(errors))
    print('M198_CATALOG_READBACK_PASS functions=22')
