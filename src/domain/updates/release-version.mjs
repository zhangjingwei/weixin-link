export const releaseTag=value=>typeof value==='string'&&/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
export function newerRelease(next,current){
 if(!releaseTag(next))return false
 if(!releaseTag(current))return true
 const a=next.slice(1).split('.').map(BigInt),b=current.slice(1).split('.').map(BigInt)
 for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i]
 return false
}
export function installedRelease(value){return value?.version===1&&value.repository==='zhangjingwei/weixin-link'&&(value.ref==='main'||releaseTag(value.ref))&&/^[0-9a-f]{7,40}$/.test(value.commit??'')}
