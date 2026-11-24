import {desktopWriter} from './desktop-writer.mjs'
import {lstat} from 'node:fs/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {join} from 'node:path'
import {parseConfig} from '../config/config-schema.mjs'
import {readPrivateFile} from '../config/config-files.mjs'
import {initializeCodex} from '../../base/codex/protocol-operations.mjs'
import {CodexRpc} from '../../base/codex/codex-rpc.mjs'
const exec=promisify(execFile)
const failure=code=>Error('MANAGEMENT_DESKTOP_'+code)

// Open the original thread in the same Codex home as the assistant.
export function createDesktopClient({account,codexHome,binary,workspace,platform=process.platform,providerKind='subscription',sqliteHome=process.env.CODEX_SQLITE_HOME,run=exec,inspect=lstat,rpcFactory=options=>new CodexRpc(options)}){
 async function config(){const text=await readPrivateFile(join(account.stateDir,'desktop-handoff.json'));const c=text?parseConfig('desktop',text):null;if(!c?.enabled)throw failure('DISABLED');if(platform!=='darwin')throw failure('PLATFORM_UNSUPPORTED');if(providerKind!=='subscription')throw failure('PROVIDER_UNSUPPORTED');if(sqliteHome&&sqliteHome!==codexHome)throw failure('PROFILE_LAYOUT_UNSUPPORTED');return c}
 async function running(){try{const result=await run('/bin/ps',['-axo','comm=','-ww'],{timeout:5000,maxBuffer:1024*1024});return result.stdout.split('\n').some(line=>{const name=line.trim();return ['ChatGPT','Codex'].includes(name)||['/Applications/ChatGPT.app/','/Applications/Codex.app/'].some(root=>name.startsWith(root))})}catch{throw failure('PROCESS_CHECK_FAILED')}}
 async function check(){const c=await config(),app=join('/Applications',c.app+'.app');let info;try{info=await inspect(app)}catch{throw failure('APP_NOT_FOUND')}if(!info.isDirectory()||info.isSymbolicLink())throw failure('APP_UNSAFE');const home=await inspect(codexHome);if(!home.isDirectory()||home.isSymbolicLink())throw failure('HOME_UNSAFE');return {app}}
 return {
  writer:desktopWriter({codexHome,platform,run}),
  async status(){try{await check();return {supported:true,enabled:true,running:await running(),visibilityVerified:false}}catch(e){return {supported:platform==='darwin',enabled:false,reason:/^MANAGEMENT_DESKTOP_[A-Z_]+$/.test(e.message)?e.message:'MANAGEMENT_DESKTOP_UNAVAILABLE',visibilityVerified:false}}},
  async prepare(){await check();if(await running())throw failure('APP_ALREADY_RUNNING')},
  async open(threadId,{current=()=>true}={}){if(!/^[a-zA-Z0-9_-]{1,160}$/.test(threadId))throw failure('THREAD_INVALID');const {app}=await check();if(await running())throw failure('APP_ALREADY_RUNNING');if(!current())throw failure('LAUNCH_CANCELLED');await run('/usr/bin/open',['-n','-a',app,'--env','CODEX_HOME='+codexHome,'--env','CODEX_SQLITE_HOME='+codexHome,'--url','codex://threads/'+encodeURIComponent(threadId)],{timeout:15000,maxBuffer:16384});if(!current())throw failure('LAUNCH_UNCONFIRMED');return {launched:true,visibilityVerified:false}},
  async readAfterClose(threadId,{workspace:expectedWorkspace,verifyWriter=false}={}){if(platform!=='darwin')throw failure('PLATFORM_UNSUPPORTED');const home=await inspect(codexHome);if(!home.isDirectory()||home.isSymbolicLink())throw failure('HOME_UNSAFE');const rpc=rpcFactory({cwd:workspace,binary,codexHome,providerOptions:{args:['app-server']},onEvent:()=>{},onClose:()=>{}});try{await initializeCodex(rpc,{name:'zerolink_desktop_check',version:'1.0.0'});const result=await rpc.request('thread/read',{threadId,includeTurns:false});const thread=result.thread;if(thread?.id!==threadId||expectedWorkspace&&thread.cwd!==expectedWorkspace||!['idle','notLoaded'].includes(thread.status?.type))throw failure('THREAD_NOT_IDLE');if(verifyWriter){const resumed=await rpc.request('thread/resume',{threadId,excludeTurns:true});if(resumed?.thread?.id!==threadId)throw failure('THREAD_CHANGED');await rpc.request('thread/unsubscribe',{threadId})}return {threadId:thread.id}}finally{rpc.close()}}
 }
}
