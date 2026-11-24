import {releaseNotesUrl,releaseSummary} from '../../domain/updates/release-notes.mjs'
import {installedRelease,releaseTag,newerRelease} from '../../domain/updates/release-version.mjs'

/** Explicit query: does not send notifications, change deduplication state or schedule upgrades. */
export async function checkUpdates({readInstalled,fetchLatest,language='zh'}){
 const english=language==='en'
 try{
  const snapshot=await readUpdateStatus({readInstalled,fetchLatest}),{installed,latest}=snapshot
  const known=snapshot.installationVerified
  const current=known?(releaseTag(installed.ref)?installed.ref:`${english?'development build':'开发版'} ${installed.commit}`):(english?'unverified (source/custom installation)':'未核实（源码或自定义安装）')
  const prefix=english?`Current version: ${current}\n`:`当前版本：${current}\n`
  if(!latest)return prefix+(english?'No stable release is currently published. No upgrade was scheduled.':'暂未发布正式版本，未安排升级。')
  const latestLine=english?`Latest stable release: ${latest.tag}\n`:`最新正式版：${latest.tag}\n`
  let result
  if(!known)result=english?'The installed version could not be verified, so upgrade availability is unknown. No upgrade was scheduled.':'当前安装版本来源未核实，无法判断是否可升级；未安排升级。'
  else if(snapshot.matchesLatestCommit)result=english?'This development build matches the latest stable release commit. No upgrade was scheduled.':'当前开发版与最新正式版的提交一致，未安排升级。'
  else if(snapshot.updateAvailable)result=english?'An update is available. You can ask to upgrade to this version when tasks are idle. This check has not scheduled an upgrade.':'有可用更新。想安装可以说“升级到这个版本”，会等任务空闲后进行。本次只是检查，还没有安排升级。'
  else result=english?'The current version is up to date or newer than the latest stable release. No upgrade was scheduled.':'当前版本已是最新或高于最新正式版，未安排升级。'
  return prefix+latestLine+result
 }catch{return english?'Update check failed; version information could not be verified. Check the network or installation status and try again. No upgrade was scheduled.':'检查更新失败，无法核实版本信息；请检查网络或安装状态后重试。未安排升级。'}
}

/** Structured read-only counterpart used by management tools. */
export async function readUpdateStatus({readInstalled,fetchLatest}){
 const installed=await readInstalled(),latest=await fetchLatest(),known=installedRelease(installed)
 if(latest&&(!releaseTag(latest.tag)||! /^[0-9a-f]{40}$/.test(latest.commit??'')))throw Error('UPDATE_CHECK_RESPONSE_INVALID')
 const matches=known&&latest&&installed.ref==='main'&&latest.commit.startsWith(installed.commit)
 return {installed:known?{ref:installed.ref,commit:installed.commit}:null,installationVerified:!!known,matchesLatestCommit:!!matches,latest:latest?{tag:latest.tag,commit:latest.commit,url:releaseNotesUrl(latest.tag),summary:releaseSummary(latest.notes)}:null,updateAvailable:known?(latest?!matches&&newerRelease(latest.tag,installed.ref):false):null}
}
