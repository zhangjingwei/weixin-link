import {createHash,randomUUID} from 'node:crypto'
import {readFile,writeFile,rename,unlink,lstat} from 'node:fs/promises'
import {join} from 'node:path'
import {deliveryError} from '../infrastructure/wechat/delivery-error.mjs'

const RELEASE=/^[0-9a-f]{7,40}$/
export const WELCOME_MESSAGE='微信助手已连接。首次模型配置请在安装电脑的终端完成；需要时运行 node src/setup/setup.mjs wizard。'
export const welcomeMessage=language=>language==='en'?'Weixin Link is connected. Complete model setup in your computer terminal with node src/setup/setup.mjs wizard --lang en if needed.':WELCOME_MESSAGE
export const upgradeMessage=(commit,language='zh')=>language==='en'?`Weixin Link upgraded to ${commit.slice(0,7)} and is connected. Send status to view tasks, diagnostics to check the service, or guide for help.`:`微信助手已升级到 ${commit.slice(0,7)}，服务已连接。可直接发消息；发「状态」查看任务，发「诊断」检查服务，发「使用说明」查看帮助。`

export class LifecycleNotice{
 constructor({stateDir,sourceDir,owners,welcomePending=false,welcomeText=async()=>WELCOME_MESSAGE,language='zh',send,log=()=>{}}){Object.assign(this,{stateDir,sourceDir,owners:[...new Set(owners)],welcomePending,welcomeText,language,send,log});this.locks=new Map();this.commit=null;this.started=false}
 path(owner){return join(this.stateDir,'lifecycle-notice-'+createHash('sha256').update(owner).digest('hex').slice(0,24)+'.json')}
 async legacyWelcomed(owner){try{return JSON.parse(await readFile(join(this.stateDir,'welcome-'+createHash('sha256').update(owner).digest('hex').slice(0,24)+'.json'),'utf8')).state==='accepted'}catch{return false}}
 async release(){try{const value=JSON.parse(await readFile(join(this.sourceDir,'.weixin-link-release.json'),'utf8'));return value.version===1&&value.repository==='zhangjingwei/weixin-link'&&value.ref==='main'&&RELEASE.test(value.commit)?value.commit:null}catch{return null}}
 async read(owner){
  const path=this.path(owner)
  try{const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>1024)throw Error('LIFECYCLE_NOTICE_STATE_INVALID')}
  catch(error){if(error.code==='ENOENT')return null;throw error}
  const value=JSON.parse(await readFile(path,'utf8'))
  if(value.version!==1||!['welcome','upgrade'].includes(value.kind)||!['pending','sending','accepted','deferred','unknown'].includes(value.status)||value.commit!==null&&!RELEASE.test(value.commit))throw Error('LIFECYCLE_NOTICE_STATE_INVALID')
  return value
 }
 async write(owner,value){const path=this.path(owner),temp=path+'.'+randomUUID()+'.tmp';try{await writeFile(temp,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});await rename(temp,path)}finally{await unlink(temp).catch(()=>{})}}
 serialize(owner,work){const next=(this.locks.get(owner)??Promise.resolve()).catch(()=>{}).then(work);this.locks.set(owner,next);return next.finally(()=>{if(this.locks.get(owner)===next)this.locks.delete(owner)})}
 async start(){this.commit=await this.release();this.started=true;await Promise.all(this.owners.map(owner=>this.attempt(owner,false).catch(error=>this.log('lifecycle_notice.failed',{userId:owner,code:/^LIFECYCLE_[A-Z_]+$/.test(error.message)?error.message:'LIFECYCLE_NOTICE_FAILED'}))))}
 async onInbound(owner){if(!this.owners.includes(owner))return;if(!this.started){this.commit=await this.release();this.started=true}return this.attempt(owner,true)}
 attempt(owner,inbound){return this.serialize(owner,async()=>{
  let value=await this.read(owner)
  if(!value||value.commit!==this.commit){
   if(!this.commit&&!this.welcomePending)return null
   value={version:1,kind:!value&&this.welcomePending&&!await this.legacyWelcomed(owner)?'welcome':'upgrade',commit:this.commit,status:'pending'}
   await this.write(owner,value)
  }
  if(!['pending',...(inbound?['deferred']:[])].includes(value.status))return null
  const message=value.kind==='welcome'?await this.welcomeText(owner):upgradeMessage(value.commit,this.language)
  await this.write(owner,{...value,status:'sending'})
  let status='unknown'
  try{const result=await this.send(owner,message);status=result?.status==='accepted'?'accepted':'unknown'}
  catch(error){status=deliveryError(error).api_code===-2?'deferred':'unknown'}
  await this.write(owner,{...value,status})
  this.log('lifecycle_notice.delivery',{userId:owner,kind:value.kind,status})
  return status
 })}
}
