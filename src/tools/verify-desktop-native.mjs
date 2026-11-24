// Two native clients, one isolated account profile. No login, model turn, desktop
// launch, personal config, or production conversation is accessed.
import {mkdtemp,rm,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../..',import.meta.url)),dir=await mkdtemp(join(tmpdir(),'zerolink-desktop-'))
try{
 await mkdir(join(dir,'profile'),{mode:0o700})
 const code=`
 import {CodexRpc} from './src/base/codex/codex-rpc.mjs';
 import {initializeCodex} from './src/base/codex/protocol-operations.mjs';
 const clients=[],cwd=${JSON.stringify(dir)},codexHome=cwd+'/profile';
 const create=async()=>{const rpc=new CodexRpc({binary:process.execPath,providerOptions:{args:[${JSON.stringify(join(root,'node_modules/@openai/codex/bin/codex.js'))},'app-server']},cwd,codexHome});clients.push(rpc);await initializeCodex(rpc,{name:'desktop_profile_test',version:'1.0.0'});return rpc};
 try{const first=await create(),started=await first.request('thread/start',{cwd,ephemeral:false});const id=started.thread.id;
 await first.request('thread/name/set',{threadId:id,name:'Desktop profile compatibility test'});
 const second=await create(),read=await second.request('thread/read',{threadId:id,includeTurns:false});
 const list=await second.request('thread/list',{limit:100,sourceKinds:['cli','vscode','exec','appServer','unknown'],modelProviders:[]});
 const found=list.data.some(t=>t.id===id);console.log(JSON.stringify({sameThread:read.thread?.id===id,visibleToExplicitNativeList:found,desktopUiVerified:false}));if(read.thread?.id!==id)process.exitCode=1;
 }finally{for(const rpc of clients)rpc.close()}
 `
 const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',code],{cwd:root,env:{PATH:process.env.PATH,HOME:dir,CODEX_HOME:join(dir,'profile'),...(process.platform==='win32'?{SystemRoot:process.env.SystemRoot,USERPROFILE:dir}:{})},timeout:30000,maxBuffer:65536});process.stdout.write(stdout)
}catch{process.stderr.write('DESKTOP_NATIVE_CHECK_FAILED\n');process.exitCode=1}
finally{await rm(dir,{recursive:true,force:true})}
