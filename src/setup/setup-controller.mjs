import {homedir as platformHome} from 'node:os'
import {InstallationWizard} from './setup-wizard.mjs'
import {USER_GUIDE} from './user-guide.mjs'
import {doctor,installCodex,checkCodex} from './setup-core.mjs'
import {deviceLogin} from './setup-login.mjs'
import {RemoteStore} from '../infrastructure/storage/registry-lock.mjs'
import {installConfig} from './install-config.mjs'
import {readProviderProfile,providerEnvironment} from './provider-profile.mjs'

export function setupCommand(text){const commands={'使用说明':'manual','安装向导':'wizard','退出向导':'wizardExit','安装状态':'status','安装智能体':'install','登录智能体':'login','验收智能体':'check','安装帮助':'help'};return typeof text==='string'?commands[text.trim()]??null:null}
export class SetupController{
 constructor({stateDir,accountId,home=(process.env.HOME||platformHome()),backend,activeProviderKind='subscription',runDoctor=doctor,runInstall=installCodex,runLogin=deviceLogin,runCheck=checkCodex,runModelTest}={}){
  Object.assign(this,{stateDir,accountId,home,backend,activeProviderKind,runDoctor,runInstall,runLogin,runCheck,runModelTest});this.busy=false
  this.wizard=new InstallationWizard({stateDir,ops:{availability:async()=>{const profile=await readProviderProfile(this.stateDir),provider=providerEnvironment(profile),r=await this.runDoctor({home:this.home,accountId:this.accountId,providerEnv:{...provider.options,...provider.secrets}});return {installed:r.codexInstalled,loggedIn:r.codexLoggedIn,profileKind:profile?.kind??null,activeKind:this.activeProviderKind}},perform:(...args)=>this.performWizard(...args),manual:reply=>reply(USER_GUIDE),errorText:e=>({SETUP_CANCELLED:'操作已取消。',CODEX_BUNDLED_RUNTIME_MISSING:'Codex 运行时尚未就绪，请在本机源码目录运行 node src/setup/setup.mjs deps。'}[e.message]??'未确认成功，请检查本机安装诊断后重试。')}})
 }
 async init(){await this.wizard.ready;return this}
 command(text,owner,executionKey){return setupCommand(text)??this.wizard.route(text,owner,executionKey)}
 async performWizard(name,state,reply,{signal,executionKey}={}){
  if(name==='modelTest'){if(!this.runModelTest)throw Error('MODEL_TEST_NOT_CONFIGURED');return this.runModelTest({signal,executionKey,reply})}
  const root=this.stateDir.includes('/accounts/')?this.stateDir.slice(0,this.stateDir.indexOf('/accounts/')):this.stateDir
  return new RemoteStore(root).locked('codex-bootstrap',async()=>{if(name==='install')return this.runInstall({home:this.home,accountId:this.accountId,signal});if(name==='login')return this.runLogin({binary:installConfig(this.home).codexBinary,accountId:this.accountId,home:this.home,send:reply,signal});if(name==='check')return this.runCheck({accountId:this.accountId,home:this.home,signal});throw Error('UNKNOWN_SETUP_STEP')})
 }
 async handle(command,reply,{signal,scope=this.accountId??'owner',executionKey}={}){
  if(command==='manual'){await reply(USER_GUIDE);return}
  if(command==='help'){await reply('安装引导（不需要 Codex 模型在线）：\n安装向导：选择 1 订阅登录、2 DeepSeek、3 Qwen\n退出向导：结束当前向导\n安装状态：环境与模型接入检查\n安装智能体：检查项目自带的 Codex CLI\n登录智能体：获取官方设备登录引导\n验收智能体：检查官方协议与原生记忆接口\n第三方模型密钥只在本机终端配置，不要发送到微信。\n远程主机、家庭设备和备份配置：直接说明需求，由智能体检查格式、连接和写入条件后处理；需要模型可用。');return}
  if(this.busy){if(command==='wizardExit'&&this.wizardOwner===scope){this.wizardAbort?.abort();await reply('已请求停止当前向导步骤。');return}await reply('当前步骤正在执行；可发送“退出向导”停止，其他选项请等待本步骤结束。');return}
  this.busy=true
  try{
   if(command==='wizard'){await this.wizard.start(scope,reply,{executionKey});return}
   if(command==='wizardExit'){await this.wizard.exit(scope,reply);return}
   if(command.startsWith('wizardChoice:')){const [,revision,n]=command.split(':');this.wizardOwner=scope;this.wizardAbort=new AbortController();const stepSignal=signal?AbortSignal.any([signal,this.wizardAbort.signal]):this.wizardAbort.signal;try{await this.wizard.choice(scope,revision,n,reply,{signal:stepSignal,executionKey})}finally{this.wizardOwner=null;this.wizardAbort=null}return}
   if(command==='status'){const r=await this.runDoctor({home:this.home,accountId:this.accountId});await reply('安装检查：\n'+r.checks.map(c=>(c.ok?'✓ ':'待完成：')+c.name+(c.action?'；'+c.action:'')).join('\n')+'\n微信在线与 Codex 就绪分别检查。');return}
   const root=this.stateDir.slice(0,this.stateDir.indexOf('/accounts/')>=0?this.stateDir.indexOf('/accounts/'):undefined)
   await new RemoteStore(root).locked('codex-bootstrap',async()=>{
    if(command==='install'){await reply('正在检查项目自带的官方 Codex CLI。');await this.runInstall({home:this.home,accountId:this.accountId,signal});await reply('Codex 运行时已就绪。下一步发送“登录智能体”。')}
    else if(command==='login'){const r=await this.runLogin({binary:installConfig(this.home).codexBinary,accountId:this.accountId,home:this.home,send:reply,signal});await reply(r.status==='already_logged_in'?'Codex 已登录，未替换现有账号。':'Codex 登录已核实。下一步发送“验收智能体”。')}
    else if(command==='check'){await this.runCheck({accountId:this.accountId,home:this.home});if(!this.runModelTest)throw Error('MODEL_TEST_NOT_CONFIGURED');await this.runModelTest({signal,executionKey:executionKey??scope,reply});await reply('Codex app-server 与模型推理验收通过。')}
   })
  }catch(error){if(signal?.aborted)return;const codes={SETUP_CANCELLED:'安装或登录进程已停止；已完成的安装文件保留，稍后可检查并继续。',CODEX_BUNDLED_RUNTIME_MISSING:'项目自带的 Codex 运行时缺失或版本不符，请在本机源码目录运行 node src/setup/setup.mjs deps。',CODEX_NOT_LOGGED_IN_OR_NOT_INSTALLED:'Codex 未安装或未登录。先发送“安装状态”。',DEVICE_LOGIN_TIMEOUT:'设备登录已超时，可再次发送“登录智能体”。',DEVICE_LOGIN_FAILED:'设备登录未完成，现有登录状态未确认为成功。',LOGIN_PROMPT_DELIVERY_UNCONFIRMED:'登录提示送达未确认，登录进程已停止。',REGISTRY_BUSY:'另一个账号正在进行安装或登录，请稍后再试。'};await reply(codes[error.message]??'安装检查或操作未完成；未确认成功。请查看安装诊断，错误代码：'+(/^[A-Z0-9_]+$/.test(error.message)?error.message:'SETUP_OPERATION_FAILED'))}finally{this.busy=false}
 }
}
