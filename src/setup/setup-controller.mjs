import {homedir as platformHome} from 'node:os'
import {USER_GUIDE,USER_GUIDE_EN} from './user-guide.mjs'
import {doctor,installCodex,checkCodex} from './setup-core.mjs'
import {RemoteStore} from '../infrastructure/storage/registry-lock.mjs'
import {readProviderProfile} from './provider-profile.mjs'
import {readTerminalSetupStatus,terminalSetupFingerprint} from './terminal-setup-status.mjs'
import {installerCommand} from './setup-locale.mjs'

export function setupCommand(text){const commands={'使用说明':'manual',guide:'manualEn','安装向导':'wizardInfo',setup:'wizardInfoEn','安装状态':'status','setup-status':'statusEn','安装智能体':'install','install-agent':'installEn','登录智能体':'login','login-agent':'loginEn','验收智能体':'check','check-agent':'checkEn','安装帮助':'help','install-help':'helpEn'};return typeof text==='string'?commands[text.trim().toLowerCase()]??null:null}

export class SetupController{
 constructor({stateDir,accountId,home=(process.env.HOME||platformHome()),runDoctor=doctor,runInstall=installCodex,runCheck=checkCodex,runModelTest}={}){
  Object.assign(this,{stateDir,accountId,home,runDoctor,runInstall,runCheck,runModelTest});this.busy=false
 }
 async init(){return this}
 command(text){return setupCommand(text)}
 async handle(command,reply,{signal,scope=this.accountId??'owner',executionKey}={}){
  const english=command.endsWith('En');if(english)command=command.slice(0,-2)
  const setupAtHome=installerCommand('setup',{accountId:this.accountId??'default',language:english?'en':'zh'})
  if(command==='manual'){await reply(english?USER_GUIDE_EN:USER_GUIDE);return}
  if(command==='wizardInfo'){await reply(english?'Run '+setupAtHome+' on your computer and choose 2 (Configure model). Then choose subscription sign-in, DeepSeek, Qwen, or Kimi and complete a model test. Enter API keys only in your terminal.':'首次模型配置请在安装电脑运行 '+setupAtHome+'，并在菜单中选择 2。终端会引导选择订阅登录、DeepSeek、Qwen 或 Kimi，并完成模型测试。请勿把 API Key 发到微信。');return}
  if(command==='help'){await reply(english?'Complete model setup on your computer: '+setupAtHome+'.\nsetup-status: check this account and its model access\ninstall-agent: check the bundled Codex CLI\nlogin-agent: see subscription sign-in instructions\ncheck-agent: test the Codex protocol and model\nEnter third-party API keys only in your local terminal.':'安装配置在电脑终端完成，运行以下命令后选择 2：'+setupAtHome+'。\n安装状态（setup-status）：查看当前账号环境与模型接入状态\n安装智能体（install-agent）：检查项目自带的 Codex CLI\n登录智能体（login-agent）：查看订阅登录方法\n验收智能体（check-agent）：检查 Codex 协议并发起一次模型测试\n第三方模型密钥只在本机终端输入。');return}
  if(this.busy){await reply(english?'An installation check is already running. Please wait.':'当前安装检查正在执行，请等待完成。');return}
  this.busy=true
  try{
   if(command==='status'){
    const r=await this.runDoctor({home:this.home,accountId:this.accountId}),profile=await readProviderProfile(this.stateDir),verified=await readTerminalSetupStatus(this.stateDir)
    const passed=verified?.provider===(profile?.kind??'subscription')&&verified.fingerprint===terminalSetupFingerprint(profile)
    await reply(english?'Installation checks:\n'+r.checks.map(c=>(c.ok?'✓ ':'Needs attention: ')+c.name).join('\n')+'\nModel inference verification: '+(passed?'passed':'unconfirmed')+'.':'安装检查：\n'+r.checks.map(c=>(c.ok?'✓ ':'待完成：')+c.name+(c.action?'；'+c.action:'')).join('\n')+'\n模型推理验收：'+(passed?'已通过':'未确认')+'。')
    return
   }
   const root=this.stateDir.includes('/accounts/')?this.stateDir.slice(0,this.stateDir.indexOf('/accounts/')):this.stateDir
   await new RemoteStore(root).locked('codex-bootstrap',async()=>{
    if(command==='install'){await this.runInstall({home:this.home,accountId:this.accountId,signal});await reply(english?'The bundled Codex CLI is ready. Run '+setupAtHome+' on your computer and choose 2 to configure a model.':'项目自带的 Codex CLI 已就绪。首次模型配置请在安装电脑运行 '+setupAtHome+'。')}
    else if(command==='login'){await reply(english?'Run '+setupAtHome+' on your computer and choose Subscription sign-in to authorize through the official device login page.':'订阅登录请在安装电脑运行 '+setupAtHome+'，在安装菜单中选择 2，再选择“订阅登录”完成官方设备授权。')}
    else if(command==='check'){
     await this.runCheck({accountId:this.accountId,home:this.home,signal})
     if(!this.runModelTest)throw Error('MODEL_TEST_NOT_CONFIGURED')
     await this.runModelTest({signal,executionKey:executionKey??scope,reply})
     await reply(english?'Codex protocol and model inference checks passed.':'Codex 协议与模型推理验收通过。')
    }
   })
  }catch(error){if(signal?.aborted)return;const code=/^[A-Z0-9_]+$/.test(error.message)?error.message:'SETUP_OPERATION_FAILED';await reply(english?'Installation check did not finish ('+code+'). Run '+setupAtHome+' on your computer.':'安装检查未完成（'+code+'）。请在安装电脑运行 '+setupAtHome+' 检查。')}finally{this.busy=false}
 }
}
