const FOOTER='〔系统通知〕'
export function systemNotice(value){
 const mark=text=>typeof text==='string'&&text&&!text.endsWith(FOOTER)?text+'\n'+FOOTER:text
 return typeof value==='string'?mark(value):value&&typeof value==='object'&&typeof value.text==='string'?{...value,text:mark(value.text)}:value
}
