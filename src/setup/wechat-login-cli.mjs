import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
import {fileURLToPath} from 'node:url'
import {displayLoginLink} from './login-link-display.mjs'
import {setupLanguage,installerCommand} from './setup-locale.mjs'

const exec=promisify(execFile)
const manager=fileURLToPath(new URL('./account-manager.mjs',import.meta.url))

async function accountCommand(action,accountId,{run=exec}={}){
 try{
  const {stdout}=await run(process.execPath,[manager,action,accountId],{timeout:action==='stop'?650000:60000,maxBuffer:65536})
  const result=JSON.parse(stdout)
  if(result.ok===false)throw Error(result.error)
  return result
 }catch(error){
  let code
  try{code=JSON.parse(String(error.stdout)).error}catch{}
  throw Error(/^[A-Z][A-Z0-9_]*$/.test(code??error.message)?code??error.message:'WECHAT_LOGIN_FAILED')
 }
}

async function waitForLogin(accountId,{start=spawn,language}={}){
 const child=start(process.execPath,[manager,'verify-wait',accountId,'--human'],{stdio:'inherit',env:{...process.env,WEIXIN_LINK_LANG:language}})
 return new Promise((resolve,reject)=>{
  child.on('error',()=>reject(Error('VERIFICATION_FLOW_FAILED')))
  child.on('exit',code=>code===0?resolve():reject(Error('VERIFICATION_FLOW_FAILED')))
 })
}

export async function runWeChatLogin({accountId='default',relogin=false,human=false,language=setupLanguage(),run=exec,start=spawn,output=process.stdout,showLoginLink=displayLoginLink}={}){
 const en=language==='en'
 const list=await accountCommand('list',accountId,{run})
 const current=list.accounts?.find(row=>row.account===accountId)
 if(!current)throw Error('ACCOUNT_NOT_FOUND')
 if(current.ready&&!relogin){if(human)output.write(en?'The local service is ready. If WeChat was unlinked, rerun '+installerCommand('relogin',{accountId,language})+' and choose 3.\n':'本地服务已就绪。如微信已解绑，请重新运行 '+installerCommand('relogin',{accountId,language})+' 并选择 3。\n');return {status:'already_ready',account:accountId}}
 if(current.service_active&&!relogin)throw Error('ACCOUNT_RUNNING_NOT_READY')
 if(current.service_active){if(human)output.write(en?'Waiting for current tasks to finish and stopping this account safely…\n':'正在等待当前任务结束并安全停止本账号服务…\n');const stopped=await accountCommand('stop',accountId,{run});if(stopped.status!=='stopped')throw Error('ACCOUNT_STOP_UNCONFIRMED')}
 const login=await accountCommand('refresh-qr',accountId,{run})
 if(login.status!=='scan_to_login'||typeof login.url!=='string')throw Error('LOGIN_URL_UNAVAILABLE')
 await showLoginLink(login,{output,human,language})
 if(human)output.write(en?'Confirm with WeChat on your phone. If prompted for a PIN, enter it in this terminal.\n':'请在手机微信确认；如需 PIN，请按本终端提示输入。\n')
 if(output.isTTY&&process.stdin.isTTY){await waitForLogin(accountId,{start,language});return {status:'logged_in',account:accountId}}
 return {status:'scan_to_login',account:accountId}
}
