import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {doubaoEnvironment} from './environment.mjs'
export async function inspectDoubao(binary,{env=process.env,run=promisify(execFile)}={}){
 let version
 try{version=(await run(binary,['--version'],{env:doubaoEnvironment(env),timeout:15000,maxBuffer:16384,windowsHide:true})).stdout.trim()}catch{throw Object.assign(Error('DOUBAO_CLI_UNAVAILABLE'),{code:'DOUBAO_CLI_UNAVAILABLE'})}
 if(!/^(?:doubao\s+)?2\.38\.2\b/i.test(version))throw Object.assign(Error('DOUBAO_CLI_VERSION_UNSUPPORTED'),{code:'DOUBAO_CLI_VERSION_UNSUPPORTED'})
 return {version:'2.38.2',authentication:'not_checked'}
}
