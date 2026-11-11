// Keep each delivery bounded without truncating any message text.
const CHUNK_SIZE=2200;
function timestamp(value){
 if(value==null)return '';
 const date=new Date(typeof value==='number'&&value<1e12?value*1000:value);
 return Number.isNaN(date.getTime())?'':` · ${date.toISOString().replace('T',' ').replace('.000Z',' UTC')}`;
}
export function historyParts(messages){
 const parts=[];
 for(const message of messages){
  const chars=Array.from(message.text);
  const count=Math.ceil(chars.length/CHUNK_SIZE);
  for(let i=0;i<count;i++){
   const heading=`── 本页第${message.round}轮 · ${message.role}${timestamp(message.time)}${count>1?` · 正文${i+1}/${count}`:''} ──`;
   const block=heading+'\n'+chars.slice(i*CHUNK_SIZE,(i+1)*CHUNK_SIZE).join('');
   if(parts.length&&parts.at(-1).length+block.length+2<=2600)parts[parts.length-1]+='\n\n'+block;
   else parts.push(block);
  }
 }
 return parts.length?parts:['本页没有匹配的文字消息。'];
}
