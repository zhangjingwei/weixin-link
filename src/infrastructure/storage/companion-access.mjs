import {ingressId} from '../../domain/messages/message-identity.mjs'
import {messageOwner,requireExternalMessageId} from './ingress-envelope.mjs'

export class CompanionAccess {
 constructor(db){
  this.db=db
  db.exec(`CREATE TABLE IF NOT EXISTS companion_access(singleton INTEGER PRIMARY KEY CHECK(singleton=1),writer TEXT NOT NULL,revision INTEGER NOT NULL,since INTEGER NOT NULL);
   INSERT OR IGNORE INTO companion_access VALUES(1,'wechat',0,0)`)
 }
 read(){return this.db.prepare('SELECT writer,revision,since FROM companion_access WHERE singleton=1').get()}
 take(writer,revision){
  if(!Number.isSafeInteger(revision)||!this.db.prepare('UPDATE companion_access SET writer=?,revision=revision+1,since=? WHERE singleton=1 AND revision=? AND writer<>?').run(writer,Date.now(),revision,writer).changes)throw Object.assign(Error('COMPANION_STALE'),{statusCode:409})
  return this.read()
 }
 phone(message,jobs,hasMedia){
  const receipt='companion:'+ingressId(messageOwner(message),requireExternalMessageId(message))
  if(this.db.prepare('SELECT 1 FROM receipt_notices WHERE id=?').get(receipt))return {}
  if(jobs.findCaptured(message)?._captureState==='pending')return null
  const state=this.read(),text=!hasMedia(message)&&!message.quotedMessage&&!message.references?.length&&message.text?.trim()
  const claim=typeof text==='string'&&/^微信接手 (\d+)$/.exec(text)
  const info=()=>state.writer==='mac'?`Mac 正在操作，微信只读。回复「微信接手 ${state.revision}」可接回。`:'微信正在操作。'
  const late=state.since>0&&!(Number(message.raw?.create_time_ms)>state.since)
  if(!claim&&text!=='操作端'&&state.writer==='wechat'&&!late)return null
  this.db.exec('BEGIN IMMEDIATE')
  try{
   let notice
   if(jobs.claimReceipt(receipt)&&!jobs.findCaptured(message)){
    const id=jobs.capture(message)
    jobs.acknowledge([id])
    if(claim&&state.writer==='mac'&&Number(claim[1])===state.revision){this.take('wechat',state.revision);notice='微信已接手。正在运行的任务会继续。'}
    else notice=(late&&state.writer==='wechat'&&!claim&&text!=='操作端'?'这条消息早于本次接手或缺少发送时间，未执行。':'')+info()
   }
   this.db.exec('COMMIT');return {notice}
  }catch(error){this.db.exec('ROLLBACK');throw error}
 }
}
