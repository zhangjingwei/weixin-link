import {readInstalledNotice} from '../infrastructure/updates/release-source.mjs'
import {createHash,randomUUID} from 'node:crypto'
import {readFile,writeFile,rename,unlink,lstat} from 'node:fs/promises'
import {join} from 'node:path'
import {deliveryError} from '../infrastructure/wechat/delivery-error.mjs'
import {installerCommand} from '../setup/setup-locale.mjs'

const RELEASE=/^(?:[0-9a-f]{7,40}|[0-9a-f]{64})$/
export const welcomeMessage=(language,accountId='default')=>language==='en'?'Weixin Link is connected. Complete model setup in your computer terminal with '+installerCommand('setup',{accountId,language:'en'})+' if needed.':'微信助手已连接。首次模型配置请在安装电脑的终端完成；需要时运行 '+installerCommand('setup',{accountId,language:'zh'})+'。'
export const upgradeMessage=(commit,language='zh',release)=>(language==='en'?`Weixin Link upgraded to ${release?.tag??commit.slice(0,7)} and is connected. You can ask how your tasks are progressing, whether the service is working, or how to use the assistant.`:`微信助手已升级到 ${release?.tag??commit.slice(0,7)}，服务已连接。可以直接说你的需求，例如“看看任务进展”“检查助手是否正常”或“介绍一下怎么用”。`)+(release?'\n\n'+release.details:'')

export class LifecycleNotice{
 constructor({stateDir,sourceDir,owners,welcomePending=false,loginId,welcomeText,language='zh',send,log=()=>{}}){Object.assign(this,{stateDir,sourceDir,owners:[...new Set(owners)],welcomePending,loginId,welcomeText:welcomeText??(async()=>welcomeMessage(language)),language,send,log});this.locks=new Map();this.commit=null;this.started=false}
 path(owner){return join(this.stateDir,'lifecycle-notice-'+createHash('sha256').update(owner).digest('hex').slice(0,24)+'.json')}
 async release(){
  try{this.installed=await readInstalledNotice(this.sourceDir,this.language)}catch{this.installed=null}
  return this.installed?.commit??null
 }
 async read(owner){
  const path=this.path(owner)
  try{const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>1024)throw Error('LIFECYCLE_NOTICE_STATE_INVALID')}
  catch(error){if(error.code==='ENOENT')return null;throw error}
  const value=JSON.parse(await readFile(path,'utf8'))
  if(value.version!==1||!['welcome','upgrade'].includes(value.kind)||!['pending','sending','accepted','deferred','unknown','suppressed'].includes(value.status)||value.commit!==null&&!RELEASE.test(value.commit))throw Error('LIFECYCLE_NOTICE_STATE_INVALID')
  return value
 }
 async write(owner,value){const path=this.path(owner),temp=path+'.'+randomUUID()+'.tmp';try{await writeFile(temp,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});await rename(temp,path)}finally{await unlink(temp).catch(()=>{})}}
 serialize(owner,work){const next=(this.locks.get(owner)??Promise.resolve()).catch(()=>{}).then(work);this.locks.set(owner,next);return next.finally(()=>{if(this.locks.get(owner)===next)this.locks.delete(owner)})}
 async start(){this.commit=await this.release();this.started=true;await Promise.all(this.owners.map(owner=>this.attempt(owner,false).catch(error=>this.log('lifecycle_notice.failed',{userId:owner,code:/^LIFECYCLE_[A-Z_]+$/.test(error.message)?error.message:'LIFECYCLE_NOTICE_FAILED'}))))}
 async onInbound(owner){if(!this.owners.includes(owner))return;if(!this.started){this.commit=await this.release();this.started=true}return this.attempt(owner,true)}
 attempt(owner,inbound){return this.serialize(owner,async()=>{
  let value=await this.read(owner)
  const newLogin=this.loginId && value?.loginId!==this.loginId
  if(newLogin || !value || value.commit!==this.commit){
   const welcome=newLogin || (!value && this.welcomePending)
   if(!welcome && !this.commit)return null
   value={version:1,kind:welcome?'welcome':'upgrade',commit:this.commit,status:'pending',loginId:this.loginId??value?.loginId}
   await this.write(owner,value)
  }
  // Pairing is visible in setup. Do not inject welcome/help into a conversation.
  if(value.kind==='welcome'){
   if(value.status!=='suppressed')await this.write(owner,{...value,status:'suppressed'})
   return null
  }
  if(!['pending',...(inbound?['deferred']:[])].includes(value.status))return null
  const localUpdate=this.language==='en'?'Your WeChat assistant has been updated to the new local version.':'微信助手已更新到本地新版，可以继续使用了。'
  const release=value.kind==='upgrade'&&this.installed?.tag?this.installed:null
  const message=this.installed?.local?localUpdate:upgradeMessage(value.commit,this.language,release)
  await this.write(owner,{...value,status:'sending'})
  let status='unknown'
  try{const result=await this.send(owner,message);status=result?.status==='accepted'?'accepted':'unknown'}
  catch(error){status=deliveryError(error).api_code===-2?'deferred':'unknown'}
  await this.write(owner,{...value,status})
  this.log('lifecycle_notice.delivery',{userId:owner,kind:value.kind,status})
  return status
 })}
}
