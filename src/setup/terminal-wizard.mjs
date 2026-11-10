import {emitKeypressEvents} from 'node:readline'
import {homedir} from 'node:os'
import {assertAccount} from '../infrastructure/accounts/account-store.mjs'
import {accountProviderProfile,clearProviderProfile} from './provider-profile.mjs'
import {configureProvider} from './provider-config-cli.mjs'
import {deviceLogin} from './setup-login.mjs'
import {checkCodex} from './setup-core.mjs'
import {probeTerminalModel} from './terminal-model-probe.mjs'
import {clearTerminalSetupStatus,writeTerminalSetupStatus,terminalSetupFingerprint} from './terminal-setup-status.mjs'
import {ServiceManager} from './platform-service.mjs'
import {AgentSwitcher} from './agent-switch.mjs'
import {setupLanguage,installerCommand} from './setup-locale.mjs'

const providers={1:'subscription',2:'deepseek',3:'qwen',4:'kimi'}
const messages={
 zh:{names:{subscription:'订阅登录',deepseek:'DeepSeek',qwen:'Qwen',kimi:'Kimi'},menu:'\nCodex 模型接入',current:'（当前：',choice:'\n1. 订阅登录（OpenAI/ChatGPT）\n2. DeepSeek\n3. Qwen（百炼按量付费）\n4. Kimi（国际平台）\n0. 稍后配置\n请选择：',deferred:command=>'模型接入尚未验证。微信连接后会提示如何继续；稍后可重新运行 '+command+' 并选择“配置模型”。',invalid:'请输入 0、1、2、3 或 4。',login:'正在打开 Codex 订阅授权；请按终端显示的官方链接和设备码完成登录。',key:name=>'请在本机输入 '+name+' 的 API Key；密钥不会显示或发送到微信。',check:'正在检查 Codex 连接和原生接口…',probe:'正在进行一次真实模型推理测试…',done:(name,restarted)=>'✓ '+name+' 已配置并通过模型测试。'+(restarted?'已安排本账号空闲后重启。':'请继续完成微信登录。'),failed:code=>'配置或验收未完成（'+code+'）。可重试、改选提供商或稍后配置。'},
 en:{names:{subscription:'Subscription sign-in',deepseek:'DeepSeek',qwen:'Qwen',kimi:'Kimi'},menu:'\nCodex model setup',current:' (current: ',choice:'\n1. Subscription sign-in (OpenAI/ChatGPT)\n2. DeepSeek\n3. Qwen (Alibaba Cloud pay as you go)\n4. Kimi (international platform)\n0. Configure later\nChoose: ',deferred:command=>'Model access has not been verified. After WeChat login, rerun '+command+' and choose Configure model to continue.',invalid:'Enter 0, 1, 2, 3, or 4.',login:'Open the official Codex device sign-in link shown in this terminal and enter its code.',key:name=>'Enter the '+name+' API key on this computer. It will not be displayed or sent to WeChat.',check:'Checking the Codex connection and native API…',probe:'Running a real model inference test…',done:(name,restarted)=>'✓ '+name+' is configured and passed the model test. '+(restarted?'This account will restart when idle.':'Continue with WeChat login.'),failed:code=>'Setup or verification did not finish ('+code+'). Retry, choose another provider, or configure later.'},
}

export async function terminalChoice(prompt){
 if(!process.stdin.isTTY||!process.stdout.isTTY)throw Error('TERMINAL_SETUP_REQUIRES_TTY')
 const options=[...prompt.matchAll(/(?:^|\n)([0-9])\. ([^\n]+)/g)].map(match=>({value:match[1],label:match[2]}))
 if(!options.length)throw Error('INVALID_SETUP_MENU')
 const title=prompt.slice(0,prompt.indexOf('\n1.')).trim()
 const hint=prompt.includes('请选择：')?'用 ↑/↓ 选择，回车确认：':'Use ↑/↓ to choose, then press Enter:'
 let selected=0
 const draw=()=>{for(let i=0;i<options.length;i++)process.stdout.write(`\x1b[2K${i===selected?'> ':'  '}${options[i].label}\n`)}
 process.stdout.write(`\n${title}\n${hint}\n`)
 draw()
 const wasRaw=process.stdin.isRaw
 emitKeypressEvents(process.stdin)
 process.stdin.setRawMode(true)
 process.stdin.resume()
 return new Promise((resolve,reject)=>{
  const finish=(error,value)=>{
   process.stdin.off('keypress',onKey)
   process.stdin.setRawMode(wasRaw)
   process.stdin.pause()
   process.stdout.write('\n')
   error?reject(error):resolve(value)
  }
  const onKey=(character,key={})=>{
   if(key.ctrl&&key.name==='c')return finish(Error('SETUP_CANCELLED'))
   if(key.name==='return'||key.name==='enter')return finish(null,options[selected].value)
   const old=selected
   if(key.name==='up')selected=(selected+options.length-1)%options.length
   else if(key.name==='down')selected=(selected+1)%options.length
   else {const index=options.findIndex(option=>option.value===character);if(index>=0)selected=index;else return}
   if(selected!==old){process.stdout.write(`\x1b[${options.length}A`);draw()}
  }
  process.stdin.on('keypress',onKey)
 })
}

export async function applyTerminalSetupToService(account,home){
 const service=new ServiceManager({home})
 if(!(await service.status(account.service)).active)return false
 let scheduled=false
 await new AgentSwitcher({account,home}).handle({action:'restart'},async message=>{scheduled=message.startsWith('已安排')||message.startsWith('已有维护任务')})
 if(!scheduled)throw Error('MODEL_SERVICE_RESTART_NOT_SCHEDULED')
 return true
}

export async function runTerminalWizard({accountId='default',home=process.env.HOME||homedir(),language=setupLanguage(),choose=terminalChoice,configure=configureProvider,login=deviceLogin,check=checkCodex,probe=probeTerminalModel,applyService=applyTerminalSetupToService,write=text=>console.log(text)}={}){
 const m=messages[language]
 if(!m)throw Error('INVALID_SETUP_LANGUAGE')
 const account=await assertAccount(accountId,home)
 while(true){
  const existing=await accountProviderProfile(accountId,home)
  const choice=await choose(m.menu+(existing?m.current+m.names[existing.kind]+(language==='zh'?'）':')'):'')+m.choice)
  if(choice==='0'){write(m.deferred(installerCommand('setup',{accountId,language})));return {verified:false,deferred:true}}
  const kind=providers[choice]
  if(!kind){write(m.invalid);continue}
  try{
   await clearTerminalSetupStatus(account.stateDir)
   if(kind==='subscription'){
    write(m.login)
    await login({accountId,home,language,send:text=>{write(text);return {status:'accepted'}}})
    if(existing)await clearProviderProfile({accountId,home})
   }else{
    write(m.key(m.names[kind]))
    await configure(kind,accountId,{home,language})
   }
   write(m.check)
   await check({accountId,home})
   write(m.probe)
   const result=await probe({accountId,home})
   if(result.verified!==true||result.provider!==kind)throw Error('MODEL_PROBE_FAILED')
   await writeTerminalSetupStatus(account.stateDir,{...result,language,fingerprint:terminalSetupFingerprint(await accountProviderProfile(accountId,home))})
   const restarted=await applyService(account,home)
   write(m.done(m.names[kind],restarted))
   return result
  }catch(error){await clearTerminalSetupStatus(account.stateDir);const code=/^[A-Z0-9_]+$/.test(error.message)?error.message:'TERMINAL_SETUP_FAILED';write(m.failed(code))}
 }
}
