// Isolated Codex compatibility check: no personal home, login, model turn or WeChat.
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
const root=fileURLToPath(new URL('../..',import.meta.url)),dir=await mkdtemp(join(tmpdir(),'zerolink-management-'))
try{
 const code=`
 import {CodexRpc} from './src/base/codex/codex-rpc.mjs';
 import {createSessionProtocol} from './src/infrastructure/agents/session-protocol.mjs';
 import {managementPlugin} from './src/setup/management-plugin.mjs';
 import {managementConfiguration} from './src/infrastructure/agents/management-plugin.mjs';
 const cwd=${JSON.stringify(dir)},codexHome=cwd+'/codex';
 await managementPlugin({codexHome,stateDir:cwd+'/state'});
 const protocol=createSessionProtocol({providerEnv:{},codexHome,rpcFactory:options=>new CodexRpc({...options,binary:process.execPath,providerOptions:{...options.providerOptions,args:[${JSON.stringify(join(root,'node_modules/@openai/codex/bin/codex.js'))},...options.providerOptions.args]}})});
 const rpc=protocol.createRpc({cwd,management:managementConfiguration({socket:cwd+'/unavailable.sock',capability:'isolated-test-only'}),onEvent:()=>{},onClose:()=>{}});
 try{
  await protocol.initialize(rpc);
  const result=await protocol.open(rpc,{saved:{},cwd,instructions:'Compatibility check only. No model turn.',provider:protocol.providerOptions()});
  const skills=await rpc.request('skills/list',{cwds:[cwd],forceReload:true});
  const skill=skills.data?.flatMap(d=>d.skills??[]).find(s=>s.name==='zerolink-manage');
  const status=await rpc.request('mcpServerStatus/list',{}),server=status.data?.find(s=>s.name==='zerolink-management');
  const report={threadStarted:!!result.thread?.id,skillDiscovered:!!skill,skillEnabled:skill?.enabled===true,managementToolCount:Object.keys(server?.tools??{}).length};
  console.log(JSON.stringify(report));if(!report.threadStarted||!report.skillEnabled||report.managementToolCount!==8)process.exitCode=1;
 }finally{rpc.close()}
 `
 const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',code],{cwd:root,env:{PATH:process.env.PATH,HOME:dir,CODEX_HOME:join(dir,'codex'),...(process.platform==='win32'?{SystemRoot:process.env.SystemRoot,USERPROFILE:dir}:{})},timeout:30000,maxBuffer:65536})
 process.stdout.write(stdout)
}catch{process.stderr.write('MANAGEMENT_NATIVE_CHECK_FAILED\n');process.exitCode=1}
finally{await rm(dir,{recursive:true,force:true})}
