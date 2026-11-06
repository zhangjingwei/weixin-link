#!/usr/bin/env python3
"""Private encrypted snapshots. Restore verification never activates a bot or executes saved tasks."""
import contextlib
import os,json,sqlite3,hashlib,shutil,tarfile,tempfile,subprocess,datetime,fcntl,sys,base64,io
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
os.umask(0o077)
HOME=Path.home(); ROOT=HOME/'.local/share/wechat-assistant-backups'; ROOT.mkdir(parents=True,exist_ok=True)
import re
CONFIG_PATH=Path(os.environ.get('WECHAT_BACKUP_CONFIG',HOME/'.config/wechat-assistant/backup.json'))
try:
 CONFIG=json.loads(CONFIG_PATH.read_text())
 host=CONFIG['host'];REMOTE=CONFIG['remoteDirectory']
 if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*',host) or not re.fullmatch(r'/[A-Za-z0-9_./-]+',REMOTE) or '..' in REMOTE.split('/') or REMOTE=='/':raise ValueError()
except Exception:
 print('BACKUP_CONFIG_REQUIRED_OR_INVALID',file=sys.stderr);sys.exit(1)
SSH=['ssh','-F',str(Path(os.environ.get('WECHAT_SSH_CONFIG',HOME/'.ssh/wechat_hosts_config'))),'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',host]

def ssh(command,data=None):return subprocess.run(SSH+[command],input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout
def sha(path):return hashlib.file_digest(open(path,'rb'),'sha256').hexdigest()
def copytree(source,dest,media=False):
 if not source.exists():return
 for p in source.rglob('*'):
  rel=p.relative_to(source)
  if any(x in ('node_modules','backups','.git','.remote-locks','cache','log','logs') for x in rel.parts) or p.is_symlink() or not p.is_file():continue
  ismedia='attachments' in rel.parts or 'outputs' in rel.parts
  if media!=ismedia:continue
  if p.name.endswith(('-wal','-shm','.sock','.log','.jsonl')) and p.suffix!='.jsonl':continue
  if p.suffix=='.jsonl' and source.name not in ('sessions','archived_sessions') and 'sessions' not in rel.parts and 'archived_sessions' not in rel.parts:continue
  target=dest/rel;target.parent.mkdir(parents=True,exist_ok=True)
  if p.suffix in ('.sqlite','.db'):
   with sqlite3.connect('file:'+str(p)+'?mode=ro',uri=True,timeout=15) as src,sqlite3.connect(target) as dst:
    src.backup(dst)
    if dst.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise RuntimeError('DATABASE_INTEGRITY')
  else:shutil.copyfile(p,target)
  target.chmod(0o600)
def encrypt(stage,dest,public):
 with tempfile.TemporaryFile() as tar:
  with tarfile.open(fileobj=tar,mode='w:gz') as t:t.add(stage,arcname='snapshot',recursive=True)
  tar.seek(0);plain=tar.read()
 key=AESGCM.generate_key(bit_length=256);nonce=os.urandom(12)
 wrapped=public.encrypt(key,padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),algorithm=hashes.SHA256(),label=None))
 header=json.dumps({'version':1,'nonce':base64.b64encode(nonce).decode(),'key':base64.b64encode(wrapped).decode()},separators=(',',':')).encode()
 dest.write_bytes(len(header).to_bytes(4,'big')+header+AESGCM(key).encrypt(nonce,plain,header))
