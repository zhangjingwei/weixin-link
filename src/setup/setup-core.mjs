import {validateConfig} from './config-schema.mjs'
import {atomicConfigWrite,digest} from './config-files.mjs'
import {updateWorkspaceGuidance} from './workspace-guidance.mjs'
import {ServiceManager,supportedPlatform} from './platform-service.mjs'
import {npmCommand} from './platform-command.mjs'
import {homedir as platformHome} from 'node:os'
import {maintenanceRun} from './maintenance-run.mjs'
// Bootstrap must remain usable before npm dependencies or Codex exist.
import {access,mkdir,readFile,writeFile,rename,stat,statfs,copyFile,chmod} from 'node:fs/promises'
import {join,resolve,isAbsolute,dirname} from 'node:path'
import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
import {createHash,randomUUID} from 'node:crypto'
import {createInterface} from 'node:readline'
import {installConfig,findCodex,projectRoot} from './install-config.mjs'
export const CODEX_VERSION='0.163.0'
const exec=promisify(execFile)
const exists=async p=>{try{await access(p);return true}catch{return false}}
export function setupPaths({home=(process.env.HOME||platformHome()),root=projectRoot}={}){return {home,root,state:join(home,'.local/share/wechat-ping-bot'),units:join(home,'.config/systemd/user'),...installConfig(home)}}
export function unitText({root,node=process.execPath,template=false,home=(process.env.HOME||platformHome())}){
 const quote=s=>{if(/[\n\r\0]/.test(s))throw Error('INVALID_SERVICE_PATH');return '"'+s.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%')+'"'}
 return `# Managed by wechat-assistant setup v1\n[Unit]\nDescription=WeChat assistant${template?' account %i':''}\nAfter=network-online.target\n[Service]\nType=simple\nWorkingDirectory=${quote(resolve(root))}\nExecStart=${quote(node)} ${quote(join(resolve(root),'src/wechat/bot.mjs'))}\nEnvironment=${quote('PATH='+[dirname(node),join(home,'.local/bin'),'/usr/local/bin','/usr/bin','/bin'].join(':'))}\n${template?'Environment=WECHAT_ACCOUNT=%i\n':'Environment=WECHAT_ACCOUNT=default\n'}UMask=0077\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=30\n[Install]\nWantedBy=default.target\n`
}
export async function initInstallation({home=(process.env.HOME||platformHome()),root=projectRoot,workspace=join(home,'work/wechat-assistant')}={}){
 if(!isAbsolute(workspace)||/[\r\n\0]/.test(workspace))throw Error('INVALID_WORKSPACE')
 const paths=setupPaths({home,root});await mkdir(paths.state,{recursive:true,mode:0o700});if(process.platform==='win32')await new ServiceManager({home,root}).windows('secure','wechat-ping-bot.service');let current;try{current=JSON.parse(await readFile(join(paths.state,'installation.json'),'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
 if(current&&current.workspace!==workspace)throw Error('INSTALLATION_ALREADY_CONFIGURED')
 await mkdir(workspace,{recursive:true,mode:0o700});const guidance=await updateWorkspaceGuidance({workspace,root,codexBinary:installConfig(home).codexBinary})
 if(!current)await atomicConfigWrite(join(paths.state,'installation.json'),JSON.stringify(validateConfig('installation',{version:1,workspace,createdAt:new Date().toISOString()}))+'\n',{expected:digest(null),backup:false})
 return {initialized:true,workspace,existingAccountsPreserved:true,guidance}
}
export async function installServices({home=(process.env.HOME||platformHome()),root=projectRoot,reload=true,run=exec,platform=process.platform}={}){
 const manager=new ServiceManager({platform,home,root,run});if(platform!=='linux'){await manager.prepare('wechat-ping-bot.service');return {servicesPrepared:true,started:false}}
 const paths=setupPaths({home,root});await mkdir(paths.units,{recursive:true,mode:0o700});const prepared=[]
 for(const template of [false,true]){const name=template?'wechat-ping-bot@.service':'wechat-ping-bot.service',path=join(paths.units,name),text=unitText({root,template,home});if(await exists(path)){const old=await readFile(path,'utf8');if(old!==text&&!old.startsWith('# Managed by wechat-assistant setup v1\n'))throw Error('EXISTING_SERVICE_REQUIRES_REVIEW');if(old===text)continue}prepared.push({path,text})}
 for(const {path,text}of prepared){await writeFile(path+'.tmp',text,{mode:0o600});await rename(path+'.tmp',path)}
 if(reload)await run('systemctl',['--user','daemon-reload'],{timeout:15000})
 return {servicesPrepared:true,started:false}
}
export async function codexAvailability({home=(process.env.HOME||platformHome()),run=exec}={}){
 let installed=false,loggedIn=false;try{await run(findCodex(home),['--version'],{timeout:10000});installed=true;try{await run(findCodex(home),['login','status'],{timeout:10000});loggedIn=true}catch{}}catch{};return {installed,loggedIn}
}
export async function doctor({home=(process.env.HOME||platformHome()),root=projectRoot,run=exec,platform=process.platform,arch=process.arch}={}){
 const p=setupPaths({home,root}),checks=[];const add=(name,ok,action)=>checks.push({name,ok,action:ok?null:action})
 add('node24',Number(process.versions.node.split('.')[0])>=24,'需要 Node.js 24 或更新受支持版本')
 add('platform',supportedPlatform(platform,arch),'支持 Linux/macOS arm64/x64、Windows x64')
 add('dependencies',await exists(join(root,'node_modules/@wechatbot/wechatbot/dist/index.js')),'运行 src/setup/setup.mjs deps')
 add('ffmpeg',await exists(join(root,'node_modules/@ffmpeg-installer/'+platform+'-'+arch+'/ffmpeg'+(platform==='win32'?'.exe':''))),'运行 src/setup/setup.mjs deps 安装对应架构的可选媒体依赖')
 let patched=false;try{patched=(await readFile(join(root,'node_modules/@wechatbot/wechatbot/dist/messaging/poller.js'),'utf8')).includes('WEIXIN_CURSOR_ORDER_V2')}catch{};add('sdkPatches',patched,'运行 src/setup/setup.mjs deps 应用已审查的 SDK 补丁')
 add('installation',await exists(join(p.state,'installation.json')),'运行 src/setup/setup.mjs init')
 add('workspace',await exists(p.workspace),'运行 src/setup/setup.mjs init')
 if(platform==='linux')add('services',await exists(join(p.units,'wechat-ping-bot.service'))&&await exists(join(p.units,'wechat-ping-bot@.service')),'运行 src/setup/setup.mjs services');else if(platform==='darwin')add('services',await exists(new ServiceManager({platform,home,root,run}).plist('wechat-ping-bot.service')),'运行 src/setup/setup.mjs services');else {try{await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',"if (!(Get-ScheduledTask -TaskName 'com.wechat-assistant.wechat-ping-bot' -ErrorAction SilentlyContinue)) {exit 1}"],{timeout:10000});add('services',true)}catch{add('services',false,'运行 src/setup/setup.mjs services')}}
 if(platform==='linux')try{await run('systemctl',['--user','is-active','default.target'],{timeout:5000});add('userSystemd',true)}catch{add('userSystemd',false,'需要可用的用户级 systemd 会话；长期后台运行需配置 linger')}
 if(platform==='darwin'){try{await run('launchctl',['print','gui/'+process.getuid()],{timeout:5000});add('userLaunchd',true)}catch{add('userLaunchd',false,'需要已登录的 macOS 图形用户会话')}}
 for(const command of (platform==='linux'?['npm','python3','flock']:['npm',platform==='win32'?'python':'python3'])){try{const c=command==='npm'?npmCommand(['--version'],{platform}):{binary:command,args:['--version']};await run(c.binary,c.args,{timeout:5000});add(command,true)}catch{add(command,false,'安装 '+command)}}
 try{const fs=await statfs(home);add('disk',fs.bavail*fs.bsize>=1024**3,'至少预留 1GiB 可用空间')}catch{add('disk',false,'无法检查可用空间')}
 const {installed,loggedIn}=await codexAvailability({home,run})
 add('codexInstalled',installed,'微信发送“安装Codex”或运行 src/setup/setup.mjs codex-install');add('codexLoggedIn',loggedIn,'微信发送“登录Codex”或运行 src/setup/setup.mjs codex-login')
 const {configStatus}=await import('./config-manager.mjs');const optionalConfigurations=await configStatus({home,workspace:p.workspace})
 return {checks,optionalConfigurations,channelPrerequisitesReady:checks.filter(c=>!['codexInstalled','codexLoggedIn','disk','python3','python','ffmpeg'].includes(c.name)).every(c=>c.ok),codexInstalled:installed,codexLoggedIn:loggedIn,ready:checks.every(c=>c.ok)}
}
async function refreshGuidance(home){
 const config=installConfig(home);if(!await exists(config.workspace))return {updated:false,reason:'WORKSPACE_NOT_INITIALIZED'}
 try{return await updateWorkspaceGuidance({workspace:config.workspace,root:projectRoot,codexBinary:findCodex(home)})}catch(error){return {updated:false,error:error.code??'GUIDANCE_UPDATE_FAILED'}}
}
export async function installCodex({home=(process.env.HOME||platformHome()),run=maintenanceRun,signal}={}){
 try{await run(findCodex(home),['--version'],{timeout:10000});return {status:'already_installed',guidance:await refreshGuidance(home)}}catch{}
 const prefix=join(home,'.local/share/wechat-ping-bot/tools/codex');await mkdir(prefix,{recursive:true,mode:0o700})
 const npm=npmCommand(['install','--global','--prefix',prefix,'@openai/codex@'+CODEX_VERSION]);await run(npm.binary,npm.args,{timeout:300000,maxBuffer:1024*1024,signal})
 await run(findCodex(home),['--version'],{timeout:10000});return {status:'installed',version:CODEX_VERSION,guidance:await refreshGuidance(home)}
}
export async function checkCodex({binary=findCodex(),cwd=installConfig().workspace,timeoutMs=20000,signal}={}){
 signal?.throwIfAborted();await exec(binary,['login','status'],{timeout:10000,signal}).catch(()=>{throw Error('CODEX_NOT_LOGGED_IN_OR_NOT_INSTALLED')})
 const child=spawn(binary,['app-server','--listen','stdio://','-c','features.memories=true','-c','memories.generate_memories=true','-c','memories.use_memories=true'],{cwd,stdio:['pipe','pipe','pipe']});child.stdin.on('error',()=>{});child.stderr.on('data',()=>{})
 let line,closed=false;const result=await new Promise((ok,fail)=>{const timer=setTimeout(()=>fail(Error('CODEX_PROTOCOL_TIMEOUT')),timeoutMs);const abort=()=>{child.kill('SIGTERM');finish(Error('SETUP_CANCELLED'))};const finish=(e,v)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);e?fail(e):ok(v)};signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)return abort();line=createInterface({input:child.stdout});line.on('line',text=>{let m;try{m=JSON.parse(text)}catch{return}if(m.id===1){if(m.error)return finish(Error('CODEX_INITIALIZE_FAILED'));child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');child.stdin.write(JSON.stringify({id:2,method:'memory/status',params:{}})+'\n')}if(m.id===2)finish(m.error?Error('CODEX_MEMORY_PROTOCOL_UNSUPPORTED'):null,{protocolReady:true,memoryStatus:m.result,inferenceVerified:false})});child.on('error',()=>finish(Error('CODEX_START_FAILED')));child.on('close',()=>{closed=true;finish(Error('CODEX_CLOSED_BEFORE_READY'))});child.stdin.write(JSON.stringify({id:1,method:'initialize',params:{clientInfo:{name:'wechat-setup',version:'1'},capabilities:{experimentalApi:true}}})+'\n')}).finally(()=>{line?.close();child.stdin.destroy();if(!closed)child.kill('SIGTERM')})
 return result
}
