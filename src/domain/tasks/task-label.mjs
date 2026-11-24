export function localTaskLabel(input,id){
 const raw=typeof input==='string'?input:input?.text??'',first=raw.split('\n').find(s=>s.trim())??'附件处理'
 return {id:String(id).slice(0,8),title:Array.from(first.replace(/\s+/g,' ').trim()).slice(0,36).join('')}
}
export function localCompletion(marker,task){return marker}

export function taskDisplayTitle(input,title){
 const raw=typeof title==='string'&&title.trim()?title:localTaskLabel(input,'').title
 const clean=raw.replace(/[\r\n\t\u0000-\u001f]/g,' ').replace(/[【】\[\]]/g,'').replace(/\s+/g,' ').trim()
 const characters=Array.from(clean||'处理用户请求');return characters.slice(0,24).join('')+(characters.length>24?'…':'')
}
