const FOOTER='〔系统通知〕'
export function systemNotice(value){
 const mark=text=>{
  const trimmed=text.trimEnd()
  if(!trimmed)return text
  const body=trimmed.endsWith(FOOTER)?trimmed.slice(0,-FOOTER.length).trimEnd():trimmed
  return body?body+' '+FOOTER:FOOTER
 }
 return typeof value==='string'?mark(value):value&&typeof value==='object'&&typeof value.text==='string'?{...value,text:mark(value.text)}:value
}
