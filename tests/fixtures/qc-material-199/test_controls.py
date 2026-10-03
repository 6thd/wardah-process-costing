"""Real input/connection refusal controls; no connection to any target."""
import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from unittest.mock import patch
import bridge
import verify_inputs

HERE=Path(__file__).resolve().parent
client=Path(sys.argv[1]).resolve()
base={'PGHOST':'127.0.0.1','PGPORT':'55439','PGDATABASE':'wardah_issue_parent_198_canonical_qc199_control'}
for key in ('DATABASE_URL','SUPABASE_DB_URL','PGSERVICE','PGHOSTADDR'): base[key]=''
with patch.dict(os.environ,base): bridge.guard()
for key,value in [('PGHOST','localhost'),('PGPORT','5432'),('PGPORT','bad'),('PGPORT','65536'),('PGDATABASE','postgres'),
                  ('DATABASE_URL','test'),('SUPABASE_DB_URL','test'),('PGSERVICE','test'),('PGHOSTADDR','127.0.0.1')]:
 with patch.dict(os.environ,{**base,key:value}):
  try: bridge.guard()
  except SystemExit as e: assert str(e)=='REFUSED_NON_DISPOSABLE_DATABASE'
  else: raise AssertionError('CONNECTION_FALSE_GREEN: '+key)
 print('QC_MATERIAL_CONNECTION_REFUSED case='+key)

# Copy pinned DB sources only; mutate each copy, never the frozen worktree.
lock=json.loads((HERE/'SOURCE_LOCK.json').read_text())
with tempfile.TemporaryDirectory(prefix='wardah-qc-input-controls-') as temp:
 root=Path(temp)
 for name in lock['database_sources']:
  dest=root/name; dest.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(verify_inputs.ROOT/name,dest)
 with patch.object(verify_inputs,'ROOT',root):
  with contextlib.redirect_stdout(io.StringIO()): verify_inputs.verify(client)
  for name in ('sql/migrations/199_manufacturing_quality_control.sql','sql/migrations/198_material_issue_parent_version.sql',next(p for p in lock['database_sources'] if p.startswith('sql/baseline/'))):
   path=root/name; original=path.read_bytes(); path.write_bytes(original+b'\n-- drift\n')
   try: verify_inputs.verify(client)
   except SystemExit as e: assert str(e)=='PINNED_SOURCE_DRIFT: '+name
   else: raise AssertionError('INPUT_FALSE_GREEN: '+name)
   path.write_bytes(original); print('QC_MATERIAL_SOURCE_REFUSED case='+name)
 # Wrong HEAD is checked using a real repo, never a mock git command.
 try: verify_inputs.verify(verify_inputs.ROOT)
 except SystemExit as e: assert str(e)=='PINNED_CLIENT_IDENTITY_DRIFT'
 else: raise AssertionError('CLIENT_HEAD_FALSE_GREEN')
 print('QC_MATERIAL_SOURCE_REFUSED case=client_head')
print('QC_MATERIAL_REFUSAL_CONTROLS_PASS connections=9 sources=4')
