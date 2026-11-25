import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {claudeEnvironment} from './environment.mjs'
const exec=promisify(execFile)
const failure=code=>Object.assign(Error(code),{code})
export async function inspectClaude(binary,{env=process.env,run=exec}={}){
 const options={env:claudeEnvironment(env),timeout:15000,maxBuffer:128*1024,windowsHide:true}
 let version,status
 try{version=(await run(binary,['--version'],options)).stdout.trim()}catch{throw failure('CLAUDE_CLI_UNAVAILABLE')}
 // Pin the tested wire/SDK pair; do not silently adopt a different native protocol.
 if(!/^2\.1\.319\b/.test(version))throw failure('CLAUDE_CLI_VERSION_UNSUPPORTED')
 try{status=JSON.parse((await run(binary,['auth','status'],options)).stdout)}catch{throw failure('CLAUDE_LOGIN_REQUIRED')}
 if(status.loggedIn!==true||status.authMethod!=='claude.ai')throw failure('CLAUDE_SUBSCRIPTION_LOGIN_REQUIRED')
 return {version:'2.1.319',authenticated:true,authMethod:'claude.ai'}
}
