import {spawn} from 'node:child_process'
import {resolve,isAbsolute} from 'node:path'
import {pathToFileURL} from 'node:url'
import {accountPaths} from '../infrastructure/accounts/account-store.mjs'
import {readAgentSelection,saveAgentSelection} from '../infrastructure/agents/agent-selection.mjs'
import {inspectDoubao} from '../infrastructure/agents/doubao/installation.mjs'
import {inspectGrok} from '../infrastructure/agents/grok/installation.mjs'
import {doubaoEnvironment} from '../infrastructure/agents/doubao/environment.mjs'
import {grokEnvironment} from '../infrastructure/agents/grok/environment.mjs'
import {inspectWorkbuddy} from '../infrastructure/agents/workbuddy/installation.mjs'
import {workbuddyEnvironment} from '../infrastructure/agents/workbuddy/environment.mjs'
import {inspectSystemCodex} from '../infrastructure/agents/codex/installation.mjs'
import {inspectClaude} from '../infrastructure/agents/claude/installation.mjs'
import {claudeEnvironment} from '../infrastructure/agents/claude/environment.mjs'
import {controlRequest} from '../infrastructure/runtime/runtime-control.mjs'

export async function agentCommand(args,{account=accountPaths(),inspect=inspectClaude,inspectWorkbuddyCli=inspectWorkbuddy,inspectDoubaoCli=inspectDoubao,inspectGrokCli=inspectGrok,probe=controlRequest}={}){
 const [action,kind,...rest]=args
 if(action==='status')return readAgentSelection(account.stateDir)
 const explicit=rest.length===2&&rest[0]==='--binary'&&isAbsolute(rest[1])
 if(!['select','configure'].includes(action)||!['codex','claude','workbuddy','doubao','grok'].includes(kind)||!(explicit||action==='select'&&kind==='codex'&&!rest.length))throw Error('用法：select codex 或 configure|select <智能体> --binary /绝对路径/CLI')
 // Switching is local configuration, never an implicit service restart or upgrade.
 try{await probe(account.socket,'GET','/status');throw Error('AGENT_SERVICE_MUST_BE_STOPPED')}
 catch(e){if(!['ENOENT','ECONNREFUSED'].includes(e.code))throw e}
 if(kind==='codex'&&explicit)await inspectSystemCodex(rest[1])
 if(kind==='claude')await inspect(rest[1])
 if(kind==='workbuddy')await inspectWorkbuddyCli(rest[1])
 if(kind==='doubao')await inspectDoubaoCli(rest[1])
 if(kind==='grok')await inspectGrokCli(rest[1])
 const previous=await readAgentSelection(account.stateDir)
 return saveAgentSelection(account.stateDir,{...previous,version:1,kind:action==='configure'?previous.kind:kind,...explicit?{[kind+'Binary']:rest[1],...(action==='select'?{binary:rest[1]}:{})}:{}})
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2)
 if(args[0]==='login'&&['claude','workbuddy','doubao','grok'].includes(args[1])&&args[2]==='--binary'&&isAbsolute(args[3]??'')&&args.length===4){
  const child=spawn(args[3],args[1]==='workbuddy'?[]:args[1]==='claude'?['auth','login']:['login'],{env:({workbuddy:workbuddyEnvironment,claude:claudeEnvironment,doubao:doubaoEnvironment,grok:grokEnvironment})[args[1]](),stdio:'inherit'});child.on('exit',code=>{process.exitCode=code??1});child.on('error',()=>{console.error(args[1].toUpperCase()+'_CLI_UNAVAILABLE');process.exitCode=1})
 }else agentCommand(args).then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(error.message);process.exitCode=1})
}
