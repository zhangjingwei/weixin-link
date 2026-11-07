export const releaseTag=value=>typeof value==='string'&&/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
export function newerRelease(next,current){
 if(!releaseTag(next))return false
 if(!releaseTag(current))return true
 const a=next.slice(1).split('.').map(BigInt),b=current.slice(1).split('.').map(BigInt)
 for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i]
 return false
}
export function installedRelease(value){return value?.version===1&&value.repository==='zhangjingwei/weixin-link'&&(value.ref==='main'||releaseTag(value.ref))&&/^[0-9a-f]{7,40}$/.test(value.commit??'')}
export async function githubLatestRelease({request=fetch}={}){
 async function get(path,optional=false){
  const response=await request('https://api.github.com/repos/zhangjingwei/weixin-link/'+path,{headers:{accept:'application/vnd.github+json','user-agent':'weixin-link-update-check'},signal:AbortSignal.timeout(8000)})
  if(optional&&response.status===404)return null
  if(!response.ok)throw Error('UPDATE_CHECK_HTTP_FAILED')
  const text=await response.text();if(text.length>262144)throw Error('UPDATE_CHECK_RESPONSE_INVALID')
  return JSON.parse(text)
 }
 const release=await get('releases/latest',true)
 if(!release)return null
 if(release.draft||release.prerelease||!releaseTag(release.tag_name))throw Error('UPDATE_CHECK_RESPONSE_INVALID')
 let object=(await get('git/ref/tags/'+release.tag_name))?.object
 for(let i=0;i<5&&object?.type==='tag';i++){
  if(!/^[0-9a-f]{40}$/.test(object.sha??''))throw Error('UPDATE_CHECK_RESPONSE_INVALID')
  object=(await get('git/tags/'+object.sha))?.object
 }
 if(object?.type!=='commit'||!/^[0-9a-f]{40}$/.test(object.sha??''))throw Error('UPDATE_CHECK_RESPONSE_INVALID')
 return {tag:release.tag_name,commit:object.sha}
}
