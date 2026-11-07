import {ffmpegBinary} from '../media/media-binary.mjs'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {dirname} from 'node:path'
import {pathToFileURL} from 'node:url'
const sdkRoot=dirname(createRequire(import.meta.url).resolve('@wechatbot/wechatbot'))
const {buildAuthHeaders}=await import(pathToFileURL(join(sdkRoot,'protocol/headers.js')).href)
import {createHash,randomUUID} from 'node:crypto'
import {encode,isSilk,getDuration} from 'silk-wasm'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
const exec=promisify(execFile),ffmpeg=ffmpegBinary
export function partialSelection(value){
 if(!value||typeof value!=='object')return null
 const out={};for(const k of ['start','end','quotemd5'])if(typeof value[k]==='string')out[k]=value[k].slice(0,1024)
 for(const k of ['startindex','endindex'])if(value[k]!==undefined){if(!Number.isSafeInteger(value[k])||value[k]<0)return null;out[k]=value[k]}
 if(out.startindex!==undefined&&out.endindex!==undefined&&out.endindex<out.startindex)return null
 return Object.keys(out).length?out:null
}
export function quotedContext(message,lookup=()=>null){
 const refs=(message.raw?.item_list??[]).filter(i=>i.ref_msg&&typeof i.ref_msg==='object').map(i=>i.ref_msg).slice(0,8)
 return refs.map(ref=>{const sourceId=ref.svr_id??ref.message_item?.msg_id;const messageId=typeof sourceId==='string'?sourceId.slice(0,128):Number.isSafeInteger(sourceId)?String(sourceId):null;const raw=typeof ref.message_item?.text_item?.text==='string'?ref.message_item.text_item.text:messageId?lookup(messageId):null
 return {messageId,title:typeof ref.title==='string'?ref.title.slice(0,512):'',text:typeof raw==='string'?raw.slice(0,2400):null,partialText:partialSelection(ref.partial_text),type:Number.isSafeInteger(ref.message_item?.type)?ref.message_item.type:null,truncated:typeof raw==='string'&&raw.length>2400}
 })
}
export function quoteInput(value,refs){return refs?.length?{...(typeof value==='string'?{text:value}:value),references:refs}:value}
export async function encodeVoice(data){
 if(data.length>10*1024*1024)throw Error('VOICE_LOCAL_SIZE_LIMIT')
 let silk,duration
 if(isSilk(data)){silk=data;duration=getDuration(data)}else{const dir=await mkdtemp(join(tmpdir(),'wechat-voice-'));try{const src=join(dir,'input'),pcm=join(dir,'audio.pcm');await writeFile(src,data,{mode:0o600});await exec(ffmpeg,['-v','error','-protocol_whitelist','file,pipe','-i',src,'-t','61','-ac','1','-ar','24000','-f','s16le',pcm],{timeout:30000,maxBuffer:8192});const raw=await readFile(pcm);if(raw.length>60*24000*2)throw Error('VOICE_LOCAL_DURATION_LIMIT');const result=await encode(raw,24000);silk=Buffer.from(result.data);duration=result.duration}finally{await rm(dir,{recursive:true,force:true})}}
 if(!Number.isFinite(duration)||duration<=0||duration>60000)throw Error('VOICE_LOCAL_DURATION_LIMIT')
 return {data:Buffer.from(silk),duration}
}
export function installWeixinProtocol(bot,{db,prepareBatch=async()=>{},log=()=>{}}){
 for(const [file,marker] of [['transport/http.js','WEIXIN_LOSSLESS_IDS_V1'],['messaging/poller.js','WEIXIN_CURSOR_ORDER_V2'],['storage/file.js','WEIXIN_ATOMIC_STORAGE_V1'],['core/client.js','WEIXIN_MEDIA_SEND_RESULT_V1']])if(!readFileSync(join(sdkRoot,file),'utf8').includes(marker))throw Error('WEIXIN_SDK_PATCH_REQUIRED')
 db.exec(`CREATE TABLE IF NOT EXISTS weixin_sent(client_id TEXT PRIMARY KEY,peer TEXT NOT NULL,message_id TEXT,state TEXT NOT NULL,text TEXT,created INTEGER NOT NULL);CREATE INDEX IF NOT EXISTS weixin_sent_lookup ON weixin_sent(peer,message_id);`)
 const sensitiveMessages=new WeakSet()
 const apiSend=bot.api.sendMessage.bind(bot.api)
 bot.api.sendMessage=async(base,token,msg)=>{
  const text=sensitiveMessages.has(msg)?'[敏感登录提示未保存]':(msg.item_list??[]).filter(i=>i.text_item).map(i=>i.text_item.text).join('\n').slice(0,24000)
  const clientId=msg.client_id??=randomUUID()
  // A result-unknown client ID cannot be replayed automatically.
  const prior=db.prepare('SELECT state FROM weixin_sent WHERE client_id=?').get(clientId);if(prior)throw Error('WEIXIN_SUBMISSION_ALREADY_RECORDED')
  db.prepare("INSERT INTO weixin_sent VALUES(?,?,NULL,'sending',?,?)").run(clientId,msg.to_user_id,text,Date.now())
  try{const result=await apiSend(base,token,msg);db.prepare("UPDATE weixin_sent SET message_id=?,state='accepted' WHERE client_id=?").run(result?.message_id===undefined?null:String(result.message_id),clientId);return result}catch(error){db.prepare('UPDATE weixin_sent SET state=? WHERE client_id=?').run(error?.name==='ApiError'?'failed':'unknown',clientId);throw error}
 }
 bot.poller.beforeCheckpoint=prepareBatch
 let timeout=40000
 bot.api.getUpdates=async(base,token,cursor,signal)=>{
  const current=bot.getCredentials?.();base=current?.baseUrl??base;token=current?.token??token
  try{const response=await bot.http.executeRequest({method:'POST',url:new URL('/ilink/bot/getupdates',base).toString(),headers:buildAuthHeaders(token),body:{get_updates_buf:cursor,base_info:bot.api.baseInfo()},timeoutMs:timeout,signal});const data=response.data,n=data.longpolling_timeout_ms;if(Number.isFinite(n)&&n>0)timeout=Math.max(10000,Math.min(120000,n+5000));return data}
  catch(error){if(!signal?.aborted&&['TimeoutError','AbortError'].includes(error?.name))return {ret:0,msgs:[],get_updates_buf:cursor};throw error}
 }
 const context=peer=>{const token=bot.contextStore.get(peer);if(!token)throw Error('WEIXIN_CONTEXT_UNAVAILABLE');return token}
 const lookup=(peer,id)=>{
 const sent=db.prepare("SELECT text FROM weixin_sent WHERE peer=? AND message_id=? AND state='accepted' ORDER BY created DESC LIMIT 1").get(peer,id);if(sent)return sent.text
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ingress'").get())return null
 return db.prepare("SELECT json_extract(payload,'$.text') AS text FROM ingress WHERE json_extract(payload,'$.raw.from_user_id')=? AND CAST(json_extract(payload,'$.raw.message_id') AS TEXT)=? ORDER BY created DESC LIMIT 1").get(peer,id)?.text??null
 }
 bot.sendSensitiveText=async(peer,text)=>{const c=bot.requireCredentials(),msg={from_user_id:'',to_user_id:peer,client_id:randomUUID(),message_type:2,message_state:2,context_token:context(peer),item_list:[{type:1,text_item:{text}}]};sensitiveMessages.add(msg);return bot.api.sendMessage(c.baseUrl,c.token,msg)}
 // Lifecycle notices may be the first message after QR pairing. Try an empty
 // context token when none exists; retain the send ledger and never replay an
 // uncertain submission automatically.
 bot.sendAnnouncement=async(peer,text)=>bot.sendRaw({from_user_id:'',to_user_id:peer,client_id:randomUUID(),message_type:2,message_state:2,context_token:bot.contextStore.get(peer)??'',item_list:[{type:1,text_item:{text}}]})
 bot.sendQuoted=async(peer,text,{messageId,partialText}={})=>{const original=lookup(peer,String(messageId));if(original===null)throw Error('QUOTE_OWNER_OR_MESSAGE_UNKNOWN');return bot.sendRaw({from_user_id:'',to_user_id:peer,client_id:randomUUID(),message_type:2,message_state:2,context_token:context(peer),item_list:[{type:1,text_item:{text},ref_msg:{svr_id:String(messageId),...(partialSelection(partialText)?{partial_text:partialSelection(partialText)}:{})}}]})}
 bot.sendVoice=async(peer,bytes)=>{const ctx=context(peer),{data,duration}=await encodeVoice(bytes),creds=bot.requireCredentials();const uploaded=await bot.uploader.upload(creds.baseUrl,creds.token,{data,userId:peer,mediaType:4});return bot.sendRaw({from_user_id:'',to_user_id:peer,client_id:randomUUID(),message_type:2,message_state:2,context_token:context(peer),item_list:[{type:3,voice_item:{media:uploaded.media,encode_type:6,sample_rate:24000,bits_per_sample:16,playtime:Math.round(duration)}}]})}
 bot.sendToolStatus=async(peer,{id,name,status,started})=>bot.sendRaw({from_user_id:'',to_user_id:peer,client_id:createHash('sha256').update(peer+':'+id+':'+String(started)).digest('hex'),message_type:2,message_state:2,context_token:context(peer),item_list:[started?{type:11,tool_call_start_item:{tool_name:name,tool_call_id:id}}:{type:12,tool_call_result_item:{tool_name:name,tool_call_id:id,status}}]})
 return {lookup,quote:message=>quotedContext(message,id=>lookup(message._conversationOwner??message.userId,id)),get pollTimeoutMs(){return timeout}}
}
