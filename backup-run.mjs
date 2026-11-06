import {controlRequest} from './runtime-control.mjs'
import {readdir,access,mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
import {spawn} from 'node:child_process'
let aborted=false,backupChild
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{aborted=true;backupChild?.kill('SIGTERM')})
const base=join(process.env.HOME,'.local/share/wechat-ping-bot'),lease=randomUUID(),owned=[]
try{
 const dirs=[base,...(await readdir(join(base,'accounts'),{withFileTypes:true}).catch(()=>[])).filter(x=>x.isDirectory()).map(x=>join(base,'accounts',x.name))]
 const sockets=[];for(const dir of dirs){try{await access(join(dir,'runtime.sock'));sockets.push(join(dir,'runtime.sock'))}catch{}}
 // Wait for all accounts to be idle; do not seal one indefinitely while another is busy.
 let sealed=false
 for(let i=0;i<1800;i++){
  if(aborted)throw Error('BACKUP_CANCELLED')
  let all=true
  for(const socket of sockets){const state=await controlRequest(socket,'POST','/drain',{lease});if(!owned.includes(socket))owned.push(socket);if(!state.idle)all=false}
  if(all){try{for(const socket of sockets)await controlRequest(socket,'POST','/seal',{lease});sealed=true;break}catch{for(const socket of owned)await controlRequest(socket,'POST','/resume',{lease}).catch(()=>{});owned.length=0}}
  await delay(1000)
 }
 if(!sealed)throw Error('BACKUP_DEFERRED_BUSY')
 const result=await new Promise((resolve,reject)=>{const child=backupChild=spawn('/usr/bin/python3',[new URL('./backup-data.py',import.meta.url).pathname],{stdio:'inherit'});let timer=setInterval(()=>{for(const socket of owned)void controlRequest(socket,'POST','/drain',{lease}).catch(()=>{})},30000);child.on('error',reject);child.on('exit',code=>{clearInterval(timer);resolve(code)})})
 if(result!==0)throw Error('BACKUP_FAILED')
}catch(error){
 const dir=join(process.env.HOME,'.local/share/wechat-assistant-backups');await mkdir(dir,{recursive:true,mode:0o700});await writeFile(join(dir,'last-failure.json'),JSON.stringify({at:new Date().toISOString(),code:error.message==='BACKUP_DEFERRED_BUSY'?error.message:'BACKUP_FAILED'}),{mode:0o600});console.error('WeChat backup failed or deferred; inspect private backup receipt.');process.exitCode=1
}finally{for(const socket of owned)await controlRequest(socket,'POST','/resume',{lease}).catch(()=>{})}
