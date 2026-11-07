import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,utimes,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import lockfile from 'proper-lockfile'
import {atomicConfigWrite} from '../../src/setup/config-files.mjs'

test('stale historical config lock recovers, but a live heartbeat lock is respected',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'config-lock-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const path=join(dir,'config.json'),lock=path+'.write-lock'
 await writeFile(path,'old');await mkdir(lock)
 const old=new Date(Date.now()-60000);await utimes(lock,old,old)
 await atomicConfigWrite(path,'new')
 assert.equal(await readFile(path,'utf8'),'new')
 assert.equal(await readFile(path+'.previous','utf8'),'old')
 const release=await lockfile.lock(path,{realpath:false,lockfilePath:lock,stale:30000,update:10000})
 try{await assert.rejects(atomicConfigWrite(path,'conflict'),{code:'CONFIG_BUSY'});assert.equal(await readFile(path,'utf8'),'new')}finally{await release()}
 await atomicConfigWrite(path,'after release')
 assert.equal(await readFile(path,'utf8'),'after release')
})

test('lock held by a killed writer can be recovered after lease expiry',async t=>{
 const {spawn}=await import('node:child_process')
 const {once}=await import('node:events')
 const dir=await mkdtemp(join(tmpdir(),'config-crash-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const path=join(dir,'config.json');await writeFile(path,'original')
 const child=spawn(process.execPath,['--input-type=module','-e',`import lockfile from 'proper-lockfile';await lockfile.lock(process.argv[1],{realpath:false,lockfilePath:process.argv[1]+'.write-lock',stale:30000,update:10000});process.stdout.write('locked');setInterval(()=>{},1000)`,path],{cwd:new URL('../../',import.meta.url),stdio:['ignore','pipe','pipe']})
 t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL')})
 await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',()=>reject(Error('Writer exited before acquiring lock')));child.stdout.once('data',resolve)})
 await assert.rejects(atomicConfigWrite(path,'blocked'),{code:'CONFIG_BUSY'})
 const exited=once(child,'exit');child.kill('SIGKILL');await exited
 // Advance only this dead writer's lease timestamp instead of waiting 30 seconds.
 const expired=new Date(Date.now()-60000);await utimes(path+'.write-lock',expired,expired)
 await atomicConfigWrite(path,'recovered');assert.equal(await readFile(path,'utf8'),'recovered')
})
