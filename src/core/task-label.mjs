export function localTaskLabel(input,id){
 const raw=typeof input==='string'?input:input?.text??'',first=raw.split('\n\n[目标识别候选')[0].split('\n').find(s=>s.trim())??'附件处理'
 return {id:String(id).slice(0,8),title:Array.from(first.replace(/\s+/g,' ').trim()).slice(0,36).join('')}
}
export function localCompletion(marker,task){return marker}
