import {messageInstructions} from './voice-text.mjs'
// Only combines items belonging to this SDK message. Never waits for another message.
export async function singleMedia(message,token,{prepare,compose,submit,log=()=>{}}){
 if(!token.current())return false
 const received=await prepare(message,token)
 if(!token.current())return false
 if(!received.attachments.length)throw Error('附件接收失败，请重新发送。')
 const messageId=message.raw?.message_id??message.raw?.client_id,start=Date.now();log('attachments.preprocess_started',{messageId})
 const input=await compose({text:messageInstructions(message),attachments:received.attachments,errors:received.errors,signal:token.signal})
 log('attachments.preprocess_completed',{messageId,duration_ms:Date.now()-start,parts:input.images?.length??0})
 if(!token.current())return false
 if(message.references?.length)input.references=message.references
 if(message._receiptDeferred)input.receiptDeferred=true
 log('attachments.job_submit',{messageId})
 await submit(message.userId,input,token,message._ingressId)
 return true
}
