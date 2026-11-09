import {access} from 'node:fs/promises'
import {constants} from 'node:fs'
import {setupCommand} from './setup-controller.mjs'

export class ClaudeSetupController{
 constructor({binary,env=process.env}){this.binary=binary;this.env=env}
 async init(){return this}
 command(text){return setupCommand(text)}
 async cancelBinding(){}
 async handle(command,reply){
  if(command==='status'||command==='check'){
   let installed=false;try{await access(this.binary,constants.X_OK);installed=true}catch{}
   const credentials=!!(this.env.ANTHROPIC_API_KEY||this.env.CLAUDE_CODE_USE_BEDROCK||this.env.CLAUDE_CODE_USE_VERTEX||this.env.CLAUDE_CODE_USE_FOUNDRY)
   await reply(`Claude CLI：${installed?'已找到':'未找到'}；API 凭据：${credentials?'已提供':'未提供'}。${command==='check'?'本检查不调用模型；模型推理尚未验收。':''}`)
  }else if(command==='manual'||command==='help')await reply('当前使用 Claude 底座。直接发送需求；“状态”“结果”“停止”“列表”“新建 名称”“切换2”可用。Claude CLI 和 API 凭据由服务环境提供；模型目录、长期记忆开关、官方历史检索、归档与永久删除暂未接入。安装配置见项目 CONFIGURATION.md。')
  else if(command==='install')await reply('当前 Claude 底座未提供微信内自动安装；请在安装配置中指定已安装的 Claude CLI 绝对路径。')
  else if(command==='login')await reply('Claude 底座通过服务环境中的 Anthropic Console API 密钥或受支持云提供商凭据调用；微信不接收或保存密钥。')
  else await reply('当前 Claude 底座暂不支持该 Codex 安装或容器操作；未改动服务。')
 }
}
