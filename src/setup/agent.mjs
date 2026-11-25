import {spawn} from 'node:child_process'
import {resolve,isAbsolute} from 'node:path'
import {pathToFileURL} from 'node:url'
import {accountPaths} from '../infrastructure/accounts/account-store.mjs'
import {readAgentSelection,saveAgentSelection} from '../infrastructure/agents/agent-selection.mjs'
import {inspectClaude} from '../infrastructure/agents/claude/installation.mjs'
import {claudeEnvironment} from '../infrastructure/agents/claude/environment.mjs'
import {controlRequest} from '../infrastructure/runtime/runtime-control.mjs'

export async function agentCommand(args,{account=accountPaths(),inspect=inspectClaude,probe=controlRequest}={}){
 const [action,kind,...rest]=args
 if(action==='status')return readAgentSelection(account.stateDir)
 if(action!=='select'||!['codex','claude'].includes(kind)||kind==='codex'&&rest.length||kind==='claude'&&(rest.length!==2||rest[0]!=='--binary'||!isAbsolute(rest[1])))throw Error('用法：node src/setup/agent.mjs status | select codex | select claude --binary /绝对路径/claude')
 // Switching is local configuration, never an implicit service restart or upgrade.
 try{await probe(account.socket,'GET','/status');throw Error('AGENT_SERVICE_MUST_BE_STOPPED')}
 catch(e){if(!['ENOENT','ECONNREFUSED'].includes(e.code))throw e}
 if(kind==='claude')await inspect(rest[1])
 return saveAgentSelection(account.stateDir,{version:1,kind,...kind==='claude'?{binary:rest[1]}:{}})
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2)
 if(args[0]==='login'&&args[1]==='claude'&&args[2]==='--binary'&&isAbsolute(args[3]??'')&&args.length===4){
  const child=spawn(args[3],['auth','login'],{env:claudeEnvironment(),stdio:'inherit'});child.on('exit',code=>{process.exitCode=code??1});child.on('error',()=>{console.error('CLAUDE_CLI_UNAVAILABLE');process.exitCode=1})
 }else agentCommand(args).then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(error.message);process.exitCode=1})
}
