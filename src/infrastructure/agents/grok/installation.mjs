import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {grokEnvironment} from './environment.mjs'
export async function inspectGrok(binary,{env=process.env,run=promisify(execFile)}={}){
 let version
 try{version=(await run(binary,['--version'],{env:grokEnvironment(env),timeout:15000,maxBuffer:16384,windowsHide:true})).stdout.trim()}catch{throw Object.assign(Error('GROK_CLI_UNAVAILABLE'),{code:'GROK_CLI_UNAVAILABLE'})}
 if(!/^(?:grok\s+)?1\.0\.92\b/i.test(version))throw Object.assign(Error('GROK_CLI_VERSION_UNSUPPORTED'),{code:'GROK_CLI_VERSION_UNSUPPORTED'})
 return {version:'1.0.92',authentication:'not_checked'}
}
