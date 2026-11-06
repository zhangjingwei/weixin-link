import {homedir as platformHome} from 'node:os'
import {ffmpegBinary} from './media-binary.mjs'
import {deliveryError,deliveryFailureState} from '../core/delivery-error.mjs'
import {wechatParts} from '../wechat/wechat-text.mjs'
import {mkdir,readFile,writeFile,realpath,stat,unlink} from 'node:fs/promises'
import {resolve,join,basename,extname,relative,isAbsolute} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import sharp from 'sharp'
const ffmpeg=ffmpegBinary
const exec=promisify(execFile),MAX=50*1024*1024,generatedRoot=join(process.env.CODEX_HOME??join((process.env.HOME||platformHome()),'.codex'),'generated_images')
const extensions=new Set(['.png','.jpg','.jpeg','.webp','.gif','.mp4','.pdf','.html','.htm','.zip','.txt','.md','.csv','.json','.docx','.xlsx','.pptx','.wav','.mp3','.silk'])
const inside=(root,path)=>{const rel=relative(root,path);return !/^\.\.[\\/]/.test(rel)&&rel!=='..'&&!isAbsolute(rel)}
const digest=data=>createHash('sha256').update(data).digest('hex')
export function outputLinks(text){
 const paths=[]
 for(const match of text.replace(/```[\s\S]*?```/g,'').replace(/`[^`\n]*`/g,'').matchAll(/!?\[[^\]\n]*\]\((?:<([^>\n]+)>|([^\s)]+))\)/g)){
  let path=match[1]??match[2];if(path.startsWith('sandbox:'))path=path.slice(8)
  if(isAbsolute(path)&&extensions.has(extname(path).toLowerCase()))paths.push(path)
 }
 return paths
}
export class OutputStore {
 constructor({stateDir,cwd,roots=[resolve(cwd),resolve(cwd,'..'),generatedRoot],fileReader,voiceMode='file'}={}){Object.assign(this,{stateDir,cwd,roots,fileReader,voiceMode})}
 async package(userId,text,generated=[],signal){
  const candidates=[...generated,...outputLinks(text).map(path=>({path}))]
  if(!candidates.length)return text
  const packet={kind:'bundle',id:randomUUID(),text,attachments:[],errors:[],textParts:[]}
  const user=createHash('sha256').update(userId).digest('hex').slice(0,24),dir=join(this.stateDir,'outgoing',user,packet.id);await mkdir(dir,{recursive:true,mode:0o700})
  const seen=new Set();let total=0
  for(const candidate of candidates.slice(0,8)){
   signal?.throwIfAborted()
   const name=basename(candidate.path??'generated.png');let data,kind,fileName=name
   try{
    if(candidate.path&&this.fileReader){data=await this.fileReader(candidate.path,signal)}else if(candidate.path){
     const path=await realpath(candidate.path)
     if(!this.roots.some(root=>inside(resolve(root),path))||(path.split(/[\\/]/).some(part=>part.startsWith('.'))&&!inside(generatedRoot,path))||/^(?:credentials|secrets?|tokens?|private[-_]key)/i.test(basename(path)))throw Error('EXPORT_PATH_REFUSED')
     // Codex's image output directory is hidden by convention; explicitly allow only that root.
     const info=await stat(path);if(!info.isFile()||info.size>MAX||info.size<1)throw Error('FILE_SIZE_LIMIT')
     data=await readFile(path)
    }else if(typeof candidate.data==='string'){
     const value=candidate.data.replace(/^data:image\/(?:png|jpeg|webp);base64,/, '')
     if(value.length>MAX*1.4||!value||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw Error('INVALID_IMAGE')
     data=Buffer.from(value,'base64')
    }else throw Error('MISSING_ARTIFACT')
    const ext=extname(name).toLowerCase()
    if(candidate.image||['.png','.jpg','.jpeg','.gif','.webp'].includes(ext)){
     const image=sharp(data,{limitInputPixels:40000000,pages:1}),meta=await image.metadata()
     // Keep tall PNG/JPEG reports byte-for-byte; a 2048px longest-edge cap destroys their text.
     const originalLongImage=['png','jpeg'].includes(meta.format)&&meta.height>2048&&meta.width<=2048
     if(!originalLongImage)data=await image.rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).png().toBuffer()
     if(data.length>(originalLongImage?MAX:8*1024*1024))throw Error('IMAGE_SIZE_LIMIT');kind='image';fileName=basename(name,ext)+(originalLongImage&&meta.format==='jpeg'?'.jpg':'.png')
    }else if(ext==='.mp4'){
     if(data.toString('ascii',4,8)!=='ftyp')throw Error('INVALID_MP4')
     const probe=join(dir,randomUUID()+'.probe.mp4');await writeFile(probe,data,{mode:0o600,flag:'wx'});let stderr
     try{({stderr}=await exec(ffmpeg,['-hide_banner','-protocol_whitelist','file,pipe','-i',probe,'-map','0:v:0','-frames:v','1','-f','null','-'],{timeout:20000,maxBuffer:128*1024,signal}))}finally{await unlink(probe)}
     if(!/Video: h264\b/.test(stderr))throw Error('MP4_REQUIRES_H264');kind='video'
    }else if(['.wav','.mp3','.silk'].includes(ext)){kind=this.voiceMode==='native'?'voice':'file'
    }else{if(!extensions.has(ext))throw Error('UNSUPPORTED_FILE');kind='file'}
    if(data.length>MAX||total+data.length>MAX)throw Error('OUTPUT_SIZE_LIMIT')
    const hash=digest(data);if(seen.has(hash))continue;seen.add(hash);total+=data.length
    const path=join(dir,hash+(kind==='image'?extname(fileName):ext));await writeFile(path,data,{mode:0o600,flag:'wx'})
    packet.attachments.push({id:hash,kind,path,fileName,bytes:data.length,sha256:hash,status:'pending'})
   }catch(error){if(signal?.aborted)throw error;packet.errors.push({fileName:name,code:['EXPORT_PATH_REFUSED','FILE_SIZE_LIMIT','IMAGE_SIZE_LIMIT','MP4_REQUIRES_H264','OUTPUT_SIZE_LIMIT','INVALID_MP4','UNSUPPORTED_FILE'].includes(error.message)?error.message:error.code==='ENOENT'?'FILE_NOT_FOUND':'ARTIFACT_PREPARE_FAILED'})}
  }
  if(candidates.length>8)packet.errors.push({code:'OUTPUT_COUNT_LIMIT'})
  if(packet.errors.length)packet.text+='\n部分附件未能准备发送：'+packet.errors.map(e=>`${e.fileName??'附件'}（${e.code}）`).join('；')
  return packet
 }
 async bytes(userId,item){
  const root=await realpath(join(this.stateDir,'outgoing',createHash('sha256').update(userId).digest('hex').slice(0,24))),path=await realpath(item.path)
  if(!inside(root,path))throw Error('ARTIFACT_OWNER_MISMATCH')
  const info=await stat(path);if(info.size>MAX||info.size!==item.bytes)throw Error('ARTIFACT_CHANGED')
  const data=await readFile(path);if(digest(data)!==item.sha256)throw Error('ARTIFACT_CHANGED');return data
 }
 replay(packet){return {...structuredClone(packet),id:randomUUID(),textParts:[],failureNotice:undefined,attachments:packet.attachments.map(a=>({...a,status:'pending'}))}}
}
export class OutputTransport {
 constructor({store,send,log=()=>{},maxRetries=1,retryDelayMs=750}){Object.assign(this,{store,send,log,maxRetries,retryDelayMs});this.queues=new Map()}
 deliver(userId,value,{checkpoint=async()=>{},current=()=>true,continueTextFailure=false}={}){
  const run=(this.queues.get(userId)??Promise.resolve()).catch(()=>{}).then(()=>this.sendOne(userId,value,checkpoint,current,continueTextFailure));this.queues.set(userId,run)
  return run.finally(()=>{if(this.queues.get(userId)===run)this.queues.delete(userId)})
 }
 async sendWithRetry(userId,content,{event,kind,part,parts}){
  const attempts=Math.max(0,Math.trunc(this.maxRetries))+1
  for(let attempt=1;attempt<=attempts;attempt++){
   try{const response=await this.send(userId,content);return {attempt,messageIds:(Array.isArray(response)?response:[response]).filter(Boolean).map(r=>r.message_id).filter(id=>id!==undefined).map(String)}}
   catch(error){
    const state=deliveryFailureState(error),finalAttempt=state!=='failed'||attempt===attempts
    this.log(event,{userId,kind,part,parts,attempt,final_attempt:finalAttempt,...deliveryError(error),delivery_state:state})
    if(finalAttempt)throw error
    if(this.retryDelayMs>0)await new Promise(resolve=>setTimeout(resolve,this.retryDelayMs))
   }
  }
 }
 async sendOne(userId,value,checkpoint,current,continueTextFailure=false){
  const bundle=typeof value!=='string',text=bundle?value.text:value,parts=wechatParts(text)
  for(let part=0;part<parts.length;part++){
   if(!current()){if(bundle){for(const item of value.attachments)if(item.status==='pending')item.status='cancelled';await checkpoint()}return {status:'cancelled'}}
   if(bundle&&value.textParts[part])continue
   if(bundle){value.textParts[part]='sending';await checkpoint()}
   try{
    const attempt=await this.sendWithRetry(userId,parts[part],{event:'outbound.text_failed',kind:'text',part:part+1,parts:parts.length})
    this.log('outbound.text_accepted',{userId,kind:'text',part:part+1,parts:parts.length,attempt:attempt.attempt})
    if(bundle){value.textParts[part]='accepted';value.textMessageIds??={};value.textMessageIds[part]=attempt.messageIds;await checkpoint()}
   }catch(error){
    const state=deliveryFailureState(error)
    const priorAccepted=bundle?value.textParts.slice(0,part).includes('accepted'):part>0
    if(priorAccepted)error.deliveryState='partial'
    if(bundle){value.textParts[part]=state;value.textErrors??={};value.textErrors[part]=deliveryError(error);await checkpoint()}
    if(!bundle||!continueTextFailure)throw error
   }
  }
  if(!bundle)return {status:'accepted'}
  for(const item of value.attachments){
   if(item.status!=='pending')continue
   if(!current()){item.status='cancelled';await checkpoint();continue}
   let data;try{data=await this.store.bytes(userId,item)}catch{item.status='failed';item.reason='ARTIFACT_UNAVAILABLE';this.log('outbound.media_failed',{userId,kind:item.kind,reason:item.reason});await checkpoint();continue}
   if(!current()){item.status='cancelled';await checkpoint();continue}
   item.status='sending';await checkpoint()
   if(!current()){item.status='cancelled';await checkpoint();continue}
   try{const attempt=await this.sendWithRetry(userId,item.kind==='image'?{image:data}:item.kind==='video'?{video:data}:item.kind==='voice'?{voice:data}:{file:data,fileName:item.fileName},{event:'outbound.media_failed',kind:item.kind,parts:1});item.status='accepted';item.messageIds=attempt.messageIds;this.log('outbound.media_accepted',{userId,kind:item.kind,bytes:item.bytes,attempt:attempt.attempt})}
   catch(error){item.status=deliveryFailureState(error);item.error=deliveryError(error)}
   await checkpoint()
  }
  const textFailed=value.textParts.some(s=>s!=='accepted');
  const failed=value.attachments.filter(a=>['unknown','failed'].includes(a.status)).length
  if(failed&&current()&&!value.failureNotice){
   value.failureNotice='sending';await checkpoint()
   try{await this.sendWithRetry(userId,`有 ${failed} 个附件未能确认送达。可发“结果”主动重发整组结果（含已发送附件）。`,{event:'outbound.failure_notice_failed',kind:'failure_notice',parts:1});value.failureNotice='accepted'}catch(error){value.failureNotice=deliveryFailureState(error);value.failureNoticeError=deliveryError(error)}
   await checkpoint()
  }
  return {status:failed||textFailed?'partial':'accepted'}
 }
}
