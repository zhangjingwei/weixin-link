import {releaseDetails} from '../../domain/updates/release-notes.mjs'
import {releaseTag,newerRelease,installedRelease} from '../../domain/updates/release-version.mjs'
import {deliveryFailureState} from '../../infrastructure/wechat/delivery-error.mjs'
import {shouldPromptForUpdate} from '../../domain/delivery/notification-state.mjs'

const FULL_COMMIT=/^[0-9a-f]{40}$/
const CHECK_INTERVAL=60*60*1000

export class UpdateNotifier{
 constructor({stateStore,readInstalled,owners,send,ready=()=>true,fetchLatest,log=()=>{},intervalMs=CHECK_INTERVAL,initialDelayMs=60000,now=Date.now}){
  if(!stateStore||typeof stateStore.read!=='function'||typeof stateStore.write!=='function'||typeof readInstalled!=='function'||typeof fetchLatest!=='function')throw Error('UPDATE_NOTICE_PORT_INVALID')
  Object.assign(this,{stateStore,readInstalled,owners:[...new Set(owners)],send,ready,fetchLatest,log,intervalMs,initialDelayMs,now})
  this.ownerLocks=new Map();this.closed=false;this.timer=null;this.initialTimer=null;this.running=null
 }
 async release(){
  const value=await this.readInstalled()
  return installedRelease(value)?value:null
 }
 async readState(owner){
  const value=await this.stateStore.read(owner)
  if(value===null)return null
  if(value?.version!==1||!(releaseTag(value.tag)||FULL_COMMIT.test(value.commit??''))||!['sending','accepted','unknown','deferred','dismissed'].includes(value.status))throw Error('UPDATE_NOTICE_STATE_INVALID')
  if(value.skippedTags!==undefined&&(!Array.isArray(value.skippedTags)||!value.skippedTags.every(releaseTag)))throw Error('UPDATE_NOTICE_STATE_INVALID')
  return value
 }
 async writeState(owner,tag,status,skippedTags=[]){
  await this.stateStore.write(owner,{version:1,tag,status,at:new Date(this.now()).toISOString(),...(skippedTags.length?{skippedTags}:{})})
 }
 withOwner(owner,work){
  const next=(this.ownerLocks.get(owner)??Promise.resolve()).catch(()=>{}).then(work)
  this.ownerLocks.set(owner,next)
  return next.finally(()=>{if(this.ownerLocks.get(owner)===next)this.ownerLocks.delete(owner)})
 }
 async skip(owner,language='zh'){
  if(!this.owners.includes(owner))throw Error('UPDATE_NOTICE_OWNER_INVALID')
  return this.withOwner(owner,async()=>{
   const previous=await this.readState(owner)
   if(!releaseTag(previous?.tag))return language==='en'?'There is no notified release to skip. No preference was changed.':'当前没有可跳过的新版本提示，未更改设置。'
   const skippedTags=[...new Set([...(previous.skippedTags??[]),previous.tag])]
   await this.writeState(owner,previous.tag,'dismissed',skippedTags)
   return language==='en'?`Skipped ${previous.tag}. This release will not be suggested again; newer releases can still notify you. You can still use check-updates or upgrade explicitly.`:`已跳过 ${previous.tag}，不再提示这个版本；后续新版本仍会提醒。仍可主动“检查更新”或“升级”。`
  })
 }
 async check(){
  if(this.closed||!this.ready())return
  const installed=await this.release()
  if(!installed)return
  const latest=await this.fetchLatest()
  if(!latest)return
  if(!releaseTag(latest.tag)||!FULL_COMMIT.test(latest.commit??''))throw Error('UPDATE_CHECK_RESPONSE_INVALID')
  if(!newerRelease(latest.tag,installed.ref)||latest.commit.startsWith(installed.commit)&&installed.ref==='main'||this.closed||!this.ready())return
  const message=`发现新版本（当前 ${releaseTag(installed.ref)?installed.ref:'旧开发版'}，最新 ${latest.tag}）。回复“升级”可在空闲后安装；不会自动升级。回复“不升级”或“取消”可跳过这个版本，后续新版本仍会提醒。\n\n${releaseDetails(latest)}`
  for(const owner of this.owners){
   if(this.closed||!this.ready())return
   await this.withOwner(owner,async()=>{
    if(this.closed||!this.ready())return
    let previous
    try{previous=await this.readState(owner)}catch{this.log('update_notice.state_invalid',{code:'UPDATE_NOTICE_STATE_INVALID'});return}
    if(!shouldPromptForUpdate(previous,latest.tag))return
    await this.writeState(owner,latest.tag,'sending',previous?.skippedTags)
    let status='unknown'
    try{const result=await this.send(owner,message);status=result?.status==='accepted'?'accepted':result?.status==='cancelled'?'deferred':'unknown'}
    catch(error){
     status=deliveryFailureState(error)==='failed'?'deferred':'unknown'
     this.log(status==='deferred'?'update_notice.delivery_rejected':'update_notice.delivery_unknown',{code:status==='deferred'?'UPDATE_NOTICE_DELIVERY_REJECTED':'UPDATE_NOTICE_DELIVERY_UNKNOWN'})
    }
    await this.writeState(owner,latest.tag,status,previous?.skippedTags)
   })
  }
 }
 tick(){
  if(this.running)return this.running
  this.running=this.check().catch(error=>this.log('update_notice.check_failed',{code:/^UPDATE_[A-Z_]+$/.test(error.message)?error.message:'UPDATE_CHECK_FAILED'})).finally(()=>{this.running=null})
  return this.running
 }
 start(){
  if(this.closed||this.initialTimer||this.timer)return
  this.initialTimer=setTimeout(()=>{this.initialTimer=null;void this.tick();this.timer=setInterval(()=>{void this.tick()},this.intervalMs);this.timer.unref()},this.initialDelayMs)
  this.initialTimer.unref()
 }
 close(){this.closed=true;if(this.initialTimer)clearTimeout(this.initialTimer);if(this.timer)clearInterval(this.timer);this.initialTimer=null;this.timer=null}
}
