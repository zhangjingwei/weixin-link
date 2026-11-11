import {changelogSection,releaseDetails} from '../../domain/updates/release-notes.mjs'
import {readFile,stat} from 'node:fs/promises'
import {join} from 'node:path'
import {releaseTag,installedRelease} from '../../domain/updates/release-version.mjs'

export async function readInstalledRelease(sourceDir) {
  try {return JSON.parse(await readFile(join(sourceDir, '.weixin-link-release.json'), 'utf8'))}
  catch (error) {if (error.code === 'ENOENT') return null; throw error}
}

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
 return {tag:release.tag_name,commit:object.sha,...(typeof release.body==='string'&&release.body.trim()?{notes:release.body.slice(0,16000)}:{})}
}

export {githubLatestRelease as fetchLatestRelease}

export async function readInstalledNotes(sourceDir,tag){
 try{
  const path=join(sourceDir,'CHANGELOG.md')
  if((await stat(path)).size>1024*1024)return ''
  return changelogSection(await readFile(path,'utf8'),tag)
 }catch{return ''}
}

export async function readInstalledNotice(sourceDir,language='zh'){
 const installed=await readInstalledRelease(sourceDir)
 if(!installedRelease(installed))return null
 const tag=releaseTag(installed.ref)?installed.ref:null
 return {commit:installed.commit,tag,details:tag?releaseDetails({tag,notes:await readInstalledNotes(sourceDir,tag)},language):''}
}
