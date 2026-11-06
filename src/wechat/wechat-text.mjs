/** Convert wide Markdown tables to readable records; preserve fenced code verbatim. */
function cells(line){const result=[];let cell='',escaped=false,ticks=false;for(const c of line.trim()){if(escaped){cell+=c;escaped=false;continue}if(c==='\\'){escaped=true;cell+=c;continue}if(c==='`')ticks=!ticks;if(c==='|'&&!ticks){result.push(cell.trim());cell=''}else cell+=c}result.push(cell.trim());if(result[0]==='')result.shift();if(result.at(-1)==='')result.pop();return result}
// Protect code spans, URLs and link targets before removing presentation markers.
function emphasis(text){return text.replace(/(\*\*|__)(?=\S)(.+?\S|\S)\1/g,'$2').replace(/~~(?=\S)(.+?\S|\S)~~/g,'$1').replace(/(?<![\w*])\*([^*\n]+)\*(?!\*)/g,'$1')}
function plainLine(line){
 const blocks=[],hold=value=>{const key='\u0000'+blocks.length+'\u0000';blocks.push(value);return key}
 let text=line.replace(/(`+)([^`\n]*?)\1/g,(_,ticks,code)=>hold(code))
 text=text.replace(/!?\[([^\]\n]*)\]\((?:<([^>\n]+)>|([^\s)]+))\)/g,(_,label,angled,target)=>{
  const url=angled??target,name=emphasis(label)
  return hold(/^https?:\/\//i.test(url)?(name===url?url:name+'：'+url):name)
 })
 text=text.replace(/https?:\/\/[^\s\u0000]+/g,url=>hold(url))
 text=text.replace(/^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?$/,'$1').replace(/^(\s*)>\s?/,'$1').replace(/^(\s*)[-+*]\s+/, '$1• ')
 text=emphasis(text)
 for(let i=0;i<blocks.length;i++){const next=text.replace(/\u0000(\d+)\u0000/g,(all,n)=>blocks[Number(n)]??all);if(next===text)break;text=next}
 return text
}
export function wechatText(text){const lines=text.split('\n'),out=[];let fence=null
 for(let i=0;i<lines.length;i++){const line=lines[i],mark=line.match(/^\s{0,3}(`{3,}|~{3,})/)
  if(mark){if(!fence)fence=mark[1][0];else if(fence===mark[1][0])fence=null;out.push(line);continue}
  const header=cells(line),separator=i+1<lines.length?cells(lines[i+1]):[]
  if(!fence&&line.includes('|')&&header.length>1&&separator.length===header.length&&separator.every(c=>/^:?-{3,}:?$/.test(c))){
   i++;let rows=0;while(i+1<lines.length&&lines[i+1].includes('|')){const row=cells(lines[i+1]);if(row.length!==header.length)break;i++;out.push(plainLine(row[0]),...row.slice(1).map((value,n)=>plainLine(header[n+1]+'：'+value)),'');rows++}if(!rows)out.push(plainLine(header.join(' / ')));continue
  }
  out.push(fence?line:plainLine(line))
 }
 return out.join('\n')
}
/** Prefer paragraph/line boundaries and balance code fences in each transport packet. */
export function wechatParts(text,limit=1800){const chunks=[];let remaining=Array.from(wechatText(text)),fence=null
 while(remaining.length){const size=fence||remaining.slice(0,limit).join('').match(/^\s{0,3}(?:`{3,}|~{3,})/m)?Math.min(1600,limit-160):limit;let count=Math.min(size,remaining.length)
  if(count<remaining.length){const head=remaining.slice(0,count).join(''),line=head.lastIndexOf('\n');if(line>=head.length/2)count=Array.from(head.slice(0,line+1)).length}
  const raw=remaining.splice(0,count).join(''),prefix=fence?fence+'\n':''
  for(const line of raw.split('\n')){const match=line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);if(match){if(!fence)fence=match[1]+match[2].slice(0,100);else if(match[1][0]===fence[0])fence=null}}
  chunks.push(prefix+raw+(fence?'\n'+fence.match(/^[`~]+/)[0]:''))
 }
 return chunks
}
