import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {loadRemoteHosts,shellQuote} from './remote-config.mjs'
test('unconfigured adapter has no implicit personal hosts',()=>{
 const env={...process.env};delete env.WECHAT_REMOTE_HOSTS
 const value=execFileSync(process.execPath,['--input-type=module','-e',`import {HOSTS} from ${JSON.stringify(new URL('./remote-config.mjs',import.meta.url).href)}; console.log(JSON.stringify(HOSTS))`],{env,encoding:'utf8'})
 assert.deepEqual(JSON.parse(value),{})
})
test('explicit missing config fails rather than falling back to personal hosts',()=>{
 const env={...process.env,WECHAT_REMOTE_HOSTS:join(tmpdir(),'absent-remote-config-'+process.pid+'.json')}
 assert.throws(()=>execFileSync(process.execPath,['--input-type=module','-e',`import ${JSON.stringify(new URL('./remote-config.mjs',import.meta.url).href)}`],{env,stdio:'pipe'}),error=>/REMOTE_HOSTS_CONFIG_UNREADABLE/.test(error.stderr.toString()))
})
test('configuration validates host names, absolute roots, platform and ports',()=>{
 const dir=mkdtempSync(join(tmpdir(),'config-validation-')),file=join(dir,'hosts.json'),valid={platform:'posix',binary:'/opt/Codex App/codex',root:'/srv/projects',transport:'daemon-proxy'}
 try{
  for(const config of [[],null,{'-oProxyCommand=bad':valid},{demo:{...valid,root:'relative'}},{demo:{...valid,binary:'/opt/codex\ncommand'}},{demo:{...valid,platform:'win32'}},{demo:{...valid,transport:'ssh-websocket',port:22}}]){
   writeFileSync(file,JSON.stringify(config));assert.throws(()=>loadRemoteHosts(file),/INVALID_REMOTE_HOSTS_CONFIG/)
  }
  writeFileSync(file,JSON.stringify({demo:valid}));assert.deepEqual(loadRemoteHosts(file),{demo:valid})
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('remote executable is passed as one shell literal including spaces and quotes',()=>{
 const binary="/opt/Codex App/it's-$HOME-`id`/codex"
 assert.equal(execFileSync('sh',['-c','printf %s '+shellQuote(binary)],{encoding:'utf8'}),binary)
})
