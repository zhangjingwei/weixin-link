import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
import {randomUUID} from 'node:crypto'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {writeFile,unlink} from 'node:fs/promises'
import {readPrivateFile,atomicConfigWrite} from './config-files.mjs'
import {xml,userHome} from './platform-service.mjs'
import {standardDeployment} from './upgrade.mjs'
import {RemoteStore} from '../infrastructure/storage/registry-lock.mjs'
import {readChatUpgrade} from './chat-upgrade.mjs'

const exec=promisify(execFile)
const root=fileURLToPath(new URL('../../',import.meta.url))
export const agentSwitchPath=account=>join(account.stateDir,'agent-switch.json')

export function agentSwitchCommand(text=''){
 const value=text.trim().replace(/[。！!]$/,'')
 if(value==='重启'||value.toLowerCase()==='restart')return {action:'restart',target:null}
 return null
}

export async function readAgentSwitch(account){
 const text=await readPrivateFile(agentSwitchPath(account))
 if(text===null)return null
 let value
 try{value=JSON.parse(text)}catch{throw Error('AGENT_SWITCH_STATE_INVALID')}
 if(!value||!['waiting_idle','committing','complete','failed'].includes(value.status)||typeof value.id!=='string')throw Error('AGENT_SWITCH_STATE_INVALID')
 if(value.target!=='codex'||value.previous!=='codex')return null
 return value
}

export async function saveAgentSwitch(account,value){
 await atomicConfigWrite(agentSwitchPath(account),JSON.stringify(value,null,2)+'\n',{backup:false})
}

export async function scheduleAgentSwitch(account,request,{platform=process.platform,run=exec,start=spawn,home=userHome()}={}){
 const script=join(root,'src/setup/agent-switch-worker.mjs'),args=[script,account.id,request.id]
 if(platform==='linux'){
  await run('systemd-run',['--user','--unit=wechat-agent-switch-'+request.id.slice(0,12),'--collect','--property=UMask=0077',process.execPath,...args],{timeout:15000})
  return
 }
 if(platform==='darwin'){
  const label='com.wechat-assistant.agent-switch.'+request.id.replaceAll('-','')
  const path=join(account.stateDir,'agent-switch-'+request.id+'.plist')
  const plist=`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${[process.execPath,...args].map(a=>'<string>'+xml(a)+'</string>').join('')}</array><key>EnvironmentVariables</key><dict><key>HOME</key><string>${xml(home)}</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><false/></dict></plist>\n`
  await writeFile(path,plist,{mode:0o600})
  try{await run('launchctl',['bootstrap','gui/'+process.getuid(),path],{timeout:15000})}catch(error){await unlink(path).catch(()=>{});throw error}
  return
 }
 if(platform==='win32'){
  const child=start(process.execPath,args,{detached:true,stdio:'ignore',windowsHide:true,env:{...process.env,HOME:home}})
  child.unref()
  return
 }
 throw Error('AGENT_SWITCH_PLATFORM_UNSUPPORTED')
}

export class AgentSwitcher{
 constructor({account,home=userHome(),schedule=scheduleAgentSwitch,deployment=standardDeployment,targetRoot=root,lock}={}){Object.assign(this,{account,home,schedule,deployment,targetRoot});this.lock=lock??(fn=>new RemoteStore(account.stateDir).locked('agent-switch-request',fn))}
 async handle(command,reply){
  if(command.action!=='restart')throw Error('AGENT_SWITCH_UNSUPPORTED')
  const pending=await readAgentSwitch(this.account)
  if(pending&&['waiting_idle','committing'].includes(pending.status)){await reply('已有维护任务进行中，未重复安排。');return}
  const upgrade=await readChatUpgrade(this.home)
  if(upgrade&&['waiting_idle','running'].includes(upgrade.status)){await reply('升级正在等待或执行，暂不安排重启。');return}
  const deployment=await this.deployment({target:this.targetRoot,home:this.home})
  if(!deployment.services.some(service=>service.id===this.account.id&&service.active))throw Error('AGENT_SWITCH_SERVICE_UNAVAILABLE')
  const outcome=await this.lock(async()=>{
   const latest=await readAgentSwitch(this.account)
   if(latest&&['waiting_idle','committing'].includes(latest.status))return {pending:latest.target}
   const request={id:randomUUID(),target:'codex',previous:'codex',status:'waiting_idle'}
   await saveAgentSwitch(this.account,request)
   try{await this.schedule(this.account,request,{home:this.home})}catch(error){await saveAgentSwitch(this.account,{...request,status:'failed'});throw error}
   return {scheduled:true}
  })
  if(outcome.pending){await reply('已有维护任务进行中，未重复安排。');return}
  await reply('已安排本账号空闲后重启。完成后发“服务状态”核对。')
 }
}
