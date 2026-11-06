import {spawn} from 'node:child_process'
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
export class RemoteStore {
 constructor(root){this.root=root;this.path=join(root,'remote-sessions.json')}
 async read(){try{return JSON.parse(await readFile(this.path,'utf8'))}catch(error){if(error.code==='ENOENT')return {};throw error}}
 async locked(name,work){
  if(!/^[a-z0-9-]{1,100}$/.test(name))throw Error('INVALID_LOCK')
  const dir=join(this.root,'.remote-locks');await mkdir(dir,{recursive:true,mode:0o700})
  const child=spawn('/usr/bin/flock',['-w','10',join(dir,name),process.execPath,'-e','process.stdout.write("LOCKED\\n");process.stdin.resume()'],{stdio:['pipe','pipe','ignore']})
  child.stdin.on('error',()=>{});const exited=new Promise(resolve=>child.once('close',resolve))
  try{
   await new Promise((resolve,reject)=>{let data='';child.once('error',reject);child.stdout.on('data',chunk=>{data+=chunk;if(data.includes('LOCKED'))resolve()});child.once('close',()=>reject(Error('REGISTRY_BUSY')))})
   return await work()
  }finally{child.stdin.end();await exited}
 }

 async update(mutator){return this.locked('registry',async()=>{const state=await this.read(),result=await mutator(state),tmp=this.path+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(state,null,2)+'\n',{mode:0o600});await rename(tmp,this.path);return result})}
}
