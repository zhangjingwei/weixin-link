#!/usr/bin/env node
import {setupMessage,setupError,setupProgress} from './cli-output.mjs'
import {npmCommand} from './platform-command.mjs'
import {fileURLToPath} from 'node:url'
import {initInstallation,installServices,doctor,installCodex,checkCodex,setupPaths} from './setup-core.mjs'
import {deviceLogin} from './setup-login.mjs'
import {projectRoot,installConfig} from './install-config.mjs'
import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
const exec=promisify(execFile),[action='help',...args]=process.argv.slice(2).filter(arg=>arg!=='--human')
const human=process.argv.includes('--human')
const report=(action,result)=>console.log(human?setupMessage(action,result):JSON.stringify(result))
try{
 if(human&&setupProgress[action])console.log(setupProgress[action])
 if(action.startsWith('integration-')){const {runIntegrationCommand}=await import('../integrations/cli.mjs');console.log(JSON.stringify(await runIntegrationCommand(action.slice('integration-'.length),args)))}
 else if(['config-schema','config-check','config-set','config-restore','config-status'].includes(action)){const {runConfigurationAction}=await import('./config-action.mjs');const result=await runConfigurationAction(action,args);console.log(JSON.stringify(result,null,action==='config-schema'?2:0))}
 else if(action==='init')report(action,await initInstallation(args[0]?{workspace:args[0]}:{}))
 else if(action==='services')report(action,await installServices())
 else if(action==='doctor')console.log(JSON.stringify(await doctor(),null,2))
 else if(action==='deps'){const npm=npmCommand(['ci']);await exec(npm.binary,npm.args,{cwd:projectRoot,timeout:600000,maxBuffer:1024*1024});console.log(human?setupMessage(action):'Project dependencies installed, including Codex CLI and the WeChat SDK.')}
 else if(action==='codex-install')console.log(JSON.stringify(await installCodex()))
 else if(action==='codex-login')console.log(JSON.stringify(await deviceLogin({send:text=>console.log(text)})))
 else if(action==='provider-config'){const {configureProvider}=await import('./provider-config-cli.mjs');console.log(JSON.stringify(await configureProvider(args[0],args[1]??'default')))}
 else if(action==='codex-check')console.log(JSON.stringify(await checkCodex()))
 else if(action==='pair'&&human){try{const {stdout}=await exec(process.execPath,[fileURLToPath(new URL('./account-manager.mjs',import.meta.url)),'login',args[0]??'default'],{timeout:30000});report(action,JSON.parse(stdout))}catch(error){let code;try{code=JSON.parse(error.stdout).error}catch{}throw code?Error(code):error}}
 else if(action==='pair'){const child=spawn(process.execPath,[fileURLToPath(new URL('./account-manager.mjs',import.meta.url)),'login',args[0]??'default'],{stdio:'inherit'});child.on('exit',code=>{process.exitCode=code??1})}
 else if(action==='qr'){let result;for(let n=0;n<40;n++){try{const {stdout}=await exec(process.execPath,[fileURLToPath(new URL('./account-manager.mjs',import.meta.url)),'qr',args[0]??'default'],{timeout:10000});result=stdout;break}catch(error){if(n===39)throw Error('QR_NOT_READY_OR_EXPIRED');await new Promise(r=>setTimeout(r,500))}}const qr=JSON.parse(result.trim());const {accountPaths}=await import('../infrastructure/accounts/account-store.mjs');const {displayQr}=await import('./qr-display.mjs');await displayQr(qr,accountPaths(args[0]??'default').stateDir,{human});if(human)console.log(setupMessage('qr'));else console.log(result.trim())}
 else console.log('配置命令（JSON 内容通过标准输入提供）：config-schema 类型、config-check 类型、config-set 类型、config-restore 类型、config-status。核心类型：installation、backup、remote-hosts；集成配置类型由 integration-list 返回。集成命令：integration-list/status [账号]、integration-enable/disable/check/call 集成ID [账号]。\n安装顺序：\nnode src/setup/setup.mjs init [工作目录]\nnode src/setup/setup.mjs deps\nnode src/setup/setup.mjs services\nnode src/setup/setup.mjs pair [账号档案]\nnode src/setup/setup.mjs qr [账号档案]\n扫码后微信会主动推送安装向导：1 订阅登录、2 DeepSeek、3 Qwen。\n本机模型配置：node src/setup/setup.mjs provider-config deepseek|qwen|subscription [账号档案]\n诊断：node src/setup/setup.mjs doctor\n默认账号档案可省略；新档案先运行 src/setup/account-manager.mjs create。')
}catch(error){if(human){console.error(setupError(error));process.exitCode=1}else{console.error(JSON.stringify({ok:false,error:/^[A-Z0-9_]+$/.test(error.message)?error.message:error.code??'SETUP_FAILED',...(error.field?{field:error.field}:{})}));process.exitCode=1}}
