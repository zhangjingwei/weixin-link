import {ServiceManager} from '../setup/platform-service.mjs'
import {controlRequest} from '../core/runtime/runtime-control.mjs'
import {PairingState} from './pairing-state.mjs'
import {createSdkLogger} from '../core/diagnostics/diagnostic-log.mjs'
import {WeChatBot} from '@wechatbot/wechatbot'
import QRCode from 'qrcode'
import {readFile,writeFile,rename,unlink,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {setTimeout as delay} from 'node:timers/promises'
import {assertAccount,registerLogin} from './accounts.mjs'
const exec=promisify(execFile),p=await assertAccount(process.argv[2]);
const pairingTimeout=setTimeout(()=>process.exit(1),600000);pairingTimeout.unref()
const pairing=new PairingState(p.stateDir),state=status=>pairing.set(status)
const logger=createSdkLogger(()=>{}),bot=new WeChatBot({storage:'memory',logger});let qrWrites=Promise.resolve()
const get=bot.http.apiGet.bind(bot.http);bot.http.apiGet=async(base,path,headers)=>path.startsWith('/ilink/bot/get_qrcode_status?')?(await bot.http.request({method:'GET',url:new URL(path,base).toString(),headers,timeoutMs:65000})).data:get(base,path,headers)
try{
 await state('requesting_qr')
 const credentials=await bot.login({force:true,callbacks:{
  onQrUrl:url=>{qrWrites=qrWrites.then(async()=>{await state('requesting_qr');await pairing.publish(await QRCode.toBuffer(url,{type:'png',width:480,margin:4}));const current=JSON.parse(await readFile(join(p.stateDir,'pairing.json'),'utf8'));await writeFile(join(p.stateDir,'login-'+current.qr_version+'.terminal'),await QRCode.toString(url,{type:'terminal',small:true}),{mode:0o600})}).catch(()=>state('qr_write_failed'))},
  onScanned:()=>{qrWrites=qrWrites.then(()=>state('waiting_confirmation'))},
  onExpired:()=>{qrWrites=qrWrites.then(()=>state('qr_expired'))},
  onVerifyCode:async retry=>{await state(retry?'verification_code_rejected':'verification_code_required');for(let n=0;n<180;n++){try{const path=join(p.stateDir,'pairing-code.txt'),code=(await readFile(path,'utf8')).trim();await unlink(path);if(/^\d{4,12}$/.test(code))return code}catch(e){if(e.code!=='ENOENT')throw e}await delay(1000)}throw Error('VERIFICATION_TIMEOUT')}
 }})
 await qrWrites;await registerLogin(p.id,credentials);await writeFile(join(p.stateDir,'welcome-pending.json'),JSON.stringify({pending:true})+'\n',{mode:0o600});await state('logged_in')
 await new ServiceManager().start(p.service,{enable:true});let ready=false;for(let n=0;n<30;n++){try{if((await controlRequest(p.socket,'GET','/status')).ready){ready=true;break}}catch{}await delay(500)}if(!ready)throw Error('WECHAT_SERVICE_NOT_READY');await state('service_started');await rm(join(p.stateDir,'login.png'),{force:true})
}catch(error){const code=['WECHAT_ACCOUNT_ALREADY_REGISTERED','PROFILE_BOUND_TO_DIFFERENT_ACCOUNT','VERIFICATION_TIMEOUT','INVALID_OWNERS','WECHAT_SERVICE_NOT_READY'].includes(error.message)?error.message:'LOGIN_OR_START_FAILED';await state(code);process.exitCode=1}
