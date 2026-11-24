// macOS: a normal application quit request to the verified holder of this rollout.
import {realpath} from 'node:fs/promises'
import {join,sep} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'

export function desktopWriter({codexHome,run,platform=process.platform}){
 async function holder(path){
  let listing
  try{listing=await run('/usr/sbin/lsof',['-nP','-Fpa','--',path],{timeout:5000})}
  catch(e){if(e.code===1&&!e.stdout&&!e.stderr)return null;throw e}
  const writers=new Set()
  let pid
  for(const line of listing.stdout.split('\n')){
   if(/^p\d+$/.test(line))pid=line.slice(1)
   if(pid&&/^a[uw]$/.test(line))writers.add(pid)
  }
  if(writers.size!==1)throw Error('DESKTOP_WRITER_UNVERIFIED')
  pid=[...writers][0]
  const ps=await run('/bin/ps',['-axo','pid=,ppid=,comm=','-ww'],{timeout:5000,maxBuffer:2*1024*1024})
  const processes=new Map()
  for(const line of ps.stdout.split('\n')){
   const m=line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/)
   if(m)processes.set(m[1],{parent:m[2],exe:m[3]})
  }
  for(const app of ['ChatGPT','Codex']){
   const bundle='/Applications/'+app+'.app',main=bundle+'/Contents/MacOS/'+app
   let ancestor=pid
   for(let i=0;i<12;i++){
    const process=processes.get(ancestor)
    if(!process?.exe.startsWith(bundle+'/'))break
    if(process.exe===main)return {app,pid:ancestor,writer:pid,bundle}
    ancestor=process.parent
   }
  }
  throw Error('DESKTOP_WRITER_UNVERIFIED')
 }
 async function inspect(thread){
  if(platform!=='darwin'||!thread?.path||!thread.id)throw Error('DESKTOP_WRITER_UNVERIFIED')
  const path=await realpath(thread.path),home=await realpath(codexHome)
  if(!path.startsWith(join(home,'sessions')+sep)||!path.endsWith('-'+thread.id+'.jsonl'))throw Error('DESKTOP_WRITER_UNVERIFIED')
  return holder(path)
 }
 return {inspect,async release(thread,expected,current){
  const target=await inspect(thread)
  if(!target)return
  if(target.pid!==expected.pid||target.writer!==expected.writer||target.app!==expected.app||!current())throw Error('DESKTOP_WRITER_CHANGED')
  const script='ObjC.import("AppKit"); function run(args){const app=$.NSRunningApplication.runningApplicationWithProcessIdentifier(Number(args[0])); if (!app || ObjC.unwrap(app.bundleURL.path)!==args[1] || !app.terminate) throw Error("quit not accepted")}'
  await run('/usr/bin/osascript',['-l','JavaScript','-e',script,target.pid,target.bundle],{timeout:5000})
  for(let i=0;i<30&&current();i++){
   await delay(500)
   if(!await inspect(thread))return
  }
  throw Error('DESKTOP_WRITER_STILL_ACTIVE')
 }}
}
