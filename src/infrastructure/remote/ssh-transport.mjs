import {spawn} from 'node:child_process'
import {homedir} from 'node:os'
import {join} from 'node:path'

export const sshConfig=process.env.WECHAT_SSH_CONFIG??join(homedir(),'.ssh/wechat_hosts_config')
export const shellQuote=value=>"'"+value.replaceAll("'", "'\"'\"'")+"'"

// A lost SSH connection does not tell us whether the remote shell ran the command.
export async function sshCommand(host,command,{input,timeoutMs=30000,maxBytes=65536,spawnImpl=spawn,config=sshConfig}={}){
 if(typeof host!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(host)||typeof command!=='string'||!command||command.length>65536||/[\0\r]/.test(command))throw Error('REMOTE_ARGUMENTS_INVALID')
 if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>120000||!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>1048576)throw Error('REMOTE_ARGUMENTS_INVALID')
 const bytes=input===undefined?undefined:Buffer.isBuffer(input)?input:Buffer.from(input)
 if(bytes&&bytes.length>1048576)throw Error('REMOTE_INPUT_TOO_LARGE')
 return new Promise((resolve,reject)=>{
  const child=spawnImpl('ssh',['-F',config,'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3',host,command],{stdio:['pipe','pipe','pipe']})
  let stdout=[],stderr=[],outSize=0,errSize=0,settled=false,timedOut=false,tooLarge=false
  const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve(result)}
  const timer=setTimeout(()=>{timedOut=true;child.kill()},timeoutMs)
  child.stdout.on('data',chunk=>{outSize+=chunk.length;if(outSize>maxBytes){tooLarge=true;child.kill()}else stdout.push(chunk)})
  child.stderr.on('data',chunk=>{errSize+=chunk.length;if(errSize>4096){tooLarge=true;child.kill()}else stderr.push(chunk)})
  child.on('error',()=>finish(Error('REMOTE_CONNECTION_FAILED')))
  child.on('close',code=>{
   if(timedOut)return finish(Error('REMOTE_RESULT_UNCERTAIN'))
   if(tooLarge)return finish(Error('REMOTE_OUTPUT_TOO_LARGE'))
   if(code===255||code===null)return finish(Error('REMOTE_RESULT_UNCERTAIN'))
   finish(null,{exitCode:code,stdout:Buffer.concat(stdout),stderr:Buffer.concat(stderr)})
  })
  child.stdin.on('error',()=>{})
  if(bytes)child.stdin.end(bytes);else child.stdin.end()
 })
}
