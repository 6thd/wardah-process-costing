"""Retain frozen M199/M198 comparison and add other-function mutation controls."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
from verify_inputs import verify

if len(sys.argv)!=2: raise SystemExit('USAGE: verify_catalog.py CLEAN_PINNED_CLIENT')
client=Path(sys.argv[1]).resolve()
verify(client)
spec=importlib.util.spec_from_file_location('frozen_qc_overlay',client/'docs/db/material-issue-quality-integration/verify_readback.py')
overlay=importlib.util.module_from_spec(spec)
spec.loader.exec_module(overlay)
snapshot=json.load(sys.stdin)
errors=overlay.verify(snapshot)
if errors: raise SystemExit('\n'.join(errors))
overlay.controls(snapshot)
other=next(r for r in snapshot['functions'] if r['signature'].startswith('public.rpc_consume_material_event('))
for name,field,value in (('other_body','prosrc_md5',overlay.QC_MD5),('other_acl','acl',[])):
 mutant=copy.deepcopy(snapshot)
 next(r for r in mutant['functions'] if r['signature']==other['signature'])[field]=value
 if not overlay.verify(mutant): raise SystemExit('QC_MATERIAL_CATALOG_FALSE_GREEN: '+name)
 print('QC_MATERIAL_CATALOG_REFUSED case='+name)
print('QC_MATERIAL_199_CATALOG_PASS functions=22 controls=6 role_template=M199')
