const markers=/[💡❓📋🛠️📦⚠️] Zero · [^\n]+/gu

export function grade(text,expect={}){
 const answer=String(text??'').trim(),failures=[]
 if(!answer)failures.push('没有模型回复')
 if(expect.startsWith&&!answer.startsWith(expect.startsWith))failures.push(`开头应为「${expect.startsWith}」`)
 for(const part of expect.contains??[])if(!answer.includes(part))failures.push(`缺少「${part}」`)
 for(const part of expect.notContains??[])if(answer.includes(part))failures.push(`不应包含「${part}」`)
 if(expect.maxUtf16&&answer.length>expect.maxUtf16)failures.push(`超过 ${expect.maxUtf16} 个 UTF-16 代码单元`)
 if(expect.questionCount!==undefined){
  const count=(answer.match(/[？?]/gu)??[]).length
  if(count!==expect.questionCount)failures.push(`应有 ${expect.questionCount} 个问题，实际 ${count} 个`)
 }
 if(expect.startsWith){
  const first=answer.match(markers)?.[0]
  if(first&&answer.match(markers)?.filter(marker=>marker===first).length>1)failures.push('阶段标记重复')
 }
 return {pass:failures.length===0,failures}
}
