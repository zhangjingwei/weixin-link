import {terminateMaintenance} from './maintenance-run.mjs'
import {spawn,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {findCodex} from './install-config.mjs'
import {ensureAccountCodexHome} from '../infrastructure/accounts/codex-home.mjs'
const exec=promisify(execFile)
export function parseDeviceLogin(text){const clean=text.replace(/\x1b\[[0-9;]*[A-Za-z]/g,'');const code=clean.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4,5}\b/)?.[0];const url=clean.match(/https:\/\/auth\.openai\.com\/(?:codex\/)?device\b/)?.[0];return code&&url?{code,url}:null}
export async function deviceLogin({binary=findCodex(),send,prefixArgs=[],signal,timeoutMs=600000,accountId=process.env.WECHAT_ACCOUNT??'default',home,language='zh'}={}){
 const env={...process.env,CODEX_HOME:await ensureAccountCodexHome(accountId,home)}
 try{await exec(binary,[...prefixArgs,'login','status'],{timeout:10000,env});return {status:'already_logged_in'}}catch{}
 const help=await exec(binary,[...prefixArgs,'login','--help'],{timeout:10000,env});if(!help.stdout.includes('--device-auth'))throw Error('DEVICE_LOGIN_UNSUPPORTED')
 signal?.throwIfAborted()
 const child=spawn(binary,[...prefixArgs,'login','--device-auth'],{stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32',env});let buffer='',sent=false,delivery=Promise.resolve()
 let stopping;const stop=()=>{stopping??=terminateMaintenance(child);void stopping.catch(()=>{})};signal?.addEventListener('abort',stop,{once:true})
 const result=await new Promise((ok,fail)=>{const timer=setTimeout(()=>{stop();fail(Error('DEVICE_LOGIN_TIMEOUT'))},timeoutMs);const consume=chunk=>{buffer=(buffer+chunk.toString()).slice(-16000);const data=parseDeviceLogin(buffer);if(data&&!sent){sent=true;const message=language==='en'?'For this Codex sign-in only:\n'+data.url+'\nDevice code: '+data.code+'\nComplete authorization on the official page. The code is not saved.':'仅为你本次 Codex 登录使用：\n'+data.url+'\n设备验证码：'+data.code+'\n请在官方页面完成授权，验证码不写入安装记录。';delivery=Promise.resolve(send(message,{sensitive:true})).then(result=>{if(result?.status&&result.status!=='accepted')throw Error('LOGIN_PROMPT_DELIVERY_UNCONFIRMED');return result}).catch(()=>{stop();throw Error('LOGIN_PROMPT_DELIVERY_UNCONFIRMED')});void delivery.catch(()=>{})}};child.stdout.on('data',consume);child.stderr.on('data',consume);child.on('error',()=>{clearTimeout(timer);fail(Error('CODEX_START_FAILED'))});child.on('close',async code=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);if(stopping)await stopping;buffer='';if(signal?.aborted)return fail(Error('SETUP_CANCELLED'));delivery.then(()=>code===0?ok({status:'login_process_completed'}):fail(Error('DEVICE_LOGIN_FAILED')),fail)})})
 await exec(binary,[...prefixArgs,'login','status'],{timeout:10000,env}).catch(()=>{throw Error('LOGIN_NOT_VERIFIED')});return {status:'logged_in'}
}