def verify(file,restore=None):
 raw=file.read_bytes();n=int.from_bytes(raw[:4],'big');header=raw[4:4+n];h=json.loads(header)
 if h.get('version')!=1:raise RuntimeError('FORMAT')
 key=ssh('openssl pkeyutl -decrypt -inkey .config/wechat-backup-key/private.pem -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -pkeyopt rsa_mgf1_md:sha256',base64.b64decode(h['key']))
 plain=AESGCM(key).decrypt(base64.b64decode(h['nonce']),raw[4+n:],header)
 if restore is not None:restore.mkdir(parents=True,exist_ok=False)
 with (contextlib.nullcontext(str(restore)) if restore is not None else tempfile.TemporaryDirectory(prefix='wechat-restore-')) as tmp:
  with tarfile.open(fileobj=io.BytesIO(plain),mode='r:gz') as tar:tar.extractall(tmp,filter='data')
  base=Path(tmp)/'snapshot';manifest=json.loads((base/'manifest.json').read_text());dbs=0
  for entry in manifest['files']:
   p=base/entry['path']
   if sha(p)!=entry['sha256']:raise RuntimeError('HASH_MISMATCH')
   if p.suffix in ('.sqlite','.db'):
    with sqlite3.connect(p) as db:
     if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise RuntimeError('DATABASE_INTEGRITY')
     # Offline restored copy only: prevent blind replay if this quarantine is ever inspected.
     tables={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
     if 'jobs' in tables and 'thread_id' in {r[1] for r in db.execute('PRAGMA table_info(jobs)')}:
      db.execute("UPDATE jobs SET state='uncertain' WHERE state IN ('pending','bound','submitted')")
     if 'ingress' in tables:db.execute("UPDATE ingress SET state='cancelled' WHERE state='pending'")
    dbs+=1
 return {'files':len(manifest['files']),'databases':dbs,'isolated_restore_verified':True}
def retain(names):
 # Keep latest seven daily, four weekly, three monthly successful generations.
 keep=set();weekly=set();monthly=set();daily=set()
 for name in sorted(names,reverse=True):
  try:d=datetime.datetime.strptime(name[:8],'%Y%m%d')
  except ValueError:continue
  week=d.strftime('%G-%V');month=d.strftime('%Y-%m')
  day=d.strftime('%Y-%m-%d')
  if day in daily or len(daily)<7:daily.add(day);keep.add(name)
  if week not in weekly and len(weekly)<4:weekly.add(week);keep.add(name)
  if month not in monthly and len(monthly)<3:monthly.add(month);keep.add(name)
 return keep

def main():
 with open(ROOT/'backup.lock','a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  name=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');dest=ROOT/name;dest.mkdir()
  try:
   pub=serialization.load_pem_public_key((HOME/'.config/wechat-assistant/backup-public.pem').read_bytes())
   with tempfile.TemporaryDirectory(prefix='wechat-backup-') as tmp:
    for kind in ('core','media'):
     stage=Path(tmp)/kind;stage.mkdir()
     installation=HOME/'.local/share/wechat-ping-bot/installation.json'
     workspace=Path(json.loads(installation.read_text())['workspace']) if installation.exists() else HOME/'work/wechat-assistant'
     sources=[HOME/'.local/share/wechat-ping-bot',Path(__file__).resolve().parents[3],workspace]
     for i,src in enumerate(sources):copytree(src,stage/['accounts','code','workspace'][i],kind=='media')
     if kind=='core':
      copytree(HOME/'.config/wechat-assistant',stage/'private-config')
      copytree(HOME/'.codex/sessions',stage/'codex/sessions')
      copytree(HOME/'.codex/archived_sessions',stage/'codex/archived_sessions')
      for p in (HOME/'.codex').glob('*'):
       if p.is_file() and (p.suffix in ('.sqlite','.toml') or p.name=='auth.json') and not p.name.startswith('logs_'):
        single=stage/'codex';single.mkdir(exist_ok=True)
        if p.suffix=='.sqlite':
         with sqlite3.connect('file:'+str(p)+'?mode=ro',uri=True) as src,sqlite3.connect(single/p.name) as dst:src.backup(dst)
        else:shutil.copyfile(p,single/p.name)
      copytree(HOME/'.config/systemd/user',stage/'systemd')
      sshdir=stage/'ssh';sshdir.mkdir()
      for f in ('wechat_hosts_config','known_hosts'):
       if (HOME/'.ssh'/f).is_file():shutil.copyfile(HOME/'.ssh'/f,sshdir/f)
      conf=Path(os.environ.get('WECHAT_SSH_CONFIG',HOME/'.ssh/wechat_hosts_config'))
      if conf.exists():
       for line in conf.read_text().splitlines():
        parts=line.strip().split(None,1)
        if len(parts)==2 and parts[0].lower()=='identityfile':
         keyfile=Path(os.path.expandvars(os.path.expanduser(parts[1].strip(chr(34)))))
         if keyfile.is_file() and not keyfile.is_symlink():shutil.copyfile(keyfile,sshdir/keyfile.name)
     files=[{'path':str(p.relative_to(stage)),'sha256':sha(p)} for p in stage.rglob('*') if p.is_file()]
     (stage/'manifest.json').write_text(json.dumps({'version':1,'created':name,'kind':kind,'files':files}))
     encrypt(stage,dest/(kind+'.enc'),pub)
   checks={p.name:sha(p) for p in dest.glob('*.enc')};(dest/'checksums.json').write_text(json.dumps(checks))
   ssh('mkdir -p '+REMOTE+'/'+name)
   for p in dest.iterdir():ssh('umask 077; cat > '+REMOTE+'/'+name+'/'+p.name+'.part',p.read_bytes());ssh('mv '+REMOTE+'/'+name+'/'+p.name+'.part '+REMOTE+'/'+name+'/'+p.name)
   for file,expected in checks.items():
    actual=ssh('sha256sum '+REMOTE+'/'+name+'/'+file).decode().split()[0]
    if actual!=expected:raise RuntimeError('NAS_HASH_MISMATCH')
   report={kind:verify(dest/(kind+'.enc')) for kind in ('core','media')}
   receipt={'completed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'verified','generation':name,'nas_verified':True,'restore':report,'bytes':sum(p.stat().st_size for p in dest.glob('*.enc'))}
   (dest/'verified.json').write_text(json.dumps(receipt));ssh('umask 077; cat > '+REMOTE+'/'+name+'/verified.json',json.dumps(receipt).encode())
   (ROOT/'latest.json').write_text(json.dumps(receipt));(ROOT/'last-failure.json').unlink(missing_ok=True)
   generations=[p.name for p in ROOT.iterdir() if p.is_dir() and (p/'verified.json').exists()]
   keep=retain(generations)
   for old in set(generations)-keep:
    shutil.rmtree(ROOT/old)
    # Only generated names, never arbitrary paths. Remote deletion only for verified local generations.
    if len(old)==16 and old.endswith('Z') and old[:8].isdigit():ssh('rm -rf -- '+REMOTE+'/'+old)
   print(json.dumps(receipt))
  except Exception:
   (ROOT/'latest.json').write_text(json.dumps({'status':'failed','generation':name,'code':'BACKUP_OR_VERIFICATION_FAILED'}));raise
if __name__=='__main__':
 try:
  if len(sys.argv)==3 and sys.argv[1] in ('verify','restore'):
   file=Path(sys.argv[2]).resolve()
   if file.name not in ('core.enc','media.enc'):raise RuntimeError('INVALID_ARCHIVE')
   target=HOME/'.local/share/wechat-assistant-restore'/file.parent.name/file.stem if sys.argv[1]=='restore' else None
   print(json.dumps(verify(file,target)))
  elif len(sys.argv)==1:main()
  else:raise RuntimeError('INVALID_ARGUMENT')
 except Exception:print('Backup failed; private details suppressed.',file=sys.stderr);sys.exit(1)
