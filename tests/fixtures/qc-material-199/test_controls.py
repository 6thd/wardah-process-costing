"""Real input/connection refusal controls; no connection to any target."""
import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess  # nosec B404
import sys
import tempfile
from unittest.mock import patch
import bridge
import verify_inputs

HERE=Path(__file__).resolve().parent
client=Path(sys.argv[1]).resolve()
base={'PGHOST':'127.0.0.1','PGPORT':'55439','PGDATABASE':'wardah_issue_parent_198_canonical_qc199_control'}
for key in ('DATABASE_URL','SUPABASE_DB_URL','PGSERVICE','PGHOSTADDR'):
 base[key]=''
with patch.dict(os.environ,base):
 bridge.guard()
connections=[('PGHOST','localhost'),('PGPORT','5432'),('PGPORT','bad'),('PGPORT','65536'),('PGDATABASE','postgres'),
                  ('DATABASE_URL','test'),('SUPABASE_DB_URL','test'),('PGSERVICE','test'),('PGHOSTADDR','127.0.0.1')]
connections=connections+[('PGPORT',p) for p in (' 55439','+55439','55_439','٥٥٤٣٩','55439 ','055439')]
for key,value in connections:
 with patch.dict(os.environ,{**base,key:value}):
  try:
   bridge.guard()
  except SystemExit as e:
   assert str(e)=='REFUSED_NON_DISPOSABLE_DATABASE'
  else:
   raise AssertionError('CONNECTION_FALSE_GREEN: '+key)
 print('QC_MATERIAL_CONNECTION_REFUSED case='+key)

# Copy pinned DB sources only; mutate each copy, never the frozen worktree.
lock=json.loads((HERE/'SOURCE_LOCK.json').read_text())
with tempfile.TemporaryDirectory(prefix='wardah-qc-input-controls-') as temp:
 root=Path(temp)
 for name in lock['database_sources']:
  dest=root/name
  dest.parent.mkdir(parents=True,exist_ok=True)
  shutil.copyfile(verify_inputs.ROOT/name,dest)
 with patch.object(verify_inputs,'ROOT',root):
  with contextlib.redirect_stdout(io.StringIO()):
   verify_inputs.verify(client)
  for name in ('sql/migrations/199_manufacturing_quality_control.sql','sql/migrations/198_material_issue_parent_version.sql','sql/baseline/000_schema_baseline_20260905_184634.sql'):
   path=root/name
   original=path.read_bytes()
   path.write_bytes(original+b'\n-- drift\n')
   try:
    verify_inputs.verify(client)
   except SystemExit as e:
    assert str(e)=='PINNED_SOURCE_DRIFT: '+name
   else:
    raise AssertionError('INPUT_FALSE_GREEN: '+name)
   path.write_bytes(original)
   print('QC_MATERIAL_SOURCE_REFUSED case='+name)
 # Wrong HEAD is checked using a real repo, never a mock git command.
 try:
  verify_inputs.verify(verify_inputs.ROOT)
 except SystemExit as e:
  assert str(e)=='PINNED_CLIENT_IDENTITY_DRIFT'
 else:
  raise AssertionError('CLIENT_HEAD_FALSE_GREEN')
 print('QC_MATERIAL_SOURCE_REFUSED case=client_head')

def scratch_git(directory,*args):
 env={k:v for k,v in os.environ.items() if not k.startswith('GIT_')}
 subprocess.run(['/usr/bin/git','-c','core.fsmonitor=false','-C',str(directory),*args],
                env=env,check=True,capture_output=True,shell=False)  # nosec B603

def refused(copy,message):
 try:
  verify_inputs.verify(copy)
 except SystemExit as error:
  assert str(error).startswith(message), str(error)
 else:
  raise AssertionError('CLIENT_CONTENT_FALSE_GREEN: '+message)

# Real scratch repository/index flags; the accepted client is never modified.
with tempfile.TemporaryDirectory(prefix='wardah-qc-client-controls-') as temp:
 copy=Path(temp)/'client'
 scratch_git(Path(temp),'clone','--no-hardlinks','--no-checkout',str(client),str(copy))
 scratch_git(copy,'checkout','--detach',lock['client_head'])
 with contextlib.redirect_stdout(io.StringIO()):
  verify_inputs.verify(copy)
 target=copy/'src/features/manufacturing/quality/QualityControlPage.tsx'
 name=target.relative_to(copy).as_posix()
 original=target.read_bytes()
 for flag in ('assume-unchanged','skip-worktree'):
  scratch_git(copy,'update-index','--'+flag,name)
  target.write_bytes(original+b'\n// hidden drift\n')
  # Reproduce the former status-only false green, then require the real verifier
  # to refuse the same bytes. This positive mutant proves non-vacuity.
  assert not verify_inputs.git(copy,'status')
  with patch.object(verify_inputs,'verify_worktree',lambda _client:None):
   with contextlib.redirect_stdout(io.StringIO()):
    verify_inputs.verify(copy)
  refused(copy,'PINNED_CLIENT_CONTENT_DRIFT: '+name)
  target.write_bytes(original)
  scratch_git(copy,'update-index','--no-'+flag,name)
  print('QC_MATERIAL_CLIENT_REFUSED case='+flag)
 shadow=copy/'src/features/manufacturing/quality/qualityErrors.js'
 for ignored in (False,True):
  if ignored:
   with (copy/'.git/info/exclude').open('a') as exclude:
    exclude.write('\nsrc/features/manufacturing/quality/qualityErrors.js\n')
  shadow.write_text('export const unreviewed = true\n')
  with patch.object(verify_inputs,'verify_worktree',lambda _client:None):
   with contextlib.redirect_stdout(io.StringIO()):
    verify_inputs.verify(copy)
  refused(copy,'PINNED_CLIENT_UNTRACKED_SOURCE: src/features/manufacturing/quality/qualityErrors.js')
  shadow.unlink()
  print('QC_MATERIAL_CLIENT_REFUSED case='+('ignored-shadow' if ignored else 'untracked-shadow'))
 with contextlib.redirect_stdout(io.StringIO()):
  verify_inputs.verify(copy)
print('QC_MATERIAL_REFUSAL_CONTROLS_PASS connections=15 sources=4 client=4')
