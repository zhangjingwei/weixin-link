import {readFile,realpath,mkdtemp,rm} from 'node:fs/promises'
import {homedir,tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {CodexRpc} from '../base/codex/codex-rpc.mjs'
import {initializeCodex} from '../base/codex/protocol-operations.mjs'
import {cases} from '../infrastructure/agents/evals/cases.mjs'
import {grade} from '../infrastructure/agents/evals/grade.mjs'

const projectRoot=fileURLToPath(new URL('../..',import.meta.url))
const skillRoot=join(projectRoot,'src/infrastructure/agents/skills')
const codexCli=join(projectRoot,'node_modules/@openai/codex/bin/codex.js')
const usage=`Usage: npm run eval:skills -- [--case ID] [--model MODEL] --codex-home DIR
       npm run eval:skills -- [--case ID] --responses FILE

Live mode calls the model using an isolated, already signed-in Codex profile.
Responses mode grades saved JSON: {"case-id": ["reply for step 1", "reply for step 2"]}.
The evaluator never starts WeChat or runs a task in the project workspace.`

function options(argv){
 const result={}
 for(let i=0;i<argv.length;i++){
  const key=argv[i]
  if(key==='--help'){result.help=true;continue}
  if(!['--case','--model','--codex-home','--responses'].includes(key)||!argv[i+1])throw Error(`Unknown or incomplete option: ${key}`)
  result[key.slice(2).replaceAll('-','_')]=argv[++i]
 }
 return result
}

async function liveAnswers(scenario,{model,codex_home}){
 const cwd=await mkdtemp(join(tmpdir(),'zerolink-skill-eval-'))
 let rpc,pending
 try{
  const replies=[]
  rpc=new CodexRpc({binary:process.execPath,cwd,codexHome:codex_home,
   providerOptions:{args:[codexCli,'app-server']},
   onEvent:message=>{
    if(!pending)return
    if(message.method==='item/completed'&&message.params?.item?.type==='agentMessage'&&message.params.item.phase==='final_answer')pending.parts.push(message.params.item.text??'')
    if(message.method==='turn/completed'){
     const current=pending;pending=null;clearTimeout(current.timer)
     message.params?.turn?.status==='completed'
      ?current.resolve(current.parts.join('\n\n'))
      :current.reject(Error(`Codex turn ended: ${message.params?.turn?.status??'unknown'}`))
    }
   },
   onClose:()=>{if(pending){const current=pending;pending=null;clearTimeout(current.timer);current.reject(Error('Codex connection closed'))}},
  })
  await initializeCodex(rpc,{name:'zerolink_skill_eval',version:'1.0.0'})
  await rpc.request('skills/extraRoots/set',{extraRoots:[skillRoot]})
  const opened=await rpc.request('thread/start',{cwd,ephemeral:true,sandbox:'read-only',approvalPolicy:'untrusted',
   developerInstructions:'这是技能评测。只回复文字，不使用工具，不写文件，不发送消息。按已加载的技能要求组织回复。',
   ...(model?{model}:{})})
  const threadId=opened.thread?.id
  if(!threadId)throw Error('Codex did not return a thread ID')
  for(let i=0;i<scenario.steps.length;i++){
   const step=scenario.steps[i]
   const input=[{type:'text',text:step.prompt}]
   if(i===0&&scenario.skill)input.push({type:'skill',name:scenario.skill,path:join(skillRoot,scenario.skill,'SKILL.md')})
   const completion=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending=null;reject(Error('Codex turn timed out'))},120000)
    pending={resolve,reject,timer,parts:[]}
   })
   try{await rpc.request('turn/start',{threadId,input})}
   catch(error){if(pending){clearTimeout(pending.timer);pending=null}completion.catch(()=>{});throw error}
   replies.push(await completion)
  }
  return replies
 }finally{rpc?.close();await rm(cwd,{recursive:true,force:true})}
}

async function main(){
 const args=options(process.argv.slice(2))
 if(args.help){console.log(usage);return}
 const selected=args.case?cases.filter(item=>item.id===args.case):cases
 if(!selected.length)throw Error(`Unknown case: ${args.case}`)
 if(args.responses&&args.codex_home)throw Error('Choose --responses or --codex-home')
 let saved
 if(args.responses){saved=JSON.parse(await readFile(resolve(args.responses),'utf8'))}
 else{
  if(!args.codex_home)throw Error(`Live mode requires --codex-home.\n${usage}`)
  const profile=await realpath(resolve(args.codex_home))
  const personal=await realpath(join(homedir(),'.codex')).catch(()=>null)
  if(profile===personal)throw Error('Use a separate Codex profile, not ~/.codex')
  args.codex_home=profile
 }
 let failed=0
 for(const scenario of selected){
  const answers=saved?saved[scenario.id]:await liveAnswers(scenario,args)
  if(!Array.isArray(answers)||answers.length!==scenario.steps.length)throw Error(`Missing replies for ${scenario.id}: expected ${scenario.steps.length}`)
  for(let i=0;i<scenario.steps.length;i++){
   const step=scenario.steps[i]
   if(!step.expect)continue
   const result=grade(answers[i],step.expect)
   if(!result.pass)failed++
   console.log(`${result.pass?'PASS':'FAIL'} ${scenario.id} step ${i+1}${result.failures.length?' — '+result.failures.join('；'):''}`)
  }
 }
 console.log(`Evaluated ${selected.length} scenarios; ${failed} failed checks.`)
 if(failed)process.exitCode=1
}

main().catch(error=>{console.error(error.message);process.exitCode=1})
