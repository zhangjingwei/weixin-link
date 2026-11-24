import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {realpath} from 'node:fs/promises'
import {isAbsolute} from 'node:path'
const execute=promisify(execFile)

// Inspect only an authoritative thread directory, with no hooks or fsmonitor.
export async function conversationRepository(path,{run=execute}={}){
 if(typeof path!=='string'||!isAbsolute(path)||/[\0\r\n]/.test(path))throw Error('MANAGEMENT_REPOSITORY_UNAVAILABLE')
 const cwd=await realpath(path).catch(()=>{throw Error('MANAGEMENT_REPOSITORY_UNAVAILABLE')})
 const env={...process.env}
 for(const key of ['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_INDEX_FILE'])delete env[key]
 let stdout
 try{({stdout}=await run('git',['-c','core.fsmonitor=false','-C',cwd,'rev-parse','--path-format=absolute','--show-toplevel','--git-common-dir'],{timeout:5000,maxBuffer:16384,env}))}
 catch(error){if(error.code===128&&/not a git repository/i.test(error.stderr??''))return null;throw Error('MANAGEMENT_REPOSITORY_UNAVAILABLE')}
 const lines=stdout.trim().split(/\r?\n/)
 if(lines.length!==2||!lines.every(isAbsolute))throw Error('MANAGEMENT_REPOSITORY_UNAVAILABLE')
 try{return {root:await realpath(lines[0]),commonDir:await realpath(lines[1])}}catch{throw Error('MANAGEMENT_REPOSITORY_UNAVAILABLE')}
}
