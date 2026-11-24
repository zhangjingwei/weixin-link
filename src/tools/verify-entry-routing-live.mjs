import {entryPlan} from '../domain/tasks/entry-plan.mjs'
import {readFile,writeFile,mkdir,chmod} from 'node:fs/promises'
import {dirname,isAbsolute} from 'node:path'
import {loadAgentAdapter} from '../infrastructure/agents/agent-adapter.mjs'
import {accountPaths} from '../infrastructure/accounts/account-store.mjs'
import {installConfig} from '../setup/install-config.mjs'

if(process.argv[2]!=='--live'||!isAbsolute(process.argv[3]??''))throw Error('Usage: node src/tools/verify-entry-routing-live.mjs --live /private/report.json')
const candidate=process.argv[process.argv.indexOf('--model')+1],effort=process.argv.includes('--low')?'low':'medium'
const model=process.argv.includes('--model')?candidate:null
if(model&&!['gpt-6-luna','gpt-6.1-terra','gpt-6.1-sol'].includes(model))throw Error('EVALUATION_MODEL_NOT_ALLOWED')
const ids=process.argv.includes('--ids')?process.argv[process.argv.indexOf('--ids')+1].split(','):null
const fixtures=JSON.parse(await readFile(new URL('../../tests/fixtures/entry-routing-cases.json',import.meta.url),'utf8')).filter(f=>!ids||ids.includes(f.id))
const installation=installConfig(),agent=await loadAgentAdapter(accountPaths(),installation.workspace,installation,{entryClassifierOptions:{reasoningEffort:effort,...model?{selectModel:models=>{if(!models.some(m=>m.model===model))throw Error('EVALUATION_MODEL_UNAVAILABLE');return model}}:{}}}),results=[]
const projects=[{projectId:'1',name:'日常助手',state:'running',task:null,queuedTasks:[]},{projectId:'2',name:'知识库',state:'running',task:{id:'running-search',turnId:'turn-search'},queuedTasks:[{taskId:'queued-search',title:'修复搜索'}]},{projectId:'3',name:'工具箱',state:'disconnected',task:null,queuedTasks:[]}]
try{for(const fixture of fixtures){
 const start=Date.now();let decision,error
 try{decision=await agent.classifyEntry({text:fixture.text,currentProjectId:'1',projects:[...projects,...fixture.duplicateProject?[{projectId:'4',name:'知识库',task:null,queuedTasks:[]}]:[]],pendingClarification:fixture.pendingClarification??null,currentAttachments:fixture.attachments?[{name:'测试文档.pdf',kind:'files'}]:[]})}catch(e){error=/^[A-Z_]+$/.test(e.message)?e.message:'CLASSIFIER_FAILED'}
 const rawDecision=decision
 if(!error){try{entryPlan(decision,fixture.text,[...projects,...fixture.duplicateProject?[{projectId:'4',name:'知识库'}]:[]])}catch(e){if(e.message==='ENTRY_TARGET_UNCONFIRMED')decision={action:'clarify',projectId:null};else error=e.message}}
 const passed=!error&&decision.action===fixture.action&&(!fixture.projectId||decision.projectId===fixture.projectId)&&(!fixture.taskId||decision.taskId===fixture.taskId)&&(!fixture.count||decision.steps?.length===fixture.count)&&(!fixture.dependent||decision.steps?.[1]?.dependsOn?.includes(0))&&(!fixture.useClarification||decision.useClarification)&&(!fixture.useAttachments||decision.useAttachments)
 const row={id:fixture.id,passed,latencyMs:Date.now()-start,error,decision,rawDecision};results.push(row);console.log(JSON.stringify({id:row.id,passed,latencyMs:row.latencyMs,error}))
}}finally{await agent.classifyEntry.close()}
const usage=agent.classifyEntry.statistics?.()??null
const times=results.map(r=>r.latencyMs).sort((a,b)=>a-b),report={generatedAt:new Date().toISOString(),syntheticOnly:true,executionToolsUsed:false,model:model??'budget-default',reasoningEffort:effort,usage,total:results.length,passed:results.filter(r=>r.passed).length,p50Ms:times[Math.floor(times.length*.5)],p95Ms:times[Math.min(times.length-1,Math.floor(times.length*.95))],results}
await mkdir(dirname(process.argv[3]),{recursive:true,mode:0o700});await writeFile(process.argv[3],JSON.stringify(report,null,2)+'\n',{mode:0o600});await chmod(process.argv[3],0o600)
console.log(JSON.stringify({total:report.total,passed:report.passed,p50Ms:report.p50Ms,p95Ms:report.p95Ms}));if(report.passed!==report.total)process.exitCode=1
