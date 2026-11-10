import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,realpath,symlink,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawn} from 'node:child_process'
import {SshOperations} from '../../src/application/remote-tasks/ssh-operations.mjs'
import {sshCommand} from '../../src/infrastructure/remote/ssh-transport.mjs'

const hosts={example:{platform:'posix',root:'/work'}}
const ok=(stdout='')=>({exitCode:0,stdout:Buffer.from(stdout),stderr:Buffer.alloc(0)})
test('SSH operations validate project and path before remote file access',async()=>{
 const calls=[],service=new SshOperations({hosts,run:async(host,command,options)=>{calls.push({host,command,options});return ok('data')}})
 assert.deepEqual(await service.runRequest({action:'list'}),{hosts:['example']})
 const read=await service.runRequest({action:'read',host:'example',project:'/work/project',path:'/work/project/file.txt'})
 assert.equal(read.data_base64,Buffer.from('data').toString('base64'))
 assert.equal(calls.length,3)
 await assert.rejects(service.runRequest({action:'read',host:'example',project:'/work/project',path:'/etc/passwd'}),/EXPORT_PATH_REFUSED/)
 await assert.rejects(service.runRequest({action:'exec',host:'example',project:'/work/../etc',command:'pwd'}),/INVALID_PROJECT/)
})

test('SSH operations reject symlinked project and refuse overwriting a file',async()=>{
 const unavailable=new SshOperations({hosts,run:async()=>({exitCode:1,stdout:Buffer.alloc(0),stderr:Buffer.alloc(0)})})
 await assert.rejects(unavailable.runRequest({action:'inspect',host:'example',project:'/work/project'}),/REMOTE_PROJECT_UNAVAILABLE/)
 const calls=[],service=new SshOperations({hosts,run:async(host,command,options)=>{calls.push({command,options});return ok()}})
 await assert.rejects(service.runRequest({action:'write',host:'example',project:'/work/project',path:'/work/project/new.txt',data_base64:'YQ=='}),/REMOTE_FILE_EXISTS/)
 assert.equal(calls.some(call=>call.options?.input),false)
})

test('SSH command result reports bounded output and exit status',async()=>{
 const service=new SshOperations({hosts,run:async(host,command,options)=>{
  if(command==='sh -s'){assert.equal(options.timeoutMs,1000);assert.equal(options.input.toString(),"cd '/work/project' && false\n");return {exitCode:7,stdout:Buffer.from('out'),stderr:Buffer.from('err')}}
  return ok()
 }})
 assert.deepEqual(await service.runRequest({action:'exec',host:'example',project:'/work/project',command:'false',timeoutMs:1000}),{host:'example',project:'/work/project',exit_code:7,stdout:'out',stderr:'err'})
})

test('SSH operations work through an isolated local shell stand-in',async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'ssh-ops-')))
 t.after(()=>rm(root,{recursive:true,force:true}))
 const project=join(root,'project');await mkdir(project)
 const run=(host,command,options)=>sshCommand(host,command,{...options,spawnImpl:(_binary,args,spawnOptions)=>spawn('/bin/sh',['-c',args.at(-1)],spawnOptions)})
 const service=new SshOperations({hosts:{example:{platform:'posix',root}},run})
 assert.equal((await service.runRequest({action:'inspect',host:'example',project})).project,project)
 const path=join(project,'new file.txt'),data=Buffer.from('hello remote')
 assert.equal((await service.runRequest({action:'write',host:'example',project,path,data_base64:data.toString('base64')})).bytes,data.length)
 assert.equal(await readFile(path,'utf8'),'hello remote')
 assert.equal((await service.runRequest({action:'read',host:'example',project,path})).data_base64,data.toString('base64'))
 assert.equal((await service.runRequest({action:'exec',host:'example',project,command:'pwd'})).stdout.trim(),project)
 await assert.rejects(service.runRequest({action:'write',host:'example',project,path,data_base64:data.toString('base64')}),/REMOTE_FILE_EXISTS/)
 const link=join(root,'link');await symlink(project,link)
 await assert.rejects(service.runRequest({action:'inspect',host:'example',project:link}),/REMOTE_PROJECT_UNAVAILABLE/)
})

test('Windows SSH operations send PowerShell wrappers and keep command text on stdin',async()=>{
 const project='C:\\work\\project',path=project+'\\new.txt',calls=[]
 const run=async(host,command,options)=>{
  assert.equal(host,'windows')
  assert.match(command,/^powershell\.exe -NoProfile -NonInteractive -EncodedCommand /)
  const script=Buffer.from(command.split(' ').at(-1),'base64').toString('utf16le')
  calls.push({script,options})
  if(script.includes('Test-Path'))return {exitCode:1,stdout:Buffer.alloc(0),stderr:Buffer.alloc(0)}
  if(script.includes('OpenRead'))return ok('windows file')
  if(script.includes('Invoke-Expression'))return ok('command output')
  return ok()
 }
 const service=new SshOperations({hosts:{windows:{platform:'win32',root:'C:\\work'}},run})
 assert.equal((await service.runRequest({action:'inspect',host:'windows',project})).project,project)
 assert.ok(calls.some(call=>call.script.includes('ReparsePoint')))
 assert.equal((await service.runRequest({action:'read',host:'windows',project,path})).data_base64,Buffer.from('windows file').toString('base64'))
 assert.equal((await service.runRequest({action:'write',host:'windows',project,path,data_base64:'YQ=='})).bytes,1)
 assert.equal(calls.at(-1).options.input.toString(),'a')
 const result=await service.runRequest({action:'exec',host:'windows',project,command:'Get-Location'})
 assert.equal(result.stdout,'command output')
 assert.equal(calls.at(-1).options.input.toString(),'Get-Location')
 assert.ok(!calls.at(-1).script.includes('Get-Location'))
 await assert.rejects(service.runRequest({action:'read',host:'windows',project,path:path+':secret'}),/EXPORT_PATH_REFUSED/)
})
