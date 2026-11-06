import {homedir as platformHome} from 'node:os'
import {BindingPermit} from './setup-binding-permit.mjs'
import {InstallationWizard} from './setup-wizard.mjs'
import {USER_GUIDE} from '../wechat/user-guide.mjs'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
const setupExec=promisify(execFile)
import {doctor,installCodex,checkCodex} from './setup-core.mjs'
import {deviceLogin} from './setup-login.mjs'
import {RemoteStore} from '../core/registry-lock.mjs'
import {installConfig} from './install-config.mjs'
export function setupCommand(text){const commands={'安装Codex':'install','登录Codex':'login','验收Codex':'check','使用说明':'manual','说明书':'manual','安装向导':'wizard','隔离参数':'containerParameters','使用宿主机':'hostChoice','安装状态':'status','安装智能体':'install','登录智能体':'login','验收智能体':'check','安装帮助':'help','创建容器':'containerCreate','登录容器':'containerLogin','使用容器':'containerBind','启动容器':'containerStart'};return typeof text==='string'?commands[text.trim()]??null:null}
export class SetupController{
 constructor({stateDir,accountId,home=(process.env.HOME||platformHome()),backend,runDoctor=doctor,runInstall=installCodex,runLogin=deviceLogin,runCheck=checkCodex,runModelTest}={}){Object.assign(this,{stateDir,accountId,home,backend,runDoctor,runInstall,runLogin,runCheck,runModelTest});this.busy=false;this.wizard=new InstallationWizard({stateDir,backend,ops:{availability:async()=>{const r=await this.runDoctor({home:this.home});return {installed:r.codexInstalled,loggedIn:r.codexLoggedIn}},perform:(...args)=>this.performWizard(...args),manual:reply=>reply(USER_GUIDE),cancelBinding:owner=>this.cancelBinding(owner),containerReadback:async()=>{try{const {containerForAccount}=await import('./setup-container.mjs');return (await containerForAccount(this.accountId,{home:this.home})).id}catch{return null}},bindingStatus:async()=>{try{return JSON.parse(await readFile(join(this.stateDir,'setup-bind-result.json'),'utf8')).status}catch{return 'unknown'}},errorText:e=>({PODMAN_NOT_READY:'Podman 未就绪，请先完成系统安装后重新选择1。',PODMAN_MEMORY_CONTROLLER_REQUIRED:'内存控制器未就绪，需要管理员配置；未修改内核。',CURRENT_TASK_BUSY:'当前还有任务，请结束后重试。',SETUP_CANCELLED:'操作已取消，已完成的文件保留。'}[e.message]??'未确认成功，停留在当前步骤；可选择1重试或3退出。')}})}
 async init(){await this.wizard.ready;return this}
 command(text,owner,executionKey){return setupCommand(text)??this.wizard.route(text,owner,executionKey)}
 async reconcileBinding(){const permits=new BindingPermit(this.stateDir),p=await permits.read();if(p?.phase!=='committing')return;const unit='wechat-setup-bind-'+createHash('sha256').update(this.accountId+p.id).digest('hex').slice(0,12);const state=await setupExec('systemctl',['--user','show',unit,'--property=ActiveState','--value'],{timeout:10000}).then(r=>r.stdout.trim()).catch(()=> 'unknown');if(['inactive','failed'].includes(state))await permits.finish(p.id)}
 async cancelBinding(owner){await this.reconcileBinding();return new BindingPermit(this.stateDir).cancel(owner)}
 async scheduleBinding(target,owner=this.accountId,signal){signal?.throwIfAborted();await this.reconcileBinding();const {containerForAccount}=await import('./setup-container.mjs');const current=await containerForAccount(this.accountId,{home:this.home});if(target&&target!==current.id)throw Error('CONTAINER_TARGET_CHANGED');signal?.throwIfAborted();const permit=await new BindingPermit(this.stateDir).issue(current.id,owner);try{signal?.throwIfAborted();await setupExec('systemd-run',['--user','--unit=wechat-setup-bind-'+createHash('sha256').update(this.accountId+permit.id).digest('hex').slice(0,12),'--collect','--property=UMask=0077','--setenv=PATH='+process.env.PATH,process.execPath,fileURLToPath(new URL('./setup-bind.mjs',import.meta.url)),this.accountId,current.id,permit.id],{timeout:15000,signal});signal?.throwIfAborted()}catch(e){await this.cancelBinding(owner);throw e}}
 async performWizard(name,state,reply,{signal,executionKey}={}){
  if(name==='modelTest'){if(!this.runModelTest)throw Error('MODEL_TEST_NOT_CONFIGURED');return this.runModelTest({signal,executionKey,reply})}
  if(name==='containerCreate'||name==='containerLogin'){const {containerSetup}=await import('./setup-container.mjs');return containerSetup(name==='containerCreate'?'container-create':'container-login',this.accountId,{home:this.home,send:reply,signal})}
  if(name==='containerBind')return this.scheduleBinding(state.target,state.owner,signal)
  if(this.backend?.kind==='podman'){
   if(name==='login')return this.runLogin({binary:'podman',prefixArgs:['exec','-i',this.backend.container,this.backend.binary],send:reply,signal})
   if(name!=='check')throw Error('CONTAINER_SETUP_USE_CONTAINER_COMMAND')
   signal?.throwIfAborted();await this.backend.preflight(['bound-owner']);const rpc=this.backend.rpcFactory({onEvent:()=>{},onClose:()=>{}});const abort=()=>rpc.close();signal?.addEventListener('abort',abort,{once:true});try{signal?.throwIfAborted();await rpc.request('initialize',{clientInfo:{name:'wechat-setup',version:'1'},capabilities:{experimentalApi:true}});rpc.write({method:'initialized',params:{}});return await rpc.request('memory/status',{})}finally{signal?.removeEventListener('abort',abort);rpc.close()}
  }
  const root=this.stateDir.includes('/accounts/')?this.stateDir.slice(0,this.stateDir.indexOf('/accounts/')):this.stateDir
  return new RemoteStore(root).locked('codex-bootstrap',async()=>{if(name==='install')return this.runInstall({home:this.home,signal});if(name==='login')return this.runLogin({binary:installConfig(this.home).codexBinary,send:reply,signal});if(name==='check')return this.runCheck({signal});throw Error('UNKNOWN_SETUP_STEP')})
 }
 async handle(command,reply,{signal,scope=this.accountId??'owner',executionKey}={}){
 if(command==='manual'){await reply(USER_GUIDE);return}
 if(command==='help'){await reply('安装引导（不需要 Codex 模型在线）：\n安装状态：环境与登录检查\n安装智能体：安装固定版本官方 CLI\n登录智能体：获取官方设备登录引导\n验收智能体：验证官方协议与原生记忆接口\n创建容器、登录容器、使用容器：准备独立运行环境\n容器账号安装与登录需在其容器环境内完成，不会复制宿主凭据。\n远程主机、家庭设备和备份配置：直接说明需求，由智能体检查格式、连接和写入条件后处理；需要模型可用。');return}
 if(this.busy){const choice=command.match(/^wizardChoice:(\d+):3$/);if(choice&&this.wizardOwner===scope&&Number(choice[1])===this.wizard.states.get(scope)?.revision){this.wizardAbort?.abort();await reply('已请求退出向导并停止当前安装步骤；已完成的文件保留。');return}await reply('当前步骤正在执行；向导中可回复3退出，其它选项请等待本步骤结束。');return}
 this.busy=true
 try{
 if(command==='wizard'){await this.wizard.start(scope,reply,{executionKey});return}
 if(command.startsWith('wizardChoice:')){const [,revision,n]=command.split(':');this.wizardOwner=scope;this.wizardAbort=new AbortController();const stepSignal=signal?AbortSignal.any([signal,this.wizardAbort.signal]):this.wizardAbort.signal;try{await this.wizard.choice(scope,revision,n,reply,{signal:stepSignal,executionKey})}finally{this.wizardOwner=null;this.wizardAbort=null}return}
 if(command==='containerParameters'){let memory=false;try{memory=(await readFile('/sys/fs/cgroup/cgroup.controllers','utf8')).split(/\s+/).includes('memory')}catch{}await reply('隔离环境默认参数：rootless Podman、独立工作目录与登录、只读根目录、内存上限1.5GiB、交换空间0、CPU上限0.5核。\n当前内核memory控制器：'+(memory?'可见，还需验证用户级委派。':'未检测到，需要管理员配置。')+'\n创建前会检查Podman及memory委派；缺失时阻断并解释，不自动改内核或重启。');return}
 if(command==='hostChoice'){await reply(this.backend?.kind==='podman'?'当前已绑定容器；切回宿主机需走独立后端切换，不能覆盖容器会话。':'已选择当前宿主机路径。发送“安装智能体”，再“登录智能体”“验收智能体”。');return}
 if(command==='containerStart'){if(this.backend?.kind!=='podman'){await reply('当前账号未绑定容器，先发送“创建容器”。');return}await setupExec('systemctl',['--user','start',this.backend.container+'.service'],{timeout:60000});await reply('容器服务已请求启动；发送“安装状态”核实，若尚未登录可发送“登录智能体”。');return}
 if(['containerCreate','containerLogin','containerBind'].includes(command)){
  if(!this.accountId)throw Error('ACCOUNT_REQUIRED')
  if(this.backend?.kind==='podman'){await reply('当前账号已经使用独立容器；登录或验收请发送“登录智能体”“验收智能体”。');return}
  const {containerSetup,containerForAccount}=await import('./setup-container.mjs')
  if(command==='containerCreate'){await reply('正在准备本账号的独立容器，需要 rootless Podman、内存控制器及联网构建能力。');await containerSetup('container-create',this.accountId,{home:this.home,send:reply,signal});await reply('容器已准备，尚未切换。发送“登录容器”完成独立授权。')}
  else if(command==='containerLogin'){const r=await containerSetup('container-login',this.accountId,{home:this.home,send:reply,signal});await reply('容器登录检查完成。发送“使用容器”进行空闲切换。')}
  else{await this.scheduleBinding(undefined,scope,signal);await reply('已安排本账号空闲后切换。仅在登录、隔离及队列预检通过后执行；实际结果请发送“安装状态”核实。')}
  return
 }
 if(command==='status'&&this.backend?.kind==='podman'){try{await this.backend.preflight(['bound-owner']);await reply('当前使用独立容器：运行、隔离配置及 Codex 登录检查通过。可发送“验收智能体”检查官方协议。')}catch{await reply('当前容器未通过就绪检查；可发送“登录智能体”，不会改动宿主凭据。')}return}
 if(command==='status'){try{const receipt=JSON.parse(await readFile(join(this.stateDir,'setup-bind-result.json'),'utf8'));if(['waiting_idle','binding_failed_or_unconfirmed'].includes(receipt.status))await reply(receipt.status==='waiting_idle'?'容器切换仍在等待账号空闲。':'上次容器切换失败或未确认，当前仍以实际运行环境为准。')}catch{}const r=await this.runDoctor({home:this.home});await reply('安装检查：\n'+r.checks.map(c=>(c.ok?'✓ ':'待完成：')+c.name+(c.action?'；'+c.action:'')).join('\n')+'\n微信在线与 Codex 就绪分别检查。');return}
 if(this.backend?.kind==='podman'){if(command==='login'){const r=await this.runLogin({binary:'podman',prefixArgs:['exec','-i',this.backend.container,this.backend.binary],send:reply,signal});await reply(r.status==='already_logged_in'?'容器 Codex 已登录，未替换账号。':'容器 Codex 登录已核实。');return}if(command!=='check')throw Error('CONTAINER_SETUP_USE_CONTAINER_COMMAND');signal?.throwIfAborted();await this.backend.preflight(['bound-owner']);const rpc=this.backend.rpcFactory({onEvent:()=>{},onClose:()=>{}});try{await rpc.request('initialize',{clientInfo:{name:'wechat-setup',version:'1'},capabilities:{experimentalApi:true}});rpc.write({method:'initialized',params:{}});await rpc.request('memory/status',{});await reply('容器内 Codex 登录与官方记忆协议检查通过；尚未进行模型推理验收。')}finally{rpc.close()}return}
 const root=this.stateDir.slice(0,this.stateDir.indexOf('/accounts/')>=0?this.stateDir.indexOf('/accounts/'):undefined)
 await new RemoteStore(root).locked('codex-bootstrap',async()=>{
 if(command==='install'){await reply('正在安装官方 Codex CLI；微信收发保持在线。');const r=await this.runInstall({home:this.home,signal});await reply(r.status==='already_installed'?'已检测到 Codex，未覆盖现有安装。可发送“验收智能体”。':'Codex 已安装。下一步发送“登录智能体”。')}
 else if(command==='login'){const r=await this.runLogin({binary:installConfig(this.home).codexBinary,send:reply,signal});await reply(r.status==='already_logged_in'?'Codex 已登录，未替换现有账号。':'Codex 登录已核实。下一步发送“验收智能体”。')}
 else if(command==='check'){const r=await this.runCheck();await reply('Codex 登录、app-server 初始化及原生记忆接口检查通过。\n此检查不调用模型，尚未证明模型推理权限；可发普通消息继续验收。')}
 })
 }catch(error){if(signal?.aborted)return;const codes={SETUP_CANCELLED:'安装或登录进程已停止；已完成的安装文件保留，稍后可检查并继续。',CONTAINER_SETUP_USE_CONTAINER_COMMAND:'当前账号运行在容器中，拒绝改动宿主 Codex。请使用安装入口的 container-login 命令完成该容器登录。',CODEX_NOT_LOGGED_IN_OR_NOT_INSTALLED:'Codex 未安装或未登录。先发送“安装状态”。',DEVICE_LOGIN_TIMEOUT:'设备登录已超时，可再次发送“登录智能体”。',DEVICE_LOGIN_FAILED:'设备登录未完成，现有登录状态未确认为成功。',LOGIN_PROMPT_DELIVERY_UNCONFIRMED:'登录提示送达未确认，登录进程已停止。',PODMAN_NOT_READY:'Podman 尚未就绪，需要先安装 rootless Podman 并启用用户服务。',PODMAN_MEMORY_CONTROLLER_REQUIRED:'容器内存控制器未就绪，需要先配置 cgroup v2 memory 委派。',CONTAINER_NOT_CREATED:'尚未创建该账号的容器，先发送“创建容器”。',REGISTRY_BUSY:'另一个账号正在进行安装或登录，请稍后再试。'};await reply(codes[error.message]??'安装检查或操作未完成；未确认成功。请查看安装诊断，错误代码：'+(/^[A-Z0-9_]+$/.test(error.message)?error.message:'SETUP_OPERATION_FAILED'))}finally{this.busy=false}
 }
}
