import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import lockfile from 'proper-lockfile'

// The short mutex protects a durable reservation. A dead process does not prove
// its agent stopped: only reconciliation of that same job may release it.
export class ExecutionGate {
 constructor(root){this.root=root;this.path=join(root,'reservation.json')}
 async transaction(work){
  await mkdir(this.root,{recursive:true,mode:0o700})
  const release=await lockfile.lock(this.root,{stale:30000,update:10000,retries:{retries:20,minTimeout:50,maxTimeout:100}})
  try{return await work()}finally{await release()}
 }
 async read(){try{return JSON.parse(await readFile(this.path,'utf8'))}catch(error){if(error.code==='ENOENT')return null;throw error}}
 async claim(identity,{recovery=false}={}){
  return this.transaction(async()=>{
   const current=await this.read()
   if(current){
    const same=current.account===identity.account&&current.job===identity.job
    if(same&&!recovery)throw Error('EXECUTION_RECONCILIATION_REQUIRED')
    return recovery&&same
   }
   const temp=this.path+'.'+randomUUID()+'.tmp'
   try{await writeFile(temp,JSON.stringify(identity),{flag:'wx',mode:0o600});await rename(temp,this.path)}finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e})}
   return true
  })
 }
 async release(identity){return this.transaction(async()=>{
  const current=await this.read()
  if(current?.account===identity.account&&current?.job===identity.job)await unlink(this.path)
 })}
}
