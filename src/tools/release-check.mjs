// Check the staged source, never print matched values or credential contents.
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {resolve} from 'node:path'
const privateParts=new Set(['.ssh','.private','.codex','.config','.local','accounts','attachments','outputs','backups','logs','node_modules'])
const privateNames=new Set(['ha.json','backup.json','monitor.json','credentials.json','account.json','account-identity.json','codex-owners.json','codex-sessions.json','remote-sessions.json','remote-hosts.json','targets.json','installation.json','notification-jobs.json','runtime.sock','wechat_hosts_config','known_hosts','authorized_keys'])
export function checkReleaseFile(path,bytes,mode='100644'){
 const parts=path.replaceAll('\\','/').split('/'),name=parts.at(-1),issues=[]
 if(parts.some(p=>privateParts.has(p))||privateNames.has(name)||/^\.env(?:\.|$)/.test(name)||/^(?:id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)|.*\.(?:pem|key|p12|pfx|sqlite|sqlite3|db)(?:-wal|-shm)?$|.*\.local\.(?:json|md)$)/i.test(name))issues.push('PRIVATE_PATH')
 if(mode==='120000')issues.push('SYMLINK_NOT_ALLOWED_IN_RELEASE')
 const text=bytes.toString('utf8')
 if(/-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/.test(text))issues.push('PRIVATE_KEY')
 if(/\b(?:sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{24,})\b/.test(text))issues.push('PROVIDER_TOKEN')
 if(/\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/.test(text))issues.push('JWT_TOKEN')
 if(/(?:token|api[_-]?key|password|secret)["']?\s*[:=]\s*["'][A-Za-z0-9_+/=.-]{32,}["']/i.test(text))issues.push('LONG_SECRET_LITERAL')
 return issues.map(code=>({path,code}))
}
export function checkIndex(cwd=process.cwd()){
 const git=args=>execFileSync('git',args,{cwd,maxBuffer:64*1024*1024})
 const rows=git(['ls-files','--stage','-z']).toString().split('\0').filter(Boolean),issues=[]
 for(const row of rows){const [meta,path]=row.split('\t'),[mode,oid,stage]=meta.split(' ');if(stage!=='0'){issues.push({path,code:'UNMERGED_FILE'});continue}issues.push(...checkReleaseFile(path,git(['cat-file','blob',oid]),mode))}
 return {checked:rows.length,issues}
}
export function runReleaseCheck(){
 try{const result=checkIndex();console.log(JSON.stringify(result));if(result.issues.length)process.exitCode=1}catch{console.error('RELEASE_CHECK_FAILED');process.exitCode=1}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))runReleaseCheck()
