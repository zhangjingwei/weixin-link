import {randomUUID} from 'node:crypto'
import {readFile,writeFile,rename,rm} from 'node:fs/promises'
import {join} from 'node:path'

// A completed QR login is a new welcome event. Restarts reuse the same request.
export async function recordWelcomeRequest(stateDir) {
  const loginId=randomUUID()
  const path=join(stateDir,'welcome-pending.json'), temp=path+'.'+loginId+'.tmp'
  try{
    await writeFile(temp,JSON.stringify({pending:true,loginId})+'\n',{flag:'wx',mode:0o600})
    await rename(temp,path)
  }finally{await rm(temp,{force:true})}
  return loginId
}

export async function readWelcomeRequest(stateDir) {
  let request
  try{request=JSON.parse(await readFile(join(stateDir,'welcome-pending.json'),'utf8'))}
  catch(error){if(error.code==='ENOENT')return {};throw error}
  if(request?.pending!==true)return {}
  // Older installations recorded only the boolean. Keep their original deduplication.
  if(request.loginId===undefined)return {welcomePending:true}
  if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(request.loginId))throw Error('WELCOME_REQUEST_INVALID')
  return {welcomePending:true,loginId:request.loginId}
}
