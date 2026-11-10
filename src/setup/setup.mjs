#!/usr/bin/env node
import {setupMessage,setupError,setupProgress,setupProgressEn} from './cli-output.mjs'
import {npmCommand} from './platform-command.mjs'
import {fileURLToPath} from 'node:url'
import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
import {languageOption} from './setup-locale.mjs'
const exec=promisify(execFile);let [action='help',...args]=process.argv.slice(2).filter(arg=>arg!=='--human')
const projectRoot=fileURLToPath(new URL('../..',import.meta.url))
const human=process.argv.includes('--human')
let language='zh'
const report=(action,result)=>console.log(human?setupMessage(action,result,language):JSON.stringify(result))
try{
 const option=languageOption(args);language=option.language;args=option.args
 if(human&&setupProgress[action])console.log((language==='en'?setupProgressEn:setupProgress)[action])
 if(action.startsWith('integration-')){const {runIntegrationCommand}=await import('../integrations/cli.mjs');console.log(JSON.stringify(await runIntegrationCommand(action.slice('integration-'.length),args)))}
 else if(['config-schema','config-check','config-set','config-restore','config-status'].includes(action)){const {runConfigurationAction}=await import('./config-action.mjs');const result=await runConfigurationAction(action,args);console.log(JSON.stringify(result,null,action==='config-schema'?2:0))}
 else if(action==='init'){const {initInstallation}=await import('./setup-core.mjs');report(action,await initInstallation(args[0]?{workspace:args[0]}:{}))}
 else if(action==='services'){const {installServices}=await import('./setup-core.mjs');report(action,await installServices())}
 else if(action==='doctor'){const {doctor}=await import('./setup-core.mjs');console.log(JSON.stringify(await doctor(),null,2))}
 else if(action==='deps'){const npm=npmCommand(['ci']);await exec(npm.binary,npm.args,{cwd:projectRoot,timeout:600000,maxBuffer:1024*1024});console.log(human?setupMessage(action,{},language):'Project dependencies installed, including Codex CLI and the WeChat SDK.')}
 else if(action==='codex-install'){const {installCodex}=await import('./setup-core.mjs');console.log(JSON.stringify(await installCodex()))}
 else if(action==='codex-login'){const {deviceLogin}=await import('./setup-login.mjs');console.log(JSON.stringify(await deviceLogin({language,send:text=>console.log(text)})))}
 else if(action==='wizard'){const {runTerminalWizard}=await import('./terminal-wizard.mjs');const result=await runTerminalWizard({accountId:args[0]??'default',language});if(!human)console.log(JSON.stringify(result))}
 else if(action==='wechat-login'){const {runWeChatLogin}=await import('./wechat-login-cli.mjs');const result=await runWeChatLogin({accountId:args.find(arg=>arg!=='--relogin')??'default',relogin:args.includes('--relogin'),human,language});if(!human)console.log(JSON.stringify(result))}
 else if(action==='provider-config'){const {configureProvider}=await import('./provider-config-cli.mjs');console.log(JSON.stringify(await configureProvider(args[0],args[1]??'default',{language})))}
 else if(action==='codex-check'){const {checkCodex}=await import('./setup-core.mjs');console.log(JSON.stringify(await checkCodex()))}
 else if(action==='pair'&&human){try{const {stdout}=await exec(process.execPath,[fileURLToPath(new URL('./account-manager.mjs',import.meta.url)),'login',args[0]??'default'],{timeout:30000});report(action,JSON.parse(stdout))}catch(error){let code;try{code=JSON.parse(error.stdout).error}catch{}throw code?Error(code):error}}
 else if(action==='pair'){const child=spawn(process.execPath,[fileURLToPath(new URL('./account-manager.mjs',import.meta.url)),'login',args[0]??'default'],{stdio:'inherit'});child.on('exit',code=>{process.exitCode=code??1})}

 else console.log(language==='en'?'Configuration commands (pass JSON through stdin): config-schema, config-check, config-set, config-restore, config-status. Core kinds: installation, backup, remote-hosts. Integration commands: integration-list/status [account], integration-enable/disable/check/call ID [account].\nFirst installation:\nnode src/setup/setup.mjs deps\nnode src/setup/setup.mjs init [workspace]\nnode src/setup/setup.mjs wizard [account] [--lang zh|en]\nnode src/setup/setup.mjs services\nnode src/setup/setup.mjs wechat-login [account] --human\nAfter unlinking WeChat: node src/setup/setup.mjs wechat-login --relogin [account] --human\nThe terminal wizard offers subscription sign-in, DeepSeek, Qwen and Kimi, and tests real model inference before WeChat pairing.\nDiagnostics: node src/setup/setup.mjs doctor\nThe default account ID may be omitted; create a named account with src/setup/account-manager.mjs create.':'配置命令（JSON 内容通过标准输入提供）：config-schema 类型、config-check 类型、config-set 类型、config-restore 类型、config-status。核心类型：installation、backup、remote-hosts；集成配置类型由 integration-list 返回。集成命令：integration-list/status [账号]、integration-enable/disable/check/call 集成ID [账号]。\n首次安装顺序：\nnode src/setup/setup.mjs deps\nnode src/setup/setup.mjs init [工作目录]\nnode src/setup/setup.mjs wizard [账号档案] [--lang zh|en]\nnode src/setup/setup.mjs services\nnode src/setup/setup.mjs wechat-login [账号档案] --human\n微信解绑后重新登录：node src/setup/setup.mjs wechat-login --relogin [账号档案] --human\n终端向导提供订阅登录、DeepSeek、Qwen、Kimi，完成真实模型测试后再扫码。扫码后微信会主动推送连接结果。\n诊断：node src/setup/setup.mjs doctor\n默认账号档案可省略；新档案先运行 src/setup/account-manager.mjs create。')
}catch(error){if(human){console.error(setupError(error,language));process.exitCode=1}else{console.error(JSON.stringify({ok:false,error:/^[A-Z0-9_]+$/.test(error.message)?error.message:error.code??'SETUP_FAILED',...(error.field?{field:error.field}:{})}));process.exitCode=1}}
