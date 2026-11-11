import {releaseTag} from './release-version.mjs'

export function releaseNotesUrl(tag){return releaseTag(tag)?`https://github.com/zhangjingwei/weixin-link/releases/tag/${tag}`:null}
// Display maintained release bullets, without inventing or translating changes.
export function releaseSummary(notes,language='zh'){
 const bullets=[];let fence=false
 for(const line of (typeof notes==='string'?notes:'').slice(0,16000).split('\n')){
  if(/^\s*(`{3,}|~{3,})/.test(line)){fence=!fence;continue}
  if(fence)continue
  const match=line.match(/^[-*]\s+(.+)/)
  if(!match)continue
  const text=match[1].replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/[`*_~]/g,'').replace(/[\x00-\x1f\x7f]/g,' ').trim()
  if(text){const chars=Array.from(text);bullets.push('• '+chars.slice(0,140).join('')+(chars.length>140?'…':''))}
  if(bullets.length===5)break
 }
 return bullets.length?(language==='en'?'Release highlights (excerpt):\n':'本次更新要点（节选）：\n')+bullets.join('\n'):(language==='en'?'No release highlights were provided.':'本版本暂未提供核心更新摘要。')
}
export function changelogSection(text,tag){
 if(!releaseTag(tag))return ''
 const version=tag.slice(1),lines=String(text).split('\n');let active=false,result=[]
 for(const line of lines){
  if(/^##\s+/.test(line)){
   if(active)break
   const token=line.match(/^##\s+\[?v?(\d+\.\d+\.\d+)(?=[\]\s]|$)/)?.[1]
   active=token===version;continue
  }
  if(active)result.push(line)
 }
 return result.join('\n').slice(0,16000)
}
export function releaseDetails({tag,notes},language='zh'){
 const url=releaseNotesUrl(tag)
 return releaseSummary(notes,language)+(url?'\n'+(language==='en'?'Full release notes: ':'完整更新说明：')+url:'')
}
