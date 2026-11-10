import {execFile} from 'node:child_process'
import {promisify} from 'node:util'

const run=promisify(execFile)

export async function recentCommits(cwd){
  try{
    const {stdout}=await run('git',['-C',cwd,'log','-10','--format=%H%x09%s'],{timeout:5000,maxBuffer:32*1024})
    return stdout.split('\n').filter(Boolean).map(line=>{
      const tab=line.indexOf('\t'),sha=line.slice(0,tab),title=line.slice(tab+1).replace(/[\x00-\x1f\x7f]/g,' ').slice(0,80)
      return /^[a-f\d]{40,64}$/i.test(sha)&&tab>0?{sha,title:title||'未命名提交'}:null
    }).filter(Boolean)
  }catch{return []}
}
