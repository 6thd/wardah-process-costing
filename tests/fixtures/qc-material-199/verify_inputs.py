"""Bind the real DB sources and clean, frozen client before executing anything."""
import hashlib
import io
import json
import os
from pathlib import Path
import stat
# Fixed executable and read-only allowlisted queries below.
import subprocess  # nosec B404
import sys
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]

def git(directory,query,blob_ids=None):
 commands={'head':('rev-parse','HEAD'),'tree':('rev-parse','HEAD^{tree}'),
           'status':('status','--porcelain','--untracked-files=no'),
           'files':('ls-tree','-rz','HEAD'),
           'blobs':('cat-file','--batch')}
 args=commands[query]  # Unsupported queries fail before invoking anything.
 env={k:v for k,v in os.environ.items() if not k.startswith('GIT_')}
 # argv only; no shell, PATH lookup, fsmonitor hook or GIT_* redirection.
 command=['/usr/bin/git','-c','core.fsmonitor=false','-C',str(directory),*args]
 if query=='blobs':
  return subprocess.check_output(command,input=('\n'.join(blob_ids)+'\n').encode(),env=env,shell=False)  # nosec B603
 return subprocess.check_output(command,env=env,text=True,shell=False).strip()  # nosec B603

def expected_blobs(client,entries):
 identifiers=list(dict.fromkeys(entry[2] for entry in entries))
 stream=io.BytesIO(git(client,'blobs',identifiers))
 result={}
 for expected in identifiers:
  digest,kind,size=stream.readline().decode().split()
  if digest!=expected or kind!='blob':
   raise SystemExit('PINNED_CLIENT_BLOB_IDENTITY_DRIFT')
  result[digest]=stream.read(int(size))
  if len(result[digest])!=int(size) or stream.read(1)!=b'\n':
   raise SystemExit('PINNED_CLIENT_BLOB_BYTES_MISSING')
 return result

def blob_bytes(path,mode):
 info=path.lstat()
 if path.parent.resolve()!=path.parent:
  raise ValueError('SYMLINK_PARENT')
 if mode=='120000' and stat.S_ISLNK(info.st_mode):
  return os.fsencode(os.readlink(path))
 if mode not in ('100644','100755') or not stat.S_ISREG(info.st_mode):
  raise ValueError('FILE_KIND')
 if bool(info.st_mode & 0o111)!=(mode=='100755'):
  raise ValueError('EXECUTABLE_MODE')
 data=path.read_bytes()
 # Frozen .gitattributes requires CRLF checkout for these archived scripts.
 # Runtime source remains byte-exact; no external git filters are executed.
 return data.replace(b'\r\n',b'\n') if path.suffix in ('.bat','.cmd','.ps1') else data

def verify_untracked_sources(client,tracked):
 # Include ignored files: an ignored .js can shadow an accepted .ts import.
 for directory,folders,files in os.walk(client/'src',followlinks=False):
  for name in files+folders:
   path=Path(directory)/name
   relative=path.relative_to(client).as_posix()
   if (not path.is_dir() or path.is_symlink()) and relative not in tracked:
    raise SystemExit('PINNED_CLIENT_UNTRACKED_SOURCE: '+relative)

def verify_worktree(client):
 # Read immutable HEAD blobs, not index flags or status caches. Check every
 # tracked byte and mode, including files hidden by assume/skip-worktree flags.
 entries=[]
 for record in git(client,'files').split('\0'):
  if record:
   metadata,name=record.split('\t',1)
   entries.append((*metadata.split(),name))
 blobs=expected_blobs(client,entries)
 tracked=set()
 for mode,kind,digest,name in entries:
  path=client/name
  tracked.add(name)
  try:
   data=blob_bytes(path,mode)
   if kind!='blob' or data!=blobs[digest]:
    raise ValueError('BLOB_BYTES')
  except (OSError,ValueError) as error:
   raise SystemExit('PINNED_CLIENT_CONTENT_DRIFT: '+name) from error
 verify_untracked_sources(client,tracked)

def verify(client):
 lock=json.loads((HERE/'SOURCE_LOCK.json').read_text())
 if git(client,'head')!=lock['client_head'] or git(client,'tree')!=lock['client_tree']:
  raise SystemExit('PINNED_CLIENT_IDENTITY_DRIFT')
 if git(client,'status'):
  raise SystemExit('PINNED_CLIENT_TRACKED_DRIFT')
 verify_worktree(client)
 for base,key in ((ROOT,'database_sources'),(client,'client_sources')):
  for name,digest in lock[key].items():
   if hashlib.sha256((base/name).read_bytes()).hexdigest()!=digest:
    raise SystemExit('PINNED_SOURCE_DRIFT: '+name)
 print('QC_MATERIAL_INPUTS_PASS client='+lock['client_head']+' database_sources='+str(len(lock['database_sources'])))

if __name__=='__main__':
 if len(sys.argv)!=2:
  raise SystemExit('USAGE: verify_inputs.py CLEAN_PINNED_CLIENT')
 verify(Path(sys.argv[1]).resolve())
