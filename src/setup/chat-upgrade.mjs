import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
import {randomUUID} from 'node:crypto'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {writeFile,unlink} from 'node:fs/promises'
import {xml,userHome} from './platform-service.mjs'
import {readPrivateFile,atomicConfigWrite} from './config-files.mjs'
import {standardDeployment} from './upgrade.mjs'
import {githubLatestRelease,releaseTag,newerRelease,installedRelease} from '../core/updates/releases.mjs'
import {RemoteStore} from '../infrastructure/storage/registry-lock.mjs'

const exec=promisify(execFile)
const root=fileURLToPath(new URL('../../',import.meta.url))
const repository='zhangjingwei/weixin-link'
export const chatUpgradeCommand=text=>typeof text==='string'&&['升级','升级微信机器人'].includes(text.trim())?{action:'upgrade'}:null
export const chatUpgradePath=home=>join(home,'.local/share/weixin-link/chat-upgrade.json')

export async function readChatUpgrade(home){
 const text=await readPrivateFile(chatUpgradePath(home))
 if(text===null)return null
 let value;try{value=JSON.parse(text)}catch{throw Error('CHAT_UPGRADE_STATE_INVALID')}
 if(!value||!['waiting_idle','running','complete','failed'].includes(value.status)||typeof value.id!=='string'||!/^[0-9a-f]{40}$/.test(value.commit))throw Error('CHAT_UPGRADE_STATE_INVALID')
 return value
}
export async function saveChatUpgrade(home,value){await atomicConfigWrite(chatUpgradePath(home),JSON.stringify(value,null,2)+'\n',{backup:false})}

export async function scheduleChatUpgrade(request,{platform=process.platform,run=exec,start=spawn,home=userHome(),target=root}={}){
 const args=[join(root,'src/setup/chat-upgrade-worker.mjs'),request.id,target]
 if(platform==='linux'){await run('systemd-run',['--user','--unit=wechat-chat-upgrade-'+request.id.slice(0,12),'--collect','--property=UMask=0077',process.execPath,...args],{timeout:15000});return}
 if(platform==='darwin'){
  const label='com.wechat-assistant.chat-upgrade.'+request.id.replaceAll('-','')
  const path=join(home,'.local/share/weixin-link/chat-upgrade-'+request.id+'.plist')
  const plist=`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${[process.execPath,...args].map(a=>'<string>'+xml(a)+'</string>').join('')}</array><key>EnvironmentVariables</key><dict><key>HOME</key><string>${xml(home)}</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><false/></dict></plist>\n`
  await writeFile(path,plist,{mode:0o600})
  try{await run('launchctl',['bootstrap','gui/'+process.getuid(),path],{timeout:15000})}catch(error){await unlink(path).catch(()=>{});throw error}
  return
 }
 if(platform==='win32'){const child=start(process.execPath,args,{detached:true,stdio:'ignore',windowsHide:true,env:{...process.env,HOME:home}});child.unref();return}
 throw Error('CHAT_UPGRADE_PLATFORM_UNSUPPORTED')
}

export class ChatUpgrader{
 constructor({home=userHome(),target=root,latest=githubLatestRelease,deployment=standardDeployment,schedule=scheduleChatUpgrade,lock}={}){Object.assign(this,{home,target,latest,deployment,schedule});this.lock=lock??(fn=>new RemoteStore(join(home,'.local/share/weixin-link')).locked('chat-upgrade-request',fn))}
 async handle(reply,{traceId}={}){
  const current=await readChatUpgrade(this.home)
  if(current&&['waiting_idle','running'].includes(current.status)){await reply('升级已安排，正在等待空闲或执行中；未重复提交。');return}
  let marker
  try{marker=JSON.parse(await readPrivateFile(join(this.target,'.weixin-link-release.json')))}catch{await reply('当前安装版本来源未核实，未自动升级。');return}
  if(!installedRelease(marker)){await reply('当前安装版本来源未核实，未自动升级。');return}
  const release=await this.latest()
  if(!release){await reply('暂未发布正式版本，未安排升级。');return}
  const {tag,commit}=release
  if(!releaseTag(tag)||!/^[0-9a-f]{40}$/.test(commit??''))throw Error('CHAT_UPGRADE_REF_INVALID')
  if(!newerRelease(tag,marker.ref)||marker.ref==='main'&&commit.startsWith(marker.commit)){await reply('当前无需升级，最新正式版本为 '+tag+'。');return}
  const deployment=await this.deployment({target:this.target,home:this.home})
  if(!deployment.services.some(service=>service.active))throw Error('CHAT_UPGRADE_SERVICE_UNAVAILABLE')
  for(const service of deployment.services){
   if(!service.stateDir)throw Error('CHAT_UPGRADE_ACCOUNT_STATE_UNAVAILABLE')
   const text=await readPrivateFile(join(service.stateDir,'agent-switch.json'))
   if(text&&['waiting_idle','committing'].includes(JSON.parse(text).status)){await reply('账号维护正在进行，暂不安排升级。');return}
  }
  const outcome=await this.lock(async()=>{
   const pending=await readChatUpgrade(this.home)
   if(pending&&['waiting_idle','running'].includes(pending.status))return false
   const request={id:randomUUID(),tag,commit,previous:marker.commit,status:'waiting_idle',trace_id:/^[0-9a-f-]{36}$/i.test(traceId??'')?traceId:randomUUID()}
   await saveChatUpgrade(this.home,request)
   try{await this.schedule(request,{home:this.home,target:this.target})}catch(error){await saveChatUpgrade(this.home,{...request,status:'failed',stage:'schedule',error:'CHAT_UPGRADE_SCHEDULE_FAILED'});throw error}
   return true
  })
  await reply(outcome?`已安排空闲后升级到 ${tag}。完成后发“诊断”核对服务。`:'升级已安排，未重复提交。')
 }
}
