import {homedir as platformHome} from 'node:os'
import {USER_GUIDE,USER_GUIDE_EN} from './user-guide.mjs'
import {doctor,installCodex,checkCodex} from './setup-core.mjs'
import {RemoteStore} from '../infrastructure/storage/registry-lock.mjs'
import {installerCommand} from './setup-locale.mjs'

export function setupCommand(text){const commands={'使用说明':'manual',guide:'manualEn','安装向导':'wizardInfo',setup:'wizardInfoEn','安装智能体':'install','install-agent':'installEn','登录智能体':'login','login-agent':'loginEn','验收智能体':'check','check-agent':'checkEn','安装帮助':'help','install-help':'helpEn'};return typeof text==='string'?commands[text.trim().toLowerCase()]??null:null}

export class SetupController{
 constructor({stateDir,accountId,home=(process.env.HOME||platformHome()),runDoctor=doctor,runInstall=installCodex,runCheck=checkCodex,runModelTest,checkUpdates,skipUpdate}={}){
  Object.assign(this,{stateDir,accountId,home,runDoctor,runInstall,runCheck,runModelTest,checkUpdates,skipUpdate});this.busy=false
 }
 async init(){return this}
 command(text){return setupCommand(text)}
 async status({includeActions=false}={}){
  const r=await this.runDoctor({home:this.home,accountId:this.accountId})
  return {checks:r.checks.map(c=>({name:c.name,ok:!!c.ok,...includeActions?{action:c.action}:{}})),ready:!!r.ready,inferenceVerified:!!r.inferenceVerified}
 }
 async handle(command,reply,{signal,scope=this.accountId??'owner',executionKey}={}){
  const english=command.endsWith('En');if(english)command=command.slice(0,-2)
  const setupAtHome=installerCommand('setup',{accountId:this.accountId??'default',language:english?'en':'zh'})
  if(command==='skipUpdate'){
   let result
   try{result=this.skipUpdate?await this.skipUpdate(scope,english?'en':'zh'):english?'Skipping release notices is unavailable. No preference was changed.':'当前安装未接入版本跳过设置，未记录选择。'}
   catch{result=english?'Could not save your release choice. It has not been confirmed; try again later.':'版本选择未能确认保存，请稍后重试。'}
   await reply(result);return
  }
  if(command==='updates'){await reply(this.checkUpdates?await this.checkUpdates(english?'en':'zh'):english?'Update checking is unavailable in this installation. No upgrade was scheduled.':'当前安装未接入版本检查，未安排升级。');return}
  if(command==='manual'){await reply(english?USER_GUIDE_EN:USER_GUIDE);return}
  if(command==='wizardInfo'||command==='help'){await reply(english?'Install and sign in to the executor CLI on the host. Send a task in WeChat, then reply with an executor name.':'在主机安装并登录要用的执行器，在微信发送任务后，回复可用执行器的名称即可绑定。');return}
  if(this.busy){await reply(english?'An installation check is already running. Please wait.':'当前安装检查正在执行，请等待完成。');return}
  this.busy=true
  try{
   if(command==='status'){
    const {checks,inferenceVerified:passed}=await this.status({includeActions:true})
    await reply(english?'Installation checks:\n'+checks.map(c=>(c.ok?'✓ ':'Needs attention: ')+c.name).join('\n')+'\nModel inference verification: '+(passed?'passed':'unconfirmed')+'.':'安装检查：\n'+checks.map(c=>(c.ok?'✓ ':'待完成：')+c.name+(c.action?'；'+c.action:'')).join('\n')+'\n模型推理验收：'+(passed?'已通过':'未确认')+'。')
    return
   }
   await new RemoteStore(this.stateDir).locked('codex-bootstrap',async()=>{
    if(command==='install'){await this.runInstall({home:this.home,accountId:this.accountId,signal});await reply(english?'The system Codex CLI is ready. Reply Codex in WeChat to select it.':'系统 Codex CLI 已就绪。可在微信回复 Codex 绑定当前会话。')}
    else if(command==='login'){await reply(english?'For the Codex executor, run codex login on the host.':'使用 Codex 执行器时，在主机终端运行 codex login。')}
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
