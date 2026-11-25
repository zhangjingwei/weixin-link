import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {workbuddyEnvironment} from './environment.mjs'
export async function inspectWorkbuddy(binary,{env=process.env,run=promisify(execFile)}={}){
 let version
 try{version=(await run(binary,['--version'],{env:workbuddyEnvironment(env),timeout:15000,maxBuffer:16384,windowsHide:true})).stdout.trim()}catch{throw Object.assign(Error('WORKBUDDY_CLI_UNAVAILABLE'),{code:'WORKBUDDY_CLI_UNAVAILABLE'})}
 if(!/^2\.187\.0\b/.test(version))throw Object.assign(Error('WORKBUDDY_CLI_VERSION_UNSUPPORTED'),{code:'WORKBUDDY_CLI_VERSION_UNSUPPORTED'})
 return {version:'2.187.0',authentication:'not_checked'}
}
