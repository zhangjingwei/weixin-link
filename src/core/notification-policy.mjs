export function receiptPolicy({media,busy,waiting}){
 if(!media)return 'send'
 if(waiting)return 'suppress'
 return busy?'defer':'send'
}
// Exact empty templates only. Never classify meaningful progress using a keyword blacklist.
const emptyStarts=new Set([
 '我会读取压缩包中的聊天记录，按上一条要求汇总',
 '我先解压读取',
 '我会读取本次附件中的对话并汇总',
 '我会读取本次附件并汇总',
 '我先读取附件',
 '正在读取附件',
 '正在解压附件',
 '附件已收到',
 '已收到附件',
])
export function emptyContinuationNotice(text){
 return typeof text==='string'&&emptyStarts.has(text.trim().replace(/[。.!！]$/u,''))
}
