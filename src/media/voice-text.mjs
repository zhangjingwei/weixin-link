/** WeChat's own ASR text is a user instruction, not a reason to upload the waveform to Codex. */
export function messageInstructions(message) {
 const items=message.raw?.item_list
 if(items?.length)return items.map(item=>item.text_item?.text??item.voice_item?.text??'').filter(t=>typeof t==='string'&&t.trim()).join('\n').trim()
 const voice=(message.voices??[]).map(v=>typeof v.text==='string'?v.text.trim():'').filter(Boolean).join('\n')
 return voice||(!['image','video','voice','file'].includes(message.type)?message.text?.trim()??'':'')
}
export function voiceTextMessage(message) {
 if(!(message.voices?.length)||['images','files','videos'].some(k=>message[k]?.length))return null
 if(message.voices.some(v=>typeof v.text!=='string'||!v.text.trim()))return null
 const text=messageInstructions(message);if(!text)return null
 return {...message,type:'text',text,voices:[]}
}
