import {resolve,isAbsolute,relative} from 'node:path'

// One syntax for attachment discovery and text rendering; code examples are not deliveries.
export const LINK_PATTERN=/!?\[([^\]\n]*)\]\((?:<([^>\n]+)>|([^\s)]+))\)/g
export function localTarget(target){return !/^(?:https?:|mailto:|tel:|#)/i.test(target)&&(!/^[a-z][a-z\d+.-]*:/i.test(target)||/^(?:sandbox:|file:)/i.test(target))}
export function deliveryLinks(text,cwd){
 const links=[]
 let fence=null
 const plain=text.split('\n').map(line=>{
  const marker=line.match(/^\s{0,3}(`{3,}|~{3,})/)
  if(marker){if(!fence)fence=marker[1];else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length)fence=null;return ''}
  return fence?'':line.replace(/`[^`\n]*`/g,'')
 }).join('\n')
 for(const match of plain.matchAll(new RegExp(LINK_PATTERN))){
  let target=match[2]??match[3]
  if(!localTarget(target))continue
  if(target.startsWith('sandbox:'))target=target.slice(8)
  if(target.startsWith('file:')){links.push({path:target,error:'INVALID_DELIVERY_LINK'});continue}
  const path=isAbsolute(target)?target:resolve(cwd,target)
  const rel=relative(resolve(cwd),path)
  const escaped=!isAbsolute(target)&&(rel==='..'||rel.startsWith('../')||isAbsolute(rel))
  links.push({path,error:escaped?'EXPORT_PATH_REFUSED':undefined})
 }
 return links
}
