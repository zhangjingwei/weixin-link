#!/usr/bin/env node
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {pathToFileURL} from 'node:url'
import {join} from 'node:path'
import {mkdir,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {accountPaths} from './accounts.mjs'
import {readJobs,chinaDate} from './scheduled-delivery.mjs'
import {controlRequest} from './runtime-control.mjs'
import {formatDigest,renderDigestHtml,digestGroups} from './news-digest.mjs'
import {renderNewsImages} from './news-image.mjs'
import {composeNews} from './news-compose.mjs'
const exec=promisify(execFile)
export function due(job,now){if(!job.enabled||job.startDate&&chinaDate(now)<job.startDate||!/^([01]\d|2[0-3]):[0-5]\d$/.test(job.time??''))return false;const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now).split(':').map(Number);const [h,m]=job.time.split(':').map(Number);const diff=parts[0]*60+parts[1]-h*60-m;return diff>=0&&diff<180}
export function formatNews(job,items,date){return `${job.title??'每日新闻'}｜${date}\n近24小时频道消息摘录（未经独立核实）\n\n`+(items.length?items.map((x,i)=>`${i+1}. ${x.title}\n${x.excerpt?x.excerpt+'\n':''}${x.link}`).join('\n\n'):'该订阅源当前返回的条目中，没有近24小时内的消息。')}
export function newsWindow(job,jobs,now,{endAtNow=false}={}){
 const date=chinaDate(now),end=endAtNow?new Date(now):new Date(date+'T'+job.time+':00+08:00');
 const candidates=jobs.filter(x=>x.enabled&&x.kind==='rss-news'&&x.recipient===job.recipient&&/^([01]\d|2[0-3]):[0-5]\d$/.test(x.time??''));
 const previous=candidates.map(x=>{let d=new Date(date+'T'+x.time+':00+08:00');if(d>=end)d=new Date(+d-86400000);return d}).sort((a,b)=>b-a)[0];
 if(!previous)throw Error('NEWS_WINDOW_UNAVAILABLE');
 return {start:previous.toISOString(),end:end.toISOString()};
}
export function selectNewsJobs(jobs,{now=new Date(),dryRun=false,forceJob=null}={}){
 if(forceJob!==null){
  const job=jobs.find(x=>x.enabled&&x.kind==='rss-news'&&x.id===forceJob);
  if(!job)throw Error('NEWS_JOB_NOT_FOUND_OR_DISABLED');
  return [job];
 }
 return jobs.filter(j=>j.kind==='rss-news'&&(dryRun?j.enabled:due(j,now)));
}
export function parseNewsCliArgs(argv=[]){
 let dryRun=false,forceJob=null;
 for(let i=0;i<argv.length;i++){
  const arg=argv[i];
  if(arg==='--dry-run'){dryRun=true;continue}
  if(arg==='--force'){
   if(forceJob!==null||i+1>=argv.length||argv[i+1].startsWith('--')||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(argv[i+1]))throw Error('INVALID_NEWS_ARGUMENTS');
   forceJob=argv[++i];continue;
  }
  throw Error('INVALID_NEWS_ARGUMENTS');
 }
 if(dryRun&&forceJob!==null)throw Error('INVALID_NEWS_ARGUMENTS');
 return {dryRun,forceJob};
}
export async function runNews({paths=accountPaths(),now=new Date(),dryRun=false,forceJob=null,imageRenderer=renderNewsImages,composer=composeNews}={}){
 const manual=forceJob!==null,allJobs=await readJobs(join(paths.stateDir,'notification-jobs.json')),jobs=selectNewsJobs(allJobs,{now,dryRun,forceJob});if(!jobs.length)return {due:0}
 let status;if(!dryRun&&!manual)status=await controlRequest(paths.socket,'GET','/scheduled-jobs',undefined,5000)
 const results=[]
 for(const job of jobs){if(!dryRun&&!manual&&status.jobs.find(x=>x.id===job.id)?.state!=='pending'){results.push({job:job.id,skipped:true});continue}
  try{
   // Pass feed parameters as argv data; Python never executes feed text or model instructions.
   const window=newsWindow(job,allJobs,now,{endAtNow:manual});
   const sources=job.sources??[{url:job.url,title:job.title}],items=[],failures=[]
   for(const source of sources){try{
    const {stdout}=await exec('python3',['-c',"import sys,runpy,io;sys.stdin=io.StringIO(sys.argv[2]);runpy.run_path(sys.argv[1],run_name='__main__')",new URL('rss-news.py',import.meta.url).pathname,JSON.stringify({url:source.url,now:window.end,start:window.start,limit:Math.min(job.limit??80,100)})],{timeout:25000,maxBuffer:8000000})
    const data=JSON.parse(stdout);if(!Array.isArray(data))throw Error('FEED_FAILED');items.push(...data.map(item=>({...item,source:source.title??'新闻源'})))
   }catch{failures.push(source.title??'新闻源')}}
   if(failures.length===sources.length)throw Error('ALL_FEEDS_FAILED')
   const prepared=await composer(items);
   const date=chinaDate(now),displayTime=manual?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now):job.time;
   const html=renderDigestHtml({...job,time:displayTime},prepared.items,date,{failures,generatedAt:now.toISOString(),premerged:true,collectedCount:items.length,dedupStats:prepared.stats,window});
   const ownerHash=createHash('sha256').update(job.recipient).digest('hex').slice(0,16),dir=join(process.env.HOME,'work/wechat-assistant/outputs/news',ownerHash);await mkdir(dir,{recursive:true,mode:0o700});
   const fileTag=manual?`${job.time.replace(':','')}-manual-${displayTime.replace(':','')}`:job.time.replace(':',''),path=join(dir,`${date}-${fileTag}.html`);await writeFile(path,html,{mode:0o600});
   let images=[],imageError=false;try{images=await imageRenderer(html,path.slice(0,-5))}catch{imageError=true}
   const {unique,groups}=digestGroups(prepared.items,{premerged:true});
   const text=`${job.title??'新闻分类汇总'}｜${date} ${job.time}\n共${unique.length}条，图片为标题速览，完整内容见HTML。频道消息未经独立核实。\n`+[...groups].map(([name,entries])=>`${name}（${entries.length}条）：${entries[0].title.slice(0,100)}`).join('\n')+(failures.length?`\n读取失败来源：${failures.join('、')}`:'')+(imageError?'\n图片渲染未完成，完整内容请查看HTML。':'')+images.map((p,i)=>`\n\n![新闻分类汇总 ${i+1}/${images.length}](${p})`).join('')+`\n\n[完整分类新闻 HTML](${path})`;
   results.push(dryRun||manual?{job:job.id,items:items.length,dedup:prepared.stats,text,html:path,images,window,failures}: {job:job.id,...await controlRequest(paths.socket,'POST','/scheduled-text',{jobId:job.id,occurrence:chinaDate(now),text},60000)})
  }catch{results.push({job:job.id,error:'NEWS_JOB_FAILED'});process.exitCode=1}
 }
 return {results}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)try{const args=parseNewsCliArgs(process.argv.slice(2));console.log(JSON.stringify(await runNews(args)))}catch(error){const known=new Set(['INVALID_NEWS_ARGUMENTS','NEWS_JOB_NOT_FOUND_OR_DISABLED']);console.error(JSON.stringify({error:known.has(error?.message)?error.message:'NEWS_RUNNER_UNAVAILABLE'}));process.exitCode=1}
