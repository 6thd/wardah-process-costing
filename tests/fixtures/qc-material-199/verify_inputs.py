"""Bind the real DB sources and clean, frozen client before executing anything."""
import hashlib
import json
import os
from pathlib import Path
# Fixed executable and read-only allowlisted queries below.
import subprocess  # nosec B404
import sys
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]

def git(directory,query):
 commands={'head':('rev-parse','HEAD'),'tree':('rev-parse','HEAD^{tree}'),
           'status':('status','--porcelain','--untracked-files=no')}
 args=commands[query]  # Unsupported queries fail before invoking anything.
 env={k:v for k,v in os.environ.items() if not k.startswith('GIT_')}
 # argv only; no shell, PATH lookup, fsmonitor hook or GIT_* redirection.
 return subprocess.check_output(['/usr/bin/git','-c','core.fsmonitor=false','-C',str(directory),*args],env=env,text=True,shell=False).strip()  # nosec B603

def verify(client):
 lock=json.loads((HERE/'SOURCE_LOCK.json').read_text())
 if git(client,'head')!=lock['client_head'] or git(client,'tree')!=lock['client_tree']:
  raise SystemExit('PINNED_CLIENT_IDENTITY_DRIFT')
 if git(client,'status'):
  raise SystemExit('PINNED_CLIENT_TRACKED_DRIFT')
 for base,key in ((ROOT,'database_sources'),(client,'client_sources')):
  for name,digest in lock[key].items():
   if hashlib.sha256((base/name).read_bytes()).hexdigest()!=digest:
    raise SystemExit('PINNED_SOURCE_DRIFT: '+name)
 print('QC_MATERIAL_INPUTS_PASS client='+lock['client_head']+' database_sources='+str(len(lock['database_sources'])))

if __name__=='__main__':
 if len(sys.argv)!=2:
  raise SystemExit('USAGE: verify_inputs.py CLEAN_PINNED_CLIENT')
 verify(Path(sys.argv[1]).resolve())
