import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
import {randomUUID} from 'node:crypto'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {writeFile,unlink,access} from 'node:fs/promises'
import {constants} from 'node:fs'
import {readPrivateFile,atomicConfigWrite} from './config-files.mjs'
import {xml,userHome} from './platform-service.mjs'
import {standardDeployment} from './upgrade.mjs'
import {agentKinds} from '../infrastructure/agents/agent-selection.mjs'
import {RemoteStore} from '../infrastructure/storage/registry-lock.mjs'
import {readChatUpgrade} from './chat-upgrade.mjs'

const exec=promisify(execFile)
const root=fileURLToPath(new URL('../../',import.meta.url))
const names={codex:'Codex',claude:'Claude'}
export const agentSwitchPath=account=>join(account.stateDir,'agent-switch.json')

export function agentSwitchCommand(text=''){
 const value=text.trim().replace(/[。！!]$/,'')
 if(value==='重启')return {action:'restart',target:null}
 if(value==='切换智能体'||/^\/agent$/i.test(value))return {action:'agent',target:null}
 const match=value.match(/^(?:切换智能体\s*|\/agent\s+)(codex|claude)$/i)
 return match?{action:'agent',target:match[1].toLowerCase()}:null
}

export async function readAgentSwitch(account){
 const text=await readPrivateFile(agentSwitchPath(account))
 if(text===null)return null
 let value
 try{value=JSON.parse(text)}catch{throw Error('AGENT_SWITCH_STATE_INVALID')}
 if(!value||!['waiting_idle','committing','complete','failed'].includes(value.status)||!agentKinds.includes(value.target)||typeof value.id!=='string')throw Error('AGENT_SWITCH_STATE_INVALID')
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
 constructor({account,installation,agentKind,home=userHome(),backendReady,schedule=scheduleAgentSwitch,deployment=standardDeployment,targetRoot=root,lock}={}){Object.assign(this,{account,installation,agentKind,home,backendReady,schedule,deployment,targetRoot});this.lock=lock??(fn=>new RemoteStore(account.stateDir).locked('agent-switch-request',fn))}
 async handle(command,reply){
  const current=this.agentKind,pending=await readAgentSwitch(this.account)
  const restarting=command.action==='restart'
  if(!command.target&&!restarting){
   await reply(`当前智能体：${names[current]}。可发送“切换智能体 Codex”或“切换智能体 Claude”。${pending?.status==='waiting_idle'||pending?.status==='committing'?`\n正在切换到 ${names[pending.target]}，结果以服务重启后“切换智能体”查询为准。`:pending?.status==='failed'?`\n上次切换未完成，当前仍以运行状态为准。`:''}`)
   return
  }
  const target=restarting?current:command.target
  if(pending&&['waiting_idle','committing'].includes(pending.status)){await reply('已有维护任务进行中，未重复安排。');return}
  const upgrade=await readChatUpgrade(this.home)
  if(upgrade&&['waiting_idle','running'].includes(upgrade.status)){await reply('升级正在等待或执行，暂不安排重启或切换。');return}
  if(target===current&&!restarting){await reply(`当前已使用 ${names[target]}，未重启服务。`);return}
  if(target==='claude'&&!restarting){
   const binary=this.installation.claudeBinary
   if(!binary){await reply('Claude CLI 路径尚未在安装配置中设置，未切换。');return}
   try{await access(binary,constants.X_OK);const {stdout}=await exec(binary,['--version'],{timeout:10000,maxBuffer:65536});const match=stdout.match(/\b(\d+)\.(\d+)\.(\d+)\b/);if(!match||Number(match[1])<2||Number(match[1])===2&&Number(match[2])<1||Number(match[1])===2&&Number(match[2])===1&&Number(match[3])<259)throw Error()}catch{await reply('Claude CLI 未通过版本或可执行检查，未切换。');return}
   if(![process.env.ANTHROPIC_API_KEY,process.env.CLAUDE_CODE_USE_BEDROCK,process.env.CLAUDE_CODE_USE_VERTEX,process.env.CLAUDE_CODE_USE_FOUNDRY].some(Boolean)){await reply('Claude API 凭据尚未提供给当前服务，未切换。');return}
  }else if(this.backendReady&&!restarting){
   const result=await this.backendReady()
   if(!result.installed||!result.loggedIn){await reply('Codex 未通过安装与登录检查，未切换。');return}
  }
  const deployment=await this.deployment({target:this.targetRoot,home:this.home})
  if(!deployment.services.some(service=>service.id===this.account.id&&service.active))throw Error('AGENT_SWITCH_SERVICE_UNAVAILABLE')
  const outcome=await this.lock(async()=>{
   const latest=await readAgentSwitch(this.account)
   if(latest&&['waiting_idle','committing'].includes(latest.status))return {pending:latest.target}
   const request={id:randomUUID(),target,previous:current,status:'waiting_idle'}
   await saveAgentSwitch(this.account,request)
   try{await this.schedule(this.account,request,{home:this.home})}catch(error){await saveAgentSwitch(this.account,{...request,status:'failed'});throw error}
   return {scheduled:true}
  })
  if(outcome.pending){await reply('已有维护任务进行中，未重复安排。');return}
  await reply(restarting?'已安排本账号空闲后重启。完成后发“服务状态”核对。':`已安排本账号空闲后切换到 ${names[target]}。现有会话按底座分别保存；切换结果请在服务重启后发送“切换智能体”核对。`)
 }
}
