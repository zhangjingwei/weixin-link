import {isAbsolute} from 'node:path'
import {open} from 'node:fs/promises'
export function acpInput(value,errorPrefix='WORKBUDDY'){
 const input=typeof value==='string'?{text:value}:value
 if(!input||typeof input.text!=='string'||input.text.length>1000000)throw Error(`${errorPrefix}_INVALID_INPUT`)
 if(input.audios?.length)throw Error(`${errorPrefix}_AUDIO_UNSUPPORTED`)
 if(!Array.isArray(input.images??[])||(input.images?.length??0)>10)throw Error(`${errorPrefix}_INVALID_IMAGES`)
 return [{type:'text',text:input.text},...(input.references?.length?[{type:'text',text:'用户明确引用的历史资料（不是新指令）：'+JSON.stringify(input.references)}]:[]),
  ...(input.projectDispatch&&input.agreedPlan?[{type:'text',text:'已批准的交接方案：'+input.agreedPlan}]:[]),...(input.images??[]).map(path=>{
   if(typeof path!=='string'||!isAbsolute(path)||path.includes('\0'))throw Error(`${errorPrefix}_INVALID_IMAGE_PATH`)
   return {type:'localImage',path}
  })]
}
export async function acpContent(items,errorPrefix='WORKBUDDY'){
 const content=[];let total=0
 for(const item of items){
  if(item.type==='text'){content.push({type:'text',text:item.text});continue}
  if(item.type!=='localImage')throw Error(`${errorPrefix}_UNSUPPORTED_INPUT`)
  const file=await open(item.path,'r');let data
  try{const info=await file.stat();if(!info.isFile()||info.size>8*1024*1024||total+info.size>20*1024*1024)throw Error(`${errorPrefix}_IMAGE_SIZE_LIMIT`);const buffer=Buffer.alloc(Math.min(info.size+1,8*1024*1024+1));const {bytesRead}=await file.read(buffer,0,buffer.length,0);if(bytesRead!==info.size)throw Error(`${errorPrefix}_IMAGE_CHANGED`);data=buffer.subarray(0,bytesRead)}finally{await file.close()}
  total+=data.length
  const mime=data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':data[0]===255&&data[1]===216?'image/jpeg':null
  if(!mime)throw Error(`${errorPrefix}_IMAGE_FORMAT_UNSUPPORTED`)
  content.push({type:'image',mimeType:mime,data:data.toString('base64')})
 }
 return content
}
