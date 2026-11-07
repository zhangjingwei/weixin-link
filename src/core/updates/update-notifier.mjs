import {createHash,randomUUID} from 'node:crypto'
import {readFile,writeFile,rename,unlink,lstat} from 'node:fs/promises'
import {join} from 'node:path'
import {deliveryFailureState} from '../delivery/delivery-error.mjs'

const REPOSITORY='zhangjingwei/weixin-link'
const COMMIT=/^[0-9a-f]{7,40}$/
const FULL_COMMIT=/^[0-9a-f]{40}$/
const CHECK_INTERVAL=60*60*1000

export async function githubMainCommit(){
 const response=await fetch(`https://api.github.com/repos/${REPOSITORY}/git/ref/heads/main`,{
  headers:{accept:'application/vnd.github+json','user-agent':'weixin-link-update-check'},
  signal:AbortSignal.timeout(8000),
 })
 if(!response.ok)throw Error('UPDATE_CHECK_HTTP_FAILED')
 const body=await response.text()
 if(body.length>16384)throw Error('UPDATE_CHECK_RESPONSE_INVALID')
 const sha=JSON.parse(body)?.object?.sha
 if(typeof sha!=='string'||!FULL_COMMIT.test(sha))throw Error('UPDATE_CHECK_RESPONSE_INVALID')
 return sha
}

export class UpdateNotifier{
 constructor({stateDir,sourceDir,owners,send,ready=()=>true,fetchLatest=githubMainCommit,log=()=>{},intervalMs=CHECK_INTERVAL,initialDelayMs=60000,now=Date.now}){
  Object.assign(this,{stateDir,sourceDir,owners:[...new Set(owners)],send,ready,fetchLatest,log,intervalMs,initialDelayMs,now})
  this.closed=false;this.timer=null;this.initialTimer=null;this.running=null
 }
 path(owner){return join(this.stateDir,'update-notice-'+createHash('sha256').update(owner).digest('hex').slice(0,24)+'.json')}
 async release(){
  let value
  try{value=JSON.parse(await readFile(join(this.sourceDir,'.weixin-link-release.json'),'utf8'))}
  catch(error){if(error.code==='ENOENT')return null;throw error}
  if(value?.version!==1||value.repository!==REPOSITORY||value.ref!=='main'||typeof value.commit!=='string'||!COMMIT.test(value.commit))return null
  return value.commit
 }
 async readState(owner){
  const path=this.path(owner)
  let info
  try{info=await lstat(path)}catch(error){if(error.code==='ENOENT')return null;throw error}
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>4096)throw Error('UPDATE_NOTICE_STATE_INVALID')
  const value=JSON.parse(await readFile(path,'utf8'))
  if(value?.version!==1||typeof value.commit!=='string'||!FULL_COMMIT.test(value.commit)||!['sending','accepted','unknown','deferred'].includes(value.status))throw Error('UPDATE_NOTICE_STATE_INVALID')
  return value
 }
 async writeState(owner,commit,status){
  const path=this.path(owner),temp=path+'.'+randomUUID()+'.tmp'
  try{await writeFile(temp,JSON.stringify({version:1,commit,status,at:new Date(this.now()).toISOString()})+'\n',{flag:'wx',mode:0o600});await rename(temp,path)}
  finally{await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error})}
 }
 async check(){
  if(this.closed||!this.ready())return
  const installed=await this.release()
  if(!installed)return
  const latest=await this.fetchLatest()
  if(typeof latest!=='string'||!FULL_COMMIT.test(latest))throw Error('UPDATE_CHECK_RESPONSE_INVALID')
  if(latest.startsWith(installed)||this.closed||!this.ready())return
  const message=`发现新版本（当前 ${installed.slice(0,7)}，最新 ${latest.slice(0,7)}）。回复“升级”可在空闲后安装；不会自动升级。`
  for(const owner of this.owners){
   if(this.closed||!this.ready())return
   let previous
   try{previous=await this.readState(owner)}catch{this.log('update_notice.state_invalid',{code:'UPDATE_NOTICE_STATE_INVALID'});continue}
   if(previous?.commit===latest&&previous.status!=='deferred')continue
   await this.writeState(owner,latest,'sending')
   let status='unknown'
   try{const result=await this.send(owner,message);status=result?.status==='accepted'?'accepted':result?.status==='cancelled'?'deferred':'unknown'}
   catch(error){
    status=deliveryFailureState(error)==='failed'?'deferred':'unknown'
    this.log(status==='deferred'?'update_notice.delivery_rejected':'update_notice.delivery_unknown',{code:status==='deferred'?'UPDATE_NOTICE_DELIVERY_REJECTED':'UPDATE_NOTICE_DELIVERY_UNKNOWN'})
   }
   await this.writeState(owner,latest,status)
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
